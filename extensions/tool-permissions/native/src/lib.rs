mod contract;
mod parser;
mod policy;

pub use contract::{
    EvaluateRequest, EvaluateResponse, NativeOperation, NativeRegistrationRequest,
    NativeRegistrationResponse, ParseRequest, ParseResponse, ParsedSubcommand, PermissionDecision,
    PermissionEvaluationRequest, PermissionOrchestrationRequest, PermissionOrchestrationResponse,
    PolicyPermission, PolicyRequest, PolicyResponse, ProbeRequest, ProbeResponse,
};
use napi::{
    bindgen_prelude::{FnArgs, Function, FunctionRef, JsObjectValue, Object, Unknown},
    Env, Error, Result,
};
use napi_derive::napi;

pub(crate) const CONTRACT_VERSION: i64 = 1;

fn validate_nonce(nonce: &str) -> Result<()> {
    if nonce.is_empty() || nonce.len() > 256 {
        return Err(Error::from_reason(
            "native request nonce must be 1-256 characters",
        ));
    }
    Ok(())
}

#[napi]
pub fn probe(request: ProbeRequest) -> Result<ProbeResponse> {
    if request.version != CONTRACT_VERSION || request.operation != "health" {
        return Err(Error::from_reason("incompatible probe request"));
    }
    validate_nonce(&request.nonce)?;
    Ok(ProbeResponse {
        version: CONTRACT_VERSION,
        operation: NativeOperation::Health,
        ok: true,
        nonce: request.nonce,
    })
}

#[napi]
pub fn parse(request: ParseRequest) -> Result<ParseResponse> {
    if request.version != CONTRACT_VERSION || request.operation != "parse" {
        return Err(Error::from_reason("incompatible parse request"));
    }
    validate_nonce(&request.nonce)?;
    Ok(parser::parse(request))
}

#[napi]
pub fn parse_policy(request: PolicyRequest) -> Result<PolicyResponse> {
    if request.version != CONTRACT_VERSION || request.operation != "policy" {
        return Err(Error::from_reason("incompatible policy request"));
    }
    validate_nonce(&request.nonce)?;
    Ok(policy::parse(request))
}

#[napi]
pub fn register_tool_permissions_callbacks(
    env: Env,
    request: NativeRegistrationRequest,
    pi: Object,
    bridge: Option<Object>,
) -> Result<NativeRegistrationResponse> {
    if request.version != CONTRACT_VERSION || request.operation != "register_callbacks" {
        return Err(Error::from_reason("incompatible registration request"));
    }
    validate_nonce(&request.nonce)?;

    let on: Function<FnArgs<(String, Function<(), ()>)>, ()> = pi
        .get_named_property("on")
        .map_err(|error| Error::from_reason(format!("pi.on is unavailable: {error}")))?;
    let handler = env.create_function_from_closure("toolPermissionsSessionStart", |ctx| {
        let session_context: Object = match ctx.get(1) {
            Ok(value) => value,
            Err(_) => return Ok(()),
        };
        if !session_context
            .get_named_property::<bool>("hasUI")
            .unwrap_or(false)
        {
            return Ok(());
        }
        let ui: Object = match session_context.get_named_property("ui") {
            Ok(value) => value,
            Err(_) => return Ok(()),
        };
        let notify: Function<FnArgs<(String, String)>, ()> = match ui.get_named_property("notify") {
            Ok(value) => value,
            Err(_) => return Ok(()),
        };
        notify.call(FnArgs::from((
            "Rust native registration active.".to_owned(),
            "info".to_owned(),
        )))?;
        Ok(())
    })?;
    on.call(FnArgs::from(("session_start".to_owned(), handler)))?;

    let mut registrations = vec!["session_start".to_owned()];
    if let Some(bridge) = bridge {
        let handle_tool_call: FunctionRef<FnArgs<(Unknown<'_>, Unknown<'_>)>, Unknown<'_>> = bridge
            .get_named_property::<Function<FnArgs<(Unknown<'_>, Unknown<'_>)>, Unknown<'_>>>("handleToolCall")
            .map_err(|error| Error::from_reason(format!("tool_call bridge is unavailable: {error}")))?
            .create_ref()?;
        let tool_call_handler = env.create_function_from_closure("toolPermissionsToolCall", move |ctx| {
            let event: Unknown = ctx.get(0)?;
            let extension_context: Unknown = ctx.get(1)?;
            let handle_tool_call = handle_tool_call.borrow_back(ctx.env)?;
            handle_tool_call.call(FnArgs::from((event, extension_context)))
        })?;
        let on_tool_call: Function<FnArgs<(String, Function<(), Unknown<'_>>)>, ()> = pi
            .get_named_property("on")
            .map_err(|error| Error::from_reason(format!("pi.on is unavailable for tool_call: {error}")))?;
        on_tool_call.call(FnArgs::from(("tool_call".to_owned(), tool_call_handler)))?;
        registrations.push("tool_call".to_owned());

        if let Ok(handle_tool_result) = bridge
            .get_named_property::<Function<FnArgs<(Unknown<'_>, Unknown<'_>)>, Unknown<'_>>>("handleToolResult")
            .and_then(|function| function.create_ref())
        {
            let tool_result_handler = env.create_function_from_closure("toolPermissionsToolResult", move |ctx| {
                let event: Unknown = ctx.get(0)?;
                let extension_context: Unknown = ctx.get(1)?;
                let handle_tool_result = handle_tool_result.borrow_back(ctx.env)?;
                handle_tool_result.call(FnArgs::from((event, extension_context)))
            })?;
            let on_tool_result: Function<FnArgs<(String, Function<(), Unknown<'_>>)>, ()> = pi
                .get_named_property("on")
                .map_err(|error| Error::from_reason(format!("pi.on is unavailable for tool_result: {error}")))?;
            on_tool_result.call(FnArgs::from(("tool_result".to_owned(), tool_result_handler)))?;
            registrations.push("tool_result".to_owned());
        }
    }

    Ok(NativeRegistrationResponse {
        version: CONTRACT_VERSION,
        operation: NativeOperation::RegisterCallbacks,
        ok: true,
        nonce: request.nonce,
        registrations,
    })
}

#[napi]
pub fn evaluate_permission_orchestration(
    request: PermissionOrchestrationRequest,
) -> Result<PermissionOrchestrationResponse> {
    if request.version != CONTRACT_VERSION || request.operation != "orchestrate_permission" {
        return Err(Error::from_reason(
            "incompatible permission orchestration request",
        ));
    }
    validate_nonce(&request.nonce)?;
    Ok(policy::evaluate_orchestration(request))
}

#[napi]
pub fn evaluate_policy(request: EvaluateRequest) -> Result<EvaluateResponse> {
    if request.version != CONTRACT_VERSION || request.operation != "evaluate" {
        return Err(Error::from_reason("incompatible evaluation request"));
    }
    validate_nonce(&request.nonce)?;
    Ok(policy::evaluate(request))
}

#[napi]
pub fn evaluate_permission(request: PermissionEvaluationRequest) -> Result<EvaluateResponse> {
    if request.version != CONTRACT_VERSION || request.operation != "evaluate_permission" {
        return Err(Error::from_reason(
            "incompatible permission evaluation request",
        ));
    }
    validate_nonce(&request.nonce)?;
    Ok(policy::evaluate_permission(request))
}

#[cfg(test)]
mod tests {
    use super::{
        evaluate_permission_orchestration, evaluate_policy, parse, parse_policy, probe,
        EvaluateRequest, ParseRequest, PermissionOrchestrationRequest, PolicyRequest, ProbeRequest,
    };
    #[test]
    fn probe_returns_a_distinct_typed_response() {
        let response = probe(ProbeRequest {
            version: 1,
            operation: "health".into(),
            nonce: "native".into(),
        })
        .unwrap();
        assert!(response.ok);
        assert_eq!(response.nonce, "native");
    }

    #[test]
    fn parser_fixture_shape_is_readable_with_toml() {
        let fixture: toml::Value = toml::from_str("[[cases]]\ncommand = 'jj status'\n").unwrap();
        assert!(fixture.get("cases").is_some());
    }

    #[test]
    fn parses_policy_toml_rules() {
        let response = parse_policy(PolicyRequest {
            version: 1,
            operation: "policy".into(),
            nonce: "n".into(),
            source: "[permissions.read]\nallow = [{ path = '^/tmp' }]\ndeny = []\n".into(),
        })
        .unwrap();
        assert!(response.ok);
        assert_eq!(response.permissions["read"].allow[0]["path"], "^/tmp");
    }

    #[test]
    fn rejects_invalid_policy_regex() {
        let response = parse_policy(PolicyRequest {
            version: 1,
            operation: "policy".into(),
            nonce: "n".into(),
            source: "[permissions.read]\nallow = [{ path = '[' }]\n".into(),
        })
        .unwrap();
        assert!(!response.ok);
        assert_eq!(response.reason, "parse_error");
    }

    #[test]
    fn evaluates_policy_with_deny_precedence() {
        let response = evaluate_policy(EvaluateRequest {
            version: 1,
            operation: "evaluate".into(),
            nonce: "n".into(),
            source: "[permissions.bash]\nallow = [{}]\ndeny = [{ command = '^rm' }]\n".into(),
            tool: "bash".into(),
            input_json: "{\"command\":\"rm -rf /\"}".into(),
        })
        .unwrap();
        assert!(response.ok);
        assert!(matches!(response.decision, super::PermissionDecision::Deny));
    }

    #[test]
    fn asks_when_no_rule_matches() {
        let response = evaluate_policy(EvaluateRequest {
            version: 1,
            operation: "evaluate".into(),
            nonce: "n".into(),
            source: "[permissions.bash]\nallow = []\ndeny = []\n".into(),
            tool: "bash".into(),
            input_json: "{\"command\":\"jj status\"}".into(),
        })
        .unwrap();
        assert!(matches!(response.decision, super::PermissionDecision::Ask));
    }

    #[test]
    fn orchestrates_permission_key_mapping_and_decisions() {
        let response = evaluate_permission_orchestration(PermissionOrchestrationRequest {
            version: 1,
            operation: "orchestrate_permission".into(),
            nonce: "n".into(),
            tool_name: "grep".into(),
            permissions_json:
                r#"{"read":{"allow":[{"path":"^/workspace"}],"deny":[{"path":"secret"}]}}"#.into(),
            input_json: r#"{"path":"/workspace/secret.txt"}"#.into(),
        })
        .unwrap();
        assert!(response.ok);
        assert_eq!(response.permission_key, "read");
        assert!(matches!(response.decision, super::PermissionDecision::Deny));
    }

    #[test]
    fn permission_evaluation_returns_not_ok_for_invalid_native_regex() {
        let response = super::evaluate_permission(super::PermissionEvaluationRequest {
            version: 1,
            operation: "evaluate_permission".into(),
            nonce: "n".into(),
            allow: vec![std::collections::HashMap::new()],
            deny: vec![std::collections::HashMap::from([(
                "command".into(),
                "(?<=rm) -rf".into(),
            )])],
            input_json: "{\"command\":\"rm -rf /\"}".into(),
        })
        .unwrap();
        assert!(!response.ok);
        assert!(matches!(response.decision, super::PermissionDecision::Ask));
    }

    #[test]
    fn parses_compound_commands() {
        let response = parse(ParseRequest {
            version: 1,
            operation: "parse".into(),
            nonce: "n".into(),
            command: "jj status && jj diff --stat".into(),
        })
        .unwrap();
        assert!(response.ok);
        assert_eq!(response.subcommands.len(), 2);
    }
}
