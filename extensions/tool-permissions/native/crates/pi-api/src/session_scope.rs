use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::Function;
use napi::{Env, Result};

#[derive(Debug, thiserror::Error)]
pub enum SessionScopeError {
    #[error("session state is unavailable")]
    Unavailable,
}

pub struct SessionScope<T> {
    state: Arc<Mutex<Option<T>>>,
}

impl<T> Clone for SessionScope<T> {
    fn clone(&self) -> Self {
        Self {
            state: Arc::clone(&self.state),
        }
    }
}

impl<T: 'static> SessionScope<T> {
    pub fn new(state: T) -> Self {
        Self {
            state: Arc::new(Mutex::new(Some(state))),
        }
    }

    pub fn with<R>(&self, action: impl FnOnce(&mut T) -> R) -> std::result::Result<R, SessionScopeError> {
        let _ = action;
        Err(SessionScopeError::Unavailable)
    }

    pub fn close(&self) -> std::result::Result<bool, SessionScopeError> {
        Ok(false)
    }

    pub fn shutdown_handler<'env>(&self, env: &'env Env) -> Result<Function<'env, (), bool>> {
        env.create_function_from_closure("piSessionShutdown", |_| Ok(false))
    }
}
