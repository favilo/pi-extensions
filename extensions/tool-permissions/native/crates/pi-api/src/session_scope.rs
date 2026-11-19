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
/// Calls never run while the lifecycle mutex is held. Concurrent or reentrant
/// access returns `Busy`; shutdown revokes access and drops an in-flight object
/// when its current synchronous operation returns.
pub struct SessionScoped<T> {
    state: Arc<Mutex<Lifecycle<T>>>,
}

enum Lifecycle<T> {
    Active(T),
    Busy,
    Closed,
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
            state: Arc::new(Mutex::new(Lifecycle::Active(state))),
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
        let object = match std::mem::replace(&mut *state, Lifecycle::Busy) {
            Lifecycle::Active(object) => object,
            Lifecycle::Busy => return Err(SessionScopeError::Busy),
            Lifecycle::Closed => {
                *state = Lifecycle::Closed;
                return Err(SessionScopeError::Unavailable);
            }
        };
        drop(state);
        let mut lease = SessionLease {
            scope: self,
            object: Some(object),
        };
        Ok(action(
            lease.object.as_mut().expect("session lease owns object"),
        ))
    }

    pub fn close(&self) -> std::result::Result<bool, SessionScopeError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| SessionScopeError::Unavailable)?;
        let removed = std::mem::replace(&mut *state, Lifecycle::Closed);
        drop(state);
        let was_active = !matches!(removed, Lifecycle::Closed);
        drop(removed);
        Ok(was_active)
    }
}

struct SessionLease<'a, T: 'static> {
    scope: &'a SessionScoped<T>,
    object: Option<T>,
}

impl<T> Drop for SessionLease<'_, T> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.scope.state.lock() {
            if matches!(*state, Lifecycle::Busy) {
                *state = Lifecycle::Active(self.object.take().expect("session lease owns object"));
            }
        }
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
    fn callbacks_run_without_holding_the_lifecycle_lock() {
        let scope = SessionScoped::new(1_u32);
        let observed = scope
            .with(|_| scope.state.try_lock().is_ok())
            .expect("active session");
        assert!(observed, "callback must not hold the lifecycle mutex");
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
