use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use napi::bindgen_prelude::{Function, Object, Promise};
use napi::threadsafe_function::ThreadsafeFunction;
use napi::{Env, Error, JsDeferred, Result as NapiResult, Status};
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
    #[error("prompt queue identity space exhausted")]
    IdentityExhausted,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct EnvironmentId(u64);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PromptId(u64);

static NEXT_ENVIRONMENT_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_PROMPT_ID: AtomicU64 = AtomicU64::new(1);
static ENVIRONMENTS: LazyLock<EnvironmentRegistry> = LazyLock::new(EnvironmentRegistry::default);

#[derive(Default)]
struct EnvironmentRegistry {
    live: Mutex<HashMap<usize, EnvironmentId>>,
}

impl EnvironmentRegistry {
    fn get_or_register(
        &self,
        key: usize,
        register_hook: impl FnOnce(EnvironmentId) -> NapiResult<()>,
    ) -> NapiResult<EnvironmentId> {
        let mut live = self
            .live
            .lock()
            .map_err(|_| Error::from_reason("environment registry unavailable"))?;
        if let Some(id) = live.get(&key) {
            return Ok(*id);
        }
        let id = EnvironmentId(
            next_identity(&NEXT_ENVIRONMENT_ID)
                .map_err(|error| Error::from_reason(error.to_string()))?,
        );
        register_hook(id)?;
        live.insert(key, id);
        Ok(id)
    }

    fn remove(&self, key: usize, id: EnvironmentId) {
        if let Ok(mut live) = self.live.lock() {
            if live.get(&key) == Some(&id) {
                live.remove(&key);
            }
        }
    }
}

fn next_identity(counter: &AtomicU64) -> Result<u64, PromptQueueError> {
    counter
        .try_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
            value.checked_add(1)
        })
        .map_err(|_| PromptQueueError::IdentityExhausted)
}

fn environment_id(env: &Env) -> NapiResult<EnvironmentId> {
    let key = env.raw() as usize;
    ENVIRONMENTS.get_or_register(key, |id| {
        env.add_env_cleanup_hook((key, id), cleanup_environment)?;
        Ok(())
    })
}

type PromptResolver = Box<dyn FnOnce(Env) -> NapiResult<PromptQueueResponse> + Send>;
type DeferredPrompt = JsDeferred<PromptQueueResponse, PromptResolver>;

type PresenterRef =
    ThreadsafeFunction<String, Promise<PromptQueueResolution>, String, Status, false, true>;

struct QueuedPrompt {
    request: PromptQueueRequest,
    present: Arc<PresenterRef>,
    deferred: DeferredPrompt,
    environment: EnvironmentId,
    id: PromptId,
}

struct PromptQueue<T> {
    environment: Option<EnvironmentId>,
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
        environment: EnvironmentId,
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

    fn restore_active(&mut self, environment: EnvironmentId, prompt: T) -> Option<T> {
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
    present: Function<'env, String, Promise<PromptQueueResolution>>,
) -> NapiResult<Object<'env>> {
    validate(&request).map_err(|error| Error::from_reason(error.to_string()))?;
    let environment = environment_id(env)?;
    let id = PromptId(
        next_identity(&NEXT_PROMPT_ID).map_err(|error| Error::from_reason(error.to_string()))?,
    );
    let (deferred, promise) = env.create_deferred::<PromptQueueResponse, PromptResolver>()?;
    let queued = QueuedPrompt {
        request,
        present: Arc::new(persistent_present(present)?),
        deferred,
        environment,
        id,
    };
    let should_open = NATIVE_PROMPT_QUEUE
        .lock()
        .expect("native prompt queue lock poisoned")
        .submit(environment, queued)
        .map_err(|error| Error::from_reason(error.to_string()))?
        == QueuePosition::Active;
    if should_open {
        open_next(env)?;
    }
    Ok(promise)
}

fn cleanup_environment((key, environment): (usize, EnvironmentId)) {
    ENVIRONMENTS.remove(key, environment);
    let released = match NATIVE_PROMPT_QUEUE.lock() {
        Ok(mut queue) if queue.environment == Some(environment) => queue.close(),
        _ => Vec::new(),
    };
    drop(released);
}

fn persistent_present(
    present: Function<'_, String, Promise<PromptQueueResolution>>,
) -> NapiResult<PresenterRef> {
    present
        .build_threadsafe_function::<String>()
        .weak::<true>()
        .build()
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
    if active.environment != environment_id(env)? {
        NATIVE_PROMPT_QUEUE
            .lock()
            .expect("native prompt queue lock poisoned")
            .restore_active(active.environment, active);
        return Err(Error::from_reason(
            "native prompt queue environment mismatch",
        ));
    }
    let presenter = active.present.clone();
    let environment = active.environment;
    let id = active.id;
    let abandoned = NATIVE_PROMPT_QUEUE
        .lock()
        .expect("native prompt queue lock poisoned")
        .restore_active(environment, active);
    if abandoned.is_some() {
        return Err(Error::from_reason(
            "prompt queue environment closed while opening",
        ));
    }

    let future = async move {
        let resolution = match presenter.call_async_catch(tool_call_id).await {
            Ok(promise) => promise.await.map_err(|_| ()),
            Err(_) => Err(()),
        };
        settle_active(environment, id, resolution);
    };
    if napi_async_runtime::try_spawn_detached(future).is_err() {
        settle_active(environment, id, Err(()));
    }
    Ok(())
}

fn settle_active(
    environment: EnvironmentId,
    id: PromptId,
    resolution: std::result::Result<PromptQueueResolution, ()>,
) {
    let Some(completed) = NATIVE_PROMPT_QUEUE
        .lock()
        .expect("native prompt queue lock poisoned")
        .finish_active(|prompt| prompt.environment == environment && prompt.id == id)
    else {
        return;
    };
    let response = match resolution {
        Ok(resolution) => complete(completed.request.clone(), resolution)
            .unwrap_or_else(|_| failed_response(&completed.request)),
        Err(()) => failed_response(&completed.request),
    };
    completed.deferred.resolve(Box::new(move |env| {
        if environment_id(&env)? == environment {
            open_next(&env)?;
        }
        Ok(response)
    }));
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
    fn reused_environment_address_gets_a_new_identity_and_ignores_old_cleanup() {
        let registry = super::EnvironmentRegistry::default();
        let first = registry.get_or_register(42, |_| Ok(())).unwrap();
        assert_eq!(
            registry
                .get_or_register(42, |_| panic!("already registered"))
                .unwrap(),
            first
        );
        registry.remove(42, first);
        let second = registry.get_or_register(42, |_| Ok(())).unwrap();
        assert_ne!(first, second);
        registry.remove(42, first);
        assert_eq!(
            registry
                .get_or_register(42, |_| panic!("new environment must remain live"))
                .unwrap(),
            second
        );
    }

    #[test]
    fn releases_the_next_fifo_prompt_when_the_active_prompt_settles() {
        let mut queue = super::PromptQueue::default();
        let first = super::ToolCallId::parse("call-first").unwrap();
        let second = super::ToolCallId::parse("call-second").unwrap();

        assert_eq!(
            queue.submit(super::EnvironmentId(1), first).unwrap(),
            super::QueuePosition::Active
        );
        assert_eq!(
            queue.submit(super::EnvironmentId(1), second).unwrap(),
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
    fn an_active_presenter_cannot_be_opened_twice() {
        let mut queue = super::PromptQueue::default();
        queue.submit(super::EnvironmentId(1), "prompt").unwrap();
        let prompt = queue.take_active_for_opening().unwrap();
        assert!(queue.restore_active(super::EnvironmentId(1), prompt).is_none());
        assert!(queue.take_active_for_opening().is_none(), "an already dispatched prompt must not open twice");
    }

    #[test]
    fn prompt_queue_rejects_presenter_restoration_after_environment_shutdown() {
        let mut queue = super::PromptQueue::default();
        assert_eq!(
            queue.submit(super::EnvironmentId(1), "old").unwrap(),
            super::QueuePosition::Active
        );
        let opening = queue.take_active_for_opening().unwrap();
        drop(queue.close());
        assert_eq!(
            queue.restore_active(super::EnvironmentId(1), opening),
            Some("old")
        );
        assert_eq!(
            queue.submit(super::EnvironmentId(2), "new").unwrap(),
            super::QueuePosition::Active
        );
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
            queue
                .submit(super::EnvironmentId(1), Presenter(Rc::clone(&released)))
                .unwrap(),
            super::QueuePosition::Active
        );
        assert_eq!(
            queue
                .submit(super::EnvironmentId(1), Presenter(Rc::clone(&released)))
                .unwrap(),
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
