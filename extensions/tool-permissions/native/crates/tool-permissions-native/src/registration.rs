use crate::contract::{NativeOperation, NativeRegistrationRequest, NativeRegistrationResponse};
use crate::tool_call::{ResultState, ToolCallId};
use crate::{CONTRACT_VERSION, validate_nonce};
use napi::bindgen_prelude::{
    Either, FnArgs, Function, FunctionRef, JsObjectValue, Object, PromiseRaw, Unknown,
};
use napi::{Env, Error, JsValue, Result};
use parking_lot::Mutex;
use pi_api::{Bridge, CallbackPresence, OnCallback, ScopedPi};
use std::sync::Arc;

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

    pub fn register_tool_call(
        &mut self,
        is_active: impl Fn() -> bool + Clone + 'static,
    ) -> Result<()> {
        let source = self
            .bridge
            .source()
            .ok_or_else(|| Error::from_reason("handleToolCall bridge is unavailable"))?;
        let callback = source.get_named_property::<Function<FnArgs<(Unknown<'static>, Unknown<'static>)>, Unknown<'static>>>("handleToolCall")?.create_ref()?;
        let handler =
            self.bridge
                .env()
                .create_function_from_closure("toolPermissionsCall", move |ctx| {
                    if !is_active() {
                        let mut denied = Object::new(ctx.env)?;
                        denied.set_named_property("block", true)?;
                        denied.set_named_property("reason", "Permission session is closed.")?;
                        return PromiseRaw::resolve(ctx.env, Either::<Object, Unknown>::A(denied));
                    }
                    let event: Object = ctx.get(0)?;
                    let valid_name = event
                        .get_named_property::<String>("toolName")
                        .is_ok_and(|name| !name.is_empty());
                    if !valid_name {
                        let mut denied = Object::new(ctx.env)?;
                        denied.set_named_property("block", true)?;
                        denied.set_named_property("reason", "Invalid tool call.")?;
                        return PromiseRaw::resolve(ctx.env, Either::<Object, Unknown>::A(denied));
                    }
                    let context: Unknown = ctx.get(1)?;
                    let result = callback
                        .borrow_back(ctx.env)?
                        .call(FnArgs::from((event.to_unknown(), context)))?;
                    let active = is_active.clone();
                    let promise = PromiseRaw::resolve(ctx.env, result)?.then(move |settled| {
                        if active() {
                            Ok(Either::B(settled.value))
                        } else {
                            let mut denied = Object::new(&settled.env)?;
                            denied.set_named_property("block", true)?;
                            denied.set_named_property("reason", "Permission session is closed.")?;
                            Ok(Either::A(denied))
                        }
                    })?;
                    Ok(promise)
                })?;
        self.bridge
            .pi()
            .on(self.bridge.env(), OnCallback::ToolCall, handler)?;
        self.record(true, "tool_call")
    }

    fn register_native_steering_result(
        &mut self,
        is_active: impl Fn() -> bool + Clone + 'static,
        state: Arc<Mutex<ResultState>>,
    ) -> Result<bool> {
        let Some(mut source) = self.bridge.source() else {
            return Ok(false);
        };
        // TODO: Remove preview cleanup delegation when interactive state moves to Rust.
        let preview_cleanup = source
            .get_named_property::<Function<FnArgs<(Unknown<'static>, Unknown<'static>)>, Unknown<'static>>>("handleToolResult")
            .ok()
            .map(|callback| callback.create_ref())
            .transpose()?;
        if source
            .get_named_property::<Function<FnArgs<(String, String)>, bool>>("recordSteering")
            .is_err()
        {
            return Ok(false);
        }
        let record_state = state.clone();
        let active = is_active.clone();
        // TODO: Remove this TypeScript capability after the prompt UI moves to Rust.
        let record: Function<FnArgs<(String, String)>, bool> = self
            .bridge
            .env()
            .create_function_from_closure("recordSteering", move |ctx| {
                if !active() {
                    record_state.lock().clear_on_session_shutdown();
                    return Ok(false);
                }
                let id: String = ctx.get(0)?;
                let text: String = ctx.get(1)?;
                let id = ToolCallId::parse(&id).map_err(|e| Error::from_reason(e.to_string()))?;
                record_state.lock().record_steering(id, text);
                Ok(true)
            })?;
        source.set_named_property("recordSteering", record)?;
        // TODO: Remove this cancellation capability when prompt ownership moves to Rust.
        let discard_state = state.clone();
        let discard: Function<String, bool> =
            self.bridge
                .env()
                .create_function_from_closure("discardSteering", move |ctx| {
                    let id: String = ctx.get(0)?;
                    let id = ToolCallId::parse(&id)
                        .map_err(|error| Error::from_reason(error.to_string()))?;
                    Ok(discard_state.lock().take_steering(&id).is_some())
                })?;
        source.set_named_property("discardSteering", discard)?;
        let handler = self.bridge.env().create_function_from_closure("toolPermissionsResult", move |ctx| {
            if !is_active() { state.lock().clear_on_session_shutdown(); return Ok(Either::B(())); }
            let event: Object = ctx.get(0)?;
            let legacy = if let Some(callback) = &preview_cleanup {
                let context: Unknown = ctx.get(1)?;
                Some(callback.borrow_back(ctx.env)?.call(FnArgs::from((event.to_unknown(), context)))?)
            } else { None };
            let id: String = event.get_named_property("toolCallId")?;
            let id = ToolCallId::parse(&id).map_err(|e| Error::from_reason(e.to_string()))?;
            let Some(steering) = state.lock().take_steering(&id) else {
                return Ok(match legacy { Some(value) => Either::A(value), None => Either::B(()) });
            };
            let mut content: Vec<Unknown> = event.get_named_property("content")?;
            let mut annotation = Object::new(ctx.env)?;
            annotation.set_named_property("type", "text")?;
            annotation.set_named_property("text", format!("\n\n<user-steering source=\"permission-prompt\">\n{steering}\n</user-steering>"))?;
            content.push(annotation.to_unknown());
            let mut result = Object::new(ctx.env)?;
            result.set_named_property("content", content)?;
            Ok(Either::A(result.to_unknown()))
        })?;
        self.bridge
            .pi()
            .on(self.bridge.env(), OnCallback::ToolResult, handler)?;
        self.registrations.push("tool_result".to_owned());
        Ok(true)
    }

    pub fn register_tool_result(&mut self) -> Result<()> {
        self.record(
            self.bridge.forward_on(
                OnCallback::ToolResult,
                "handleToolResult",
                CallbackPresence::Always,
                None,
            )?,
            "tool_result",
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
    let scoped_pi = ScopedPi::new(env, bridge.bridge.pi())?;
    scoped_pi.register_callback(crate::sample_callback::SampleCommand)?;
    let is_active = scoped_pi.is_active_check();
    let result_state = Arc::new(Mutex::new(ResultState::default()));
    let cleanup_state = result_state.clone();
    scoped_pi.on_close(move || cleanup_state.lock().clear_on_session_shutdown())?;
    // TODO: Replace this temporary TypeScript shutdown capability with Rust-owned cleanup.
    let shutdown_registered = if let Some(source) = bridge.bridge.source() {
        if let Ok(handler) = source.get_named_property::<Function<FnArgs<(Unknown<'static>, Unknown<'static>)>, Unknown<'static>>>("handleSessionShutdown") {
            scoped_pi.on_shutdown(&handler)?;
            true
        } else { false }
    } else {
        false
    };
    // TODO: Move startup and shutdown behavior into Rust, then remove these
    // temporary TypeScript lifecycle capabilities.
    bridge.record(
        bridge.bridge.forward_on(
            OnCallback::SessionStart,
            "handleSessionStart",
            CallbackPresence::Always,
            Some(crate::lifecycle_callbacks::notify_session_start),
        )?,
        "session_start",
    )?;
    bridge.register_tool_call(is_active.clone())?;
    if !bridge.register_native_steering_result(is_active, result_state)? {
        bridge.register_tool_result()?;
    }
    bridge.record(shutdown_registered, "session_shutdown")?;
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
