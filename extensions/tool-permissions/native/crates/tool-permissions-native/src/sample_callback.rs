use napi::bindgen_prelude::{JsObjectValue, Object, PromiseRaw};
use napi::{Env, Error, Result};
use pi_api::{OnCallback, Pi, ScopedCallbacks, SessionCallbacks, SessionScoped};
use thiserror::Error as ThisError;

#[derive(Debug, ThisError)]
enum TracerError {
    #[error("tracer event has an invalid type")]
    InvalidEvent,
    #[error("callback tracer state is unavailable")]
    Unavailable,
}

struct TracerEvent {
    name: Option<String>,
}

impl TracerEvent {
    fn parse(event_type: String, name: Option<String>) -> std::result::Result<Self, TracerError> {
        if event_type != "session_info_changed" {
            return Err(TracerError::InvalidEvent);
        }
        Ok(Self { name })
    }
}

#[derive(Default)]
struct Tracer {
    dispatch_count: u32,
}

impl Tracer {
    fn dispatch(&mut self, event: TracerEvent) -> TracerResponse {
        self.dispatch_count += 1;
        TracerResponse {
            name: event.name,
            dispatch_count: self.dispatch_count,
        }
    }
}

#[napi_derive::napi(object)]
pub struct TracerResponse {
    pub name: Option<String>,
    pub dispatch_count: u32,
}

impl ScopedCallbacks for Tracer {
    fn register_scoped(scope: &SessionScoped<Self>, env: &Env, pi: &Pi) -> Result<()> {
        let callback_state = scope.clone();
        let handler = env.create_function_from_closure("toolPermissionsTracer", move |ctx| {
            let event: Object = ctx.get(0)?;
            let event = TracerEvent::parse(
                event.get_named_property("type")?,
                event.get_named_property("name")?,
            )
            .map_err(|error| Error::from_reason(error.to_string()))?;
            let callback_state = callback_state.clone();
            PromiseRaw::resolve(ctx.env, ())?.then(move |_| {
                callback_state
                    .with(|state| state.dispatch(event))
                    .map_err(|_| Error::from_reason(TracerError::Unavailable.to_string()))
            })
        })?;
        pi.on(OnCallback::SessionInfoChanged, handler)
    }
}

pub fn register(env: &Env, pi: Object) -> Result<bool> {
    let pi = Pi::new(env, pi)?;
    register_with_pi(env, &pi)?;
    Ok(true)
}

pub fn register_with_pi(env: &Env, pi: &Pi) -> Result<()> {
    SessionScoped::new(Tracer::default()).register_callbacks(env, pi)
}
