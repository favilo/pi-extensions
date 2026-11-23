use crate::{OnCallback, Pi};
use napi::bindgen_prelude::{FnArgs, Function, FunctionRef, JsObjectValue, Object, Unknown};
use napi::{Env, Error, Result};

/// Whether a source property must exist before `pi.on` is called.
pub enum CallbackPresence {
    /// Fail when the property is missing or not a function.
    Required,
    /// Skip registration when the property is missing.
    IfPresent,
    /// Register even when the property is missing.
    Always,
}

/// `pi` plus the JavaScript object that holds behavior callbacks.
pub struct Bridge<'scope> {
    env: &'scope Env,
    pi: Pi,
    source: Option<Object<'scope>>,
}

type EventCallback = FunctionRef<FnArgs<(Unknown<'static>, Unknown<'static>)>, Unknown<'static>>;

impl<'scope> Bridge<'scope> {
    pub fn new(env: &'scope Env, pi: Pi, source: Option<Object<'scope>>) -> Result<Self> {
        Ok(Self { env, pi, source })
    }

    pub fn env(&self) -> &'scope Env {
        self.env
    }

    pub fn pi(&self) -> &Pi {
        &self.pi
    }

    pub fn source(&self) -> Option<Object<'scope>> {
        self.source
    }

    /// Forward a two-argument `(event, context)` callback to `pi.on`.
    ///
    /// Returns whether `pi.on` was called. `before` runs at the start of the
    /// handler when the context argument is an object. The call does not
    /// authorize a tool.
    pub fn forward_on(
        &self,
        event: OnCallback,
        property: &str,
        presence: CallbackPresence,
        before: Option<fn(&Object) -> Result<()>>,
    ) -> Result<bool> {
        let callback = match self.event_callback(property)? {
            Some(callback) => Some(callback),
            None => match presence {
                CallbackPresence::Required => {
                    return Err(Error::from_reason(format!(
                        "{property} bridge is unavailable"
                    )));
                }
                CallbackPresence::IfPresent => return Ok(false),
                CallbackPresence::Always => None,
            },
        };

        if let Some(callback) = callback {
            let handler = self
                .env
                .create_function_from_closure(event.as_str(), move |ctx| {
                    let event_value: Unknown = ctx.get(0)?;
                    let extension_context: Unknown = ctx.get(1)?;
                    if let (Some(before), Ok(session_context)) = (before, ctx.get::<Object>(1)) {
                        before(&session_context)?;
                    }
                    let callback = callback.borrow_back(ctx.env)?;
                    callback.call(FnArgs::from((event_value, extension_context)))
                })?;
            self.pi.on(self.env, event, handler)?;
        } else {
            let handler = self
                .env
                .create_function_from_closure(event.as_str(), move |ctx| {
                    if let (Some(before), Ok(session_context)) = (before, ctx.get::<Object>(1)) {
                        before(&session_context)?;
                    }
                    Ok(())
                })?;
            self.pi.on(self.env, event, handler)?;
        }
        Ok(true)
    }

    fn event_callback(&self, property: &str) -> Result<Option<EventCallback>> {
        let Some(source) = self.source else {
            return Ok(None);
        };
        match source.get_named_property::<Function<FnArgs<(Unknown<'static>, Unknown<'static>)>, Unknown<'static>>>(property) {
            Ok(function) => Ok(Some(function.create_ref()?)),
            Err(_) => Ok(None),
        }
    }
}
