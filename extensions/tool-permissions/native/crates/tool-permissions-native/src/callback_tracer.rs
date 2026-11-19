use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::{JsObjectValue, Object, PromiseRaw};
use napi::{Env, Error, Result};
use pi_api::{OnCallback, Pi};
use thiserror::Error as ThisError;

#[derive(Debug, ThisError)]
enum TracerError {
    #[error("tracer message must not be empty")]
    EmptyMessage,
    #[error("callback tracer state is unavailable")]
    Unavailable,
}

struct TracerMessage(String);

impl TracerMessage {
    fn parse(message: String) -> std::result::Result<Self, TracerError> {
        if message.is_empty() {
            return Err(TracerError::EmptyMessage);
        }
        Ok(Self(message))
    }
}

#[derive(Default)]
struct TracerState {
    dispatch_count: u32,
}

impl TracerState {
    fn dispatch(&mut self, message: TracerMessage) -> TracerResponse {
        self.dispatch_count += 1;
        TracerResponse {
            message: message.0,
            dispatch_count: self.dispatch_count,
        }
    }
}

#[napi_derive::napi(object)]
pub struct TracerResponse {
    pub message: String,
    pub dispatch_count: u32,
}

pub fn register(env: &Env, pi: Object) -> Result<bool> {
    let pi = Pi::new(env, pi)?;
    let state = Arc::new(Mutex::new(Some(TracerState::default())));
    let callback_state = Arc::clone(&state);
    let handler = env.create_function_from_closure("toolPermissionsTracer", move |ctx| {
        let event: Object = ctx.get(0)?;
        let message = TracerMessage::parse(event.get_named_property("message")?)
            .map_err(|error| Error::from_reason(error.to_string()))?;
        let callback_state = Arc::clone(&callback_state);
        PromiseRaw::resolve(ctx.env, ())?.then(move |_| {
            let mut state = callback_state
                .lock()
                .map_err(|_| Error::from_reason(TracerError::Unavailable.to_string()))?;
            let active = state
                .as_mut()
                .ok_or_else(|| Error::from_reason(TracerError::Unavailable.to_string()))?;
            Ok(active.dispatch(message))
        })
    })?;
    let shutdown_state = Arc::clone(&state);
    let shutdown = env.create_function_from_closure("toolPermissionsTracerShutdown", move |_| {
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
