use crate::CONTRACT_VERSION;
use crate::contract::{NativeOperation, PathTrustRequest, PathTrustResponse, PermissionDecision};
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
    let path = host.realpath(&absolute)?;
    Ok(PathTrustResponse {
        version: CONTRACT_VERSION,
        operation: NativeOperation::PathTrust,
        ok: true,
        nonce: request.nonce,
        path,
        cwd,
        trust_eligible: false,
        aiignore_match: false,
        decision: PermissionDecision::Ask,
    })
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

#[cfg(test)]
mod tests {
    use super::evaluate;
    use crate::contract::PathTrustRequest;
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
        assert_eq!(response.cwd, FsHost.realpath(&cwd.to_string_lossy()).unwrap());
        assert_eq!(response.path, format!("{outside_real}/new.txt"));
        let _ = fs::remove_dir_all(root);
    }
}
