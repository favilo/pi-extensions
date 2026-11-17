use crate::CONTRACT_VERSION;
use crate::contract::{NativeOperation, ToolExecutionRequest, ToolExecutionResponse};
use napi::bindgen_prelude::{FnArgs, Function, PromiseRaw};
use napi::{Error, Result as NapiResult};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ToolExecutionError {
    #[error("incompatible tool-execution request")]
    Incompatible,
    #[error("native request nonce must be 1-256 characters")]
    Nonce,
    #[error("tool execution is missing the tool name")]
    ToolName,
    #[cfg(test)]
    #[error("{0}")]
    Host(String),
}

#[cfg(test)]
pub trait HostExecutor {
    fn execute(&self, tool_name: &str, input_json: &str) -> Result<String, String>;
}

pub fn prepare(request: ToolExecutionRequest) -> Result<ToolExecutionRequest, ToolExecutionError> {
    if request.version != CONTRACT_VERSION || request.operation != "tool_execution" {
        return Err(ToolExecutionError::Incompatible);
    }
    if request.nonce.is_empty() || request.nonce.len() > 256 {
        return Err(ToolExecutionError::Nonce);
    }
    if request.tool_name.is_empty() {
        return Err(ToolExecutionError::ToolName);
    }
    Ok(request)
}

pub fn success_response(
    request: ToolExecutionRequest,
    value_json: String,
) -> ToolExecutionResponse {
    ToolExecutionResponse {
        version: CONTRACT_VERSION,
        operation: NativeOperation::ToolExecution,
        ok: true,
        nonce: request.nonce,
        decision: request.decision,
        executions: 1,
        value_json: Some(value_json),
        error: None,
    }
}

#[cfg(test)]
pub fn sequence(
    request: ToolExecutionRequest,
    host: &impl HostExecutor,
) -> Result<ToolExecutionResponse, ToolExecutionError> {
    let request = prepare(request)?;
    let value = host
        .execute(&request.tool_name, &request.input_json)
        .map_err(ToolExecutionError::Host)?;
    Ok(success_response(request, value))
}

pub fn execute<'env>(
    request: ToolExecutionRequest,
    host: Function<'env, FnArgs<(String, String)>, PromiseRaw<'env, String>>,
) -> NapiResult<PromiseRaw<'env, ToolExecutionResponse>> {
    let request = prepare(request).map_err(|error| Error::from_reason(error.to_string()))?;
    let pending = host.call(FnArgs::from((
        request.tool_name.clone(),
        request.input_json.clone(),
    )))?;
    pending.then(move |context| Ok(success_response(request, context.value)))
}

#[cfg(test)]
mod tests {
    use super::{HostExecutor, sequence};
    use crate::contract::ToolExecutionRequest;
    use std::sync::Mutex;

    struct CountingHost {
        calls: Mutex<Vec<(String, String)>>,
    }

    impl HostExecutor for CountingHost {
        fn execute(&self, tool_name: &str, input_json: &str) -> Result<String, String> {
            self.calls
                .lock()
                .expect("host call lock")
                .push((tool_name.to_owned(), input_json.to_owned()));
            Ok("\"file-body\"".to_owned())
        }
    }

    fn allow_request() -> ToolExecutionRequest {
        ToolExecutionRequest {
            version: 1,
            operation: "tool_execution".into(),
            nonce: "tool-permissions-tool-execution".into(),
            decision: "allow".into(),
            tool_name: "read".into(),
            input_json: "{\"path\":\"/tmp/note.txt\"}".into(),
        }
    }

    #[test]
    fn allow_calls_the_host_once_with_the_original_request() {
        let host = CountingHost {
            calls: Mutex::new(Vec::new()),
        };
        let response = sequence(allow_request(), &host).unwrap();
        let calls = host.calls.lock().expect("host call lock");
        assert_eq!(
            calls.as_slice(),
            [("read".to_owned(), "{\"path\":\"/tmp/note.txt\"}".to_owned())]
        );
        assert!(response.ok);
        assert_eq!(response.executions, 1);
        assert_eq!(response.decision, "allow");
        assert_eq!(response.value_json.as_deref(), Some("\"file-body\""));
    }

    #[test]
    fn deny_cancel_and_invalid_do_not_call_the_host() {
        for decision in ["deny", "cancel", "invalid"] {
            let host = CountingHost {
                calls: Mutex::new(Vec::new()),
            };
            let mut request = allow_request();
            request.decision = decision.to_owned();
            let response = sequence(request, &host).unwrap();
            assert!(
                host.calls.lock().expect("host call lock").is_empty(),
                "{decision}"
            );
            assert_eq!(response.executions, 0, "{decision}");
            assert!(response.value_json.is_none(), "{decision}");
        }
    }
}
