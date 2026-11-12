use crate::CONTRACT_VERSION;
use crate::contract::{NativeOperation, RuleSaveRequest, RuleSaveResponse};
use regex::Regex;
use serde_json::Value as JsonValue;
use thiserror::Error;
use toml::Value;
use toml::map::Map;

#[derive(Debug, Error)]
pub enum RuleSaveError {
    #[error("incompatible rule-save request")]
    Incompatible,
    #[error("native request nonce must be 1-256 characters")]
    Nonce,
    #[error("rule save is missing the tool")]
    Tool,
    #[error("saved rule must be an object")]
    RuleShape,
    #[error("saved rule patterns must be strings")]
    RulePattern,
    #[error("saved rule keys must be non-empty")]
    RuleKey,
    #[error(transparent)]
    Regex(#[from] regex::Error),
    #[error(transparent)]
    Parse(#[from] toml::de::Error),
    #[error(transparent)]
    Serialize(#[from] toml::ser::Error),
    #[error("{key} must be a table")]
    Table { key: String },
    #[error("{key} must be an array")]
    Array { key: String },
}

enum PermissionTool {
    Read,
    Write,
    Bash,
    Custom(ToolName),
}

struct ToolName(String);

struct AllowRule(Map<String, Value>);

struct PermissionsFile(Value);

struct PreparedSave {
    tool: PermissionTool,
    rule: AllowRule,
    file: PermissionsFile,
}

pub fn save(request: RuleSaveRequest) -> Result<RuleSaveResponse, RuleSaveError> {
    let prepared = prepare(&request)?;
    let contents = apply(prepared)?;
    Ok(RuleSaveResponse {
        version: CONTRACT_VERSION,
        operation: NativeOperation::RuleSave,
        ok: true,
        nonce: request.nonce,
        allowed: true,
        contents,
    })
}

fn prepare(request: &RuleSaveRequest) -> Result<PreparedSave, RuleSaveError> {
    if request.version != CONTRACT_VERSION || request.operation != "rule_save" {
        return Err(RuleSaveError::Incompatible);
    }
    if request.nonce.is_empty() || request.nonce.len() > 256 {
        return Err(RuleSaveError::Nonce);
    }
    Ok(PreparedSave {
        tool: PermissionTool::parse(&request.tool)?,
        rule: AllowRule::parse(&request.rule_json)?,
        file: PermissionsFile::parse(&request.source)?,
    })
}

fn apply(prepared: PreparedSave) -> Result<String, RuleSaveError> {
    let PreparedSave {
        tool,
        rule,
        mut file,
    } = prepared;
    file.insert(tool.key(), rule)?;
    file.to_toml()
}

impl PermissionTool {
    fn parse(value: &str) -> Result<Self, RuleSaveError> {
        match value {
            "" => Err(RuleSaveError::Tool),
            "read" => Ok(Self::Read),
            "write" => Ok(Self::Write),
            "bash" => Ok(Self::Bash),
            other => Ok(Self::Custom(ToolName(other.to_owned()))),
        }
    }

    fn key(&self) -> &str {
        match self {
            Self::Read => "read",
            Self::Write => "write",
            Self::Bash => "bash",
            Self::Custom(name) => &name.0,
        }
    }
}

impl AllowRule {
    fn parse(rule_json: &str) -> Result<Self, RuleSaveError> {
        let JsonValue::Object(entries) = serde_json::from_str(rule_json)? else {
            return Err(RuleSaveError::RuleShape);
        };
        let mut rule = Map::new();
        for (key, value) in entries {
            let JsonValue::String(pattern) = value else {
                return Err(RuleSaveError::RulePattern);
            };
            if key.is_empty() {
                return Err(RuleSaveError::RuleKey);
            }
            Regex::new(&pattern)?;
            rule.insert(key, Value::String(pattern));
        }
        Ok(Self(rule))
    }
}

impl PermissionsFile {
    fn parse(source: &str) -> Result<Self, RuleSaveError> {
        if source.trim().is_empty() {
            return Ok(Self(Value::Table(Map::new())));
        }
        let root: Value = toml::from_str(source)?;
        if root.is_table() {
            return Ok(Self(root));
        }
        Err(RuleSaveError::Table {
            key: "permissions file".into(),
        })
    }

    fn insert(&mut self, tool: &str, rule: AllowRule) -> Result<(), RuleSaveError> {
        let permissions = child_table(&mut self.0, "permissions")?;
        let tool_value = child_table(permissions, tool)?;
        ensure_array(tool_value, "deny")?;
        let allow = child_array(tool_value, "allow")?;
        if allow
            .iter()
            .any(|existing| existing.as_table() == Some(&rule.0))
        {
            return Ok(());
        }
        allow.push(Value::Table(rule.0));
        Ok(())
    }

    fn to_toml(self) -> Result<String, RuleSaveError> {
        Ok(toml::to_string(&self.0)?)
    }
}

fn child_table<'a>(parent: &'a mut Value, key: &str) -> Result<&'a mut Value, RuleSaveError> {
    let table = parent.as_table_mut().ok_or_else(|| RuleSaveError::Table {
        key: key.to_owned(),
    })?;
    if !table.contains_key(key) {
        table.insert(key.to_owned(), Value::Table(Map::new()));
    }
    let child = table.get_mut(key).ok_or_else(|| RuleSaveError::Table {
        key: key.to_owned(),
    })?;
    if child.is_table() {
        return Ok(child);
    }
    Err(RuleSaveError::Table {
        key: key.to_owned(),
    })
}

fn ensure_array(parent: &mut Value, key: &str) -> Result<(), RuleSaveError> {
    child_array(parent, key).map(|_| ())
}

fn child_array<'a>(parent: &'a mut Value, key: &str) -> Result<&'a mut Vec<Value>, RuleSaveError> {
    let table = parent.as_table_mut().ok_or_else(|| RuleSaveError::Array {
        key: key.to_owned(),
    })?;
    if !table.contains_key(key) {
        table.insert(key.to_owned(), Value::Array(Vec::new()));
    }
    table
        .get_mut(key)
        .and_then(Value::as_array_mut)
        .ok_or_else(|| RuleSaveError::Array {
            key: key.to_owned(),
        })
}

impl From<serde_json::Error> for RuleSaveError {
    fn from(_: serde_json::Error) -> Self {
        Self::RuleShape
    }
}

#[cfg(test)]
mod tests {
    use super::save;
    use crate::contract::RuleSaveRequest;

    fn request(source: &str, rule_json: &str) -> RuleSaveRequest {
        RuleSaveRequest {
            version: 1,
            operation: "rule_save".into(),
            nonce: "tool-permissions-rule-save".into(),
            source: source.into(),
            tool: "read".into(),
            rule_json: rule_json.into(),
        }
    }

    #[test]
    fn patches_one_allow_rule_into_an_empty_permissions_table() {
        let response = save(request(
            "[permissions]\n",
            r#"{"path":"^/work/notes\\.txt$"}"#,
        ))
        .unwrap();
        assert!(response.ok);
        assert!(response.allowed);
        let parsed: toml::Value = toml::from_str(&response.contents).unwrap();
        let allow = &parsed["permissions"]["read"]["allow"];
        assert_eq!(allow.as_array().unwrap().len(), 1);
        assert_eq!(allow[0]["path"].as_str(), Some("^/work/notes\\.txt$"));
    }
}
