use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use napi::bindgen_prelude::{FnArgs, Function, PromiseRaw, Unknown};
use napi::{Env, JsValue, Result};

use crate::{OnCallback, Pi};

/// A Rust callback that registers its handlers through a session facade.
pub trait Callback: Sized + 'static {
    fn register(self, pi: &ScopedPi<'_>) -> Result<()>;
}

#[derive(Clone, Default)]
struct SessionToken(Arc<AtomicBool>);

impl SessionToken {
    fn ensure_active(&self) -> Result<()> {
        if self.0.load(Ordering::Acquire) {
            Err(napi::Error::from_reason("session state is unavailable"))
        } else {
            Ok(())
        }
    }

    fn close(&self) -> bool {
        !self.0.swap(true, Ordering::AcqRel)
    }

    fn guarded_callback<A: 'static, R: 'static>(
        &self,
        action: impl Fn(A) -> R + Clone + 'static,
    ) -> impl Fn(A) -> Result<R> + Clone + 'static {
        let token = self.clone();
        move |arg| {
            token.ensure_active()?;
            Ok(action(arg))
        }
    }
}

/// Rust-only registration facade; all its callbacks share one shutdown lifetime.
pub struct ScopedPi<'a> {
    env: &'a Env,
    pi: &'a Pi,
    token: SessionToken,
}

impl<'a> ScopedPi<'a> {
    pub fn new(env: &'a Env, pi: &'a Pi) -> Result<Self> {
        let token = SessionToken::default();
        let shutdown_token = token.clone();
        let handler = env.create_function_from_closure("piSessionShutdown", move |_| {
            Ok(shutdown_token.close())
        })?;
        pi.on(env, OnCallback::SessionShutdown, handler)?;
        token.ensure_active()?;
        Ok(Self { env, pi, token })
    }

    pub fn register_callback<T: Callback>(&self, callback: T) -> Result<()> {
        self.token.ensure_active()?;
        if let Err(error) = callback.register(self) {
            self.token.close();
            return Err(error);
        }
        self.token.ensure_active()
    }

    pub fn env(&self) -> &'a Env {
        self.env
    }

    pub fn guarded_callback<A: 'static, R: 'static>(
        &self,
        action: impl Fn(A) -> R + Clone + 'static,
    ) -> impl Fn(A) -> Result<R> + Clone + 'static {
        self.token.guarded_callback(action)
    }

    pub fn on(
        &self,
        event: OnCallback,
        handler: Function<'a, FnArgs<(Unknown<'static>, Unknown<'static>)>, Unknown<'static>>,
    ) -> Result<()> {
        let handler = handler.create_ref()?;
        let token = self.token.clone();
        let guarded = self
            .env
            .create_function_from_closure("scopedEvent", move |ctx| {
                if token.ensure_active().is_err() {
                    return Ok(
                        PromiseRaw::<()>::reject(ctx.env, "session state is unavailable")?
                            .to_unknown(),
                    );
                }
                let event: Unknown = ctx.get(0)?;
                let context: Unknown = ctx.get(1)?;
                handler
                    .borrow_back(ctx.env)?
                    .call(FnArgs::from((event, context)))
            })?;
        self.pi.on(self.env, event, guarded)
    }

    pub fn register_command(
        &self,
        name: &str,
        description: &str,
        handler: Function<'a, FnArgs<(Unknown<'static>, Unknown<'static>)>, Unknown<'static>>,
    ) -> Result<()> {
        let handler = handler.create_ref()?;
        let token = self.token.clone();
        let guarded = self
            .env
            .create_function_from_closure("scopedCommand", move |ctx| {
                token.ensure_active()?;
                let args: Unknown = ctx.get(0)?;
                let context: Unknown = ctx.get(1)?;
                handler
                    .borrow_back(ctx.env)?
                    .call(FnArgs::from((args, context)))
            })?;
        self.pi
            .register_command(self.env, name, description, guarded)
    }
}

#[cfg(test)]
mod tests {
    use super::SessionToken;

    #[test]
    fn shutdown_revokes_all_token_clones_once() {
        let token = SessionToken::default();
        let clone = token.clone();
        assert!(clone.ensure_active().is_ok());
        assert!(token.close());
        assert!(!clone.close());
        assert!(clone.ensure_active().is_err());
    }
}
