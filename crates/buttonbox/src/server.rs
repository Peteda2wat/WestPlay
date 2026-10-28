//! The iPad's page and its API on the home network (Truck Remote's, unchanged, so the iPad app keeps working):
//! `/` the page, `/api/state` the lamps, `/api/action` a button, `/api/westplay/...` WestPlay's screen (passed
//! on to its server on this PC only, `westplay_host`'s remote.rs). `/api/` needs the connect code (`X-Token`,
//! or `?token=` for the screen's `<img>`). One connection carries many requests; it closes when the iPad says
//! so or after 15 s idle.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};

use crate::ButtonBox;

const PAGE: &[u8] = include_bytes!("../ipad/index.html");
const FONT: &[u8] = include_bytes!("../ipad/figtree.css");
/// WestPlay's screen server, on this PC only.
const WESTPLAY: (Ipv4Addr, u16) = (Ipv4Addr::LOCALHOST, 8766);
const MAX_BODY: usize = 64 * 1024;

pub fn start(port: u16, box_: Arc<ButtonBox>) -> std::io::Result<()> {
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)))?;
    std::thread::Builder::new().name("buttonbox-server".into()).spawn(move || {
        for stream in listener.incoming().flatten() {
            let box_ = box_.clone();
            let _ = std::thread::Builder::new().name("buttonbox-connection".into()).spawn(move || serve(stream, &box_));
        }
    })?;
    Ok(())
}

struct Request {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn serve(stream: TcpStream, box_: &ButtonBox) {
    // This PC's own requests (the window's copy of the page) aren't the iPad's.
    let from_ipad = stream.peer_addr().is_ok_and(|peer| !peer.ip().is_loopback());
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = stream.set_nodelay(true);
    let Ok(mut writer) = stream.try_clone() else { return };
    let mut reader = BufReader::new(stream);
    while let Some(request) = read_request(&mut reader) {
        let close = request.headers.get("connection").is_some_and(|c| c.eq_ignore_ascii_case("close"));
        if route(&request, &mut writer, box_, from_ipad).is_err() || close {
            return;
        }
    }
}

fn read_request(reader: &mut BufReader<TcpStream>) -> Option<Request> {
    let mut line = String::new();
    reader.read_line(&mut line).ok().filter(|n| *n > 0)?;
    let mut first = line.split_whitespace();
    let method = first.next()?.to_owned();
    let target = first.next()?.to_owned();
    let mut headers = HashMap::new();
    let mut size = line.len();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).ok().filter(|n| *n > 0)?;
        size += line.len();
        if line == "\r\n" || line == "\n" || size > 16 * 1024 {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
        }
    }
    let length: usize = headers.get("content-length").and_then(|l| l.parse().ok()).unwrap_or(0);
    if length > MAX_BODY {
        return None;
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).ok()?;
    let (path, query) = target.split_once('?').unwrap_or((&target, ""));
    let query = query
        .split('&')
        .filter_map(|pair| pair.split_once('=').or(Some((pair, ""))))
        .filter(|(name, _)| !name.is_empty())
        .map(|(name, value)| (unescape(name), unescape(value)))
        .collect();
    Some(Request { method, path: unescape(path), query, headers, body })
}

fn unescape(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let hex = bytes.get(at + 1..at + 3).and_then(|h| u8::from_str_radix(std::str::from_utf8(h).ok()?, 16).ok());
        match (bytes[at], hex) {
            (b'%', Some(byte)) => {
                out.push(byte);
                at += 3;
            }
            (b'+', _) => {
                out.push(b' ');
                at += 1;
            }
            (byte, _) => {
                out.push(byte);
                at += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn route(request: &Request, writer: &mut TcpStream, box_: &ButtonBox, from_ipad: bool) -> std::io::Result<()> {
    let get = request.method == "GET";
    match request.path.as_str() {
        "/" | "/index.html" if get => return respond(writer, 200, "text/html; charset=utf-8", PAGE, "no-store"),
        "/ipad/figtree.css" if get => return respond(writer, 200, "text/css", FONT, "max-age=86400"),
        path if !path.starts_with("/api/") => return json_reply(writer, 404, &json!({ "error": "Not found" })),
        _ => {}
    }
    let given = request.headers.get("x-token").or_else(|| request.query.get("token")).map_or("", |code| code.trim());
    // The window shows the code in capitals; it's taken however it's typed.
    if !same(&given.to_ascii_lowercase(), &box_.token.to_ascii_lowercase()) {
        return json_reply(writer, 401, &json!({ "error": "Wrong connect code" }));
    }
    if from_ipad {
        box_.ipad_seen();
    }
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/api/state") => json_reply(writer, 200, &json!({ "state": box_.controller.snapshot() })),
        ("POST", "/api/action") => {
            let asked: Value = serde_json::from_slice(&request.body).unwrap_or_default();
            let Some(action) = asked["action"].as_str() else {
                return json_reply(writer, 400, &json!({ "error": "Missing action" }));
            };
            let delta = asked["delta"].as_i64().unwrap_or(0) as i32;
            match box_.controller.handle(action, delta) {
                Ok(state) => json_reply(writer, 200, &json!({ "state": state })),
                Err(e) => json_reply(writer, 400, &json!({ "error": e })),
            }
        }
        (method, path) if path.starts_with("/api/westplay/") => {
            westplay(writer, method, &path["/api/westplay".len()..], &request.body)
        }
        _ => json_reply(writer, 404, &json!({ "error": "Not found" })),
    }
}

/// Passes a request on to WestPlay's screen server: the screen, a stream with no end, copied through until
/// either side goes, then this connection closed (the iPad's page reconnects); the rest answered on this one.
fn westplay(writer: &mut TcpStream, method: &str, path: &str, body: &[u8]) -> std::io::Result<()> {
    let allowed = matches!((method, path), ("GET", "/screen" | "/info") | ("POST", "/touch" | "/page" | "/voice"));
    if !allowed {
        return json_reply(writer, 404, &json!({ "error": "Not found" }));
    }
    let Ok(mut upstream) = TcpStream::connect_timeout(&SocketAddr::from(WESTPLAY), Duration::from_secs(2)) else {
        return json_reply(writer, 502, &json!({ "error": "ATS GPS isn't running" }));
    };
    let _ = upstream.set_read_timeout(Some(Duration::from_secs(10)));
    // WestPlay takes taps only with this header and its own address as Host (no web page can send either).
    let head = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nX-WestPlay-Remote: 1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        WESTPLAY.1,
        body.len()
    );
    upstream.write_all(head.as_bytes())?;
    upstream.write_all(body)?;
    if path == "/screen" {
        // An iPad gone quiet mustn't keep WestPlay encoding for no one.
        let _ = writer.set_write_timeout(Some(Duration::from_secs(10)));
        let _ = std::io::copy(&mut upstream, writer);
        // Closing is the only way the iPad learns the stream stopped.
        return Err(std::io::ErrorKind::ConnectionAborted.into());
    }
    let mut answer = Vec::new();
    upstream.read_to_end(&mut answer)?;
    let split = answer.windows(4).position(|w| w == b"\r\n\r\n");
    let code = std::str::from_utf8(&answer).ok().and_then(|text| text.split(' ').nth(1)?.parse::<u16>().ok());
    match (split, code) {
        (Some(split), Some(code)) => respond(writer, code, "application/json", &answer[split + 4..], "no-store"),
        _ => json_reply(writer, 502, &json!({ "error": "ATS GPS answered oddly" })),
    }
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0, |diff, (x, y)| diff | (x ^ y)) == 0
}

fn json_reply(writer: &mut TcpStream, code: u16, value: &Value) -> std::io::Result<()> {
    respond(writer, code, "application/json", value.to_string().as_bytes(), "no-store")
}

fn respond(writer: &mut TcpStream, code: u16, content_type: &str, body: &[u8], cache: &str) -> std::io::Result<()> {
    let reason = match code {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        502 => "Bad Gateway",
        _ => "Not Found",
    };
    let head = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: {cache}\r\nConnection: keep-alive\r\n\r\n",
        body.len()
    );
    writer.write_all(head.as_bytes())?;
    writer.write_all(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_addresses_as_browsers_write_them() {
        assert_eq!(unescape("a%20b+c%2Fd"), "a b c/d");
        assert_eq!(unescape("100%"), "100%");
        assert!(same("abc", "abc") && !same("abc", "abd") && !same("abc", "ab"));
    }
}
