mod contract;
mod parser;
mod policy;

pub use contract::{
    EvaluateRequest, EvaluateResponse, NativeOperation, ParseRequest, ParseResponse,
    ParsedSubcommand, PermissionDecision, PermissionEvaluationRequest, PolicyPermission,
    PolicyRequest, PolicyResponse, ProbeRequest, ProbeResponse,
};
use napi::{Error, Result};
use napi_derive::napi;

pub(crate) const CONTRACT_VERSION: i64 = 1;

#[napi]
pub fn probe(request: ProbeRequest) -> Result<ProbeResponse> {
    if request.version != CONTRACT_VERSION || request.operation != "health" {
        return Err(Error::from_reason("incompatible probe request"));
    }
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
    Ok(parser::parse(request))
}

#[napi]
pub fn parse_policy(request: PolicyRequest) -> Result<PolicyResponse> {
    if request.version != CONTRACT_VERSION || request.operation != "policy" {
        return Err(Error::from_reason("incompatible policy request"));
    }
    Ok(policy::parse(request))
}

#[napi]
pub fn evaluate_policy(request: EvaluateRequest) -> Result<EvaluateResponse> {
    if request.version != CONTRACT_VERSION || request.operation != "evaluate" {
        return Err(Error::from_reason("incompatible evaluation request"));
    }
    Ok(policy::evaluate(request))
}

#[napi]
pub fn evaluate_permission(request: PermissionEvaluationRequest) -> Result<EvaluateResponse> {
    if request.version != CONTRACT_VERSION || request.operation != "evaluate_permission" {
        return Err(Error::from_reason(
            "incompatible permission evaluation request",
        ));
    }
    Ok(policy::evaluate_permission(request))
}

#[cfg(test)]
mod tests {
    use super::{
        evaluate_policy, parse, parse_policy, probe, EvaluateRequest, ParseRequest, PolicyRequest,
        ProbeRequest,
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
