//! Narrow filesystem callbacks the extension asks JavaScript to perform.
//!
//! Path checks stay in Rust. The host supplies the syscall.

use napi::Error;
use napi::bindgen_prelude::Function;

/// Host operations a WASM path check may request.
pub trait PathHost {
    fn realpath(&self, path: &str) -> Result<String, String>;
}

/// A JavaScript `realpath` callback.
pub struct RealpathCallback<'a> {
    realpath: &'a Function<'a, String, String>,
}

impl<'a> RealpathCallback<'a> {
    pub fn new(realpath: &'a Function<'a, String, String>) -> Self {
        Self { realpath }
    }
}

impl PathHost for RealpathCallback<'_> {
    fn realpath(&self, path: &str) -> Result<String, String> {
        self.realpath
            .call(path.to_owned())
            .map_err(|error: Error| error.to_string())
    }
}
