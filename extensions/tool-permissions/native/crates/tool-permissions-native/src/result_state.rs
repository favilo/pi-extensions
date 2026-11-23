#[derive(Default)]
pub(crate) struct ResultState;

impl ResultState {
    pub(crate) fn record_steering(&mut self, _call_id: String, _steering: String) {}

    pub(crate) fn take_steering(&mut self, _call_id: &str) -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::ResultState;

    #[test]
    fn steering_is_consumed_only_by_its_own_tool_call() {
        let mut state = ResultState::default();
        state.record_steering("first".into(), "review this".into());
        assert_eq!(state.take_steering("other"), None);
        assert_eq!(state.take_steering("first"), Some("review this".into()));
        assert_eq!(state.take_steering("first"), None);
    }
}
