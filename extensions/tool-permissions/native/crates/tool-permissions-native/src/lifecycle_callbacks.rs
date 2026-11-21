use napi::Result;
use napi::bindgen_prelude::Object;
use pi_api::Ui;

pub(crate) fn notify_session_start(session_context: &Object) -> Result<()> {
    let Some(ui) = Ui::from_session(session_context)? else {
        return Ok(());
    };
    ui.notify("Rust native registration active.", "info")
}
