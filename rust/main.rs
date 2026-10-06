use jet_browser::{Input, Wpe};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, BufRead, Read, Write};
const MAX_COMMAND_BYTES: u64 = 48 * 1024 * 1024;
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum Command {
    Create {
        proxy: Option<String>,
        profile_dir: Option<String>,
        download_token: Option<String>,
        page_load_strategy: Option<String>,
    },
    Navigate {
        url: String,
    },
    BeginNavigation {
        url: String,
    },
    Input {
        events: Vec<Input>,
    },
    Screenshot,
    Title,
    Url,
    WindowHandles,
    CurrentWindow,
    SwitchWindow {
        handle: String,
    },
    NewWindow {
        kind: String,
    },
    CloseWindow,
    DocumentState,
    VisualState,
    Snapshot,
    Evaluate {
        expression: String,
    },
    InjectSemantic {
        source: String,
    },
    DrainSemantic {
        max_bytes: u32,
        max_messages: u16,
    },
    SemanticControl {
        r#type: String,
        payload: Value,
    },
    ExportState,
    ImportState {
        state: Value,
        expected_origin: String,
    },
    Release,
    Close,
}
fn main() {
    let base =
        std::env::var("WPE_WEBDRIVER_URL").unwrap_or_else(|_| "http://127.0.0.1:9515".into());
    let mut engine = match Wpe::new(&base) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1)
        }
    };
    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();
    loop {
        let mut line = String::new();
        match (&mut stdin)
            .take(MAX_COMMAND_BYTES + 1)
            .read_line(&mut line)
        {
            Ok(0) | Err(_) => break,
            _ => (),
        }
        let result = if line.len() > MAX_COMMAND_BYTES as usize {
            Err("Command too large".to_string())
        } else {
            serde_json::from_str::<Command>(&line)
                .map_err(|_| "Invalid command".to_string())
                .and_then(|cmd| match cmd {
                    Command::Create {
                        proxy,
                        profile_dir,
                        download_token,
                        page_load_strategy,
                    } => engine.create_with_downloads(
                        proxy.as_deref(),
                        profile_dir.as_deref(),
                        download_token.as_deref(),
                        page_load_strategy.as_deref(),
                    ),
                    Command::Navigate { url } => engine.navigate(&url),
                    Command::BeginNavigation { url } => engine.begin_navigation(&url),
                    Command::Input { events } => engine.input(&events),
                    Command::Screenshot => engine.screenshot(),
                    Command::Title => engine.title(),
                    Command::Url => engine.url(),
                    Command::WindowHandles => engine.window_handles(),
                    Command::CurrentWindow => engine.current_window(),
                    Command::SwitchWindow { handle } => engine.switch_window(&handle),
                    Command::NewWindow { kind } => engine.new_window(&kind),
                    Command::CloseWindow => engine.close_window(),
                    Command::DocumentState => engine.document_state(),
                    Command::VisualState => engine.visual_state(),
                    Command::Snapshot => engine.snapshot(),
                    Command::Evaluate { expression } => engine.evaluate(&expression),
                    Command::InjectSemantic { source } => engine.inject_semantic(&source),
                    Command::DrainSemantic {
                        max_bytes,
                        max_messages,
                    } => engine.drain_semantic(max_bytes, max_messages),
                    Command::SemanticControl { r#type, payload } => {
                        engine.semantic_control(&r#type, &payload)
                    }
                    Command::ExportState => engine.export_state(),
                    Command::ImportState {
                        state,
                        expected_origin,
                    } => engine.import_state(&state, &expected_origin),
                    Command::Release => engine.release(),
                    Command::Close => engine.close(),
                })
        };
        let response: Value = match result {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(error) => json!({"ok":false,"error":error}),
        };
        if writeln!(stdout, "{response}")
            .and_then(|_| stdout.flush())
            .is_err()
        {
            break;
        }
        if line.len() > MAX_COMMAND_BYTES as usize {
            break;
        }
    }
    // EOF/disconnect closes the WPE session and releases held inputs through Drop.
}
