use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    pub ffmpeg_ready: bool,
    pub ffprobe_ready: bool,
    pub ffmpeg_version: String,
    pub ffprobe_version: String,
    pub is_lgpl: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbeInfo {
    pub path: String,
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub has_audio: bool,
    pub video_codec: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgressEvent {
    pub stage: String,
    pub percent: f64,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub output_path: String,
    pub file_size_bytes: u64,
    pub duration_ms: u64,
}

#[tauri::command]
async fn check_sidecars(app: AppHandle) -> SidecarStatus {
    let ffmpeg_res = match app.shell().sidecar("ffmpeg") {
        Ok(cmd) => cmd.args(["-version"]).output().await,
        Err(e) => {
            return SidecarStatus {
                ffmpeg_ready: false,
                ffprobe_ready: false,
                ffmpeg_version: String::new(),
                ffprobe_version: String::new(),
                is_lgpl: false,
                error: Some(format!("Gagal menemukan sidecar ffmpeg: {e}")),
            }
        }
    };

    let ffprobe_res = match app.shell().sidecar("ffprobe") {
        Ok(cmd) => cmd.args(["-version"]).output().await,
        Err(e) => {
            return SidecarStatus {
                ffmpeg_ready: false,
                ffprobe_ready: false,
                ffmpeg_version: String::new(),
                ffprobe_version: String::new(),
                is_lgpl: false,
                error: Some(format!("Gagal menemukan sidecar ffprobe: {e}")),
            }
        }
    };

    let (ffmpeg_ready, ffmpeg_version, is_lgpl) = match ffmpeg_res {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let first_line = stdout.lines().next().unwrap_or("ffmpeg ready").to_string();
            let lgpl = !stdout.contains("--enable-gpl");
            (true, first_line, lgpl)
        }
        Ok(out) => (
            false,
            String::from_utf8_lossy(&out.stderr).to_string(),
            false,
        ),
        Err(e) => (false, e.to_string(), false),
    };

    let (ffprobe_ready, ffprobe_version) = match ffprobe_res {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let first_line = stdout.lines().next().unwrap_or("ffprobe ready").to_string();
            (true, first_line)
        }
        Ok(out) => (false, String::from_utf8_lossy(&out.stderr).to_string()),
        Err(e) => (false, e.to_string()),
    };

    SidecarStatus {
        ffmpeg_ready,
        ffprobe_ready,
        ffmpeg_version,
        ffprobe_version,
        is_lgpl,
        error: None,
    }
}

fn parse_ffprobe_json(path: &str, raw_json: &str) -> Result<MediaProbeInfo, String> {
    let val: serde_json::Value =
        serde_json::from_str(raw_json).map_err(|e| format!("Gagal parse output ffprobe: {e}"))?;

    let duration_sec = val["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    let streams = val["streams"]
        .as_array()
        .ok_or_else(|| "Stream tidak ditemukan pada file media.".to_string())?;

    let mut width = 0u32;
    let mut height = 0u32;
    let mut fps = 30.0f64;
    let mut has_audio = false;
    let mut video_codec = String::from("unknown");

    for stream in streams {
        match stream["codec_type"].as_str() {
            Some("video") if width == 0 => {
                width = stream["width"].as_u64().unwrap_or(0) as u32;
                height = stream["height"].as_u64().unwrap_or(0) as u32;
                video_codec = stream["codec_name"]
                    .as_str()
                    .unwrap_or("unknown")
                    .to_string();
                if let Some(rate) = stream["avg_frame_rate"].as_str() {
                    let parts: Vec<&str> = rate.split('/').collect();
                    if parts.len() == 2 {
                        if let (Ok(num), Ok(den)) =
                            (parts[0].parse::<f64>(), parts[1].parse::<f64>())
                        {
                            if den > 0.0 {
                                fps = (num / den * 100.0).round() / 100.0;
                            }
                        }
                    }
                }
            }
            Some("audio") => {
                has_audio = true;
            }
            _ => {}
        }
    }

    Ok(MediaProbeInfo {
        path: path.to_string(),
        duration_ms: (duration_sec * 1000.0).round() as u64,
        width,
        height,
        fps,
        has_audio,
        video_codec,
    })
}

#[tauri::command]
async fn probe_media(app: AppHandle, path: String) -> Result<MediaProbeInfo, String> {
    let output = app
        .shell()
        .sidecar("ffprobe")
        .map_err(|e| format!("Sidecar ffprobe tidak tersedia: {e}"))?
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &path,
        ])
        .output()
        .await
        .map_err(|e| format!("Gagal menjalankan ffprobe: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe gagal membaca media: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_ffprobe_json(&path, &stdout)
}

#[tauri::command]
async fn extract_thumbnails(
    app: AppHandle,
    path: String,
    count: Option<u32>,
) -> Result<Vec<String>, String> {
    let thumb_count = count.unwrap_or(2).clamp(1, 4);
    let probe = probe_media(app.clone(), path.clone()).await?;
    let total_sec = (probe.duration_ms as f64 / 1000.0).max(0.5);

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let temp_dir = std::env::temp_dir().join(format!("synkcut_thumbs_{stamp}"));
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| format!("Gagal membuat folder temp thumbnail: {e}"))?;

    let mut data_urls = Vec::new();

    for i in 0..thumb_count {
        let ratio = (i as f64 + 0.5) / (thumb_count as f64);
        let ts = (total_sec * ratio).min((total_sec - 0.1).max(0.0));
        let out_file = temp_dir.join(format!("thumb_{i}.jpg"));

        let out = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| format!("Sidecar ffmpeg tidak tersedia: {e}"))?
            .args([
                "-y",
                "-ss",
                &format!("{ts:.2}"),
                "-i",
                &path,
                "-frames:v",
                "1",
                "-vf",
                "scale=360:-1",
                "-q:v",
                "5",
                out_file.to_string_lossy().as_ref(),
            ])
            .output()
            .await
            .map_err(|e| format!("Gagal mengekstrak thumbnail: {e}"))?;

        if out.status.success() {
            if let Ok(bytes) = tokio::fs::read(&out_file).await {
                data_urls.push(format!("data:image/jpeg;base64,{}", BASE64.encode(bytes)));
            }
        }
    }

    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    Ok(data_urls)
}

#[tauri::command]
async fn mux_export_mp4(
    app: AppHandle,
    video_bytes: Vec<u8>,
    audio_path: Option<String>,
    generate_demo_audio: bool,
    duration_sec: f64,
    output_path: String,
) -> Result<ExportResult, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let temp_dir = std::env::temp_dir().join(format!("synkcut_export_{stamp}"));
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| format!("Gagal membuat direktori sementara: {e}"))?;

    let temp_video = temp_dir.join("encoded_video.mp4");
    tokio::fs::write(&temp_video, &video_bytes)
        .await
        .map_err(|e| format!("Gagal menulis file video sementara: {e}"))?;

    let _ = app.emit(
        "export-progress",
        ExportProgressEvent {
            stage: "muxing".to_string(),
            percent: 82.0,
            message: "FFmpeg Sidecar sedang menggabungkan audio & memfinalisasi MP4...".to_string(),
        },
    );

    let temp_video_str = temp_video.to_string_lossy().to_string();
    let mut args: Vec<String> = vec!["-y".to_string(), "-i".to_string(), temp_video_str];

    if let Some(ref audio) = audio_path {
        if !audio.trim().is_empty() {
            args.extend([
                "-i".to_string(),
                audio.clone(),
                "-map".to_string(),
                "0:v:0".to_string(),
                "-map".to_string(),
                "1:a:0".to_string(),
                "-c:v".to_string(),
                "copy".to_string(),
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                "192k".to_string(),
                "-shortest".to_string(),
                "-movflags".to_string(),
                "+faststart".to_string(),
                output_path.clone(),
            ]);
        }
    } else if generate_demo_audio {
        // Synthesize a clean gentle rhythmic chime track natively via FFmpeg LGPL lavfi
        let safe_dur = duration_sec.clamp(1.0, 120.0);
        let filter_src = format!(
            "aevalsrc=0.14*sin(2*PI*330*t)*exp(-3*mod(t\\,1.5))+0.08*sin(2*PI*495*t)*exp(-4*mod(t+0.75\\,1.5)):s=44100:d={safe_dur:.2}"
        );
        args.extend([
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            filter_src,
            "-map".to_string(),
            "0:v:0".to_string(),
            "-map".to_string(),
            "1:a:0".to_string(),
            "-c:v".to_string(),
            "copy".to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "192k".to_string(),
            "-shortest".to_string(),
            "-movflags".to_string(),
            "+faststart".to_string(),
            output_path.clone(),
        ]);
    } else {
        args.extend([
            "-c:v".to_string(),
            "copy".to_string(),
            "-movflags".to_string(),
            "+faststart".to_string(),
            output_path.clone(),
        ]);
    }

    let output = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("Sidecar ffmpeg tidak ditemukan: {e}"))?
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("Gagal menjalankan proses FFmpeg muxing: {e}"))?;

    let _ = tokio::fs::remove_dir_all(&temp_dir).await;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg muxing gagal: {stderr}"));
    }

    let meta = tokio::fs::metadata(&output_path)
        .await
        .map_err(|e| format!("File output tidak ditemukan: {e}"))?;

    let _ = app.emit(
        "export-progress",
        ExportProgressEvent {
            stage: "done".to_string(),
            percent: 100.0,
            message: "Export MP4 selesai!".to_string(),
        },
    );

    Ok(ExportResult {
        output_path,
        file_size_bytes: meta.len(),
        duration_ms: (duration_sec * 1000.0).round() as u64,
    })
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err("File tidak ditemukan.".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Gagal membuka Explorer: {e}"))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_sidecars,
            probe_media,
            extract_thumbnails,
            mux_export_mp4,
            reveal_in_explorer
        ])
        .run(tauri::generate_context!())
        .expect("error while running Synkcut Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ffprobe_json_valid() {
        let sample = r#"{
            "format": { "duration": "12.500000" },
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1080,
                    "height": 1920,
                    "avg_frame_rate": "30000/1001"
                },
                {
                    "codec_type": "audio",
                    "codec_name": "aac"
                }
            ]
        }"#;

        let info = parse_ffprobe_json("demo.mp4", sample).expect("should parse valid ffprobe json");
        assert_eq!(info.duration_ms, 12500);
        assert_eq!(info.width, 1080);
        assert_eq!(info.height, 1920);
        assert_eq!(info.fps, 29.97);
        assert!(info.has_audio);
        assert_eq!(info.video_codec, "h264");
    }
}
