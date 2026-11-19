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

#[cfg(test)]
mod tests {
    use super::SessionScope;
    use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};

    struct State {
        drops: Arc<AtomicUsize>,
        count: u32,
    }

    impl Drop for State {
        fn drop(&mut self) {
            self.drops.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn closing_one_scope_revokes_all_handles_and_drops_state_once() {
        let drops = Arc::new(AtomicUsize::new(0));
        let scope = SessionScope::new(State { drops: Arc::clone(&drops), count: 0 });
        let callback = scope.clone();
        assert_eq!(callback.with(|state| { state.count += 1; state.count }).unwrap(), 1);
        assert!(scope.close().unwrap());
        assert_eq!(drops.load(Ordering::SeqCst), 1);
        assert!(callback.with(|state| state.count).is_err());
        assert!(!scope.close().unwrap());
        assert_eq!(drops.load(Ordering::SeqCst), 1);
    }
}
