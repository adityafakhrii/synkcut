use crate::{AudioMixPlan, ExportProgressEvent, ExportResult};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::process::Command;
use tokio_tungstenite::{connect_async, tungstenite::Message};

static CDP_SEQ: AtomicU64 = AtomicU64::new(1);
static PREVIEW_SEQ: AtomicU64 = AtomicU64::new(1);

struct PreviewServerState {
    port: u16,
    pages: Arc<RwLock<HashMap<String, Vec<u8>>>>,
}

static PREVIEW_SERVER: OnceLock<PreviewServerState> = OnceLock::new();

async fn ensure_preview_server() -> Result<&'static PreviewServerState, String> {
    if let Some(state) = PREVIEW_SERVER.get() {
        return Ok(state);
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Gagal memulai HyperFrames preview server: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Gagal membaca port preview server: {e}"))?
        .port();
    let pages: Arc<RwLock<HashMap<String, Vec<u8>>>> = Arc::new(RwLock::new(HashMap::new()));
    let pages_for_task = Arc::clone(&pages);

    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let pages_ref = Arc::clone(&pages_for_task);
            tokio::spawn(async move {
                let mut buf = [0u8; 2048];
                let Ok(n) = stream.read(&mut buf).await else {
                    return;
                };
                if n == 0 {
                    return;
                }
                let req_str = String::from_utf8_lossy(&buf[..n]);
                let path = req_str
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("/")
                    .split('?')
                    .next()
                    .unwrap_or("/");

                let (status, mime, owned_body): (&str, &str, Vec<u8>) = match path {
                    "/vendor/gsap.min.js" | "/preview/vendor/gsap.min.js" => (
                        "200 OK",
                        "application/javascript; charset=utf-8",
                        VENDOR_GSAP_JS.to_vec(),
                    ),
                    "/vendor/three.module.js" | "/preview/vendor/three.module.js" => (
                        "200 OK",
                        "application/javascript; charset=utf-8",
                        VENDOR_THREE_MODULE_JS.to_vec(),
                    ),
                    "/vendor/three.core.js" | "/preview/vendor/three.core.js" => (
                        "200 OK",
                        "application/javascript; charset=utf-8",
                        VENDOR_THREE_CORE_JS.to_vec(),
                    ),
                    "/vendor/s3-kit.js" | "/preview/vendor/s3-kit.js" => (
                        "200 OK",
                        "application/javascript; charset=utf-8",
                        VENDOR_S3_KIT_JS.to_vec(),
                    ),
                    p if p.starts_with("/preview/") && p.ends_with(".html") => {
                        let id = p.trim_start_matches("/preview/").trim_end_matches(".html");
                        let found = pages_ref
                            .read()
                            .ok()
                            .and_then(|m| m.get(id).cloned());
                        match found {
                            Some(bytes) => ("200 OK", "text/html; charset=utf-8", bytes),
                            None => ("404 Not Found", "text/plain", b"Preview expired".to_vec()),
                        }
                    }
                    _ => ("404 Not Found", "text/plain", b"Not Found".to_vec()),
                };

                let header = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                    owned_body.len()
                );
                let _ = stream.write_all(header.as_bytes()).await;
                let _ = stream.write_all(&owned_body).await;
                let _ = stream.shutdown().await;
            });
        }
    });

    let _ = PREVIEW_SERVER.set(PreviewServerState { port, pages });
    PREVIEW_SERVER
        .get()
        .ok_or_else(|| "Gagal menginisialisasi preview server HyperFrames.".to_string())
}

#[tauri::command]
pub async fn register_hyperframe_preview(html: String) -> Result<String, String> {
    if html.trim().len() < 40 {
        return Err("HTML HyperFrames kosong.".to_string());
    }
    let state = ensure_preview_server().await?;
    let id = format!("hf_{}", PREVIEW_SEQ.fetch_add(1, Ordering::Relaxed));
    if let Ok(mut guard) = state.pages.write() {
        if guard.len() >= 24 {
            let mut keys: Vec<String> = guard.keys().cloned().collect();
            keys.sort();
            for old_key in keys.into_iter().take(12) {
                guard.remove(&old_key);
            }
        }
        guard.insert(id.clone(), html.into_bytes());
    }
    Ok(format!("http://127.0.0.1:{}/preview/{id}.html", state.port))
}

// Embed local vendored HyperFrames runtimes directly in the desktop binary (100% offline-proof!)
const VENDOR_GSAP_JS: &[u8] = include_bytes!("../../public/vendor/gsap.min.js");
const VENDOR_THREE_MODULE_JS: &[u8] = include_bytes!("../../public/vendor/three.module.js");
const VENDOR_THREE_CORE_JS: &[u8] = include_bytes!("../../public/vendor/three.core.js");
const VENDOR_S3_KIT_JS: &[u8] = include_bytes!("../../public/vendor/s3-kit.js");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportHyperframeMp4Request {
    pub html: String,
    pub duration_sec: f64,
    pub fps: u32,
    pub width: u32,
    pub height: u32,
    pub output_path: String,
    pub audio_path: Option<String>,
    pub generate_demo_audio: bool,
    pub mix_plan: Option<AudioMixPlan>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureHyperframePosterRequest {
    pub html: String,
    pub time_sec: f64,
}

fn find_chromium_browser() -> Option<PathBuf> {
    let local_app = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let candidates = [
        PathBuf::from(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
        PathBuf::from(&local_app).join(r"Google\Chrome\Application\chrome.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        PathBuf::from(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
        PathBuf::from(&local_app).join(r"Microsoft\Edge\Application\msedge.exe"),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

fn resolve_ffmpeg_binary() -> Result<PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in [
                "ffmpeg.exe",
                "ffmpeg-x86_64-pc-windows-msvc.exe",
                "ffmpeg",
            ] {
                let p = dir.join(name);
                if p.is_file() {
                    return Ok(p);
                }
            }
            // Dev mode fallback: target/release -> src-tauri/binaries/
            if let Some(parent2) = dir.parent().and_then(Path::parent) {
                let dev_bin = parent2
                    .join("binaries")
                    .join("ffmpeg-x86_64-pc-windows-msvc.exe");
                if dev_bin.is_file() {
                    return Ok(dev_bin);
                }
            }
        }
    }
    Err("Sidecar FFmpeg tidak ditemukan di folder aplikasi Synkcut.".to_string())
}

async fn pick_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Gagal membuka port lokal: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Gagal membaca port lokal: {e}"))?
        .port();
    drop(listener);
    Ok(port)
}

async fn start_memory_http_server(html: String) -> Result<(u16, tokio::task::JoinHandle<()>), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Gagal memulai local asset server HyperFrames: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Gagal membaca port asset server: {e}"))?
        .port();
    let html_bytes = Arc::new(html.into_bytes());

    let handle = tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let html_ref = Arc::clone(&html_bytes);
            tokio::spawn(async move {
                let mut buf = [0u8; 2048];
                let Ok(n) = stream.read(&mut buf).await else {
                    return;
                };
                if n == 0 {
                    return;
                }
                let req_str = String::from_utf8_lossy(&buf[..n]);
                let path = req_str
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("/")
                    .split('?')
                    .next()
                    .unwrap_or("/");

                let (status, mime, body): (&str, &str, &[u8]) = match path {
                    "/" | "/index.html" => ("200 OK", "text/html; charset=utf-8", html_ref.as_slice()),
                    "/vendor/gsap.min.js" => ("200 OK", "application/javascript; charset=utf-8", VENDOR_GSAP_JS),
                    "/vendor/three.module.js" => ("200 OK", "application/javascript; charset=utf-8", VENDOR_THREE_MODULE_JS),
                    "/vendor/three.core.js" => ("200 OK", "application/javascript; charset=utf-8", VENDOR_THREE_CORE_JS),
                    "/vendor/s3-kit.js" => ("200 OK", "application/javascript; charset=utf-8", VENDOR_S3_KIT_JS),
                    _ => ("404 Not Found", "text/plain", b"Not Found"),
                };

                let header = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes()).await;
                let _ = stream.write_all(body).await;
                let _ = stream.shutdown().await;
            });
        }
    });

    Ok((port, handle))
}

struct CdpSession {
    ws: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    next_id: u64,
    browser_child: tokio::process::Child,
    profile_dir: PathBuf,
    http_handle: tokio::task::JoinHandle<()>,
}

impl CdpSession {
    async fn launch(html: String, width: u32, height: u32, scale: f64) -> Result<Self, String> {
        let browser_exe = find_chromium_browser().ok_or_else(|| {
            "Google Chrome atau Microsoft Edge tidak ditemukan di sistem Windows ini.".to_string()
        })?;
        let (http_port, http_handle) = start_memory_http_server(html).await?;
        let cdp_port = pick_free_port().await?;

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let seq = CDP_SEQ.fetch_add(1, Ordering::Relaxed);
        let profile_dir = std::env::temp_dir().join(format!("synkcut_cdp_{stamp}_{seq}"));
        let _ = std::fs::create_dir_all(&profile_dir);

        let mut cmd = Command::new(&browser_exe);
        cmd.args([
            "--headless=new",
            "--disable-gpu-sandbox",
            "--enable-webgl",
            "--ignore-gpu-blocklist",
            "--use-gl=angle",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "--disable-extensions",
            "--mute-audio",
            &format!("--remote-debugging-port={cdp_port}"),
            &format!("--window-size={width},{height}"),
            &format!("--user-data-dir={}", profile_dir.to_string_lossy()),
            "about:blank",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

        let mut browser_child = cmd
            .spawn()
            .map_err(|e| format!("Gagal menjalankan Headless Browser CDP: {e}"))?;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .map_err(|e| format!("Gagal inisialisasi HTTP client CDP: {e}"))?;

        let list_url = format!("http://127.0.0.1:{cdp_port}/json/list");
        let mut ws_url: Option<String> = None;
        for _ in 0..40 {
            if let Ok(resp) = client.get(&list_url).send().await {
                if let Ok(arr) = resp.json::<Vec<Value>>().await {
                    if let Some(found) = arr.iter().find_map(|item| {
                        if item["type"].as_str() == Some("page") {
                            item["webSocketDebuggerUrl"].as_str().map(ToString::to_string)
                        } else {
                            None
                        }
                    }) {
                        ws_url = Some(found);
                        break;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(120)).await;
        }

        let ws_url = match ws_url {
            Some(u) => u,
            None => {
                let _ = browser_child.kill().await;
                http_handle.abort();
                let _ = std::fs::remove_dir_all(&profile_dir);
                return Err("Headless Chrome/Edge tidak merespons CDP WebSocket dalam 5 detik.".to_string());
            }
        };

        let (ws, _) = connect_async(&ws_url).await.map_err(|e| {
            http_handle.abort();
            format!("Gagal konek ke WebSocket CDP: {e}")
        })?;

        let mut sess = Self {
            ws,
            next_id: 1,
            browser_child,
            profile_dir,
            http_handle,
        };

        sess.send_cmd("Page.enable", json!({})).await?;
        sess.send_cmd("Runtime.enable", json!({})).await?;
        sess.send_cmd(
            "Emulation.setDeviceMetricsOverride",
            json!({
                "width": width,
                "height": height,
                "deviceScaleFactor": scale,
                "mobile": false
            }),
        )
        .await?;

        let target_url = format!("http://127.0.0.1:{http_port}/index.html");
        sess.send_cmd("Page.navigate", json!({ "url": target_url }))
            .await?;

        // Wait until `window.render` is defined AND fonts have settled (up to 8s)
        let mut render_ready = false;
        for step in 0..65 {
            let check = sess
                .send_cmd(
                    "Runtime.evaluate",
                    json!({
                        "expression": "typeof window.render === 'function' ? (document.fonts && document.fonts.status === 'loaded' ? 2 : 1) : 0",
                        "returnByValue": true
                    }),
                )
                .await
                .unwrap_or(Value::Null);
            let code = check["result"]["value"].as_i64().unwrap_or(0);
            if code == 2 || (code == 1 && step >= 22) {
                render_ready = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(120)).await;
        }

        if !render_ready {
            sess.close().await;
            return Err("Komposisi HyperFrames tidak mendefinisikan `window.render(t)` saat dimuat.".to_string());
        }

        Ok(sess)
    }

    async fn send_cmd(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let payload = json!({
            "id": id,
            "method": method,
            "params": params
        });
        self.ws
            .send(Message::Text(payload.to_string().into()))
            .await
            .map_err(|e| format!("Gagal kirim perintah CDP {method}: {e}"))?;

        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        loop {
            let next_msg = tokio::time::timeout_at(deadline, self.ws.next())
                .await
                .map_err(|_| format!("Timeout menunggu respons CDP {method}"))?;
            let Some(msg_res) = next_msg else {
                return Err(format!("Koneksi CDP tertutup saat menunggu {method}"));
            };
            let msg = msg_res.map_err(|e| format!("Error membaca WebSocket CDP: {e}"))?;
            if let Message::Text(txt) = msg {
                if let Ok(val) = serde_json::from_str::<Value>(&txt) {
                    if val["id"].as_u64() == Some(id) {
                        if let Some(err) = val.get("error") {
                            return Err(format!("CDP {method} error: {err}"));
                        }
                        return Ok(val["result"].clone());
                    }
                }
            }
        }
    }

    async fn render_and_capture_jpeg(&mut self, time_sec: f64, quality: u8) -> Result<Vec<u8>, String> {
        self.send_cmd(
            "Runtime.evaluate",
            json!({
                "expression": format!("window.render({time_sec:.4}); true;"),
                "returnByValue": true
            }),
        )
        .await?;

        let res = self
            .send_cmd(
                "Page.captureScreenshot",
                json!({
                    "format": "jpeg",
                    "quality": quality
                }),
            )
            .await?;

        let b64 = res["data"]
            .as_str()
            .ok_or_else(|| "CDP Page.captureScreenshot tidak mengembalikan data gambar.".to_string())?;
        BASE64
            .decode(b64)
            .map_err(|e| format!("Gagal decode frame JPEG dari CDP: {e}"))
    }

    async fn close(mut self) {
        let _ = self.ws.close(None).await;
        let _ = self.browser_child.kill().await;
        let _ = self.browser_child.wait().await;
        self.http_handle.abort();
        let _ = std::fs::remove_dir_all(&self.profile_dir);
    }
}

#[tauri::command]
pub async fn capture_hyperframe_poster(
    req: CaptureHyperframePosterRequest,
) -> Result<String, String> {
    if req.html.trim().len() < 80 {
        return Err("HTML HyperFrames kosong.".to_string());
    }
    let mut sess = CdpSession::launch(req.html, 1080, 1920, 0.3333).await?;
    let jpeg_res = sess.render_and_capture_jpeg(req.time_sec.max(0.1), 80).await;
    sess.close().await;
    let jpeg = jpeg_res?;
    Ok(format!("data:image/jpeg;base64,{}", BASE64.encode(jpeg)))
}

#[tauri::command]
pub async fn export_hyperframe_mp4(
    app: AppHandle,
    req: ExportHyperframeMp4Request,
) -> Result<ExportResult, String> {
    let ffmpeg_bin = resolve_ffmpeg_binary()?;
    let safe_fps = req.fps.clamp(24, 60);
    let safe_dur = if req.duration_sec.is_finite() {
        req.duration_sec.clamp(1.0, 600.0)
    } else {
        30.0
    };
    let total_frames = ((safe_dur * (safe_fps as f64)).round() as u32).max(24);
    let out_w = if req.width >= 1000 { 1080 } else { 720 };
    let out_h = if req.height >= 1800 { 1920 } else { 1280 };
    let capture_scale = (out_w as f64) / 1080.0;

    let _ = app.emit(
        "export-progress",
        ExportProgressEvent {
            stage: "init".to_string(),
            percent: 2.0,
            message: "Membuka mesin render Headless Chrome/Edge (HyperFrames CDP)...".to_string(),
        },
    );

    let mut sess = CdpSession::launch(req.html, 1080, 1920, capture_scale).await?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let work_dir = std::env::temp_dir().join(format!("synkcut_export_hf_{stamp}"));
    tokio::fs::create_dir_all(&work_dir)
        .await
        .map_err(|e| format!("Gagal membuat folder kerja export: {e}"))?;
    let silent_video_path = work_dir.join("video_only.mp4");

    // Probe bundled LGPL FFmpeg encoders once: prefer fast h264_mf, fallback to pure-LGPL libopenh264
    let mut codec_name = "h264_mf";
    let mut probe_cmd = Command::new(&ffmpeg_bin);
    probe_cmd
        .args(["-hide_banner", "-encoders"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    probe_cmd.creation_flags(0x0800_0000);
    if let Ok(enc_out) = probe_cmd.output().await {
        let enc_txt = String::from_utf8_lossy(&enc_out.stdout);
        if !enc_txt.contains("h264_mf") && enc_txt.contains("libopenh264") {
            codec_name = "libopenh264";
        }
    }

    let bitrate = if out_w >= 1080 { "8000k" } else { "4500k" };
    let mut ff_cmd = Command::new(&ffmpeg_bin);
    ff_cmd
        .args([
            "-y",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "-r",
            &safe_fps.to_string(),
            "-i",
            "pipe:0",
            "-vf",
            &format!("scale={out_w}:{out_h}:flags=lanczos,format=yuv420p"),
            "-c:v",
            codec_name,
            "-b:v",
            bitrate,
            "-color_range",
            "tv",
            "-colorspace",
            "bt709",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-movflags",
            "+faststart",
            silent_video_path.to_string_lossy().as_ref(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    ff_cmd.creation_flags(0x0800_0000);

    let mut ff_child = ff_cmd
        .spawn()
        .map_err(|e| format!("Gagal memulai encoder FFmpeg: {e}"))?;
    let mut ff_stdin = ff_child
        .stdin
        .take()
        .ok_or_else(|| "Gagal membuka stdin FFmpeg.".to_string())?;

    let mut pipe_err: Option<String> = None;
    for fidx in 0..total_frames {
        let t_sec = (fidx as f64) / (safe_fps as f64);
        match sess.render_and_capture_jpeg(t_sec, 92).await {
            Ok(jpg) => {
                if let Err(e) = ff_stdin.write_all(&jpg).await {
                    pipe_err = Some(format!("FFmpeg pipe write gagal di frame {fidx}: {e}"));
                    break;
                }
            }
            Err(e) => {
                pipe_err = Some(e);
                break;
            }
        }
        if fidx % 12 == 0 || fidx + 1 == total_frames {
            let pct = 5.0 + ((fidx + 1) as f64 / (total_frames as f64)) * 80.0;
            let _ = app.emit(
                "export-progress",
                ExportProgressEvent {
                    stage: "encoding".to_string(),
                    percent: pct,
                    message: format!(
                        "Merender frame HyperFrames {}/{} ({:.0}%)...",
                        fidx + 1,
                        total_frames,
                        ((fidx + 1) as f64 / (total_frames as f64)) * 100.0
                    ),
                },
            );
        }
    }

    drop(ff_stdin);
    sess.close().await;

    let ff_out = ff_child
        .wait_with_output()
        .await
        .map_err(|e| format!("Gagal menunggu proses FFmpeg: {e}"))?;

    if let Some(err) = pipe_err {
        let stderr = String::from_utf8_lossy(&ff_out.stderr);
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
        return Err(format!("{err}\n{stderr}"));
    }
    if !ff_out.status.success() {
        let stderr = String::from_utf8_lossy(&ff_out.stderr);
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
        return Err(format!("Encoding H.264 HyperFrames gagal: {stderr}"));
    }

    // Mux with Synkcut's exact Neural TTS + BGM auto-ducking + SFX audio graph via atomic temp output!
    let tmp_final_path = format!("{}.tmp.mp4", req.output_path);
    let mux_res = crate::mux_export_mp4_internal(
        app.clone(),
        None,
        Some(silent_video_path.to_string_lossy().to_string()),
        req.audio_path,
        req.generate_demo_audio,
        safe_dur,
        tmp_final_path.clone(),
        req.mix_plan,
    )
    .await;

    let _ = tokio::fs::remove_dir_all(&work_dir).await;
    let res = mux_res?;

    // Mandatory decode integrity check before atomic publish (guarantees 0 corrupted MP4 exports!)
    let mut verify_cmd = Command::new(&ffmpeg_bin);
    verify_cmd
        .args(["-v", "error", "-i", &tmp_final_path, "-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    verify_cmd.creation_flags(0x0800_0000);
    if let Ok(v_out) = verify_cmd.output().await {
        let v_err = String::from_utf8_lossy(&v_out.stderr).trim().to_string();
        if !v_out.status.success() || !v_err.is_empty() {
            let _ = std::fs::remove_file(&tmp_final_path);
            return Err(format!("Verifikasi integritas MP4 gagal (decode error): {v_err}"));
        }
    }

    // Atomic publish after verified mux & decode check
    std::fs::rename(&tmp_final_path, &req.output_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_final_path);
        format!("Gagal menyimpan file MP4 final secara atomik: {e}")
    })?;

    Ok(ExportResult {
        output_path: req.output_path,
        file_size_bytes: res.file_size_bytes,
        duration_ms: res.duration_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_hyperframe_preview_serves_html_and_vendor() {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        rt.block_on(async {
            let sample_html =
                "<!DOCTYPE html><html><head><title>HF Test</title></head><body>ok</body></html>"
                    .to_string();
            let url = register_hyperframe_preview(sample_html.clone())
                .await
                .expect("preview server should register HTML");
            assert!(url.starts_with("http://127.0.0.1:"));
            assert!(url.contains("/preview/hf_"));

            let client = reqwest::Client::new();
            let html_resp = client.get(&url).send().await.expect("GET preview HTML");
            assert!(html_resp.status().is_success());
            let body = html_resp.text().await.unwrap();
            assert_eq!(body, sample_html);

            let base = url.rsplit_once('/').unwrap().0;
            let s3_url = format!("{base}/vendor/s3-kit.js");
            let s3_resp = client.get(&s3_url).send().await.expect("GET s3-kit.js");
            assert!(s3_resp.status().is_success());
            let s3_txt = s3_resp.text().await.unwrap();
            assert!(s3_txt.contains("createStudioWorld"));
        });
    }
}
