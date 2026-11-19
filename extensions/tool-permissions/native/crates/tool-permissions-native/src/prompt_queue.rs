use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex};

use napi::bindgen_prelude::{Function, FunctionRef, Object, PromiseRaw, Unknown};
use napi::{Env, Error, JsDeferred, Result as NapiResult};
use thiserror::Error;

use crate::CONTRACT_VERSION;
use crate::contract::{
    NativeOperation, PromptQueueDecision, PromptQueueRequest, PromptQueueResolution,
    PromptQueueResponse,
};

#[derive(Debug, Error)]
pub enum PromptQueueError {
    #[error("incompatible prompt-queue request")]
    Incompatible,
    #[error("native request nonce must be 1-256 characters")]
    Nonce,
    #[error("prompt is missing the tool-call id")]
    ToolCallId,
    #[error("prompt queue cannot cross N-API environments")]
    Environment,
}

pub fn validate(request: &PromptQueueRequest) -> std::result::Result<(), PromptQueueError> {
    if request.version != CONTRACT_VERSION || request.operation != "prompt_queue" {
        return Err(PromptQueueError::Incompatible);
    }
    if request.nonce.is_empty() || request.nonce.len() > 256 {
        return Err(PromptQueueError::Nonce);
    }
    ToolCallId::parse(&request.tool_call_id)?;
    Ok(())
}

pub fn complete(
    request: PromptQueueRequest,
    resolution: PromptQueueResolution,
) -> std::result::Result<PromptQueueResponse, PromptQueueError> {
    validate(&request)?;
    let tool_call_id = ToolCallId::parse(&request.tool_call_id)?;
    Ok(PromptQueueResponse {
        version: CONTRACT_VERSION,
        operation: NativeOperation::PromptQueue,
        ok: true,
        nonce: request.nonce,
        tool_call_id: tool_call_id.into_string(),
        decision: resolution.decision,
        steering: resolution.steering,
    })
}

type PromptResolver = Box<dyn FnOnce(Env) -> NapiResult<PromptQueueResponse> + Send>;
type DeferredPrompt = JsDeferred<PromptQueueResponse, PromptResolver>;

// `FunctionRef` fixes its return type at storage time. The `'static` is only a
// signature marker: it stores no PromiseRaw. `call_presenter` narrows every
// actual returned promise to the current Env before it can be used.
type PresenterRef = FunctionRef<String, PromiseRaw<'static, PromptQueueResolution>>;

struct QueuedPrompt {
    request: PromptQueueRequest,
    present: PresenterRef,
    deferred: DeferredPrompt,
    environment: usize,
}

struct PromptQueue<T> {
    environment: Option<usize>,
    active: Option<T>,
    pending: VecDeque<T>,
    opening: bool,
}

impl<T> Default for PromptQueue<T> {
    fn default() -> Self {
        Self {
            environment: None,
            active: None,
            pending: VecDeque::new(),
            opening: false,
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
enum QueuePosition {
    Active,
    Waiting,
}

impl<T> PromptQueue<T> {
    fn submit(
        &mut self,
        environment: usize,
        prompt: T,
    ) -> std::result::Result<QueuePosition, PromptQueueError> {
        match self.environment {
            Some(current) if current != environment => return Err(PromptQueueError::Environment),
            Some(_) => {}
            None => self.environment = Some(environment),
        }
        if self.active.is_none() && !self.opening {
            self.active = Some(prompt);
            Ok(QueuePosition::Active)
        } else {
            self.pending.push_back(prompt);
            Ok(QueuePosition::Waiting)
        }
    }

    fn take_active_for_opening(&mut self) -> Option<T> {
        if self.opening || self.active.is_none() {
            return None;
        }
        self.opening = true;
        self.active.take()
    }

    fn restore_active(&mut self, environment: usize, prompt: T) -> Option<T> {
        if !self.opening || self.environment != Some(environment) {
            return Some(prompt);
        }
        self.active = Some(prompt);
        self.opening = false;
        None
    }

    fn finish_active(&mut self, matches: impl FnOnce(&T) -> bool) -> Option<T> {
        if !matches(self.active.as_ref()?) {
            return None;
        }
        let completed = self.active.take();
        self.active = self.pending.pop_front();
        if self.active.is_none() {
            self.environment = None;
        }
        completed
    }

    fn close(&mut self) -> Vec<T> {
        let mut released = Vec::with_capacity(self.pending.len() + 1);
        released.extend(self.active.take());
        released.extend(self.pending.drain(..));
        self.opening = false;
        self.environment = None;
        released
    }
}

static NATIVE_PROMPT_QUEUE: LazyLock<Mutex<PromptQueue<QueuedPrompt>>> =
    LazyLock::new(|| Mutex::new(PromptQueue::default()));

pub fn decide<'env>(
    env: &'env Env,
    request: PromptQueueRequest,
    present: Function<'env, String, PromiseRaw<'static, PromptQueueResolution>>,
) -> NapiResult<Object<'env>> {
    validate(&request).map_err(|error| Error::from_reason(error.to_string()))?;
    let environment = env.raw() as usize;
    let (deferred, promise) = env.create_deferred::<PromptQueueResponse, PromptResolver>()?;
    let queued = QueuedPrompt {
        request,
        present: persistent_present(present)?,
        deferred,
        environment,
    };
    let should_open = NATIVE_PROMPT_QUEUE
        .lock()
        .expect("native prompt queue lock poisoned")
        .submit(environment, queued)
        .map_err(|error| Error::from_reason(error.to_string()))?
        == QueuePosition::Active;
    if let Err(error) = env.add_env_cleanup_hook(environment, cleanup_environment) {
        cleanup_environment(environment);
        return Err(error);
    }
    if should_open {
        open_next(env)?;
    }
    Ok(promise)
}

fn cleanup_environment(environment: usize) {
    let released = match NATIVE_PROMPT_QUEUE.lock() {
        Ok(mut queue) if queue.environment == Some(environment) => queue.close(),
        _ => Vec::new(),
    };
    drop(released);
}

fn persistent_present(
    present: Function<'_, String, PromiseRaw<'static, PromptQueueResolution>>,
) -> NapiResult<PresenterRef> {
    present.create_ref()
}

fn call_presenter<'env>(
    env: &'env Env,
    present: &PresenterRef,
    tool_call_id: String,
) -> NapiResult<PromiseRaw<'env, PromptQueueResolution>> {
    present.borrow_back(env)?.call(tool_call_id)
}

fn open_next(env: &Env) -> NapiResult<()> {
    let Some(active) = NATIVE_PROMPT_QUEUE
        .lock()
        .expect("native prompt queue lock poisoned")
        .take_active_for_opening()
    else {
        return Ok(());
    };
    let tool_call_id = active.request.tool_call_id.clone();
    if active.environment != env.raw() as usize {
        NATIVE_PROMPT_QUEUE
            .lock()
            .expect("native prompt queue lock poisoned")
            .restore_active(active.environment, active);
        return Err(Error::from_reason(
            "native prompt queue environment mismatch",
        ));
    }
    let presentation = call_presenter(env, &active.present, tool_call_id.clone());
    let abandoned = NATIVE_PROMPT_QUEUE
        .lock()
        .expect("native prompt queue lock poisoned")
        .restore_active(active.environment, active);
    if abandoned.is_some() {
        return Err(Error::from_reason(
            "prompt queue environment closed while opening",
        ));
    }

    match presentation {
        Ok(presentation) => {
            let successful_tool_call_id = tool_call_id.clone();
            let settled = presentation.then(move |context| {
                settle_active(&context.env, &successful_tool_call_id, Ok(context.value))?;
                Ok(())
            })?;
            settled.catch(
                move |context: napi::bindgen_prelude::CallbackContext<Unknown>| {
                    settle_active(&context.env, &tool_call_id, Err(()))?;
                    Ok(())
                },
            )?;
            Ok(())
        }
        Err(_) => settle_active(env, &tool_call_id, Err(())),
    }
}

fn settle_active(
    env: &Env,
    tool_call_id: &str,
    resolution: std::result::Result<PromptQueueResolution, ()>,
) -> NapiResult<()> {
    let Some(completed) = NATIVE_PROMPT_QUEUE
        .lock()
        .expect("native prompt queue lock poisoned")
        .finish_active(|prompt| prompt.request.tool_call_id == tool_call_id)
    else {
        return Ok(());
    };
    let response = match resolution {
        Ok(resolution) => complete(completed.request.clone(), resolution)
            .unwrap_or_else(|_| failed_response(&completed.request)),
        Err(()) => failed_response(&completed.request),
    };
    completed.deferred.resolve(Box::new(move |_| Ok(response)));
    open_next(env)
}

fn failed_response(request: &PromptQueueRequest) -> PromptQueueResponse {
    PromptQueueResponse {
        version: CONTRACT_VERSION,
        operation: NativeOperation::PromptQueue,
        ok: false,
        nonce: request.nonce.clone(),
        tool_call_id: request.tool_call_id.clone(),
        decision: PromptQueueDecision::Deny,
        steering: None,
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ToolCallId(String);

impl ToolCallId {
    fn parse(value: &str) -> std::result::Result<Self, PromptQueueError> {
        if value.is_empty() {
            return Err(PromptQueueError::ToolCallId);
        }
        Ok(Self(value.to_owned()))
    }

    fn into_string(self) -> String {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::complete;
    use crate::contract::{PromptQueueDecision, PromptQueueRequest, PromptQueueResolution};

    #[test]
    fn releases_the_next_fifo_prompt_when_the_active_prompt_settles() {
        let mut queue = super::PromptQueue::default();
        let first = super::ToolCallId::parse("call-first").unwrap();
        let second = super::ToolCallId::parse("call-second").unwrap();

        assert_eq!(
            queue.submit(1, first).unwrap(),
            super::QueuePosition::Active
        );
        assert_eq!(
            queue.submit(1, second).unwrap(),
            super::QueuePosition::Waiting
        );
        assert_eq!(
            queue.finish_active(|id| id == &super::ToolCallId::parse("call-first").unwrap()),
            Some(super::ToolCallId::parse("call-first").unwrap())
        );
        assert_eq!(
            queue.active,
            Some(super::ToolCallId::parse("call-second").unwrap())
        );
    }

    #[test]
    fn prompt_queue_rejects_presenter_restoration_after_environment_shutdown() {
        let mut queue = super::PromptQueue::default();
        assert_eq!(queue.submit(1, "old").unwrap(), super::QueuePosition::Active);
        let opening = queue.take_active_for_opening().unwrap();
        drop(queue.close());
        assert_eq!(queue.restore_active(1, opening), Some("old"));
        assert_eq!(queue.submit(2, "new").unwrap(), super::QueuePosition::Active);
    }

    #[test]
    fn prompt_queue_releases_owned_presenters_on_environment_shutdown() {
        use std::cell::Cell;
        use std::rc::Rc;

        struct Presenter(Rc<Cell<usize>>);
        impl Drop for Presenter {
            fn drop(&mut self) {
                self.0.set(self.0.get() + 1);
            }
        }

        let released = Rc::new(Cell::new(0));
        let mut queue = super::PromptQueue::default();
        assert_eq!(
            queue.submit(1, Presenter(Rc::clone(&released))).unwrap(),
            super::QueuePosition::Active
        );
        assert_eq!(
            queue.submit(1, Presenter(Rc::clone(&released))).unwrap(),
            super::QueuePosition::Waiting
        );
        drop(queue.close());
        assert_eq!(released.get(), 2);
    }

    #[test]
    fn presenter_reference_does_not_erase_a_promise_lifetime() {
        let source = include_str!("prompt_queue.rs");
        let implementation = source.split("#[cfg(test)]\nmod tests").next().unwrap();
        assert!(
            !implementation.contains("std::mem::transmute(reference)"),
            "the presenter reference must not forge a static promise lifetime"
        );
    }

    #[test]
    fn allow_stays_bound_to_the_tool_call_that_opened_the_prompt() {
        let response = complete(
            PromptQueueRequest {
                version: 1,
                operation: "prompt_queue".into(),
                nonce: "tool-permissions-prompt-queue".into(),
                tool_call_id: "call-allow".into(),
            },
            PromptQueueResolution {
                decision: PromptQueueDecision::Allow,
                steering: None,
            },
        )
        .unwrap();

        assert!(response.ok);
        assert_eq!(response.tool_call_id, "call-allow");
        assert!(matches!(response.decision, PromptQueueDecision::Allow));
    }
}
