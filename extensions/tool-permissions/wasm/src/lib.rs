use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

const CONTRACT_VERSION: u8 = 1;

#[derive(Deserialize)]
struct ProbeRequest {
    version: u8,
    operation: String,
    payload: ProbePayload,
}

#[derive(Deserialize, Serialize)]
struct ProbePayload {
    nonce: String,
}

#[derive(Serialize)]
struct ProbeResponse {
    version: u8,
    operation: &'static str,
    ok: bool,
    payload: ProbePayload,
}

/// Pure probe boundary: the host owns JSON validation and all side effects.
#[wasm_bindgen]
pub fn probe(request_json: String) -> String {
    let Ok(request) = serde_json::from_str::<ProbeRequest>(&request_json) else {
        return "{}".to_owned();
    };
    if request.version != CONTRACT_VERSION || request.operation != "health" {
        return "{}".to_owned();
    }
    serde_json::to_string(&ProbeResponse {
        version: CONTRACT_VERSION,
        operation: "health",
        ok: true,
        payload: request.payload,
    })
    .unwrap_or_else(|_| "{}".to_owned())
}

#[cfg(test)]
mod tests {
    use super::probe;

    #[test]
    fn probe_returns_a_distinct_health_response() {
        let request = r#"{"version":1,"operation":"health","payload":{"nonce":"test"}}"#;
        let response = probe(request.to_owned());
        assert_ne!(response, request);
        assert_eq!(
            response,
            r#"{"version":1,"operation":"health","ok":true,"payload":{"nonce":"test"}}"#,
        );
    }
}
