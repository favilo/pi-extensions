use napi_derive::napi;
use serde::Deserialize;

#[derive(derive_more::FromStr)]
#[napi(string_enum = "snake_case")]
pub enum NativeOperation {
    Health,
    Parse,
    Policy,
    Evaluate,
    EvaluatePermission,
    OrchestratePermission,
}

#[derive(derive_more::FromStr)]
#[napi(string_enum = "kebab-case")]
pub enum PermissionDecision {
    Allow,
    Deny,
    Ask,
}
use std::collections::HashMap;

#[napi(object)]
pub struct ProbeRequest {
    pub version: i64,
    pub operation: String,
    pub nonce: String,
}
#[napi(object)]
pub struct ProbeResponse {
    pub version: i64,
    pub operation: NativeOperation,
    pub ok: bool,
    pub nonce: String,
}
#[napi(object)]
pub struct ParseRequest {
    pub version: i64,
    pub operation: String,
    pub nonce: String,
    pub command: String,
}
#[napi(object)]
pub struct ParsedSubcommand {
    pub normalized: String,
    pub start: i64,
    pub end: i64,
    pub command: String,
    pub args: Vec<String>,
}
#[napi(object)]
pub struct ParseResponse {
    pub version: i64,
    pub operation: NativeOperation,
    pub ok: bool,
    pub nonce: String,
    pub reason: String,
    pub detail: String,
    pub subcommands: Vec<ParsedSubcommand>,
}

#[napi(object)]
pub struct PolicyRequest {
    pub version: i64,
    pub operation: String,
    pub nonce: String,
    pub source: String,
}
#[derive(Deserialize)]
#[napi(object)]
pub struct PolicyPermission {
    pub allow: Vec<HashMap<String, String>>,
    pub deny: Vec<HashMap<String, String>>,
}
#[napi(object)]
pub struct PolicyResponse {
    pub version: i64,
    pub operation: NativeOperation,
    pub ok: bool,
    pub nonce: String,
    pub reason: String,
    pub detail: String,
    pub permissions: HashMap<String, PolicyPermission>,
}

#[napi(object)]
pub struct EvaluateRequest {
    pub version: i64,
    pub operation: String,
    pub nonce: String,
    pub source: String,
    pub tool: String,
    pub input_json: String,
}
#[napi(object)]
pub struct EvaluateResponse {
    pub version: i64,
    pub operation: NativeOperation,
    pub nonce: String,
    pub ok: bool,
    pub decision: PermissionDecision,
    pub detail: String,
}

#[napi(object)]
pub struct PermissionEvaluationRequest {
    pub version: i64,
    pub operation: String,
    pub nonce: String,
    pub allow: Vec<HashMap<String, String>>,
    pub deny: Vec<HashMap<String, String>>,
    pub input_json: String,
}

#[napi(object)]
pub struct PermissionOrchestrationRequest {
    pub version: i64,
    pub operation: String,
    pub nonce: String,
    pub tool_name: String,
    pub permissions_json: String,
    pub input_json: String,
}

#[napi(object)]
pub struct PermissionOrchestrationResponse {
    pub version: i64,
    pub operation: NativeOperation,
    pub ok: bool,
    pub nonce: String,
    pub permission_key: String,
    pub decision: PermissionDecision,
    pub detail: String,
}
