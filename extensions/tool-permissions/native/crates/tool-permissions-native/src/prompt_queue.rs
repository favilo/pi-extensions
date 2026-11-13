use crate::CONTRACT_VERSION;
use crate::contract::{
    NativeOperation, PromptQueueDecision, PromptQueueRequest, PromptQueueResponse,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PromptQueueError {
    #[error("incompatible prompt-queue request")]
    Incompatible,
    #[error("native request nonce must be 1-256 characters")]
    Nonce,
    #[error("prompt is missing the tool-call id")]
    ToolCallId,
}

pub fn validate(request: &PromptQueueRequest) -> Result<(), PromptQueueError> {
    if request.version != CONTRACT_VERSION || request.operation != "prompt_queue" {
        return Err(PromptQueueError::Incompatible);
    }
    if request.nonce.is_empty() || request.nonce.len() > 256 {
        return Err(PromptQueueError::Nonce);
    }
    ToolCallId::parse(&request.tool_call_id)?;
    Ok(())
}

pub fn complete(
    request: PromptQueueRequest,
    decision: PromptQueueDecision,
) -> Result<PromptQueueResponse, PromptQueueError> {
    validate(&request)?;
    response(request, decision)
}

fn response(
    request: PromptQueueRequest,
    decision: PromptQueueDecision,
) -> Result<PromptQueueResponse, PromptQueueError> {
    let tool_call_id = ToolCallId::parse(&request.tool_call_id)?;
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

    fn into_string(self) -> String {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::{PromptQueueDecision, complete};
    use crate::contract::PromptQueueRequest;

    #[test]
    fn allow_stays_bound_to_the_tool_call_that_opened_the_prompt() {
        let response = complete(
            PromptQueueRequest {
                version: 1,
                operation: "prompt_queue".into(),
                nonce: "tool-permissions-prompt-queue".into(),
                tool_call_id: "call-allow".into(),
            },
            PromptQueueDecision::Allow,
        )
        .unwrap();

        assert!(response.ok);
        assert_eq!(response.tool_call_id, "call-allow");
        assert!(matches!(response.decision, PromptQueueDecision::Allow));
    }
}
