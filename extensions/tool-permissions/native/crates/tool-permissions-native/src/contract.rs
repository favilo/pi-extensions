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
    RegisterCallbacks,
    PathTrust,
    AuditWrite,
    RuleSave,
    PromptQueue,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, derive_more::FromStr)]
#[napi(string_enum = "snake_case")]
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

#[napi(object)]
pub struct NativeRegistrationRequest {
    pub version: i64,
    pub operation: String,
    pub nonce: String,
}

#[napi(object)]
pub struct NativeRegistrationResponse {
    pub version: i64,
    pub operation: NativeOperation,
    pub ok: bool,
    pub nonce: String,
    pub registrations: Vec<String>,
}

#[napi(object)]
pub struct PathTrustRequest {
    pub version: i64,
    pub operation: String,
    pub nonce: String,
    pub tool: String,
    pub requested_path: String,
    pub cwd: String,
    pub trust_path: Option<String>,
    pub trust_decision: bool,
}

#[napi(object)]
pub struct PathTrustResponse {
    pub version: i64,
    pub operation: NativeOperation,
    pub ok: bool,
    pub nonce: String,
    pub path: String,
    pub cwd: String,
    pub trust_eligible: bool,
    pub aiignore_match: bool,
    pub project_matched: bool,
    pub decision: PermissionDecision,
    pub diagnostic: Option<String>,
}

#[napi(object)]
pub struct AuditWriteRequest {
    pub version: i64,
    pub operation: String,
    pub nonce: String,
    pub home_dir: String,
    pub now: String,
    pub tool: String,
    pub decision: String,
    pub cwd: String,
    pub path: Option<String>,
    pub command: Option<String>,
    pub reason: Option<String>,
    pub actor_kind: Option<String>,
    pub child_id: Option<String>,
    pub subcommand: Option<String>,
    pub pattern: Option<String>,
    pub scope: Option<String>,
    pub steering: Option<String>,
}

#[napi(object)]
pub struct AuditWriteResponse {
    pub version: i64,
    pub operation: NativeOperation,
    pub ok: bool,
    pub nonce: String,
    pub decision: String,
    pub records: i64,
}

#[napi(object)]
pub struct RuleSaveRequest {
    pub version: i64,
    pub operation: String,
    pub nonce: String,
    pub source: String,
    pub tool: String,
    pub rule_json: String,
}

#[napi(object)]
pub struct RuleSaveResponse {
    pub version: i64,
    pub operation: NativeOperation,
    pub ok: bool,
    pub nonce: String,
    pub allowed: bool,
    pub contents: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[napi(string_enum = "snake_case")]
pub enum PromptQueueDecision {
    Allow,
    Deny,
    Steer,
}

#[napi(object)]
pub struct PromptQueueRequest {
    pub version: i64,
    pub operation: String,
    pub nonce: String,
    pub tool_call_id: String,
}

#[napi(object)]
pub struct PromptQueueResolution {
    pub decision: PromptQueueDecision,
    pub steering: Option<String>,
}

#[napi(object)]
pub struct PromptQueueResponse {
    pub version: i64,
    pub operation: NativeOperation,
    pub ok: bool,
    pub nonce: String,
    pub tool_call_id: String,
    pub decision: PromptQueueDecision,
    pub steering: Option<String>,
}
