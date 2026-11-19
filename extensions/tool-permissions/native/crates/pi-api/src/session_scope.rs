use std::sync::{Arc, Mutex};

use napi::{Env, Result};

use crate::{OnCallback, Pi};

/// An object that can register its Pi callbacks.
pub trait SessionCallbacks {
    fn register_callbacks(self, env: &Env, pi: &Pi) -> Result<()>;
}

/// Defines the callbacks installed for one revocable session object.
pub trait ScopedCallbacks: Sized + 'static {
    fn register_scoped(scope: &SessionScoped<Self>, env: &Env, pi: &Pi) -> Result<()>;
}

#[derive(Debug, thiserror::Error)]
pub enum SessionScopeError {
    #[error("session state is unavailable")]
    Unavailable,
    #[error("session state is busy")]
    Busy,
}

/// Shares an owned session object across callbacks and revokes it on shutdown.
///
/// This temporarily retains the original lock-based implementation while the
/// lifecycle contract is being introduced.
pub struct SessionScoped<T> {
    state: Arc<Mutex<Option<T>>>,
}

impl<T> Clone for SessionScoped<T> {
    fn clone(&self) -> Self {
        Self {
            state: Arc::clone(&self.state),
        }
    }
}

impl<T: 'static> SessionScoped<T> {
    pub fn new(state: T) -> Self {
        Self {
            state: Arc::new(Mutex::new(Some(state))),
        }
    }

    pub fn with<R>(
        &self,
        action: impl FnOnce(&mut T) -> R,
    ) -> std::result::Result<R, SessionScopeError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| SessionScopeError::Unavailable)?;
        let active = state.as_mut().ok_or(SessionScopeError::Unavailable)?;
        Ok(action(active))
    }

    pub fn close(&self) -> std::result::Result<bool, SessionScopeError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| SessionScopeError::Unavailable)?;
        let removed = state.take();
        drop(state);
        let was_active = removed.is_some();
        drop(removed);
        Ok(was_active)
    }
}

impl<T: ScopedCallbacks> SessionCallbacks for SessionScoped<T> {
    fn register_callbacks(self, env: &Env, pi: &Pi) -> Result<()> {
        let shutdown_scope = self.clone();
        let handler = env.create_function_from_closure("piSessionShutdown", move |_| {
            shutdown_scope
                .close()
                .map_err(|error| napi::Error::from_reason(error.to_string()))
        })?;
        let ensure_active = || {
            self.with(|_| ())
                .map_err(|error| napi::Error::from_reason(error.to_string()))
        };
        let result = pi
            .on(OnCallback::SessionShutdown, handler)
            .and_then(|()| ensure_active())
            .and_then(|()| T::register_scoped(&self, env, pi))
            .and_then(|()| ensure_active());
        if let Err(error) = result {
            let _ = self.close();
            return Err(error);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::SessionScoped;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

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
        let scope = SessionScoped::new(State {
            drops: Arc::clone(&drops),
            count: 0,
        });
        let callback = scope.clone();
        assert_eq!(
            callback
                .with(|state| {
                    state.count += 1;
                    state.count
                })
                .unwrap(),
            1
        );
        assert!(scope.close().unwrap());
        assert_eq!(drops.load(Ordering::SeqCst), 1);
        assert!(callback.with(|state| state.count).is_err());
        assert!(!scope.close().unwrap());
        assert_eq!(drops.load(Ordering::SeqCst), 1);
    }
}
