use std::io::{Read, Write};
use std::net::TcpListener;

const PAGE: &str = r#"<!doctype html>
<meta charset="utf-8">
<title>Jet Browser Ready</title>
<label>Message <input id="message"></label>
<output id="result"></output>
<script>
message.addEventListener('input', () => result.value = message.value);
</script>"#;

fn main() -> std::io::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:8080")?;
    for connection in listener.incoming() {
        let mut stream = connection?;
        let mut request = [0_u8; 4096];
        let _ = stream.read(&mut request);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            PAGE.len(),
            PAGE
        );
        stream.write_all(response.as_bytes())?;
    }
    Ok(())
}
