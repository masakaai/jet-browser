use jet_browser::{Input, Wpe};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, BufRead, Read, Write};
use std::thread;
use std::time::Duration;
const MAX_COMMAND_BYTES: u64 = 48 * 1024 * 1024;

fn read_command_line<R: BufRead>(reader: &mut R, line: &mut String) -> io::Result<usize> {
    loop {
        let remaining = (MAX_COMMAND_BYTES + 1).saturating_sub(line.len() as u64);
        if remaining == 0 {
            return Ok(line.len());
        }
        match reader.take(remaining).read_line(line) {
            Ok(_) => return Ok(line.len()),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::Interrupted | io::ErrorKind::WouldBlock
                ) =>
            {
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => return Err(error),
        }
    }
}
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
        match read_command_line(&mut stdin, &mut line) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufReader, Cursor};

    struct WouldBlockOnce {
        blocked: bool,
        input: Cursor<&'static [u8]>,
    }

    impl Read for WouldBlockOnce {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if !self.blocked {
                self.blocked = true;
                return Err(io::Error::from(io::ErrorKind::WouldBlock));
            }
            self.input.read(buffer)
        }
    }

    #[test]
    fn command_input_retries_a_temporarily_empty_nonblocking_stream() {
        let source = WouldBlockOnce {
            blocked: false,
            input: Cursor::new(b"{\"op\":\"close\"}\n"),
        };
        let mut reader = BufReader::new(source);
        let mut line = String::new();
        assert_eq!(
            read_command_line(&mut reader, &mut line).unwrap(),
            line.len()
        );
        assert_eq!(line, "{\"op\":\"close\"}\n");
    }

    #[test]
    fn command_input_still_reports_a_real_eof() {
        let mut reader = BufReader::new(Cursor::new(Vec::<u8>::new()));
        let mut line = String::new();
        assert_eq!(read_command_line(&mut reader, &mut line).unwrap(), 0);
    }
}
