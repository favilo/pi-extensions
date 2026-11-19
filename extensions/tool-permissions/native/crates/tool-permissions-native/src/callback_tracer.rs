use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::{JsObjectValue, Object, PromiseRaw};
use napi::{Env, Error, Result};
use pi_api::{OnCallback, Pi};
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
struct TracerState {
    dispatch_count: u32,
}

impl TracerState {
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

pub fn register(env: &Env, pi: Object) -> Result<bool> {
    let pi = Pi::new(env, pi)?;
    let state = Arc::new(Mutex::new(Some(TracerState::default())));
    let callback_state = Arc::clone(&state);
    let handler = env.create_function_from_closure("toolPermissionsTracer", move |ctx| {
        let event: Object = ctx.get(0)?;
        let event = TracerEvent::parse(
            event.get_named_property("type")?,
            event.get_named_property("name")?,
        )
        .map_err(|error| Error::from_reason(error.to_string()))?;
        let callback_state = Arc::clone(&callback_state);
        PromiseRaw::resolve(ctx.env, ())?.then(move |_| {
            let mut state = callback_state
                .lock()
                .map_err(|_| Error::from_reason(TracerError::Unavailable.to_string()))?;
            let active = state
                .as_mut()
                .ok_or_else(|| Error::from_reason(TracerError::Unavailable.to_string()))?;
            Ok(active.dispatch(event))
        })
    })?;
    let shutdown_state = Arc::clone(&state);
    let shutdown =
        env.create_function_from_closure("toolPermissionsTracerShutdown", move |_| {
            let mut state = shutdown_state
                .lock()
                .map_err(|_| Error::from_reason(TracerError::Unavailable.to_string()))?;
            Ok(state.take().is_some())
        })?;
    let result = pi
        .on(OnCallback::SessionShutdown, shutdown)
        .and_then(|()| pi.on(OnCallback::SessionInfoChanged, handler));
    if let Err(error) = result {
        if let Ok(mut state) = state.lock() {
            state.take();
        }
        return Err(error);
    }
    Ok(true)
}
