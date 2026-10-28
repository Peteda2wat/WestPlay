//! Remote screen: the cab's screen on another device (Truck Remote's iPad page, through Truck Remote.exe), and
//! its taps back into the page as if made in the cab, so the game's screen and the iPad show the same thing.
//!
//! A small HTTP server on 127.0.0.1:[`PORT`] (this PC only: Truck Remote.exe, with its connect code, is what
//! the iPad talks to):
//! - `GET /screen`: the frames as an MJPEG stream (`multipart/x-mixed-replace`, an `<img>` shows it).
//! - `GET /info`: the page's size (JSON), to show the frame in the page's shape (the frame is 1280 x 720, the
//!   page laid out taller on some screens and squeezed into it: `westplay_shared::page_height`) and to know
//!   where taps land.
//! - `POST /touch`: lines `down x y`, `move x y`, `up x y`, `wheel x y delta`, x and y from 0 to 1 across the
//!   page.
//! - `POST /page`: `aspect 1.378`, the shape (width / height) the viewer shows the screen in: while it watches, the
//!   page is laid out in it (no black bars), whatever the game's screen wants.
//!
//! - `POST /voice`: the iPad's Nav Voice key, the spoken directions off or back on (`/info`'s `voiceMuted`).
//!
//! Posts need the header `X-WestPlay-Remote` (a web page can't send it to another site without asking
//!   first, which this server never answers), and any request a `Host` of this PC's own.
//!
//! Costs: each published frame is copied on the GPU into a texture of the newest ([`Readback::keep`]), so a
//! viewer joining sees the screen as it is now, not as it was; it's read back to memory (at most [`MAX_FPS`]
//! a second) and JPEG-encoded off the host's thread only while someone watches.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{SyncSender, sync_channel};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_MOUSE_EVENT_KIND, COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE, COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN,
    COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP, COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE,
    COREWEBVIEW2_MOUSE_EVENT_KIND_WHEEL, COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS,
    COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON, COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE,
};
use windows::Win32::Foundation::POINT;
use windows::Win32::Graphics::Direct3D11::{
    D3D11_BOX, D3D11_CPU_ACCESS_READ, D3D11_MAP_FLAG_DO_NOT_WAIT, D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, D3D11_USAGE_STAGING, ID3D11DeviceContext, ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::DXGI_ERROR_WAS_STILL_DRAWING;

use crate::gpu::Gpu;

pub const PORT: u16 = 8766;
/// Frames per second read back for viewers: half the game's, plenty for a touchscreen over Wi-Fi.
const MAX_FPS: u32 = 30;
const READ_INTERVAL: Duration = Duration::from_micros(1_000_000 / MAX_FPS as u64);
const JPEG_QUALITY: u8 = 70;
/// How long a stream waits for a new frame before sending the last again: a viewer gone is found out by the
/// write failing, so the readback stops when no one watches.
const KEEPALIVE: Duration = Duration::from_secs(2);
/// Largest request head and body read: anything bigger isn't from Truck Remote.
const MAX_HEAD: usize = 8 * 1024;
const MAX_BODY: usize = 16 * 1024;

/// The server's state, shared by the host's thread, the encoder and the connections.
pub struct Remote {
    /// The newest JPEG and its number (0: none yet).
    frame: Mutex<(u64, Option<Arc<Vec<u8>>>)>,
    new_frame: Condvar,
    viewers: AtomicUsize,
    touches: Mutex<Vec<Touch>>,
    /// The page's size, width in the high half.
    page: AtomicU64,
    /// The shape (width / height, `f32` bits; 0: none) the viewer shows the screen in (`POST /page`).
    aspect: AtomicU32,
    /// Presses of the iPad's Nav Voice key not yet taken (`POST /voice`), and whether the spoken directions are
    /// off now (the host says), for `/info`: the key's lamp.
    voice_toggles: AtomicU32,
    voice_muted: AtomicBool,
    encoder: SyncSender<Pixels>,
}

/// The server, started once per process: the host may run again after its browser went (`lib::run`), and
/// the port can only be had once.
pub fn start() -> Option<&'static Remote> {
    static REMOTE: OnceLock<Option<Remote>> = OnceLock::new();
    let mut started = None;
    let remote = REMOTE
        .get_or_init(|| {
            let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
                Ok(listener) => listener,
                Err(e) => {
                    log!("remote screen: port {PORT} unavailable ({e}); the iPad can't show the cab's screen");
                    return None;
                }
            };
            // One frame waiting at most: while the encoder is busy, newer frames are skipped.
            let (encoder, pixels) = sync_channel::<Pixels>(1);
            started = Some((listener, pixels));
            Some(Remote {
                frame: Mutex::new((0, None)),
                new_frame: Condvar::new(),
                viewers: AtomicUsize::new(0),
                touches: Mutex::new(Vec::new()),
                page: AtomicU64::new(pack(westplay_shared::SCREEN_WIDTH, westplay_shared::SCREEN_HEIGHT)),
                aspect: AtomicU32::new(0),
                voice_toggles: AtomicU32::new(0),
                voice_muted: AtomicBool::new(false),
                encoder,
            })
        })
        .as_ref()?;
    // Just made: its threads, which need it to be 'static.
    if let Some((listener, pixels)) = started {
        let encoder = std::thread::Builder::new().name("remote-encoder".into()).spawn(move || {
            for frame in pixels {
                if let Some(jpeg) = encode(&frame) {
                    remote.publish(jpeg);
                }
            }
        });
        let server = std::thread::Builder::new().name("remote-server".into()).spawn(move || {
            for stream in listener.incoming().flatten() {
                let _ =
                    std::thread::Builder::new().name("remote-connection".into()).spawn(move || serve(stream, remote));
            }
        });
        match (encoder, server) {
            (Ok(_), Ok(_)) => log!("remote screen: listening on 127.0.0.1:{PORT}"),
            _ => log!("remote screen: its threads couldn't start"),
        }
    }
    Some(remote)
}

fn page_height_for(width: u32, aspect: f32) -> u32 {
    ((width as f32 / aspect).round() as u32).clamp(westplay_shared::SCREEN_HEIGHT, width)
}

/// The shape in a `/page` body (`aspect 1.378`: width / height), if it reads as one.
fn parse_aspect(body: &str) -> Option<f32> {
    let aspect = body.trim().strip_prefix("aspect")?.trim().parse::<f32>().ok()?;
    (aspect.is_finite() && aspect > 0.0).then_some(aspect)
}

fn pack(width: u32, height: u32) -> u64 {
    (u64::from(width) << 32) | u64::from(height)
}

impl Remote {
    /// Whether anyone watches the screen.
    pub fn watched(&self) -> bool {
        self.viewers.load(Ordering::Relaxed) > 0
    }

    /// The page's size as laid out now (`webview::Stage::page_size`), for `/info` and for taps.
    pub fn set_page(&self, (width, height): (u32, u32)) {
        self.page.store(pack(width, height), Ordering::Relaxed);
    }

    pub fn page(&self) -> (u32, u32) {
        let page = self.page.load(Ordering::Relaxed);
        ((page >> 32) as u32, page as u32)
    }

    /// The page's height for a page `width` wide in the viewer's shape, while someone watches and said it: from
    /// 16:9 (the frame's own) to square.
    pub fn wanted_height(&self, width: u32) -> Option<u32> {
        let aspect = f32::from_bits(self.aspect.load(Ordering::Relaxed));
        (self.watched() && aspect > 0.0).then(|| page_height_for(width, aspect))
    }

    /// Whether the Nav Voice key was pressed an odd number of times since the last call (each press switches).
    pub fn take_voice_toggle(&self) -> bool {
        self.voice_toggles.swap(0, Ordering::Relaxed) % 2 == 1
    }

    pub fn set_voice_muted(&self, muted: bool) {
        self.voice_muted.store(muted, Ordering::Relaxed);
    }

    /// The taps that came since the last call, in order.
    pub fn take_touches(&self) -> Vec<Touch> {
        std::mem::take(&mut *self.touches.lock().unwrap_or_else(|e| e.into_inner()))
    }

    fn publish(&self, jpeg: Vec<u8>) {
        let mut frame = self.frame.lock().unwrap_or_else(|e| e.into_inner());
        *frame = (frame.0 + 1, Some(Arc::new(jpeg)));
        self.new_frame.notify_all();
    }

    /// A frame newer than `seen`, or after [`KEEPALIVE`] the newest again (`None`: none yet).
    fn next_frame(&self, seen: u64) -> (u64, Option<Arc<Vec<u8>>>) {
        let frame = self.frame.lock().unwrap_or_else(|e| e.into_inner());
        let (frame, _) = self
            .new_frame
            .wait_timeout_while(frame, KEEPALIVE, |(number, _)| *number == seen)
            .unwrap_or_else(|e| e.into_inner());
        frame.clone()
    }
}

/// Counts a viewer while a stream is open.
struct Viewer(&'static Remote);

impl Viewer {
    fn join(remote: &'static Remote) -> Self {
        if remote.viewers.fetch_add(1, Ordering::Relaxed) == 0 {
            log!("remote screen: watched");
        }
        Self(remote)
    }
}

impl Drop for Viewer {
    fn drop(&mut self) {
        if self.0.viewers.fetch_sub(1, Ordering::Relaxed) == 1 {
            log!("remote screen: no longer watched");
        }
    }
}

/// A frame read back: BGRA rows `pitch` bytes apart.
struct Pixels {
    width: u32,
    height: u32,
    pitch: usize,
    bytes: Vec<u8>,
}

fn encode(frame: &Pixels) -> Option<Vec<u8>> {
    let (width, height) = (frame.width as usize, frame.height as usize);
    let mut rgb = Vec::with_capacity(width * height * 3);
    for row in frame.bytes.chunks(frame.pitch).take(height) {
        for bgra in row[..width * 4].chunks_exact(4) {
            rgb.extend_from_slice(&[bgra[2], bgra[1], bgra[0]]);
        }
    }
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY)
        .encode(&rgb, frame.width, frame.height, image::ExtendedColorType::Rgb8)
        .ok()?;
    Some(jpeg)
}

/// Reads frames back for viewers, on the capture pipeline's GPU (built and dropped with it). Runs on the
/// host's thread, the device context's only user there.
pub struct Readback {
    context: ID3D11DeviceContext,
    /// The newest frame published, kept on the GPU.
    newest: ID3D11Texture2D,
    staging: ID3D11Texture2D,
    width: u32,
    height: u32,
    /// Numbers of the newest frame kept and of the one last copied to `staging`.
    kept: u64,
    read: u64,
    /// A copy to `staging` waiting to be mapped.
    copying: bool,
    last_read: Option<Instant>,
}

impl Readback {
    pub fn new(gpu: &Gpu, width: u32, height: u32) -> windows::core::Result<Self> {
        let texture = |usage, cpu_access| {
            let desc = D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: usage,
                BindFlags: 0,
                CPUAccessFlags: cpu_access,
                MiscFlags: 0,
            };
            let mut texture = None;
            // SAFETY: the device is alive (`gpu`); the description and the texture out are locals.
            unsafe { gpu.device.CreateTexture2D(&desc, None, Some(&mut texture))? };
            texture.ok_or_else(windows::core::Error::empty)
        };
        Ok(Self {
            context: gpu.context.clone(),
            newest: texture(D3D11_USAGE_DEFAULT, 0)?,
            staging: texture(D3D11_USAGE_STAGING, D3D11_CPU_ACCESS_READ.0 as u32)?,
            width,
            height,
            kept: 0,
            read: 0,
            copying: false,
            last_read: None,
        })
    }

    /// Keeps a frame just published (`Capture::flush`): a GPU copy, no waiting.
    pub fn keep(&mut self, frame: &ID3D11Texture2D) {
        // SAFETY: the frame and `newest` are alive textures of this device; the region fits both.
        unsafe {
            let mut desc = Default::default();
            frame.GetDesc(&mut desc);
            let region = D3D11_BOX {
                left: 0,
                top: 0,
                front: 0,
                right: desc.Width.min(self.width),
                bottom: desc.Height.min(self.height),
                back: 1,
            };
            self.context.CopySubresourceRegion(&self.newest, 0, 0, 0, 0, frame, 0, Some(&region));
        }
        self.kept += 1;
    }

    /// Every turn of the host's loop: while someone watches, reads the newest frame back (never waiting on
    /// the GPU: a copy not done yet is looked at again next turn) and hands it to the encoder.
    pub fn poll(&mut self, remote: &Remote) {
        if self.copying {
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            // SAFETY: `staging` is a CPU-readable texture of this context's device, mapped and unmapped here only.
            let map = unsafe {
                self.context.Map(
                    &self.staging,
                    0,
                    D3D11_MAP_READ,
                    D3D11_MAP_FLAG_DO_NOT_WAIT.0 as u32,
                    Some(&mut mapped),
                )
            };
            match map {
                Err(e) if e.code() == DXGI_ERROR_WAS_STILL_DRAWING => return,
                Err(_) => self.copying = false,
                Ok(()) => {
                    let pitch = mapped.RowPitch as usize;
                    let length = pitch * (self.height as usize - 1) + self.width as usize * 4;
                    // SAFETY: mapped for reading, `RowPitch` apart for `height` rows of `width` BGRA pixels.
                    let bytes = unsafe { std::slice::from_raw_parts(mapped.pData as *const u8, length) }.to_vec();
                    // SAFETY: mapped above.
                    unsafe { self.context.Unmap(&self.staging, 0) };
                    self.copying = false;
                    // The encoder busy: skipped, a newer frame follows soon enough.
                    let _ = remote.encoder.try_send(Pixels { width: self.width, height: self.height, pitch, bytes });
                }
            }
            return;
        }
        if !remote.watched() {
            // Whoever watches next gets the newest frame, even if it's the one read last (its JPEG may be of
            // another run of the host).
            self.read = 0;
            return;
        }
        let due = self.last_read.is_none_or(|last| last.elapsed() >= READ_INTERVAL);
        if self.kept != self.read && due {
            // SAFETY: both textures are alive, of this device, the same size and format.
            unsafe { self.context.CopyResource(&self.staging, &self.newest) };
            self.read = self.kept;
            self.copying = true;
            self.last_read = Some(Instant::now());
        }
    }
}

/// A tap on the remote screen, x and y from 0 to 1 across the page.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Touch {
    Down { x: f32, y: f32 },
    Move { x: f32, y: f32 },
    Up { x: f32, y: f32 },
    Wheel { x: f32, y: f32, delta: i32 },
}

/// The taps in a `/touch` body; a line that doesn't read as one is skipped.
fn parse_touches(body: &str) -> Vec<Touch> {
    body.lines()
        .filter_map(|line| {
            let mut words = line.split_whitespace();
            let kind = words.next()?;
            let mut number = || words.next()?.parse::<f32>().ok().filter(|n| n.is_finite());
            let (x, y) = (number()?.clamp(0.0, 1.0), number()?.clamp(0.0, 1.0));
            Some(match kind {
                "down" => Touch::Down { x, y },
                "move" => Touch::Move { x, y },
                "up" => Touch::Up { x, y },
                // One notch is 120, as WebView2 counts it; more than a few at once is no wheel.
                "wheel" => Touch::Wheel { x, y, delta: (number()? as i32).clamp(-1200, 1200) },
                _ => return None,
            })
        })
        .collect()
}

/// The mouse input that makes a tap on a page of `page` size, as the in-game cursor's would (`pointer.rs`):
/// a finger is a cursor that's there only while it touches.
pub fn mouse_events(
    touch: Touch,
    (width, height): (u32, u32),
) -> Vec<(COREWEBVIEW2_MOUSE_EVENT_KIND, COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS, u32, POINT)> {
    let at = |x: f32, y: f32| POINT {
        x: ((x * width as f32) as i32).min(width as i32 - 1),
        y: ((y * height as f32) as i32).min(height as i32 - 1),
    };
    let (none, left) = (COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE, COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON);
    match touch {
        Touch::Down { x, y } => vec![
            (COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE, none, 0, at(x, y)),
            (COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN, left, 0, at(x, y)),
        ],
        Touch::Move { x, y } => vec![(COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE, left, 0, at(x, y))],
        Touch::Up { x, y } => vec![
            (COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP, none, 0, at(x, y)),
            (COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE, none, 0, at(x, y)),
        ],
        Touch::Wheel { x, y, delta } => vec![
            (COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE, none, 0, at(x, y)),
            (COREWEBVIEW2_MOUSE_EVENT_KIND_WHEEL, none, delta as u32, at(x, y)),
        ],
    }
}

#[derive(Debug, PartialEq)]
struct Request {
    method: String,
    path: String,
    length: usize,
    /// Whether it came with `X-WestPlay-Remote`.
    marked: bool,
    /// Whether its `Host` is this PC's own address (not a web page's name that leads here: DNS rebinding).
    local: bool,
}

fn parse_request(head: &str) -> Option<Request> {
    let mut lines = head.lines();
    let mut first = lines.next()?.split_whitespace();
    let (method, path) = (first.next()?.to_string(), first.next()?.to_string());
    let (mut length, mut marked, mut local) = (0, false, false);
    for line in lines {
        let Some((name, value)) = line.split_once(':') else { continue };
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => length = value.parse().ok()?,
            "x-westplay-remote" => marked = true,
            "host" => local = [format!("127.0.0.1:{PORT}"), format!("localhost:{PORT}")].iter().any(|h| h == value),
            _ => {}
        }
    }
    Some(Request { method, path, length, marked, local })
}

fn serve(stream: TcpStream, remote: &'static Remote) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_nodelay(true);
    let Ok(mut writer) = stream.try_clone() else { return };
    let mut reader = BufReader::new(stream);
    let mut head = String::new();
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        head.push_str(&line);
        if line == "\r\n" || line == "\n" {
            break;
        }
        if head.len() > MAX_HEAD {
            return;
        }
    }
    let Some(request) = parse_request(&head) else { return respond(&mut writer, "400 Bad Request", "", b"") };
    if !request.local {
        return respond(&mut writer, "403 Forbidden", "", b"");
    }
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/screen") => stream_screen(&mut writer, remote),
        ("GET", "/info") => {
            let (width, height) = remote.page();
            let info = serde_json::json!({
                "width": width,
                "height": height,
                "watching": remote.viewers.load(Ordering::Relaxed),
                "voiceMuted": remote.voice_muted.load(Ordering::Relaxed),
            });
            respond(&mut writer, "200 OK", "application/json", info.to_string().as_bytes());
        }
        ("POST", "/touch" | "/page" | "/voice") if !request.marked => respond(&mut writer, "403 Forbidden", "", b""),
        ("POST", "/touch" | "/page" | "/voice") if request.length > MAX_BODY => {
            respond(&mut writer, "413 Payload Too Large", "", b"")
        }
        ("POST", "/voice") => {
            remote.voice_toggles.fetch_add(1, Ordering::Relaxed);
            respond(&mut writer, "204 No Content", "", b"");
        }
        ("POST", path @ ("/touch" | "/page")) => {
            let mut body = vec![0; request.length];
            if reader.read_exact(&mut body).is_err() {
                return;
            }
            let body = String::from_utf8_lossy(&body);
            if path == "/touch" {
                remote.touches.lock().unwrap_or_else(|e| e.into_inner()).extend(parse_touches(&body));
            } else if let Some(aspect) = parse_aspect(&body) {
                remote.aspect.store(aspect.to_bits(), Ordering::Relaxed);
            } else {
                return respond(&mut writer, "400 Bad Request", "", b"");
            }
            respond(&mut writer, "204 No Content", "", b"");
        }
        _ => respond(&mut writer, "404 Not Found", "", b""),
    }
}

fn respond(writer: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    let mut head = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n", body.len());
    if !content_type.is_empty() {
        head.push_str(&format!("Content-Type: {content_type}\r\nCache-Control: no-store\r\n"));
    }
    head.push_str("\r\n");
    let _ = writer.write_all(head.as_bytes()).and_then(|()| writer.write_all(body));
}

fn stream_screen(writer: &mut TcpStream, remote: &'static Remote) {
    let _viewer = Viewer::join(remote);
    let head = "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\n\
                Cache-Control: no-store\r\nConnection: close\r\n\r\n";
    if writer.write_all(head.as_bytes()).is_err() {
        return;
    }
    let mut seen = 0;
    loop {
        let (number, jpeg) = remote.next_frame(seen);
        seen = number;
        let Some(jpeg) = jpeg else { continue };
        let part = format!("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n", jpeg.len());
        let sent = writer
            .write_all(part.as_bytes())
            .and_then(|()| writer.write_all(&jpeg))
            .and_then(|()| writer.write_all(b"\r\n"))
            .and_then(|()| writer.flush());
        if sent.is_err() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_taps_and_skips_what_isnt_one() {
        let touches = parse_touches(
            "down 0.5 0.25\nmove 1.5 -1\nup 0.5 0.3\nwheel 0.1 0.2 -120\njump 1 1\nmove x 1\nmove NaN 0\n",
        );
        assert_eq!(
            touches,
            vec![
                Touch::Down { x: 0.5, y: 0.25 },
                Touch::Move { x: 1.0, y: 0.0 },
                Touch::Up { x: 0.5, y: 0.3 },
                Touch::Wheel { x: 0.1, y: 0.2, delta: -120 },
            ]
        );
    }

    #[test]
    fn a_tap_lands_on_the_page_where_it_was_on_the_ipad() {
        // The tablet's page, 1280 x 879: the frame's 720 rows stretched back.
        let page = (1280, 879);
        let events = mouse_events(Touch::Down { x: 0.5, y: 1.0 }, page);
        assert_eq!(events.len(), 2);
        assert_eq!(events[1].0, COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN);
        assert_eq!((events[1].3.x, events[1].3.y), (640, 878));
        // A drag holds the button; letting go leaves, as a finger has no hover.
        assert_eq!(
            mouse_events(Touch::Move { x: 0.0, y: 0.0 }, page)[0].1,
            COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON
        );
        let up = mouse_events(Touch::Up { x: 0.0, y: 0.0 }, page);
        assert_eq!(up.last().map(|e| e.0), Some(COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE));
        let wheel = mouse_events(Touch::Wheel { x: 0.0, y: 0.0, delta: -120 }, page);
        assert_eq!(wheel[1].2 as i32, -120);
    }

    #[test]
    fn lays_the_page_out_in_the_viewers_shape_within_bounds() {
        assert_eq!(parse_aspect("aspect 1.378\n"), Some(1.378));
        assert_eq!(parse_aspect("aspect -2"), None);
        assert_eq!(parse_aspect("aspect NaN"), None);
        assert_eq!(parse_aspect("1.4"), None);
        // The iPad's panel (1160 x 842): no bars.
        assert_eq!(page_height_for(1280, 1160.0 / 842.0), 929);
        // Wider than the frame: the frame's own; taller than square: square.
        assert_eq!(page_height_for(1280, 3.0), 720);
        assert_eq!(page_height_for(1280, 0.5), 1280);
    }

    #[test]
    fn only_this_pcs_own_requests_may_tap() {
        let ok = parse_request(
            "POST /touch HTTP/1.1\r\nHost: 127.0.0.1:8766\r\nContent-Length: 14\r\nX-WestPlay-Remote: 1\r\n\r\n",
        );
        assert_eq!(
            ok,
            Some(Request { method: "POST".into(), path: "/touch".into(), length: 14, marked: true, local: true })
        );
        // A web page's name for this PC (DNS rebinding), or a page posting without the header.
        let rebound = parse_request("POST /touch HTTP/1.1\r\nHost: evil.example:8766\r\nX-WestPlay-Remote: 1\r\n\r\n");
        assert!(!rebound.unwrap().local);
        let unmarked = parse_request("POST /touch HTTP/1.1\r\nhost: localhost:8766\r\n\r\n").unwrap();
        assert!(unmarked.local && !unmarked.marked);
        assert_eq!(parse_request("POST /touch HTTP/1.1\r\nContent-Length: lots\r\n\r\n"), None);
    }

    /// The real server, over a socket: taps get through with the header, not without it, and a frame streams.
    #[test]
    fn serves_taps_info_and_frames_over_http() {
        let Some(remote) = start() else {
            eprintln!("skipped: port {PORT} is taken (WestPlay running)");
            return;
        };
        let ask = |request: &str| {
            let mut stream = TcpStream::connect(("127.0.0.1", PORT)).unwrap();
            stream.write_all(request.as_bytes()).unwrap();
            let mut answer = String::new();
            let _ = stream.read_to_string(&mut answer);
            answer
        };
        let body = "down 0.25 0.5\nup 0.25 0.5\n";
        let tap = |marked: &str| {
            ask(&format!(
                "POST /touch HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\n{marked}Content-Length: {}\r\n\r\n{body}",
                body.len()
            ))
        };
        assert!(tap("").starts_with("HTTP/1.1 403"));
        assert!(remote.take_touches().is_empty());
        assert!(tap("X-WestPlay-Remote: 1\r\n").starts_with("HTTP/1.1 204"));
        assert_eq!(remote.take_touches(), vec![Touch::Down { x: 0.25, y: 0.5 }, Touch::Up { x: 0.25, y: 0.5 }]);

        remote.set_page((1280, 879));
        assert!(ask(&format!("GET /info HTTP/1.1\r\nHost: localhost:{PORT}\r\n\r\n")).contains(r#""height":879"#));
        assert!(ask("GET /info HTTP/1.1\r\nHost: evil.example\r\n\r\n").starts_with("HTTP/1.1 403"));

        let mut stream = TcpStream::connect(("127.0.0.1", PORT)).unwrap();
        stream.write_all(format!("GET /screen HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\n\r\n").as_bytes()).unwrap();
        let started = Instant::now();
        while !remote.watched() {
            assert!(started.elapsed() < Duration::from_secs(5), "never watched");
            std::thread::sleep(Duration::from_millis(10));
        }
        // The viewer's shape counts while it watches.
        let page = |body: &str| {
            ask(&format!(
                "POST /page HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nX-WestPlay-Remote: 1\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            ))
        };
        assert!(page("aspect sideways").starts_with("HTTP/1.1 400"));
        assert!(page("aspect 1.5").starts_with("HTTP/1.1 204"));
        assert_eq!(remote.wanted_height(1280), Some(853));
        // The Nav Voice key: each press switches, two cancel out.
        let voice = || {
            ask(&format!(
                "POST /voice HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nX-WestPlay-Remote: 1\r\nContent-Length: 0\r\n\r\n"
            ))
        };
        assert!(voice().starts_with("HTTP/1.1 204"));
        assert!(remote.take_voice_toggle());
        voice();
        voice();
        assert!(!remote.take_voice_toggle());
        remote.publish(vec![0xff, 0xd8, 0xff, 0xd9]);
        let mut answer = vec![0; 512];
        let mut read = 0;
        while !String::from_utf8_lossy(&answer[..read]).contains("image/jpeg") {
            read += stream.read(&mut answer[read..]).unwrap();
        }
        drop(stream);
    }

    #[test]
    fn encodes_bgra_rows_with_padding() {
        // 2 x 2 pixels, rows 16 bytes apart (8 of padding), blue on the left, red on the right.
        let row = [255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 9, 9, 9, 9, 9];
        let frame = Pixels { width: 2, height: 2, pitch: 16, bytes: [row, row].concat() };
        let jpeg = encode(&frame).expect("encoded");
        let image = image::load_from_memory(&jpeg).unwrap().to_rgb8();
        assert_eq!(image.dimensions(), (2, 2));
        let (left, right) = (image.get_pixel(0, 0), image.get_pixel(1, 0));
        assert!(left[2] > 150 && left[0] < 100, "left {left:?}");
        assert!(right[0] > 150 && right[2] < 100, "right {right:?}");
    }
}
