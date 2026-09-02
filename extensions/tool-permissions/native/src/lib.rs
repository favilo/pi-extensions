use napi::{Error, Result};
use napi_derive::napi;

const CONTRACT_VERSION: i64 = 1;

#[napi(object)]
pub struct ProbeRequest {
    pub version: i64,
    pub operation: String,
    pub nonce: String,
}

#[napi(object)]
pub struct ProbeResponse {
    pub version: i64,
    pub operation: String,
    pub ok: bool,
    pub nonce: String,
}

#[napi]
pub fn probe(request: ProbeRequest) -> Result<ProbeResponse> {
    if request.version != CONTRACT_VERSION || request.operation != "health" {
        return Err(Error::from_reason("incompatible probe request"));
    }
    Ok(ProbeResponse {
        version: CONTRACT_VERSION,
        operation: "health".to_owned(),
        ok: true,
        nonce: request.nonce,
    })
}

#[cfg(test)]
mod tests {
    use super::{probe, ProbeRequest};

    #[test]
    fn probe_returns_a_distinct_typed_response() {
        let response = probe(ProbeRequest {
            version: 1,
            operation: "health".to_owned(),
            nonce: "native".to_owned(),
        })
        .expect("compatible probe request");
        assert!(response.ok);
        assert_eq!(response.operation, "health");
        assert_eq!(response.nonce, "native");
    }
}
