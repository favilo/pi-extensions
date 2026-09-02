use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

const CONTRACT_VERSION: u8 = 1;

#[derive(Deserialize, Serialize)]
pub struct ProbeRequest {
    pub version: u8,
    pub operation: String,
    pub payload: ProbePayload,
}

#[derive(Deserialize, Serialize)]
pub struct ProbePayload {
    pub nonce: String,
}

#[derive(Serialize)]
pub struct ProbeResponse {
    pub version: u8,
    pub operation: &'static str,
    pub ok: bool,
    pub payload: ProbePayload,
}

fn build_response(request: ProbeRequest) -> Result<ProbeResponse, &'static str> {
    if request.version != CONTRACT_VERSION || request.operation != "health" {
        return Err("incompatible probe request");
    }
    Ok(ProbeResponse {
        version: CONTRACT_VERSION,
        operation: "health",
        ok: true,
        payload: request.payload,
    })
}

/// Pure probe boundary: the host owns contract validation and all side effects.
#[wasm_bindgen]
pub fn probe(request: JsValue) -> Result<JsValue, JsValue> {
    let request: ProbeRequest = serde_wasm_bindgen::from_value(request)
        .map_err(|error| JsValue::from_str(&format!("invalid probe request: {error}")))?;
    let response = build_response(request).map_err(JsValue::from_str)?;
    serde_wasm_bindgen::to_value(&response)
        .map_err(|error| JsValue::from_str(&format!("failed to encode probe response: {error}")))
}

#[cfg(test)]
mod tests {
    use super::{build_response, ProbeRequest};

    #[test]
    fn probe_returns_a_distinct_typed_health_response() {
        let request = ProbeRequest {
            version: 1,
            operation: "health".to_owned(),
            payload: super::ProbePayload {
                nonce: "test".to_owned(),
            },
        };
        let response = build_response(request).expect("compatible request");
        assert_eq!(response.version, 1);
        assert_eq!(response.operation, "health");
        assert!(response.ok);
        assert_eq!(response.payload.nonce, "test");
    }
}
