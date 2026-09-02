use wasm_bindgen::prelude::*;

/// Pure probe boundary: the host owns JSON validation and all side effects.
#[wasm_bindgen]
pub fn probe(request_json: String) -> String {
    request_json
}
