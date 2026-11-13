use crate::CONTRACT_VERSION;
use crate::contract::{
    NativeOperation, PromptQueueDecision, PromptQueueRequest, PromptQueueResponse,
};
use napi::bindgen_prelude::Function;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PromptQueueError {
    #[error("incompatible prompt-queue request")]
    Incompatible,
    #[error("native request nonce must be 1-256 characters")]
    Nonce,
    #[error("prompt is missing the tool-call id")]
    ToolCallId,
    #[error("prompt UI failed")]
    Present,
    #[error("prompt UI returned an unknown decision")]
    Decision,
}

pub trait PromptHost {
    fn present(&self, tool_call_id: &str) -> Result<PromptQueueDecision, PromptQueueError>;
}

pub struct PresentCallback<'a> {
    present: &'a Function<'a, String, String>,
}

impl<'a> PresentCallback<'a> {
    pub fn new(present: &'a Function<'a, String, String>) -> Self {
        Self { present }
    }
}

impl PromptHost for PresentCallback<'_> {
    fn present(&self, tool_call_id: &str) -> Result<PromptQueueDecision, PromptQueueError> {
        let decision = self
            .present
            .call(tool_call_id.to_owned())
            .map_err(|_| PromptQueueError::Present)?;
        PromptQueueDecision::parse(&decision)
    }
}

impl PromptQueueDecision {
    fn parse(decision: &str) -> Result<Self, PromptQueueError> {
        match decision {
            "allow" => Ok(Self::Allow),
            "deny" => Ok(Self::Deny),
            "steer" => Ok(Self::Steer),
            _ => Err(PromptQueueError::Decision),
        }
    }
}

pub fn present(
    request: PromptQueueRequest,
    host: &impl PromptHost,
) -> Result<PromptQueueResponse, PromptQueueError> {
    if request.version != CONTRACT_VERSION || request.operation != "prompt_queue" {
        return Err(PromptQueueError::Incompatible);
    }
    if request.nonce.is_empty() || request.nonce.len() > 256 {
        return Err(PromptQueueError::Nonce);
    }
    let tool_call_id = ToolCallId::parse(&request.tool_call_id)?;
    let decision = host.present(tool_call_id.as_str())?;
    Ok(PromptQueueResponse {
        version: CONTRACT_VERSION,
        operation: NativeOperation::PromptQueue,
        ok: true,
        nonce: request.nonce,
        tool_call_id: tool_call_id.into_string(),
        decision,
    })
}

struct ToolCallId(String);

impl ToolCallId {
    fn parse(value: &str) -> Result<Self, PromptQueueError> {
        if value.is_empty() {
            return Err(PromptQueueError::ToolCallId);
        }
        Ok(Self(value.to_owned()))
    }

    fn as_str(&self) -> &str {
        &self.0
    }

    fn into_string(self) -> String {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::{PromptHost, PromptQueueDecision, PromptQueueError, present};
    use crate::contract::PromptQueueRequest;

    struct AllowHost;

    impl PromptHost for AllowHost {
        fn present(&self, tool_call_id: &str) -> Result<PromptQueueDecision, PromptQueueError> {
            assert_eq!(tool_call_id, "call-allow");
            Ok(PromptQueueDecision::Allow)
        }
    }

    #[test]
    fn allow_stays_bound_to_the_tool_call_that_opened_the_prompt() {
        let response = present(
            PromptQueueRequest {
                version: 1,
                operation: "prompt_queue".into(),
                nonce: "tool-permissions-prompt-queue".into(),
                tool_call_id: "call-allow".into(),
            },
            &AllowHost,
        )
        .unwrap();

        assert!(response.ok);
        assert_eq!(response.tool_call_id, "call-allow");
        assert!(matches!(response.decision, PromptQueueDecision::Allow));
    }
}
