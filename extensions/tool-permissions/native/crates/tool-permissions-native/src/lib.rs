mod audit;
mod callback_tracer;
mod contract;
mod execution;
mod parser;
mod path_trust;
mod policy;
mod prompt_queue;
mod registration;
mod rule_save;

pub use contract::{
    AuditWriteRequest, AuditWriteResponse, EvaluateRequest, EvaluateResponse, NativeOperation,
    NativeRegistrationRequest, NativeRegistrationResponse, ParseRequest, ParseResponse,
    ParsedSubcommand, PathTrustRequest, PathTrustResponse, PermissionDecision,
    PermissionEvaluationRequest, PermissionOrchestrationRequest, PermissionOrchestrationResponse,
    PolicyPermission, PolicyRequest, PolicyResponse, ProbeRequest, ProbeResponse,
    PromptQueueDecision, PromptQueueRequest, PromptQueueResolution, PromptQueueResponse,
    RuleSaveRequest, RuleSaveResponse, ToolExecutionDecision, ToolExecutionRequest,
    ToolExecutionResponse,
};
use napi::bindgen_prelude::{FnArgs, Function, PromiseRaw};
use napi::{Env, Error, Result};
use napi_derive::napi;
use pi_api::RealpathCallback;

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
    pi: napi::bindgen_prelude::Object,
    bridge: Option<napi::bindgen_prelude::Object>,
) -> Result<NativeRegistrationResponse> {
    registration::register_callbacks(&env, request, pi, bridge)
}

#[napi]
pub fn register_callback_tracer(env: Env, pi: napi::bindgen_prelude::Object) -> Result<bool> {
    callback_tracer::register(&env, pi)
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

#[napi]
pub fn evaluate_path_trust(
    request: PathTrustRequest,
    realpath: Function<String, String>,
    read_file: Function<String, String>,
    is_dir: Function<String, bool>,
) -> Result<PathTrustResponse> {
    path_trust::evaluate(
        request,
        &RealpathCallback::new(&realpath, &read_file, &is_dir),
    )
    .map_err(Error::from_reason)
}

#[napi]
pub fn write_audit(
    request: AuditWriteRequest,
    append: Function<String, bool>,
) -> Result<AuditWriteResponse> {
    audit::write(request, &audit::AppendCallback::new(&append)).map_err(Error::from_reason)
}

#[napi]
pub fn save_rule(request: RuleSaveRequest) -> Result<RuleSaveResponse> {
    rule_save::save(request).map_err(|error| Error::from_reason(error.to_string()))
}

#[napi(ts_return_type = "Promise<PromptQueueResponse>")]
pub fn decide_prompt<'env>(
    env: &'env Env,
    request: PromptQueueRequest,
    present: Function<'env, String, PromiseRaw<'static, PromptQueueResolution>>,
) -> Result<napi::bindgen_prelude::Object<'env>> {
    prompt_queue::decide(env, request, present)
}

#[napi]
pub fn execute_tool<'env>(
    env: Env,
    request: ToolExecutionRequest,
    execute: Function<'env, FnArgs<(String, String)>, PromiseRaw<'env, String>>,
) -> Result<PromiseRaw<'env, ToolExecutionResponse>> {
    execution::execute(&env, request, execute)
}

#[cfg(test)]
mod tests {
    use super::{
        EvaluateRequest, ParseRequest, PermissionOrchestrationRequest, PolicyRequest, ProbeRequest,
        evaluate_permission_orchestration, evaluate_policy, parse, parse_policy, probe,
    };

    #[test]
    fn tool_execution_source_stays_a_host_callback() {
        let source = include_str!("execution.rs");
        assert!(!source.contains("std::process"));
        assert!(!source.contains("std::net"));
        assert!(!source.contains("FunctionRef"));
        assert!(!source.contains("mem::transmute"));
    }

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
