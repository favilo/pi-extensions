//! Typed calls into the JavaScript host.
//!
//! ExtensionAPI methods hide property lookup and `.call`. Narrow host
//! callbacks, such as path canonicalization, live here too.

mod bridge;
mod on_callback;
mod path_host;
mod session_scope;

pub use bridge::{Bridge, CallbackPresence};
pub use on_callback::OnCallback;
pub use path_host::{PathHost, RealpathCallback};
pub use session_scope::{Callback, ScopedPi};

use napi::bindgen_prelude::{
    FnArgs, FromNapiValue, Function, FunctionRef, JsObjectValue, JsValue, Object, TypeName,
    Unknown, ValidateNapiValue,
};
use napi::{Env, Error, Result};

type PiFunction = FunctionRef<FnArgs<(String, Unknown<'static>)>, ()>;

/// Bound Pi methods, invoked only with a live environment on its JS thread.
pub struct Pi {
    on: PiFunction,
    register_command: PiFunction,
    register_entry_renderer: PiFunction,
}

impl TypeName for Pi {
    fn type_name() -> &'static str {
        "Pi"
    }
    fn value_type() -> napi::ValueType {
        napi::ValueType::Object
    }
}

impl ValidateNapiValue for Pi {}

impl FromNapiValue for Pi {
    unsafe fn from_napi_value(
        env: napi::sys::napi_env,
        value: napi::sys::napi_value,
    ) -> Result<Self> {
        // SAFETY: N-API supplies the live environment and value for this synchronous invocation.
        let object = unsafe { Object::from_napi_value(env, value)? };
        let bound = |name: &str| -> Result<PiFunction> {
            let method: Function<FnArgs<(String, Unknown<'static>)>, ()> = function(&object, name)?;
            method.bind(object)?.create_ref()
        };
        Ok(Self {
            on: bound("on")?,
            register_command: bound("registerCommand")?,
            register_entry_renderer: bound("registerEntryRenderer")?,
        })
    }
}

impl Pi {
    pub fn on<'env, Return>(
        &self,
        env: &'env Env,
        event: OnCallback,
        handler: Function<'env, (), Return>,
    ) -> Result<()>
    where
        Return: FromNapiValue,
    {
        self.on.borrow_back(env)?.call(FnArgs::from((
            event.as_str().to_owned(),
            handler.to_unknown(),
        )))?;
        Ok(())
    }

    pub fn register_command<'env>(
        &self,
        env: &'env Env,
        name: &str,
        description: &str,
        handler: Function<'env, (), Unknown<'static>>,
    ) -> Result<()> {
        let mut options = Object::new(env)?;
        options.set_named_property("description", description)?;
        options.set_named_property("handler", handler)?;
        self.register_command
            .borrow_back(env)?
            .call(FnArgs::from((name.to_owned(), options.to_unknown())))?;
        Ok(())
    }

    pub fn register_entry_renderer<'env>(
        &self,
        env: &'env Env,
        name: &str,
        renderer: Function<'env, (), Unknown<'static>>,
    ) -> Result<()> {
        self.register_entry_renderer
            .borrow_back(env)?
            .call(FnArgs::from((name.to_owned(), renderer.to_unknown())))?;
        Ok(())
    }
}

fn function<'env, Args, Return>(
    object: &Object<'env>,
    name: &str,
) -> Result<Function<'env, Args, Return>>
where
    Args: napi::bindgen_prelude::JsValuesTupleIntoVec,
    Return: FromNapiValue,
{
    object.get_named_property(name).map_err(|error| {
        Error::from_reason(format!(
            "value is not a Pi extension object: pi.{name} is unavailable: {error}"
        ))
    })
}

/// The `ui` object on a session context.
pub struct Ui<'env> {
    object: Object<'env>,
}

impl<'env> Ui<'env> {
    /// Returns the session UI when `hasUI` is set and the `ui` object is present.
    pub fn from_session(session_context: &Object<'env>) -> Result<Option<Self>> {
        if !session_context
            .get_named_property::<bool>("hasUI")
            .unwrap_or(false)
        {
            return Ok(None);
        }
        match session_context.get_named_property("ui") {
            Ok(object) => Ok(Some(Self { object })),
            Err(_) => Ok(None),
        }
    }

    /// Sends a notification. A missing `notify` function is ignored.
    pub fn notify(&self, message: &str, level: &str) -> Result<()> {
        let notify: Function<FnArgs<(String, String)>, ()> =
            match self.object.get_named_property("notify") {
                Ok(value) => value,
                Err(_) => return Ok(()),
            };
        notify.call(FnArgs::from((message.to_owned(), level.to_owned())))?;
        Ok(())
    }
}
