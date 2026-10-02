//! WPE engine transport. Network isolation, tenant authorization and control leases
//! belong to the runtime/control-plane boundary, not arbitrary page JavaScript.
use reqwest::{blocking::Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Component, Path};
use std::time::Duration;

type Result<T> = std::result::Result<T, String>;
mod download_launch;

// WPE's element-send-keys path currently loses non-ASCII text and modifier case.
// Insert committed text at the active editing selection, matching an IME commit.
// Physical and shortcut keys continue through trusted W3C key actions.
const INSERT_TEXT_SCRIPT: &str = r#"
let target=document.activeElement,text=arguments[0];
while(target?.shadowRoot?.activeElement)target=target.shadowRoot.activeElement;
if(!target||target===document.body)throw new Error('No focused editable element');
const before=()=>target.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,composed:true,data:text,inputType:'insertText'}));
if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement){
 if(typeof target.selectionStart==='number'&&typeof target.selectionEnd==='number'){
  if(!before())return {inserted:false,cancelled:true};
  target.setRangeText(text,target.selectionStart,target.selectionEnd,'end');
 }
 // Email and number controls intentionally expose null selectionStart even
 // while the native editor has a selection. The editing command operates on
 // that native selection, so Control+A followed by text replaces the value.
 else if(typeof document.execCommand==='function'&&document.execCommand('insertText',false,text))return {inserted:true};
 else {
  if(!before())return {inserted:false,cancelled:true};
  const prototype=target instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  const setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;
  if(!setter)throw new Error('Editable value setter unavailable');
  setter.call(target,target.value+text);
 }
 target.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,data:text,inputType:'insertText'}));
 return {inserted:true};
}
if(target.isContentEditable){
 if(!before())return {inserted:false,cancelled:true};
 const selection=getSelection();
 if(!selection.rangeCount){const range=document.createRange();range.selectNodeContents(target);range.collapse(false);selection.addRange(range);}
 const range=selection.getRangeAt(0);range.deleteContents();const node=document.createTextNode(text);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);
 target.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,data:text,inputType:'insertText'}));
 return {inserted:true};
}
throw new Error('Focused element is not editable');
"#;
const FOCUSED_TARGET_SCRIPT: &str = r#"
let target=document.activeElement;
while(target?.shadowRoot?.activeElement)target=target.shadowRoot.activeElement;
if(!target||target===document.body)return {kind:'none'};
if(target instanceof HTMLIFrameElement||target instanceof HTMLFrameElement)return {kind:'frame',element:target};
return {kind:'element'};
"#;
const DOCUMENT_STATE_SCRIPT: &str = r#"
const links=[...document.querySelectorAll('link[rel~="stylesheet"]')];
return {
 url:location.href,
 timeOrigin:Number(performance.timeOrigin)||0,
 readyState:document.readyState,
 styleSheets:document.styleSheets.length,
 stylesheetLinks:links.length,
 pendingStyles:links.filter(link=>!link.sheet).length
};
"#;
const VISUAL_STATE_SCRIPT: &str = r#"
const key='__masakaVisualStateV1';
let state=window[key];
if(!state||state.version!==1){
 state={version:1,revision:1};
 const bump=()=>{state.revision=state.revision>=Number.MAX_SAFE_INTEGER?1:state.revision+1;};
 const observer=new MutationObserver(bump);
 observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
 addEventListener('scroll',bump,true);
 addEventListener('resize',bump,true);
 Object.defineProperty(window,key,{value:state,configurable:true});
}
return {url:location.href,title:document.title,timeOrigin:Number(performance.timeOrigin)||0,revision:Number(state.revision)||0};
"#;
const EVALUATE_SCRIPT: &str = include_str!("evaluate.js");
const SEMANTIC_DRAIN_SCRIPT: &str = include_str!("semantic-drain.js");
const SEMANTIC_CONTROL_SCRIPT: &str = include_str!("semantic-control.js");
const EXPORT_PROFILE_SCRIPT: &str = include_str!("profile-export.js");
const IMPORT_PROFILE_SCRIPT: &str = include_str!("profile-import.js");
const MAX_PROFILE_STATE_BYTES: usize = 40 * 1024 * 1024;
fn encode_path_segment(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn validate_window_handle(value: &str) -> Result<&str> {
    if value.is_empty()
        || value.len() > 256
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
    {
        return Err("Invalid browser tab handle".into());
    }
    Ok(value)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Input {
    Pointer {
        phase: Phase,
        x: u32,
        y: u32,
        button: u8,
    },
    Wheel {
        x: u32,
        y: u32,
        delta_x: i32,
        delta_y: i32,
    },
    Key {
        key: String,
        down: bool,
    },
    Text {
        text: String,
    },
    Release {},
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Move,
    Down,
    Up,
}

fn key_value(key: &str) -> Result<String> {
    let value = match key {
        "Backspace" => "\u{e003}",
        "Tab" => "\u{e004}",
        "Enter" => "\u{e007}",
        "Shift" => "\u{e008}",
        "Control" => "\u{e009}",
        "Alt" => "\u{e00a}",
        "Escape" => "\u{e00c}",
        "PageUp" => "\u{e00e}",
        "PageDown" => "\u{e00f}",
        "End" => "\u{e010}",
        "Home" => "\u{e011}",
        "ArrowLeft" => "\u{e012}",
        "ArrowUp" => "\u{e013}",
        "ArrowRight" => "\u{e014}",
        "ArrowDown" => "\u{e015}",
        "Delete" => "\u{e017}",
        "Meta" => "\u{e03d}",
        _ if key.chars().count() == 1 && !key.chars().any(char::is_control) => key,
        _ => return Err("Unsupported key".into()),
    };
    Ok(value.to_string())
}

impl Input {
    pub fn validate(&self, width: u32, height: u32) -> Result<()> {
        match self {
            Self::Pointer { x, y, button, .. } if *x >= width || *y >= height || *button > 2 => {
                Err("Invalid pointer".into())
            }
            Self::Wheel {
                x,
                y,
                delta_x,
                delta_y,
            } if *x >= width
                || *y >= height
                || delta_x.unsigned_abs() > 4000
                || delta_y.unsigned_abs() > 4000 =>
            {
                Err("Invalid wheel".into())
            }
            Self::Text { text } if text.len() > 16000 || text.contains('\0') => {
                Err("Invalid text".into())
            }
            Self::Key { key, .. } => key_value(key).map(|_| ()),
            _ => Ok(()),
        }
    }
    pub fn actions(&self) -> Result<Value> {
        match self {
            Self::Pointer {
                phase,
                x,
                y,
                button,
            } => {
                let mut actions = vec![
                    json!({"type":"pointerMove","origin":"viewport","x":x,"y":y,"duration":16}),
                ];
                match phase {
                    Phase::Down => actions.push(json!({"type":"pointerDown","button":button})),
                    Phase::Up => actions.push(json!({"type":"pointerUp","button":button})),
                    Phase::Move => (),
                }
                Ok(
                    json!({"actions":[{"type":"pointer","id":"masaka-pointer","parameters":{"pointerType":"mouse"},"actions":actions}]}),
                )
            }
            Self::Wheel {
                x,
                y,
                delta_x,
                delta_y,
            } => Ok(
                // WPE 2.54's platform wheel adapter applies the opposite polarity
                // from W3C/DOM WheelEvent. Keep the MASAKA protocol standard here.
                json!({"actions":[{"type":"wheel","id":"masaka-wheel","actions":[{"type":"scroll","origin":"viewport","x":x,"y":y,"deltaX":-delta_x,"deltaY":-delta_y,"duration":0}]}]}),
            ),
            Self::Key { key, down } => Ok(
                json!({"actions":[{"type":"key","id":"masaka-keyboard","actions":[{"type":if *down {"keyDown"}else{"keyUp"},"value":key_value(key)?}]}]}),
            ),
            _ => Err("Input uses a dedicated endpoint".into()),
        }
    }
}

pub struct Wpe {
    client: Client,
    base: String,
    session: Option<String>,
    width: u32,
    height: u32,
}
impl Wpe {
    pub fn new(base: &str) -> Result<Self> {
        let url = reqwest::Url::parse(base).map_err(|_| "Invalid driver URL")?;
        if url.scheme() != "http"
            || !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
        {
            return Err("Driver must be on a trusted loopback transport".into());
        }
        Ok(Self {
            client: Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(35))
                .build()
                .map_err(|_| "HTTP client initialization failed")?,
            base: base.trim_end_matches('/').into(),
            session: None,
            width: 1280,
            height: 800,
        })
    }
    fn request(&self, method: Method, path: &str, body: Option<Value>) -> Result<Value> {
        let mut req = self
            .client
            .request(method, format!("{}{}", self.base, path));
        if let Some(body) = body {
            req = req.json(&body)
        }
        let response = req.send().map_err(|_| "Driver transport failed")?;
        let status = response.status();
        let data: Value = response.json().map_err(|_| "Invalid driver response")?;
        let value = data.get("value").ok_or("Missing driver value")?;
        if !status.is_success() || value.get("error").is_some() {
            return Err(format!(
                "Driver error: {}",
                value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("HTTP failure")
            ));
        }
        Ok(value.clone())
    }
    fn path(&self, suffix: &str) -> Result<String> {
        Ok(format!(
            "/session/{}{}",
            self.session.as_ref().ok_or("No browser session")?,
            suffix
        ))
    }
    pub fn create(&mut self, proxy: Option<&str>, profile_dir: Option<&str>) -> Result<Value> {
        self.create_with_downloads(proxy, profile_dir, None, Some("eager"))
    }
    pub fn create_with_downloads(
        &mut self,
        proxy: Option<&str>,
        profile_dir: Option<&str>,
        download_token: Option<&str>,
        page_load_strategy: Option<&str>,
    ) -> Result<Value> {
        if self.session.is_some() {
            return Err("Session already exists".into());
        }
        let mut args = vec![
            "--automation".to_string(),
            "--fullscreen".into(),
            "--size=1280x800".into(),
        ];
        if let Some(proxy) = proxy {
            let url = reqwest::Url::parse(proxy).map_err(|_| "Invalid proxy URL")?;
            if url.scheme() != "http"
                || !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
                || url.port().is_none()
                || url.path() != "/"
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err("Proxy must be an authenticated runtime loopback".into());
            }
            args.push(format!("--proxy={proxy}"));
        }
        if let Some(profile_dir) = profile_dir {
            let path = Path::new(profile_dir);
            if !path.starts_with("/var/lib/masaka/profiles/")
                || path.components().any(|component| {
                    !matches!(component, Component::RootDir | Component::Normal(_))
                })
            {
                return Err("Invalid profile directory".into());
            }
            args.push(format!("--profile-dir={profile_dir}"));
        }
        if let Some(token) = download_token {
            download_launch::reserve(
                token,
                Path::new("/var/lib/masaka-downloads"),
                Path::new("/var/lib/masaka/download-launches"),
            )?;
            args.insert(0, format!("--masaka-download-token={token}"));
        }
        let page_load_strategy = page_load_strategy.unwrap_or("eager");
        if !matches!(page_load_strategy, "none" | "eager" | "normal") {
            return Err("Invalid page-load strategy".into());
        }
        let mut always_match = json!({"wpe:browserOptions":{"binary":"/usr/lib/x86_64-linux-gnu/wpe-webkit-2.0/MiniBrowser","args":args}});
        // WPE WebDriver 2.54 can stall URL inspection when `normal` is sent
        // explicitly. Omitting it preserves the protocol default used by the
        // proven Live DOM path; Visual still opts into `none`.
        if page_load_strategy != "normal" {
            always_match["pageLoadStrategy"] = json!(page_load_strategy);
        }
        let data = self
            .request(
                Method::POST,
                "/session",
                Some(json!({"capabilities":{"alwaysMatch":always_match}})),
            )
            .map_err(|error| {
                if matches!(
                    error.as_str(),
                    "Driver transport failed" | "Invalid driver response" | "Missing driver value"
                ) {
                    format!("Unsafe driver creation: {error}")
                } else {
                    error
                }
            })?;
        let id = data["sessionId"].as_str().ok_or("Missing session ID")?;
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err("Invalid session ID".into());
        }
        self.session = Some(id.into());
        if let Err(error) = self.request(
            Method::POST,
            &self.path("/timeouts")?,
            Some(json!({"pageLoad":15000,"script":10000,"implicit":0})),
        ) {
            let _ = self.close();
            return Err(error);
        }
        Ok(data)
    }
    pub fn navigate(&self, url: &str) -> Result<Value> {
        let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid navigation URL")?;
        if !matches!(parsed.scheme(), "http" | "https")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err("Invalid navigation scheme or credentials".into());
        }
        self.request(Method::POST, &self.path("/url")?, Some(json!({"url":url})))
    }
    pub fn begin_navigation(&self, url: &str) -> Result<Value> {
        let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid navigation URL")?;
        if !matches!(parsed.scheme(), "http" | "https")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err("Invalid navigation scheme or credentials".into());
        }
        self.request(
            Method::POST,
            &self.path("/execute/sync")?,
            Some(json!({
                "script":"const target=arguments[0];setTimeout(()=>location.assign(target),0);return {started:true};",
                "args":[url]
            })),
        )
    }
    pub fn input(&self, events: &[Input]) -> Result<Value> {
        if events.is_empty() || events.len() > 64 {
            return Err("Input batch must contain 1–64 events".into());
        }
        // Validate the whole batch before making any observable browser change.
        for e in events {
            e.validate(self.width, self.height)?;
        }
        for e in events {
            let result = match e {
                Input::Release {} => self.release(),
                Input::Text { text } => self.type_text(text),
                _ => self.request(Method::POST, &self.path("/actions")?, Some(e.actions()?)),
            };
            if let Err(error) = result {
                let _ = self.release();
                return Err(error);
            }
        }
        Ok(json!({"applied":events.len()}))
    }
    fn type_text(&self, text: &str) -> Result<Value> {
        let result = (|| {
            for _ in 0..8 {
                let focused = self.request(
                    Method::POST,
                    &self.path("/execute/sync")?,
                    Some(json!({"script":FOCUSED_TARGET_SCRIPT,"args":[]})),
                )?;
                if focused.get("kind").and_then(Value::as_str) != Some("frame") {
                    return self.request(
                        Method::POST,
                        &self.path("/execute/sync")?,
                        Some(json!({"script":INSERT_TEXT_SCRIPT,"args":[text]})),
                    );
                }
                let element = focused
                    .get("element")
                    .cloned()
                    .ok_or("Focused frame is missing its WebDriver element")?;
                self.request(
                    Method::POST,
                    &self.path("/frame")?,
                    Some(json!({"id":element})),
                )?;
            }
            Err("Focused frame nesting is too deep".into())
        })();
        let reset = self.request(
            Method::POST,
            &self.path("/frame")?,
            Some(json!({"id":null})),
        );
        match (result, reset) {
            (Ok(value), Ok(_)) => Ok(value),
            (Err(error), _) => Err(error),
            (_, Err(error)) => Err(error),
        }
    }
    pub fn release(&self) -> Result<Value> {
        self.request(Method::DELETE, &self.path("/actions")?, None)
    }
    pub fn screenshot(&self) -> Result<Value> {
        self.request(Method::GET, &self.path("/screenshot")?, None)
    }
    pub fn title(&self) -> Result<Value> {
        self.request(Method::GET, &self.path("/title")?, None)
    }
    pub fn url(&self) -> Result<Value> {
        self.request(Method::GET, &self.path("/url")?, None)
    }
    pub fn window_handles(&self) -> Result<Value> {
        self.request(Method::GET, &self.path("/window/handles")?, None)
    }
    pub fn current_window(&self) -> Result<Value> {
        self.request(Method::GET, &self.path("/window")?, None)
    }
    pub fn switch_window(&self, handle: &str) -> Result<Value> {
        self.request(
            Method::POST,
            &self.path("/window")?,
            Some(json!({"handle":validate_window_handle(handle)?})),
        )
    }
    pub fn new_window(&self, kind: &str) -> Result<Value> {
        if !matches!(kind, "tab" | "window") {
            return Err("Invalid browser tab type".into());
        }
        self.request(
            Method::POST,
            &self.path("/window/new")?,
            Some(json!({"type":kind})),
        )
    }
    pub fn close_window(&self) -> Result<Value> {
        self.request(Method::DELETE, &self.path("/window")?, None)
    }
    pub fn document_state(&self) -> Result<Value> {
        self.request(
            Method::POST,
            &self.path("/execute/sync")?,
            Some(json!({
                "script":DOCUMENT_STATE_SCRIPT,"args":[]
            })),
        )
    }
    pub fn visual_state(&self) -> Result<Value> {
        self.request(
            Method::POST,
            &self.path("/execute/sync")?,
            Some(json!({"script":VISUAL_STATE_SCRIPT,"args":[]})),
        )
    }
    pub fn snapshot(&self) -> Result<Value> {
        self.request(Method::POST, &self.path("/execute/sync")?, Some(json!({
            "script":"const root=document.body;return root?{title:document.title,url:location.href,text:(root.innerText||'').slice(0,20000)}:{title:document.title,url:location.href,text:''};",
            "args":[]
        })))
    }
    pub fn evaluate(&self, expression: &str) -> Result<Value> {
        if expression.is_empty() || expression.len() > 16000 || expression.contains('\0') {
            return Err("Invalid page expression".into());
        }
        self.request(
            Method::POST,
            &self.path("/execute/async")?,
            Some(json!({
                "script":EVALUATE_SCRIPT,"args":[expression]
            })),
        )
    }
    pub fn inject_semantic(&self, source: &str) -> Result<Value> {
        if source.is_empty() || source.len() > 512_000 || source.contains('\0') {
            return Err("Invalid semantic preview source".into());
        }
        self.request(
            Method::POST,
            &self.path("/execute/sync")?,
            Some(json!({"script":source,"args":[]})),
        )
    }
    pub fn drain_semantic(&self, max_bytes: u32, max_messages: u16) -> Result<Value> {
        if !(1..=2_100_000).contains(&max_bytes) || !(1..=128).contains(&max_messages) {
            return Err("Invalid semantic preview drain limit".into());
        }
        self.request(
            Method::POST,
            &self.path("/execute/sync")?,
            Some(json!({
                "script":SEMANTIC_DRAIN_SCRIPT,
                "args":[max_bytes,max_messages]
            })),
        )
    }
    pub fn semantic_control(&self, control_type: &str, payload: &Value) -> Result<Value> {
        if !matches!(
            control_type,
            "dash:dom-stream-start" | "dash:ps-subtree-request"
        ) || !payload.is_object()
            || serde_json::to_vec(payload)
                .map_err(|_| "Invalid semantic preview control")?
                .len()
                > 64_000
        {
            return Err("Invalid semantic preview control".into());
        }
        self.request(
            Method::POST,
            &self.path("/execute/sync")?,
            Some(json!({
                "script":SEMANTIC_CONTROL_SCRIPT,
                "args":[control_type,payload]
            })),
        )
    }
    pub fn export_state(&self) -> Result<Value> {
        let cookies = self.request(Method::GET, &self.path("/cookie")?, None)?;
        let mut state = self.request(
            Method::POST,
            &self.path("/execute/async")?,
            Some(json!({"script":EXPORT_PROFILE_SCRIPT,"args":[]})),
        )?;
        if let Some(error) = state.get("__masaka_error").and_then(Value::as_str) {
            return Err(format!("Profile export failed: {error}"));
        }
        let object = state.as_object_mut().ok_or("Invalid profile export")?;
        object.insert("cookies".into(), cookies);
        Ok(state)
    }
    pub fn import_state(&self, state: &Value) -> Result<Value> {
        if serde_json::to_vec(state)
            .map_err(|_| "Invalid profile state")?
            .len()
            > MAX_PROFILE_STATE_BYTES
        {
            return Err("Profile state is too large".into());
        }
        let cookies = state
            .get("cookies")
            .and_then(Value::as_array)
            .ok_or("Invalid profile cookies")?;
        if cookies.len() > 500 {
            return Err("Profile has too many cookies".into());
        }
        let deleted_cookies = state
            .get("deleted_cookies")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        if deleted_cookies.len() > 500 {
            return Err("Profile has too many deleted cookies".into());
        }
        if state
            .get("restore")
            .and_then(|value| value.get("cookies"))
            .and_then(Value::as_bool)
            == Some(true)
        {
            self.request(Method::DELETE, &self.path("/cookie")?, None)?;
        }
        for cookie in deleted_cookies {
            let name = cookie
                .get("name")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty() && value.len() <= 256)
                .ok_or("Invalid deleted cookie")?;
            self.request(
                Method::DELETE,
                &self.path(&format!("/cookie/{}", encode_path_segment(name)))?,
                None,
            )?;
        }
        for cookie in cookies {
            self.request(
                Method::POST,
                &self.path("/cookie")?,
                Some(json!({"cookie":cookie})),
            )?;
        }
        let result = self.request(
            Method::POST,
            &self.path("/execute/async")?,
            Some(json!({"script":IMPORT_PROFILE_SCRIPT,"args":[state]})),
        )?;
        if let Some(error) = result.get("__masaka_error").and_then(Value::as_str) {
            return Err(format!("Profile import failed: {error}"));
        }
        Ok(result)
    }
    pub fn close(&mut self) -> Result<Value> {
        if self.session.is_none() {
            return Ok(Value::Null);
        }
        let _ = self.release();
        let result = self.request(Method::DELETE, &self.path("")?, None);
        if result.is_ok() {
            self.session = None;
        }
        result
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NameValue {
    pub name: String,
    pub value: String,
}
impl Drop for Wpe {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_before_dispatch() {
        assert!(Input::Wheel {
            x: 0,
            y: 0,
            delta_x: i32::MIN,
            delta_y: 0
        }
        .validate(1280, 800)
        .is_err());
        assert!(Input::Pointer {
            phase: Phase::Down,
            x: 1280,
            y: 0,
            button: 0
        }
        .validate(1280, 800)
        .is_err());
        assert!(Input::Text {
            text: "你好 👋".into()
        }
        .validate(1280, 800)
        .is_ok());
    }
    #[test]
    fn key_mapping() {
        assert_eq!(key_value("ArrowLeft").unwrap(), "\u{e012}");
        assert!(key_value("Unknown").is_err());
        assert_eq!(key_value("a").unwrap(), "a");
    }
    #[test]
    fn text_input_descends_frames_and_open_shadow_roots() {
        assert!(FOCUSED_TARGET_SCRIPT.contains("HTMLIFrameElement"));
        assert!(FOCUSED_TARGET_SCRIPT.contains("shadowRoot?.activeElement"));
        assert!(INSERT_TEXT_SCRIPT.contains("shadowRoot?.activeElement"));
    }
    #[test]
    fn wheel_keeps_pointer_origin() {
        let value = Input::Wheel {
            x: 123,
            y: 456,
            delta_x: -12,
            delta_y: 30,
        }
        .actions()
        .unwrap();
        assert_eq!(value["actions"][0]["actions"][0]["x"], 123);
        assert_eq!(value["actions"][0]["actions"][0]["deltaX"], 12);
    }
    #[test]
    fn rejects_extra_fields() {
        assert!(serde_json::from_value::<Input>(json!({"type":"release","script":"bad"})).is_err());
    }
    #[test]
    fn rejects_remote_driver() {
        assert!(Wpe::new("http://example.com:9515").is_err());
        assert!(Wpe::new("http://127.0.0.1:9515").is_ok());
    }
    #[test]
    fn committed_text_script_uses_argument_not_interpolation() {
        assert!(INSERT_TEXT_SCRIPT.contains("arguments[0]"));
        assert!(INSERT_TEXT_SCRIPT.contains("execCommand('insertText'"));
        assert!(!INSERT_TEXT_SCRIPT.contains("innerHTML"));
    }
    #[test]
    fn validates_browser_tab_handles() {
        assert_eq!(validate_window_handle("page-ABC_123:4").unwrap(), "page-ABC_123:4");
        assert!(validate_window_handle("").is_err());
        assert!(validate_window_handle("page/escape").is_err());
    }
}
