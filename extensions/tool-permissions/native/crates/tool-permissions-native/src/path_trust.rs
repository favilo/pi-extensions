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
    let aiignore_match = aiignore_matches(&cwd, &path, host);
    let (trust_eligible, project_decision) = project_decision(&request, &cwd, &path, host)?;
    let decision = match project_decision {
        Some(PermissionDecision::Deny) => PermissionDecision::Deny,
        _ if aiignore_match => PermissionDecision::Deny,
        Some(decision) => decision,
        None => PermissionDecision::Ask,
    };
    Ok(PathTrustResponse {
        version: CONTRACT_VERSION,
        operation: NativeOperation::PathTrust,
        ok: true,
        nonce: request.nonce,
        path,
        cwd,
        trust_eligible,
        aiignore_match,
        decision,
    })
}

fn project_decision(
    request: &PathTrustRequest,
    cwd: &str,
    path: &str,
    host: &impl PathHost,
) -> Result<(bool, Option<PermissionDecision>), String> {
    let Some(trust_path) = request.trust_path.as_deref() else {
        return Ok((false, None));
    };
    if !request.trust_decision {
        return Ok((false, None));
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
            Ok(decision) => return Ok((true, Some(decision))),
            Err(_) => return Ok((true, Some(PermissionDecision::Ask))),
        }
    }
    Ok((true, None))
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

fn aiignore_matches(cwd: &str, path: &str, host: &impl PathHost) -> bool {
    if !is_inside(path, cwd) {
        return false;
    }
    let relative = relative_posix(cwd, path);
    if relative.is_empty() {
        return false;
    }
    let Ok(source) = host.read_to_string(&format!("{cwd}/.aiignore")) else {
        return false;
    };
    let mut builder = GitignoreBuilder::new(cwd);
    for line in source.lines() {
        if builder.add_line(None, line).is_err() {
            return true;
        }
    }
    match builder.build() {
        Ok(gitignore) => gitignore.matched(relative, false).is_ignore(),
        Err(_) => true,
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
}
