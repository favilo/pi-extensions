//! Typed calls into the JavaScript host.
//!
//! ExtensionAPI methods hide property lookup and `.call`. Narrow host
//! callbacks, such as path canonicalization, live here too.

mod bridge;
mod on_callback;
mod path_host;
mod session_scope;

pub use session_scope::{SessionScope, SessionScopeError};
pub use bridge::{Bridge, CallbackPresence};
pub use on_callback::OnCallback;
pub use path_host::{PathHost, RealpathCallback};

use napi::bindgen_prelude::{
    FnArgs, FromNapiValue, Function, JsObjectValue, JsValue, Object, Unknown,
};
use napi::{Env, Error, Result};

type OnFunction<'scope> = Function<'scope, FnArgs<(String, Unknown<'scope>)>, ()>;
type RegisterCommandFunction<'scope> = Function<'scope, FnArgs<(String, Object<'scope>)>, ()>;
type RegisterEntryRendererFunction<'scope> =
    Function<'scope, FnArgs<(String, Function<'scope, (), Unknown<'static>>)>, ()>;

/// The `pi` object passed to an extension entrypoint.
pub struct Pi<'scope> {
    env: &'scope Env,
    on: OnFunction<'scope>,
    register_command: RegisterCommandFunction<'scope>,
    register_entry_renderer: RegisterEntryRendererFunction<'scope>,
}

impl<'scope> Pi<'scope> {
    /// Returns the wrapper when `object` exposes the Pi methods this crate calls.
    ///
    /// `on`, `registerCommand`, and `registerEntryRenderer` are stored here.
    /// The check does not call them.
    pub fn new(env: &'scope Env, object: Object<'scope>) -> Result<Self> {
        Ok(Self {
            env,
            on: function(&object, "on")?,
            register_command: function(&object, "registerCommand")?,
            register_entry_renderer: function(&object, "registerEntryRenderer")?,
        })
    }

    pub fn on<Return>(&self, event: OnCallback, handler: Function<'scope, (), Return>) -> Result<()>
    where
        Return: FromNapiValue,
    {
        self.on.call(FnArgs::from((
            event.as_str().to_owned(),
            handler.to_unknown(),
        )))?;
        Ok(())
    }

    pub fn register_command(
        &self,
        name: &str,
        description: &str,
        handler: Function<'scope, (), Unknown<'static>>,
    ) -> Result<()> {
        let mut options = Object::new(self.env)?;
        options.set_named_property("description", description)?;
        options.set_named_property("handler", handler)?;
        self.register_command
            .call(FnArgs::from((name.to_owned(), options)))?;
        Ok(())
    }

    pub fn register_entry_renderer(
        &self,
        name: &str,
        renderer: Function<'scope, (), Unknown<'static>>,
    ) -> Result<()> {
        self.register_entry_renderer
            .call(FnArgs::from((name.to_owned(), renderer)))?;
        Ok(())
    }
}

fn function<'scope, Args, Return>(
    object: &Object<'scope>,
    name: &str,
) -> Result<Function<'scope, Args, Return>>
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
pub struct Ui<'scope> {
    object: Object<'scope>,
}

impl<'scope> Ui<'scope> {
    /// Returns the session UI when `hasUI` is set and the `ui` object is present.
    pub fn from_session(session_context: &Object<'scope>) -> Result<Option<Self>> {
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
