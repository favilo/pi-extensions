use crate::CONTRACT_VERSION;
use crate::contract::{NativeOperation, PathTrustRequest, PathTrustResponse, PermissionDecision};
use ignore::gitignore::GitignoreBuilder;
use pi_api::PathHost;

pub fn evaluate(
    request: PathTrustRequest,
    host: &impl PathHost,
) -> Result<PathTrustResponse, String> {
    if request.version != CONTRACT_VERSION || request.operation != "path_trust" {
        return Err("incompatible path-trust request".into());
    }
    if request.nonce.is_empty() || request.nonce.len() > 256 {
        return Err("native request nonce must be 1-256 characters".into());
    }

    let cwd = host.realpath(&request.cwd)?;
    let absolute = node_resolve(&cwd, &request.requested_path);
    let path = canonicalize_leaf(&request.tool, &absolute, host)?;
    let aiignore = aiignore_status(&cwd, &path, host);
    let project = project_decision(&request, &cwd, &path, host)?;
    let (decision, aiignore_match, diagnostic) =
        path_decision(&request.tool, &path, &cwd, &project, aiignore);
    Ok(PathTrustResponse {
        version: CONTRACT_VERSION,
        operation: NativeOperation::PathTrust,
        ok: true,
        nonce: request.nonce,
        path,
        cwd,
        trust_eligible: project.eligible,
        aiignore_match,
        project_matched: project.matched,
        decision,
        diagnostic,
    })
}

struct ProjectTrust {
    eligible: bool,
    decision: Option<PermissionDecision>,
    diagnostic: Option<String>,
    matched: bool,
}

enum AiignoreStatus {
    Clear,
    Matched,
    Invalid(String),
}

fn path_decision(
    tool: &str,
    path: &str,
    cwd: &str,
    project: &ProjectTrust,
    aiignore: AiignoreStatus,
) -> (PermissionDecision, bool, Option<String>) {
    if matches!(project.decision, Some(PermissionDecision::Deny)) {
        return (
            PermissionDecision::Deny,
            matches!(aiignore, AiignoreStatus::Matched),
            None,
        );
    }
    // A broken ignore file stays ask so the host can prompt. No UI still blocks.
    if let AiignoreStatus::Invalid(message) = aiignore {
        return (PermissionDecision::Ask, false, Some(message));
    }
    if matches!(aiignore, AiignoreStatus::Matched) {
        return (PermissionDecision::Deny, true, None);
    }
    if let Some(diagnostic) = &project.diagnostic {
        return (PermissionDecision::Ask, false, Some(diagnostic.clone()));
    }
    let inside = implicit_project_tool(tool) && is_inside(path, cwd);
    let decision = match project.decision {
        Some(PermissionDecision::Allow) => PermissionDecision::Allow,
        Some(PermissionDecision::Deny) => PermissionDecision::Deny,
        Some(PermissionDecision::Ask) | None if inside => PermissionDecision::Allow,
        Some(PermissionDecision::Ask) | None => PermissionDecision::Ask,
    };
    (decision, false, None)
}

fn implicit_project_tool(tool: &str) -> bool {
    matches!(tool, "read" | "grep" | "find" | "ls")
}

fn project_decision(
    request: &PathTrustRequest,
    cwd: &str,
    path: &str,
    host: &impl PathHost,
) -> Result<ProjectTrust, String> {
    let Some(trust_path) = request.trust_path.as_deref() else {
        return Ok(ProjectTrust::inactive());
    };
    if !request.trust_decision {
        return Ok(ProjectTrust::inactive());
    }
    let trusted = host.realpath(trust_path)?;
    for policy_path in project_policy_paths(cwd, host) {
        let Ok(source) = host.read_to_string(&policy_path) else {
            continue;
        };
        let canonical_policy = host.realpath(&policy_path).unwrap_or(policy_path);
        if !is_inside(&canonical_policy, &trusted) {
            continue;
        }
        match crate::policy::decision_for_tool_path(&request.tool, &source, path) {
            Ok(PermissionDecision::Ask) => continue,
            Ok(decision) => {
                return Ok(ProjectTrust {
                    eligible: true,
                    decision: Some(decision),
                    diagnostic: None,
                    matched: true,
                });
            }
            Err(error) => {
                return Ok(ProjectTrust {
                    eligible: true,
                    decision: Some(PermissionDecision::Ask),
                    diagnostic: Some(format!(
                        "Project permission policy could not be read: {error}"
                    )),
                    matched: false,
                });
            }
        }
    }
    Ok(ProjectTrust {
        eligible: true,
        decision: None,
        diagnostic: None,
        matched: false,
    })
}

impl ProjectTrust {
    fn inactive() -> Self {
        Self {
            eligible: false,
            decision: None,
            diagnostic: None,
            matched: false,
        }
    }
}

fn project_policy_paths(cwd: &str, host: &impl PathHost) -> Vec<String> {
    let directories = ancestors(cwd);
    let boundary = directories.iter().position(|directory| {
        host.realpath(&format!("{directory}/.git")).is_ok()
            || host.realpath(&format!("{directory}/.jj")).is_ok()
    });
    let eligible: Vec<&String> = match boundary {
        Some(index) => directories.iter().take(index + 1).collect(),
        None => directories.iter().take(1).collect(),
    };
    eligible
        .into_iter()
        .map(|directory| format!("{directory}/.pi/permissions.toml"))
        .collect()
}

fn ancestors(start: &str) -> Vec<String> {
    let mut directories = Vec::new();
    let mut current = start.to_string();
    loop {
        directories.push(current.clone());
        let parent = dirname_posix(&current).to_string();
        if parent == current {
            break;
        }
        current = parent;
    }
    directories
}

fn aiignore_status(cwd: &str, path: &str, host: &impl PathHost) -> AiignoreStatus {
    if !is_inside(path, cwd) {
        return AiignoreStatus::Clear;
    }
    let relative = relative_posix(cwd, path);
    if relative.is_empty() {
        return AiignoreStatus::Clear;
    }
    let ignore_path = format!("{cwd}/.aiignore");
    let Ok(source) = host.read_to_string(&ignore_path) else {
        return AiignoreStatus::Clear;
    };
    let mut builder = GitignoreBuilder::new(cwd);
    for (index, line) in source.lines().enumerate() {
        if let Err(error) = builder.add_line(None, line) {
            return AiignoreStatus::Invalid(format!(
                "{ignore_path} line {} is invalid: {error}",
                index + 1
            ));
        }
    }
    match builder.build() {
        Ok(gitignore) => {
            if gitignore.matched(relative, host.is_dir(path)).is_ignore() {
                AiignoreStatus::Matched
            } else {
                AiignoreStatus::Clear
            }
        }
        Err(error) => AiignoreStatus::Invalid(format!("{ignore_path} could not be built: {error}")),
    }
}

fn is_inside(path: &str, directory: &str) -> bool {
    path == directory || path.starts_with(&format!("{directory}/"))
}

fn relative_posix(directory: &str, path: &str) -> String {
    path.strip_prefix(&format!("{directory}/"))
        .unwrap_or("")
        .to_owned()
}

fn node_resolve(cwd: &str, requested: &str) -> String {
    let requested = if requested.is_empty() { "." } else { requested };
    if requested.starts_with('/') {
        normalize_posix(requested)
    } else {
        normalize_posix(&format!("{cwd}/{requested}"))
    }
}

fn normalize_posix(path: &str) -> String {
    let absolute = path.starts_with('/');
    let mut stack = Vec::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            if stack.pop().is_none() && !absolute {
                stack.push("..");
            }
            continue;
        }
        stack.push(part);
    }
    let joined = stack.join("/");
    if absolute {
        format!("/{joined}")
    } else if joined.is_empty() {
        ".".into()
    } else {
        joined
    }
}

fn canonicalize_leaf(tool: &str, absolute: &str, host: &impl PathHost) -> Result<String, String> {
    match host.realpath(absolute) {
        Ok(path) => Ok(path),
        Err(error) if missing_leaf(tool, &error) => {
            let parent = dirname_posix(absolute);
            let name = basename_posix(absolute);
            if name.is_empty() {
                return Err(error);
            }
            let canonical_parent = host.realpath(parent)?;
            if canonical_parent == "/" {
                Ok(format!("/{name}"))
            } else {
                Ok(format!("{canonical_parent}/{name}"))
            }
        }
        Err(error) => Err(error),
    }
}

fn missing_leaf(tool: &str, error: &str) -> bool {
    matches!(tool, "write" | "edit" | "subagent_result")
        && (error.contains("ENOENT")
            || error.contains("os error 2")
            || error.contains("No such file or directory"))
}

fn dirname_posix(path: &str) -> &str {
    match path.rfind('/') {
        Some(0) => "/",
        Some(index) => &path[..index],
        None => ".",
    }
}

fn basename_posix(path: &str) -> &str {
    match path.rfind('/') {
        Some(index) => &path[index + 1..],
        None => path,
    }
}

#[cfg(test)]
mod tests {
    use super::evaluate;
    use crate::contract::{PathTrustRequest, PermissionDecision};
    use pi_api::PathHost;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct FsHost;

    impl PathHost for FsHost {
        fn realpath(&self, path: &str) -> Result<String, String> {
            fs::canonicalize(path)
                .map(|path| path.to_string_lossy().into_owned())
                .map_err(|error| error.to_string())
        }

        fn read_to_string(&self, path: &str) -> Result<String, String> {
            fs::read_to_string(path).map_err(|error| error.to_string())
        }

        fn is_dir(&self, path: &str) -> bool {
            fs::metadata(path)
                .map(|metadata| metadata.is_dir())
                .unwrap_or(false)
        }
    }

    #[test]
    fn canonical_path_matches_the_host_for_an_existing_read() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let cwd = std::env::temp_dir().join(format!("pi-path-trust-{nanos}"));
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("notes.txt"), "hello").unwrap();
        let cwd_text = cwd.to_string_lossy().into_owned();

        let response = evaluate(
            PathTrustRequest {
                version: 1,
                operation: "path_trust".into(),
                nonce: "tool-permissions-path-trust".into(),
                tool: "read".into(),
                requested_path: "notes.txt".into(),
                cwd: cwd_text,
                trust_path: None,
                trust_decision: false,
            },
            &FsHost,
        )
        .unwrap();

        assert!(response.ok);
        assert_eq!(
            response.cwd,
            FsHost.realpath(&cwd.to_string_lossy()).unwrap()
        );
        assert_eq!(
            response.path,
            FsHost
                .realpath(&cwd.join("notes.txt").to_string_lossy())
                .unwrap()
        );
        let _ = fs::remove_dir_all(cwd);
    }

    #[test]
    fn missing_write_under_a_symlink_parent_uses_the_canonical_parent() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("pi-path-trust-symlink-{nanos}"));
        let cwd = root.join("project");
        let outside = root.join("outside");
        fs::create_dir_all(&cwd).unwrap();
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, cwd.join("escape")).unwrap();

        let response = evaluate(
            PathTrustRequest {
                version: 1,
                operation: "path_trust".into(),
                nonce: "tool-permissions-path-trust".into(),
                tool: "write".into(),
                requested_path: "escape/new.txt".into(),
                cwd: cwd.to_string_lossy().into_owned(),
                trust_path: None,
                trust_decision: false,
            },
            &FsHost,
        )
        .unwrap();

        let outside_real = FsHost.realpath(&outside.to_string_lossy()).unwrap();
        assert_eq!(
            response.cwd,
            FsHost.realpath(&cwd.to_string_lossy()).unwrap()
        );
        assert_eq!(response.path, format!("{outside_real}/new.txt"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn nearer_project_denial_inside_the_trusted_root_wins() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("pi-path-trust-trust-{nanos}"));
        let repo = root.join("project");
        let cwd = repo.join("child");
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::create_dir_all(cwd.join(".pi")).unwrap();
        fs::create_dir_all(repo.join(".pi")).unwrap();
        fs::write(cwd.join("notes.txt"), "hello").unwrap();
        fs::write(
            repo.join(".pi/permissions.toml"),
            "[permissions.read]\nallow = [{ path = '.*' }]\ndeny = []\n",
        )
        .unwrap();
        fs::write(
            cwd.join(".pi/permissions.toml"),
            "[permissions.read]\nallow = []\ndeny = [{ path = '.*' }]\n",
        )
        .unwrap();

        let response = evaluate(
            PathTrustRequest {
                version: 1,
                operation: "path_trust".into(),
                nonce: "tool-permissions-path-trust".into(),
                tool: "read".into(),
                requested_path: "notes.txt".into(),
                cwd: cwd.to_string_lossy().into_owned(),
                trust_path: Some(repo.to_string_lossy().into_owned()),
                trust_decision: true,
            },
            &FsHost,
        )
        .unwrap();

        assert!(response.trust_eligible);
        assert!(matches!(response.decision, PermissionDecision::Deny));
        let _ = fs::remove_dir_all(root);
    }

    fn path_request(tool: &str, cwd: &str, requested: &str) -> PathTrustRequest {
        PathTrustRequest {
            version: 1,
            operation: "path_trust".into(),
            nonce: "tool-permissions-path-trust".into(),
            tool: tool.into(),
            requested_path: requested.into(),
            cwd: cwd.into(),
            trust_path: None,
            trust_decision: false,
        }
    }

    #[test]
    fn a_read_inside_the_working_directory_is_allowed() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let cwd = std::env::temp_dir().join(format!("pi-path-trust-inside-{nanos}"));
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("notes.txt"), "hello").unwrap();
        let cwd_text = cwd.to_string_lossy().into_owned();

        let response = evaluate(path_request("read", &cwd_text, "notes.txt"), &FsHost).unwrap();

        assert!(matches!(response.decision, PermissionDecision::Allow));
        assert!(response.diagnostic.is_none());
        assert!(!response.project_matched);
        let _ = fs::remove_dir_all(cwd);
    }

    #[test]
    fn a_write_inside_the_working_directory_stays_ask() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let cwd = std::env::temp_dir().join(format!("pi-path-trust-write-inside-{nanos}"));
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("notes.txt"), "hello").unwrap();
        let cwd_text = cwd.to_string_lossy().into_owned();

        let response = evaluate(path_request("write", &cwd_text, "notes.txt"), &FsHost).unwrap();

        assert!(matches!(response.decision, PermissionDecision::Ask));
        let _ = fs::remove_dir_all(cwd);
    }

    #[test]
    fn a_directory_only_pattern_matches_the_directory() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let cwd = std::env::temp_dir().join(format!("pi-path-trust-dir-{nanos}"));
        fs::create_dir_all(cwd.join("logs")).unwrap();
        fs::write(cwd.join("notes.txt"), "hello").unwrap();
        fs::write(cwd.join(".aiignore"), "logs/\nnotes.txt/\n").unwrap();
        let cwd_text = cwd.to_string_lossy().into_owned();

        let directory = evaluate(path_request("read", &cwd_text, "logs"), &FsHost).unwrap();
        let file = evaluate(path_request("read", &cwd_text, "notes.txt"), &FsHost).unwrap();

        assert!(directory.aiignore_match);
        assert!(matches!(directory.decision, PermissionDecision::Deny));
        assert!(!file.aiignore_match);
        assert!(matches!(file.decision, PermissionDecision::Allow));
        let _ = fs::remove_dir_all(cwd);
    }

    #[test]
    fn an_invalid_aiignore_line_asks_with_a_diagnostic() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let cwd = std::env::temp_dir().join(format!("pi-path-trust-bad-ignore-{nanos}"));
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("notes.txt"), "hello").unwrap();
        fs::write(cwd.join(".aiignore"), "[z-a]\n").unwrap();
        let cwd_text = cwd.to_string_lossy().into_owned();

        let response = evaluate(path_request("read", &cwd_text, "notes.txt"), &FsHost).unwrap();

        assert!(matches!(response.decision, PermissionDecision::Ask));
        assert!(!response.aiignore_match);
        let diagnostic = response.diagnostic.unwrap_or_default();
        assert!(diagnostic.contains(".aiignore"));
        assert!(diagnostic.contains("invalid"));
        let _ = fs::remove_dir_all(cwd);
    }

    #[test]
    fn a_malformed_project_policy_asks_with_a_diagnostic() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("pi-path-trust-bad-policy-{nanos}"));
        let cwd = root.join("project");
        fs::create_dir_all(cwd.join(".git")).unwrap();
        fs::create_dir_all(cwd.join(".pi")).unwrap();
        fs::write(cwd.join("notes.txt"), "hello").unwrap();
        fs::write(cwd.join(".pi/permissions.toml"), "[[[\n").unwrap();
        let cwd_text = cwd.to_string_lossy().into_owned();
        let mut request = path_request("read", &cwd_text, "notes.txt");
        request.trust_path = Some(cwd_text.clone());
        request.trust_decision = true;

        let response = evaluate(request, &FsHost).unwrap();

        assert!(matches!(response.decision, PermissionDecision::Ask));
        assert!(!response.project_matched);
        let diagnostic = response.diagnostic.unwrap_or_default();
        assert!(diagnostic.contains("could not be read"));
        let _ = fs::remove_dir_all(root);
    }
}
