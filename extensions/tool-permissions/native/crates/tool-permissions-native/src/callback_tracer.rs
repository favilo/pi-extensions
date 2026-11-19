use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::{JsObjectValue, Object};
use napi::{Env, Error, Result};
use pi_api::{OnCallback, Pi};

#[derive(Default)]
struct TracerState {
    dispatch_count: u32,
}

impl TracerState {
    fn dispatch(&mut self, message: String) -> TracerResponse {
        self.dispatch_count += 1;
        TracerResponse {
            message,
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
    let state = Arc::new(Mutex::new(TracerState::default()));
    let handler = env.create_function_from_closure("toolPermissionsTracer", move |ctx| {
        let event: Object = ctx.get(0)?;
        let message: String = event.get_named_property("message")?;
        let mut state = state
            .lock()
            .map_err(|_| Error::from_reason("callback tracer state is unavailable"))?;
        Ok(state.dispatch(message))
    })?;
    pi.on(OnCallback::SessionInfoChanged, handler)?;
    Ok(true)
}
