use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex};

use napi::bindgen_prelude::{Function, FunctionRef, PromiseRaw, ToNapiValue, Unknown};
use napi::{Env, Error, Result as NapiResult, Status};
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

struct DeferredPrompt {
    env: napi::sys::napi_env,
    deferred: napi::sys::napi_deferred,
}

// Deferred handles are created and settled only on their owning JavaScript thread.
unsafe impl Send for DeferredPrompt {}

struct QueuedPrompt {
    request: PromptQueueRequest,
    present: FunctionRef<String, PromiseRaw<'static, PromptQueueResolution>>,
    deferred: DeferredPrompt,
}

#[cfg(test)]
#[derive(Default)]
struct PromptQueue {
    active: Option<ToolCallId>,
    pending: VecDeque<ToolCallId>,
}

#[derive(Debug, Eq, PartialEq)]
enum QueuePosition {
    Active,
    Waiting,
}

#[cfg(test)]
impl PromptQueue {
    fn submit(&mut self, tool_call_id: ToolCallId) -> QueuePosition {
        if self.active.is_none() {
            self.active = Some(tool_call_id);
            QueuePosition::Active
        } else {
            self.pending.push_back(tool_call_id);
            QueuePosition::Waiting
        }
    }

    fn complete(&mut self, tool_call_id: &ToolCallId) -> Option<ToolCallId> {
        if self.active.as_ref() != Some(tool_call_id) {
            return None;
        }
        self.active = self.pending.pop_front();
        self.active.clone()
    }
}

#[derive(Default)]
struct NativePromptQueue {
    environment: Option<usize>,
    active: Option<QueuedPrompt>,
    pending: VecDeque<QueuedPrompt>,
    opening: bool,
}

impl NativePromptQueue {
    fn submit(
        &mut self,
        environment: usize,
        prompt: QueuedPrompt,
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

    fn take_active_for_opening(&mut self) -> Option<QueuedPrompt> {
        if self.opening || self.active.is_none() {
            return None;
        }
        self.opening = true;
        self.active.take()
    }

    fn restore_active(&mut self, prompt: QueuedPrompt) {
        self.active = Some(prompt);
        self.opening = false;
    }

    fn finish_active(&mut self, tool_call_id: &str) -> Option<QueuedPrompt> {
        if self.active.as_ref()?.request.tool_call_id != tool_call_id {
            return None;
        }
        let completed = self.active.take();
        self.active = self.pending.pop_front();
        if self.active.is_none() {
            self.environment = None;
        }
        completed
    }
}

static NATIVE_PROMPT_QUEUE: LazyLock<Mutex<NativePromptQueue>> =
    LazyLock::new(|| Mutex::new(NativePromptQueue::default()));

pub fn decide<'env>(
    env: Env,
    request: PromptQueueRequest,
    present: Function<'env, String, PromiseRaw<'env, PromptQueueResolution>>,
) -> NapiResult<PromiseRaw<'env, PromptQueueResponse>> {
    validate(&request).map_err(|error| Error::from_reason(error.to_string()))?;
    let (deferred, promise) = create_deferred(env)?;
    let queued = QueuedPrompt {
        request,
        present: persistent_present(present)?,
        deferred,
    };
    let should_open = NATIVE_PROMPT_QUEUE
        .lock()
        .expect("native prompt queue lock poisoned")
        .submit(env.raw() as usize, queued)
        .map_err(|error| Error::from_reason(error.to_string()))?
        == QueuePosition::Active;
    if should_open {
        open_next(&env)?;
    }
    Ok(promise)
}

fn persistent_present<'env>(
    present: Function<'env, String, PromiseRaw<'env, PromptQueueResolution>>,
) -> NapiResult<FunctionRef<String, PromiseRaw<'static, PromptQueueResolution>>> {
    let reference = present.create_ref()?;
    // SAFETY: `FunctionRef` owns a `napi_ref`; napi-rs explicitly provides it
    // to outlive a `Function` call scope. `PromiseRaw` carries its scope only
    // in `&'env PhantomData<T>`, so this changes no pointer or owned value.
    // The erased value is private: `open_next` borrows it back only with the
    // exact `Env` captured in `DeferredPrompt`, immediately attaches `then`
    // and `catch`, and never stores or returns that `PromiseRaw`. `submit`
    // rejects a different N-API environment while work is queued, and
    // `open_next` checks the captured environment before the borrow.
    Ok(unsafe { std::mem::transmute(reference) })
}

fn create_deferred<'env>(
    env: Env,
) -> NapiResult<(DeferredPrompt, PromiseRaw<'env, PromptQueueResponse>)> {
    let mut deferred = std::ptr::null_mut();
    let mut promise = std::ptr::null_mut();
    let status = unsafe { napi::sys::napi_create_promise(env.raw(), &mut deferred, &mut promise) };
    if status != napi::sys::Status::napi_ok {
        return Err(Error::from_status(Status::from(status as i32)));
    }
    Ok((
        DeferredPrompt {
            env: env.raw(),
            deferred,
        },
        PromiseRaw::new(env.raw(), promise),
    ))
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
    if active.deferred.env != env.raw() {
        NATIVE_PROMPT_QUEUE
            .lock()
            .expect("native prompt queue lock poisoned")
            .restore_active(active);
        return Err(Error::from_reason(
            "native prompt queue environment mismatch",
        ));
    }
    let presentation = active.present.borrow_back(env)?.call(tool_call_id.clone());
    NATIVE_PROMPT_QUEUE
        .lock()
        .expect("native prompt queue lock poisoned")
        .restore_active(active);

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
        .finish_active(tool_call_id)
    else {
        return Ok(());
    };
    let response = match resolution {
        Ok(resolution) => complete(completed.request.clone(), resolution)
            .unwrap_or_else(|_| failed_response(&completed.request)),
        Err(()) => failed_response(&completed.request),
    };
    resolve(&completed.deferred, response)?;
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

fn resolve(deferred: &DeferredPrompt, response: PromptQueueResponse) -> NapiResult<()> {
    let value = unsafe { PromptQueueResponse::to_napi_value(deferred.env, response) }?;
    let status =
        unsafe { napi::sys::napi_resolve_deferred(deferred.env, deferred.deferred, value) };
    if status != napi::sys::Status::napi_ok {
        return Err(Error::from_status(Status::from(status as i32)));
    }
    Ok(())
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

        assert_eq!(queue.submit(first), super::QueuePosition::Active);
        assert_eq!(queue.submit(second), super::QueuePosition::Waiting);
        assert_eq!(
            queue.complete(&super::ToolCallId::parse("call-first").unwrap()),
            Some(super::ToolCallId::parse("call-second").unwrap())
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
