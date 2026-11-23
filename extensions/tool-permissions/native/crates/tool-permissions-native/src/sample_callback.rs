use napi::bindgen_prelude::{JsObjectValue, Object, PromiseRaw};
use napi::{Error, JsValue, Result};
use parking_lot::Mutex;
use pi_api::{Callback, OnCallback, ScopedPi, Ui};
use std::sync::Arc;
use thiserror::Error as ThisError;

#[derive(Debug, ThisError)]
enum TracerError {
    #[error("tracer event has an invalid type")]
    InvalidEvent,
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
pub struct Tracer {
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

impl Callback for Tracer {
    fn register(self, pi: &ScopedPi<'_>) -> Result<()> {
        let state = Arc::new(Mutex::new(self));
        let dispatch = pi.guarded_callback(move |event| state.lock().dispatch(event));
        let handler =
            pi.env()
                .create_function_from_closure("toolPermissionsTracer", move |ctx| {
                    let event: Object = ctx.get(0)?;
                    let event = TracerEvent::parse(
                        event.get_named_property("type")?,
                        event.get_named_property("name")?,
                    )
                    .map_err(|error| Error::from_reason(error.to_string()))?;
                    let dispatch = dispatch.clone();
                    Ok(PromiseRaw::resolve(ctx.env, ())?
                        .then(move |_| dispatch(event))?
                        .to_unknown())
                })?;
        pi.on(OnCallback::SessionInfoChanged, handler)
    }
}

pub struct SampleCommand;

impl Callback for SampleCommand {
    fn register(self, pi: &ScopedPi<'_>) -> Result<()> {
        let handler = pi
            .env()
            .create_function_from_closure("registrationSample", |ctx| {
                let context: Object = ctx.get(1)?;
                if let Some(ui) = Ui::from_session(&context)? {
                    ui.notify("Rust sample command works.", "info")?;
                }
                ctx.get::<napi::bindgen_prelude::Unknown>(0)
            })?;
        pi.register_command(
            "registration-sample",
            "Test Rust command registration",
            handler,
        )
    }
}
