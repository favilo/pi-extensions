use crate::contract::{NativeOperation, NativeRegistrationRequest, NativeRegistrationResponse};
use crate::{CONTRACT_VERSION, validate_nonce};
use napi::bindgen_prelude::{FnArgs, Function, FunctionRef, JsObjectValue, Object, Unknown};
use napi::{Env, Error, Result};
use pi_api::{Bridge, CallbackPresence, OnCallback, Ui};

type NativeRenderer =
    FunctionRef<FnArgs<(Unknown<'static>, Unknown<'static>, Unknown<'static>)>, Unknown<'static>>;
type NativeCommand = FunctionRef<FnArgs<(String, Unknown<'static>)>, Unknown<'static>>;
/// A registered JS function whose return value stays opaque to Rust.
type NativeHandler<'env> = Function<'env, (), Unknown<'static>>;

pub struct RegistrationBridge<'env> {
    bridge: Bridge<'env>,
    registrations: Vec<String>,
}

impl<'env> RegistrationBridge<'env> {
    pub fn new(env: &'env Env, pi: pi_api::Pi, bridge: Option<Object<'env>>) -> Result<Self> {
        Ok(Self {
            bridge: Bridge::new(env, pi, bridge)?,
            registrations: Vec::new(),
        })
    }

    pub fn registrations(self) -> Vec<String> {
        self.registrations
    }

    pub fn register_session_start(&mut self) -> Result<()> {
        self.record(
            self.bridge.forward_on(
                OnCallback::SessionStart,
                "handleSessionStart",
                CallbackPresence::Always,
                Some(notify_session_start),
            )?,
            "session_start",
        )
    }

    pub fn register_tool_call(&mut self) -> Result<()> {
        self.record(
            self.bridge.forward_on(
                OnCallback::ToolCall,
                "handleToolCall",
                CallbackPresence::Required,
                None,
            )?,
            "tool_call",
        )
    }

    pub fn register_tool_result(&mut self) -> Result<()> {
        self.record(
            self.bridge.forward_on(
                OnCallback::ToolResult,
                "handleToolResult",
                CallbackPresence::IfPresent,
                None,
            )?,
            "tool_result",
        )
    }

    pub fn register_session_shutdown(&mut self) -> Result<()> {
        self.record(
            self.bridge.forward_on(
                OnCallback::SessionShutdown,
                "handleSessionShutdown",
                CallbackPresence::Always,
                None,
            )?,
            "session_shutdown",
        )
    }

    pub fn register_command(&mut self) -> Result<()> {
        let Some(callback) = self.optional_command("handlePermissionsCommand") else {
            return Ok(());
        };
        let handler: NativeHandler = self.bridge.env().create_function_from_closure(
            "toolPermissionsCommand",
            move |ctx| {
                let args: String = ctx.get(0)?;
                let command_context: Unknown = ctx.get(1)?;
                let callback = callback.borrow_back(ctx.env)?;
                callback.call(FnArgs::from((args, command_context)))
            },
        )?;
        self.bridge.pi().register_command(
            self.bridge.env(),
            "permissions",
            "Edit user or local tool permissions",
            handler,
        )?;
        self.registrations.push("command:permissions".to_owned());
        Ok(())
    }

    pub fn register_entry_renderer(&mut self) -> Result<()> {
        let Some(renderer) = self.optional_renderer("renderPermissionPreview") else {
            return Ok(());
        };
        let handler: NativeHandler = self.bridge.env().create_function_from_closure(
            "toolPermissionsPreviewRenderer",
            move |ctx| {
                let entry: Unknown = ctx.get(0)?;
                let options: Unknown = ctx.get(1)?;
                let theme: Unknown = ctx.get(2)?;
                let renderer = renderer.borrow_back(ctx.env)?;
                renderer.call(FnArgs::from((entry, options, theme)))
            },
        )?;
        self.bridge.pi().register_entry_renderer(
            self.bridge.env(),
            "permission-preview",
            handler,
        )?;
        self.registrations
            .push("entry_renderer:permission-preview".to_owned());
        Ok(())
    }

    fn record(&mut self, registered: bool, label: &str) -> Result<()> {
        if registered {
            self.registrations.push(label.to_owned());
        }
        Ok(())
    }

    fn optional_command(&self, name: &str) -> Option<NativeCommand> {
        self.bridge.source().and_then(|bridge| {
            bridge
                .get_named_property::<Function<FnArgs<(String, Unknown<'static>)>, Unknown<'static>>>(name)
                .and_then(|function| function.create_ref())
                .ok()
        })
    }

    fn optional_renderer(&self, name: &str) -> Option<NativeRenderer> {
        self.bridge.source().and_then(|bridge| {
            bridge
                .get_named_property::<Function<
                    FnArgs<(Unknown<'static>, Unknown<'static>, Unknown<'static>)>,
                    Unknown<'static>,
                >>(name)
                .and_then(|function| function.create_ref())
                .ok()
        })
    }
}

fn notify_session_start(session_context: &Object) -> Result<()> {
    let Some(ui) = Ui::from_session(session_context)? else {
        return Ok(());
    };
    ui.notify("Rust native registration active.", "info")
}

pub fn register_callbacks(
    env: &Env,
    request: NativeRegistrationRequest,
    pi: pi_api::Pi,
    bridge: Option<Object>,
) -> Result<NativeRegistrationResponse> {
    if request.version != CONTRACT_VERSION || request.operation != "register_callbacks" {
        return Err(Error::from_reason("incompatible registration request"));
    }
    validate_nonce(&request.nonce)?;

    let mut bridge = RegistrationBridge::new(env, pi, bridge)?;
    pi_api::ScopedPi::new(env, bridge.bridge.pi())?
        .register_callback(crate::sample_callback::SampleCommand)?;
    bridge.register_session_start()?;
    bridge.register_tool_call()?;
    bridge.register_tool_result()?;
    bridge.register_session_shutdown()?;
    bridge.register_command()?;
    bridge.register_entry_renderer()?;

    Ok(NativeRegistrationResponse {
        version: CONTRACT_VERSION,
        operation: NativeOperation::RegisterCallbacks,
        ok: true,
        nonce: request.nonce,
        registrations: bridge.registrations(),
    })
}
