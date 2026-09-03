use crate::contract::{
    EvaluateRequest, EvaluateResponse, NativeOperation, PermissionDecision,
    PermissionEvaluationRequest, PolicyPermission, PolicyRequest, PolicyResponse,
};
use regex::Regex;
use std::collections::HashMap;
use toml::Value;

pub fn parse(request: PolicyRequest) -> PolicyResponse {
    match decode(&request.source) {
        Ok(permissions) => response(request.nonce, true, "", "", permissions),
        Err(detail) => response(request.nonce, false, "parse_error", &detail, HashMap::new()),
    }
}

fn decode(source: &str) -> Result<HashMap<String, PolicyPermission>, String> {
    let root: Value = toml::from_str(source).map_err(|error| error.to_string())?;
    let Some(table) = root.get("permissions").and_then(Value::as_table) else {
        return Ok(HashMap::new());
    };
    table
        .iter()
        .map(|(tool, value)| {
            let permission = value
                .as_table()
                .ok_or_else(|| format!("permissions.{tool} must be a table"))?;
            Ok((
                tool.clone(),
                PolicyPermission {
                    allow: rules(
                        permission.get("allow"),
                        &format!("permissions.{tool}.allow"),
                    )?,
                    deny: rules(permission.get("deny"), &format!("permissions.{tool}.deny"))?,
                },
            ))
        })
        .collect()
}

fn rules(value: Option<&Value>, field: &str) -> Result<Vec<HashMap<String, String>>, String> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let array = value
        .as_array()
        .ok_or_else(|| format!("{field} must be an array"))?;
    array
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let table = item
                .as_table()
                .ok_or_else(|| format!("{field}[{index}] must be a table"))?;
            table
                .iter()
                .map(|(path, value)| {
                    let pattern = value
                        .as_str()
                        .ok_or_else(|| format!("{field}[{index}] must contain string patterns"))?;
                    if path.is_empty() {
                        return Err(format!("{field}[{index}] must contain string patterns"));
                    }
                    Regex::new(pattern).map_err(|error| {
                        format!("{field}[{index}] invalid regular expression: {error}")
                    })?;
                    Ok((path.clone(), pattern.to_owned()))
                })
                .collect()
        })
        .collect()
}

pub fn evaluate_permission(request: PermissionEvaluationRequest) -> EvaluateResponse {
    let input: serde_json::Value = match serde_json::from_str(&request.input_json) {
        Ok(value) => value,
        Err(error) => {
            return evaluate_response(
                request.nonce,
                false,
                PermissionDecision::Ask,
                &format!("invalid input JSON: {error}"),
            )
        }
    };
    let permission = PolicyPermission {
        allow: request.allow,
        deny: request.deny,
    };
    let decision = match permission_decision(&permission, &input) {
        Ok(decision) => decision,
        Err(error) => {
            return evaluate_response(
                request.nonce,
                false,
                PermissionDecision::Ask,
                &format!("invalid native regex: {error}"),
            )
        }
    };
    evaluate_response_with_operation(
        NativeOperation::EvaluatePermission,
        request.nonce,
        true,
        decision,
        "evaluated permission rules",
    )
}

pub fn evaluate(request: EvaluateRequest) -> EvaluateResponse {
    let input: serde_json::Value = match serde_json::from_str(&request.input_json) {
        Ok(value) => value,
        Err(error) => {
            return evaluate_response(
                request.nonce,
                false,
                PermissionDecision::Ask,
                &format!("invalid input JSON: {error}"),
            )
        }
    };
    let permissions = match decode(&request.source) {
        Ok(value) => value,
        Err(error) => {
            return evaluate_response(request.nonce, false, PermissionDecision::Ask, &error)
        }
    };
    let Some(permission) = permissions.get(&request.tool) else {
        return evaluate_response(
            request.nonce,
            true,
            PermissionDecision::Ask,
            "no matching permission",
        );
    };
    match permission_decision(permission, &input) {
        Ok(PermissionDecision::Deny) => evaluate_response(
            request.nonce,
            true,
            PermissionDecision::Deny,
            "matched deny rule",
        ),
        Ok(PermissionDecision::Allow) => evaluate_response(
            request.nonce,
            true,
            PermissionDecision::Allow,
            "matched allow rule",
        ),
        Ok(PermissionDecision::Ask) => evaluate_response(
            request.nonce,
            true,
            PermissionDecision::Ask,
            "no matching allow rule",
        ),
        Err(error) => evaluate_response(
            request.nonce,
            false,
            PermissionDecision::Ask,
            &format!("invalid native regex: {error}"),
        ),
    }
}

fn permission_decision(
    permission: &PolicyPermission,
    input: &serde_json::Value,
) -> Result<PermissionDecision, String> {
    if permission.deny.iter().try_fold(false, |matched, rule| {
        Ok::<_, String>(matched || matches_rule(rule, input)?)
    })? {
        return Ok(PermissionDecision::Deny);
    }
    if permission.allow.iter().try_fold(false, |matched, rule| {
        Ok::<_, String>(matched || matches_rule(rule, input)?)
    })? {
        return Ok(PermissionDecision::Allow);
    }
    Ok(PermissionDecision::Ask)
}

fn matches_rule(rule: &HashMap<String, String>, input: &serde_json::Value) -> Result<bool, String> {
    rule.iter().try_fold(true, |matched, (path, pattern)| {
        if !matched {
            return Ok(false);
        }
        let Some(value) = field_value(input, path) else {
            return Ok(false);
        };
        let regex = Regex::new(pattern).map_err(|error| error.to_string())?;
        Ok(regex.is_match(&pattern_value(value)))
    })
}

fn field_value<'a>(input: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    path.split('.')
        .try_fold(input, |value, part| value.as_object()?.get(part))
}

fn pattern_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(value) => value.clone(),
        serde_json::Value::Null => "null".into(),
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => value.to_string(),
        _ => value.to_string(),
    }
}

fn evaluate_response(
    nonce: String,
    ok: bool,
    decision: PermissionDecision,
    detail: &str,
) -> EvaluateResponse {
    evaluate_response_with_operation(NativeOperation::Evaluate, nonce, ok, decision, detail)
}

fn evaluate_response_with_operation(
    operation: NativeOperation,
    nonce: String,
    ok: bool,
    decision: PermissionDecision,
    detail: &str,
) -> EvaluateResponse {
    EvaluateResponse {
        version: crate::CONTRACT_VERSION,
        operation,
        nonce,
        ok,
        decision,
        detail: detail.into(),
    }
}

fn response(
    nonce: String,
    ok: bool,
    reason: &str,
    detail: &str,
    permissions: HashMap<String, PolicyPermission>,
) -> PolicyResponse {
    PolicyResponse {
        version: crate::CONTRACT_VERSION,
        operation: NativeOperation::Policy,
        ok,
        nonce,
        reason: reason.into(),
        detail: detail.into(),
        permissions,
    }
}
