use crate::CONTRACT_VERSION;
use crate::contract::{AuditWriteRequest, AuditWriteResponse, NativeOperation};
use napi::bindgen_prelude::Function;
use serde_json::{Map, Value};

pub trait AuditSink {
    fn append(&self, line: &str) -> Result<(), String>;
}

pub struct AppendCallback<'a> {
    append: &'a Function<'a, String, bool>,
}

impl<'a> AppendCallback<'a> {
    pub fn new(append: &'a Function<'a, String, bool>) -> Self {
        Self { append }
    }
}

impl AuditSink for AppendCallback<'_> {
    fn append(&self, line: &str) -> Result<(), String> {
        match self.append.call(line.to_owned()) {
            Ok(true) => Ok(()),
            Ok(false) => Err("audit write failed".into()),
            Err(error) => Err(error.to_string()),
        }
    }
}

pub fn write(
    request: AuditWriteRequest,
    sink: &impl AuditSink,
) -> Result<AuditWriteResponse, String> {
    if request.version != CONTRACT_VERSION || request.operation != "audit_write" {
        return Err("incompatible audit-write request".into());
    }
    if request.nonce.is_empty() || request.nonce.len() > 256 {
        return Err("native request nonce must be 1-256 characters".into());
    }
    if request.home_dir.is_empty()
        || request.now.is_empty()
        || request.tool.is_empty()
        || request.decision.is_empty()
        || request.cwd.is_empty()
    {
        return Err("audit record is missing required fields".into());
    }

    let line = record_line(&request);
    let wrote = sink.append(&line);
    let records = if wrote.is_ok() { 1 } else { 0 };
    // A failed write must not remain an allow. The caller treats this as a deny.
    let decision = if wrote.is_ok() {
        request.decision
    } else {
        "deny".into()
    };
    Ok(AuditWriteResponse {
        version: CONTRACT_VERSION,
        operation: NativeOperation::AuditWrite,
        ok: wrote.is_ok(),
        nonce: request.nonce,
        decision,
        records,
    })
}

fn record_line(request: &AuditWriteRequest) -> String {
    let mut record = Map::new();
    record.insert("time".into(), Value::String(request.now.clone()));
    record.insert("tool".into(), Value::String(request.tool.clone()));
    insert_actor(&mut record, request);
    record.insert("decision".into(), Value::String(request.decision.clone()));
    record.insert("cwd".into(), Value::String(request.cwd.clone()));
    insert_text(&mut record, "path", &request.path);
    insert_text(&mut record, "command", &request.command);
    insert_text(&mut record, "subcommand", &request.subcommand);
    insert_text(&mut record, "pattern", &request.pattern);
    insert_text(&mut record, "scope", &request.scope);
    insert_text(&mut record, "reason", &request.reason);
    insert_text(&mut record, "steering", &request.steering);
    format!("{}\n", Value::Object(record))
}

fn insert_actor(record: &mut Map<String, Value>, request: &AuditWriteRequest) {
    let Some(kind) = &request.actor_kind else {
        return;
    };
    let mut actor = Map::new();
    actor.insert("kind".into(), Value::String(kind.clone()));
    if kind == "child" {
        insert_text(&mut actor, "childId", &request.child_id);
    }
    record.insert("actor".into(), Value::Object(actor));
}

fn insert_text(record: &mut Map<String, Value>, key: &str, value: &Option<String>) {
    if let Some(text) = value {
        record.insert(key.into(), Value::String(text.clone()));
    }
}

#[cfg(test)]
mod tests {
    use super::{AuditSink, write};
    use crate::contract::AuditWriteRequest;

    struct MemorySink {
        lines: std::sync::Mutex<Vec<String>>,
        fail: bool,
    }

    impl AuditSink for MemorySink {
        fn append(&self, line: &str) -> Result<(), String> {
            if self.fail {
                return Err("full".into());
            }
            self.lines.lock().unwrap().push(line.to_owned());
            Ok(())
        }
    }

    fn request() -> AuditWriteRequest {
        AuditWriteRequest {
            version: 1,
            operation: "audit_write".into(),
            nonce: "tool-permissions-audit-write".into(),
            home_dir: "/tmp/home".into(),
            now: "2026-07-31T12:00:00.000Z".into(),
            tool: "read".into(),
            decision: "allow_pattern".into(),
            cwd: "/work".into(),
            path: Some("/work/notes.txt".into()),
            command: None,
            reason: Some("user allow".into()),
            actor_kind: None,
            child_id: None,
            subcommand: None,
            pattern: None,
            scope: None,
            steering: None,
        }
    }

    #[test]
    fn appends_one_record_with_the_current_fields() {
        let sink = MemorySink {
            lines: std::sync::Mutex::new(Vec::new()),
            fail: false,
        };
        let response = write(request(), &sink).unwrap();
        assert!(response.ok);
        assert_eq!(response.records, 1);
        assert_eq!(response.decision, "allow_pattern");
        let lines = sink.lines.lock().unwrap();
        assert_eq!(lines.len(), 1);
        let record: serde_json::Value = serde_json::from_str(lines[0].trim()).unwrap();
        assert_eq!(record["time"], "2026-07-31T12:00:00.000Z");
        assert_eq!(record["tool"], "read");
        assert_eq!(record["decision"], "allow_pattern");
        assert_eq!(record["cwd"], "/work");
        assert_eq!(record["path"], "/work/notes.txt");
        assert_eq!(record["reason"], "user allow");
        assert!(record.get("command").is_none());
    }

    #[test]
    fn a_failed_write_does_not_remain_allow() {
        let sink = MemorySink {
            lines: std::sync::Mutex::new(Vec::new()),
            fail: true,
        };
        let response = write(request(), &sink).unwrap();
        assert!(!response.ok);
        assert_eq!(response.records, 0);
        assert_eq!(response.decision, "deny");
        assert!(sink.lines.lock().unwrap().is_empty());
    }

    #[test]
    fn writes_the_host_actor_pattern_scope_and_steering() {
        let sink = MemorySink {
            lines: std::sync::Mutex::new(Vec::new()),
            fail: false,
        };
        let mut request = request();
        request.actor_kind = Some("main".into());
        request.pattern = Some("^/work/notes\\.txt$".into());
        request.scope = Some("project".into());
        request.steering = Some("keep the notes".into());
        let response = write(request, &sink).unwrap();
        assert!(response.ok);
        assert_eq!(response.records, 1);
        let lines = sink.lines.lock().unwrap();
        let record: serde_json::Value = serde_json::from_str(lines[0].trim()).unwrap();
        assert_eq!(record["actor"]["kind"], "main");
        assert_eq!(record["pattern"], "^/work/notes\\.txt$");
        assert_eq!(record["scope"], "project");
        assert_eq!(record["steering"], "keep the notes");
        assert!(record.get("command").is_none());
    }
}
