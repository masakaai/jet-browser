// Isolated engine feasibility experiment. No production credentials or public port.
use std::{fs, os::unix::fs::PermissionsExt, process::{Command,Stdio}, thread, time::Duration};
fn main() {
    fs::create_dir_all("/tmp/wpe-runtime").unwrap();
    fs::set_permissions("/tmp/wpe-runtime", fs::Permissions::from_mode(0o700)).unwrap();
    let mut display = Command::new("weston").args(["--backend=headless-backend.so", "--socket=wayland-0", "--idle-time=0", "--width=1280", "--height=800", "--renderer=pixman"]).stdout(Stdio::null()).spawn().expect("Weston startup");
    for _ in 0..100 { if fs::metadata("/tmp/wpe-runtime/wayland-0").is_ok(){break} thread::sleep(Duration::from_millis(50)); }
    let status = Command::new("dbus-run-session").args(["--", "WPEWebDriver", "--host=127.0.0.1", "--port=9515"]).status().expect("WPEWebDriver startup");
    let _ = display.kill(); let _ = display.wait();
    std::process::exit(status.code().unwrap_or(1));
}
