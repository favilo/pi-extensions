use crate::CONTRACT_VERSION;
use crate::contract::{NativeOperation, ToolExecutionRequest, ToolExecutionResponse};
use napi::bindgen_prelude::{
    CallbackContext, FnArgs, Function, JsObjectValue, Object, PromiseRaw, Unknown,
};
use napi::{Env, Error, Result as NapiResult, ValueType};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ToolExecutionError {
    #[error("incompatible tool-execution request")]
    Incompatible,
    #[error("native request nonce must be 1-256 characters")]
    Nonce,
    #[error("tool execution is missing the tool name")]
    ToolName,
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

fn skipped_response(request: ToolExecutionRequest) -> ToolExecutionResponse {
    ToolExecutionResponse {
        version: CONTRACT_VERSION,
        operation: NativeOperation::ToolExecution,
        ok: false,
        nonce: request.nonce,
        decision: request.decision,
        executions: 0,
        value_json: None,
        error: None,
    }
}

pub enum ExecutionDecision {
    Run(ToolExecutionRequest),
    Skip(ToolExecutionResponse),
}

pub fn decide_execution(
    request: ToolExecutionRequest,
) -> Result<ExecutionDecision, ToolExecutionError> {
    let request = prepare(request)?;
    if request.decision == "allow" {
        Ok(ExecutionDecision::Run(request))
    } else {
        Ok(ExecutionDecision::Skip(skipped_response(request)))
    }
}

fn host_failure(request: ToolExecutionRequest, error: String) -> ToolExecutionResponse {
    ToolExecutionResponse {
        version: CONTRACT_VERSION,
        operation: NativeOperation::ToolExecution,
        ok: false,
        nonce: request.nonce,
        decision: request.decision,
        executions: 1,
        value_json: None,
        error: Some(error),
    }
}

fn host_error_message(value: &Unknown) -> String {
    if matches!(value.get_type(), Ok(ValueType::Object)) {
        // SAFETY: `Unknown::cast` requires the JavaScript type to match `Object`.
        // `get_type()` just reported `ValueType::Object` for this value.
        if let Ok(object) = unsafe { value.cast::<Object>() } {
            if let Ok(message) = object.get_named_property::<String>("message") {
                if !message.is_empty() {
                    return message;
                }
            }
        }
    }
    if matches!(value.get_type(), Ok(ValueType::String)) {
        // SAFETY: `Unknown::cast` requires the JavaScript type to match `String`.
        // `get_type()` just reported `ValueType::String` for this value.
        if let Ok(text) = unsafe { value.cast::<String>() } {
            if !text.is_empty() {
                return text;
            }
        }
    }
    "host execution failed".to_owned()
}

#[cfg(test)]
pub fn sequence(
    request: ToolExecutionRequest,
    host: &impl HostExecutor,
) -> Result<ToolExecutionResponse, ToolExecutionError> {
    let request = match decide_execution(request)? {
        ExecutionDecision::Skip(response) => return Ok(response),
        ExecutionDecision::Run(request) => request,
    };
    let value = match host.execute(&request.tool_name, &request.input_json) {
        Ok(value) => value,
        Err(error) => return Ok(host_failure(request, error)),
    };
    Ok(success_response(request, value))
}

pub fn execute<'env>(
    env: &Env,
    request: ToolExecutionRequest,
    host: Function<'env, FnArgs<(String, String)>, PromiseRaw<'env, String>>,
) -> NapiResult<PromiseRaw<'env, ToolExecutionResponse>> {
    let request =
        match decide_execution(request).map_err(|error| Error::from_reason(error.to_string()))? {
            ExecutionDecision::Skip(response) => return PromiseRaw::resolve(env, response),
            ExecutionDecision::Run(request) => request,
        };
    let pending = match host.call(FnArgs::from((
        request.tool_name.clone(),
        request.input_json.clone(),
    ))) {
        Ok(pending) => pending,
        Err(error) => return PromiseRaw::resolve(env, host_failure(request, error.to_string())),
    };
    let failed = request.clone();
    let settled = pending.then(move |context| Ok(success_response(request, context.value)))?;
    settled.catch(move |context: CallbackContext<Unknown>| {
        Ok(host_failure(failed, host_error_message(&context.value)))
    })
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

    #[test]
    fn a_host_error_is_not_a_successful_result() {
        struct FailingHost;
        impl HostExecutor for FailingHost {
            fn execute(&self, _tool_name: &str, _input_json: &str) -> Result<String, String> {
                Err("disk full".into())
            }
        }

        let response = sequence(allow_request(), &FailingHost).unwrap();
        assert!(!response.ok);
        assert_eq!(response.executions, 1);
        assert!(response.value_json.is_none());
        assert_eq!(response.error.as_deref(), Some("disk full"));
    }
}
