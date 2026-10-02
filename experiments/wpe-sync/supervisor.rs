// Isolated engine feasibility experiment. No production credentials or public port.
use std::{env, fs, os::unix::fs::PermissionsExt, process::{Child,Command,ExitStatus,Stdio}, thread, time::Duration};

fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn exit_code(status: ExitStatus) -> i32 {
    status.code().unwrap_or(1)
}

fn main() {
    let runtime=env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_|"/tmp/wpe-runtime-0".into());
    let socket=env::var("WAYLAND_DISPLAY").unwrap_or_else(|_|"wayland-0".into());
    let port=env::var("MASAKA_WPE_PORT").unwrap_or_else(|_|"9515".into());
    fs::create_dir_all(&runtime).unwrap();
    fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700)).unwrap();
    let socket_arg=format!("--socket={socket}");
    let mut display = Command::new("weston").args(["--backend=headless-backend.so", "--shell=kiosk", &socket_arg, "--idle-time=0", "--width=1280", "--height=800", "--renderer=pixman", "--debug"]).stdout(Stdio::null()).spawn().expect("Weston startup");
    let socket_path=format!("{runtime}/{socket}");
    let mut ready=false;
    for _ in 0..100 {
        if let Ok(Some(status))=display.try_wait(){
            eprintln!("Weston exited before readiness: {status}");
            std::process::exit(exit_code(status));
        }
        if fs::metadata(&socket_path).is_ok(){ready=true;break}
        thread::sleep(Duration::from_millis(50));
    }
    if !ready {
        eprintln!("Weston socket did not become ready: {socket_path}");
        stop(&mut display);
        std::process::exit(1);
    }
    let mut driver = Command::new("dbus-run-session").args(["--", "WPEWebDriver", "--host=127.0.0.1", &format!("--port={port}")]).spawn().expect("WPEWebDriver startup");
    loop {
        if let Ok(Some(status))=display.try_wait(){
            eprintln!("Weston exited while WebDriver was still running: {status}");
            stop(&mut driver);
            std::process::exit(exit_code(status));
        }
        if let Ok(Some(status))=driver.try_wait(){
            stop(&mut display);
            std::process::exit(exit_code(status));
        }
        thread::sleep(Duration::from_millis(100));
    }
}
