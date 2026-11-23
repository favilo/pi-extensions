use std::collections::HashMap;

#[derive(Debug, thiserror::Error)]
#[error("tool-call id is empty")]
pub(crate) struct InvalidToolCallId;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct ToolCallId(String);

impl ToolCallId {
    pub(crate) fn parse(value: &str) -> Result<Self, InvalidToolCallId> {
        if value.is_empty() {
            return Err(InvalidToolCallId);
        }
        Ok(Self(value.to_owned()))
    }

    pub(crate) fn into_string(self) -> String {
        self.0
    }
}

#[derive(Default)]
pub(crate) struct ResultState {
    steering: HashMap<ToolCallId, String>,
}

impl ResultState {
    pub(crate) fn record_steering(&mut self, call_id: ToolCallId, steering: String) {
        self.steering.insert(call_id, steering);
    }

    pub(crate) fn take_steering(&mut self, call_id: &ToolCallId) -> Option<String> {
        self.steering.remove(call_id)
    }

    pub(crate) fn close(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::{ResultState, ToolCallId};

    #[test]
    fn closing_one_session_does_not_clear_another_sessions_steering() {
        let id = ToolCallId::parse("same-call").unwrap();
        let mut first = ResultState::default();
        let mut second = ResultState::default();
        first.record_steering(id.clone(), "first".into());
        second.record_steering(id.clone(), "second".into());
        first.close();
        assert_eq!(first.take_steering(&id), None);
        assert_eq!(second.take_steering(&id), Some("second".into()));
    }

    #[test]
    fn steering_is_consumed_only_by_its_own_tool_call() {
        let mut state = ResultState::default();
        let first = ToolCallId::parse("first").unwrap();
        let other = ToolCallId::parse("other").unwrap();
        state.record_steering(first.clone(), "review this".into());
        assert_eq!(state.take_steering(&other), None);
        assert_eq!(state.take_steering(&first), Some("review this".into()));
        assert_eq!(state.take_steering(&first), None);
    }
}
