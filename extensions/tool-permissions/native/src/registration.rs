use crate::contract::{NativeOperation, NativeRegistrationRequest, NativeRegistrationResponse};
use crate::{validate_nonce, CONTRACT_VERSION};
use napi::{
    bindgen_prelude::{FnArgs, Function, FunctionRef, JsObjectValue, Object, Unknown},
    Env, Error, Result,
};

// Why `Unknown<'static>` appears here
//
// `create_function_from_closure` requires a `'static` closure, and a `'static`
// closure may not mention a non-`'static` lifetime. That naming constraint is
// the only reason these aliases spell `Unknown<'static>`. In napi 3,
// `FunctionRef<Args, Return>` stores a raw `napi_ref` plus the owning
// `napi_env`; it has no Rust lifetime parameter of its own, and `Args`/`Return`
// exist only as `PhantomData` markers. `Unknown<'env>` is likewise a `Copy`
// wrapper over a raw value plus `PhantomData<&'env ()>`, so no borrow is held
// across the callback boundary and nothing here claims the referenced JS
// values outlive the env.
//
// Each invocation re-anchors validity through `borrow_back(ctx.env)`, which
// returns a `Function<'scope>` tied to the live calling `Env`. The covariant
// `PhantomData<&'env ()>` inside `Unknown` lets the per-call value coerce into
// the `'static` marker slot. Alternatives were evaluated and rejected:
// `UnknownRef` creates a real `napi_ref` per conversion (refcount churn plus a
// leak-check warning on every call), and napi 3.12 exposes no lifetime-free
// unknown value type in the bindgen runtime.
type NativeCallback = FunctionRef<FnArgs<(Unknown<'static>, Unknown<'static>)>, Unknown<'static>>;
type NativeRenderer = FunctionRef<FnArgs<(Unknown<'static>, Unknown<'static>, Unknown<'static>)>, Unknown<'static>>;
type NativeCommand = FunctionRef<FnArgs<(String, Unknown<'static>)>, Unknown<'static>>;
/// A registered JS function whose return value stays opaque to Rust.
type NativeHandler<'env> = Function<'env, (), Unknown<'static>>;

pub struct RegistrationBridge<'env> {
    env: &'env Env,
    pi: Object<'env>,
    bridge: Option<Object<'env>>,
    registrations: Vec<String>,
}

impl<'env> RegistrationBridge<'env> {
    pub fn new(env: &'env Env, pi: Object<'env>, bridge: Option<Object<'env>>) -> Self {
        Self { env, pi, bridge, registrations: Vec::new() }
    }

    pub fn registrations(self) -> Vec<String> { self.registrations }

    pub fn register_session_start(&mut self) -> Result<()> {
        let handle_session_start = self.optional_callback("handleSessionStart");
        let handler = self.env.create_function_from_closure("toolPermissionsSessionStart", move |ctx| {
            let event: Unknown = ctx.get(0)?;
            let extension_context: Unknown = ctx.get(1)?;
            if let Ok(session_context) = ctx.get::<Object>(1) { notify_session_start(&session_context)?; }
            if let Some(handle_session_start) = &handle_session_start {
                let handle_session_start = handle_session_start.borrow_back(ctx.env)?;
                handle_session_start.call(FnArgs::from((event, extension_context)))?;
            }
            Ok(())
        })?;
        self.pi_on()?.call(FnArgs::from(("session_start".to_owned(), handler)))?;
        self.registrations.push("session_start".to_owned());
        Ok(())
    }

    pub fn register_tool_call(&mut self) -> Result<()> {
        let handler = forwarding_handler(self.env, "toolPermissionsToolCall", self.required_callback("handleToolCall", "tool_call")?)?;
        self.pi_on()?.call(FnArgs::from(("tool_call".to_owned(), handler)))?;
        self.registrations.push("tool_call".to_owned());
        Ok(())
    }

    pub fn register_tool_result(&mut self) -> Result<()> {
        let Some(callback) = self.optional_callback("handleToolResult") else { return Ok(()); };
        let handler = forwarding_handler(self.env, "toolPermissionsToolResult", callback)?;
        self.pi_on()?.call(FnArgs::from(("tool_result".to_owned(), handler)))?;
        self.registrations.push("tool_result".to_owned());
        Ok(())
    }

    pub fn register_session_shutdown(&mut self) -> Result<()> {
        let Some(callback) = self.optional_callback("handleSessionShutdown") else { return Ok(()); };
        let handler = forwarding_handler(self.env, "toolPermissionsSessionShutdown", callback)?;
        self.pi_on()?.call(FnArgs::from(("session_shutdown".to_owned(), handler)))?;
        self.registrations.push("session_shutdown".to_owned());
        Ok(())
    }

    pub fn register_command(&mut self) -> Result<()> {
        let Some(callback) = self.optional_command("handlePermissionsCommand") else { return Ok(()); };
        let handler: NativeHandler = self.env.create_function_from_closure("toolPermissionsCommand", move |ctx| {
            let args: String = ctx.get(0)?;
            let command_context: Unknown = ctx.get(1)?;
            let callback = callback.borrow_back(ctx.env)?;
            callback.call(FnArgs::from((args, command_context)))
        })?;
        let mut command_options = Object::new(self.env)?;
        command_options.set_named_property("description", "Edit user or local tool permissions")?;
        command_options.set_named_property("handler", handler)?;
        let register_command: Function<FnArgs<(String, Object)>, ()> = self
            .pi
            .get_named_property("registerCommand")
            .map_err(|error| Error::from_reason(format!("pi.registerCommand is unavailable: {error}")))?;
        register_command.call(FnArgs::from(("permissions".to_owned(), command_options)))?;
        self.registrations.push("command:permissions".to_owned());
        Ok(())
    }

    pub fn register_entry_renderer(&mut self) -> Result<()> {
        let Some(renderer) = self.optional_renderer("renderPermissionPreview") else { return Ok(()); };
        let handler: NativeHandler = self.env.create_function_from_closure("toolPermissionsPreviewRenderer", move |ctx| {
            let entry: Unknown = ctx.get(0)?;
            let options: Unknown = ctx.get(1)?;
            let theme: Unknown = ctx.get(2)?;
            let renderer = renderer.borrow_back(ctx.env)?;
            renderer.call(FnArgs::from((entry, options, theme)))
        })?;
        let register_entry_renderer: Function<FnArgs<(String, NativeHandler)>, ()> = self
            .pi
            .get_named_property("registerEntryRenderer")
            .map_err(|error| Error::from_reason(format!("pi.registerEntryRenderer is unavailable: {error}")))?;
        register_entry_renderer.call(FnArgs::from(("permission-preview".to_owned(), handler)))?;
        self.registrations.push("entry_renderer:permission-preview".to_owned());
        Ok(())
    }

    fn pi_on<Return>(&self) -> Result<Function<'env, FnArgs<(String, Function<'env, (), Return>)>, ()>>
    where Return: napi::bindgen_prelude::FromNapiValue {
        self.pi.get_named_property("on").map_err(|error| Error::from_reason(format!("pi.on is unavailable: {error}")))
    }

    fn required_callback(&self, name: &str, label: &str) -> Result<NativeCallback> {
        self.bridge
            .ok_or_else(|| Error::from_reason(format!("{label} bridge is unavailable")))?
            .get_named_property::<Function<FnArgs<(Unknown<'static>, Unknown<'static>)>, Unknown<'static>>>(name)
            .map_err(|error| Error::from_reason(format!("{label} bridge is unavailable: {error}")))?
            .create_ref()
    }

    fn optional_callback(&self, name: &str) -> Option<NativeCallback> {
        self.bridge.and_then(|bridge| bridge.get_named_property::<Function<FnArgs<(Unknown<'static>, Unknown<'static>)>, Unknown<'static>>>(name).and_then(|function| function.create_ref()).ok())
    }

    fn optional_command(&self, name: &str) -> Option<NativeCommand> {
        self.bridge.and_then(|bridge| bridge.get_named_property::<Function<FnArgs<(String, Unknown<'static>)>, Unknown<'static>>>(name).and_then(|function| function.create_ref()).ok())
    }

    fn optional_renderer(&self, name: &str) -> Option<NativeRenderer> {
        self.bridge.and_then(|bridge| bridge.get_named_property::<Function<FnArgs<(Unknown<'static>, Unknown<'static>, Unknown<'static>)>, Unknown<'static>>>(name).and_then(|function| function.create_ref()).ok())
    }
}

fn notify_session_start(session_context: &Object) -> Result<()> {
    if !session_context.get_named_property::<bool>("hasUI").unwrap_or(false) { return Ok(()); }
    let ui: Object = match session_context.get_named_property("ui") { Ok(value) => value, Err(_) => return Ok(()) };
    let notify: Function<FnArgs<(String, String)>, ()> = match ui.get_named_property("notify") { Ok(value) => value, Err(_) => return Ok(()) };
    notify.call(FnArgs::from(("Rust native registration active.".to_owned(), "info".to_owned())))?;
    Ok(())
}

fn forwarding_handler<'env>(env: &'env Env, name: &str, callback: NativeCallback) -> Result<NativeHandler<'env>> {
    env.create_function_from_closure(name, move |ctx| {
        let event: Unknown = ctx.get(0)?;
        let extension_context: Unknown = ctx.get(1)?;
        let callback = callback.borrow_back(ctx.env)?;
        callback.call(FnArgs::from((event, extension_context)))
    })
}

pub fn register_callbacks(env: &Env, request: NativeRegistrationRequest, pi: Object, bridge: Option<Object>) -> Result<NativeRegistrationResponse> {
    if request.version != CONTRACT_VERSION || request.operation != "register_callbacks" {
        return Err(Error::from_reason("incompatible registration request"));
    }
    validate_nonce(&request.nonce)?;

    let mut bridge = RegistrationBridge::new(env, pi, bridge);
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
