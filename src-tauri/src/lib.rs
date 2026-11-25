mod ai;
mod audio;
mod audio_pack;
mod byok;
mod motion_skills;
mod projects;
mod style_ref;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;

static ATOMIC_TEMP_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FootageFrameSample {
    pub timestamp_ms: u64,
    pub data_url: String,
}

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
async fn extract_footage_frames(
    app: AppHandle,
    path: String,
    count: Option<u32>,
) -> Result<Vec<FootageFrameSample>, String> {
    let thumb_count = count.unwrap_or(4).clamp(1, 6);
    let probe = probe_media(app.clone(), path.clone()).await?;
    let total_sec = (probe.duration_ms as f64 / 1000.0).max(0.5);

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seq = ATOMIC_TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let temp_dir = std::env::temp_dir().join(format!("synkcut_thumbs_{stamp}_{seq}"));
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| format!("Gagal membuat folder temp thumbnail: {e}"))?;

    let mut samples = Vec::new();

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
                if !bytes.is_empty() {
                    samples.push(FootageFrameSample {
                        timestamp_ms: (ts * 1000.0).round() as u64,
                        data_url: format!("data:image/jpeg;base64,{}", BASE64.encode(bytes)),
                    });
                }
            }
        }
    }

    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    Ok(samples)
}

#[tauri::command]
async fn extract_thumbnails(
    app: AppHandle,
    path: String,
    count: Option<u32>,
) -> Result<Vec<String>, String> {
    let frames = extract_footage_frames(app, path, count).await?;
    Ok(frames.into_iter().map(|f| f.data_url).collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SfxMixEvent {
    pub preset: String,
    pub timestamp_ms: u64,
    pub volume: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMixPlan {
    pub bgm_preset: Option<String>,
    pub bgm_volume: Option<f64>,
    pub auto_ducking: Option<bool>,
    pub sfx_events: Option<Vec<SfxMixEvent>>,
}

fn build_audio_mix_graph(
    has_voice: bool,
    bgm_input_idx: Option<usize>,
    bgm_volume: f64,
    auto_ducking: bool,
    sfx_inputs: &[(usize, u64, f64)], // (ffmpeg_input_index, timestamp_ms, volume)
) -> Option<(String, String)> {
    let mut filters: Vec<String> = Vec::new();
    let mut mix_labels: Vec<String> = Vec::new();

    if has_voice {
        if bgm_input_idx.is_some() && auto_ducking {
            filters.push("[1:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=2[vo_main][vo_sc]".to_string());
            mix_labels.push("[vo_main]".to_string());
        } else {
            filters.push("[1:a]aformat=sample_rates=44100:channel_layouts=stereo[vo_main]".to_string());
            mix_labels.push("[vo_main]".to_string());
        }
    }

    if let Some(b_idx) = bgm_input_idx {
        let safe_vol = bgm_volume.clamp(0.05, 0.85);
        if has_voice && auto_ducking {
            filters.push(format!(
                "[{b_idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume={safe_vol:.2}[bgm_pre]"
            ));
            filters.push(
                "[bgm_pre][vo_sc]sidechaincompress=threshold=0.025:ratio=6:attack=35:release=280:makeup=1[bgm_duck]"
                    .to_string(),
            );
            mix_labels.push("[bgm_duck]".to_string());
        } else {
            filters.push(format!(
                "[{b_idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume={safe_vol:.2}[bgm_out]"
            ));
            mix_labels.push("[bgm_out]".to_string());
        }
    }

    for (idx, (inp, ts_ms, vol)) in sfx_inputs.iter().enumerate() {
        let safe_vol = vol.clamp(0.05, 1.0);
        filters.push(format!(
            "[{inp}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume={safe_vol:.2},adelay={ts_ms}|{ts_ms}[sfx_{idx}]"
        ));
        mix_labels.push(format!("[sfx_{idx}]"));
    }

    if mix_labels.is_empty() {
        return None;
    }

    if mix_labels.len() == 1 {
        let single = mix_labels[0].clone();
        return Some((filters.join(";"), single));
    }

    let joined_inputs = mix_labels.join("");
    let count = mix_labels.len();
    filters.push(format!(
        "{joined_inputs}amix=inputs={count}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]"
    ));
    Some((filters.join(";"), "[aout]".to_string()))
}

/// Streamed 2 MB base64 video chunk writer: avoids the 1.5 GB `Array.from(Uint8Array)` JSON IPC OOM spike!
#[tauri::command]
async fn write_export_video_chunk(
    export_id: String,
    chunk_base64: String,
    append: bool,
) -> Result<String, String> {
    use tokio::io::AsyncWriteExt;
    let safe_id: String = export_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(48)
        .collect();
    if safe_id.is_empty() {
        return Err("export_id tidak valid.".to_string());
    }
    let temp_dir = std::env::temp_dir().join(format!("synkcut_export_{safe_id}"));
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| format!("Gagal membuat folder export sementara: {e}"))?;
    let temp_video = temp_dir.join("encoded_video.mp4");
    let decoded = BASE64
        .decode(chunk_base64.trim())
        .map_err(|e| format!("Gagal decode chunk video export: {e}"))?;

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(!append)
        .append(append)
        .open(&temp_video)
        .await
        .map_err(|e| format!("Gagal membuka file video sementara: {e}"))?;
    file.write_all(&decoded)
        .await
        .map_err(|e| format!("Gagal menulis chunk video sementara: {e}"))?;
    file.flush().await.ok();
    Ok(temp_video.to_string_lossy().to_string())
}

#[tauri::command]
async fn cleanup_export_temp(export_id: String) -> Result<(), String> {
    let safe_id: String = export_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(48)
        .collect();
    if !safe_id.is_empty() {
        let temp_dir = std::env::temp_dir().join(format!("synkcut_export_{safe_id}"));
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }
    Ok(())
}

#[tauri::command]
async fn mux_export_mp4(
    app: AppHandle,
    video_bytes: Option<Vec<u8>>,
    temp_video_path: Option<String>,
    audio_path: Option<String>,
    generate_demo_audio: bool,
    duration_sec: f64,
    output_path: String,
    mix_plan: Option<AudioMixPlan>,
) -> Result<ExportResult, String> {
    if !output_path.trim().to_ascii_lowercase().ends_with(".mp4") {
        return Err("Path tujuan export wajib berakhiran .mp4.".to_string());
    }
    let seq = ATOMIC_TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let (temp_dir, temp_video) = if let Some(ref prewritten) = temp_video_path.filter(|s| !s.trim().is_empty()) {
        let pb = PathBuf::from(prewritten);
        if !pb.is_file() {
            return Err("File video hasil encode tidak ditemukan.".to_string());
        }
        let dir = pb.parent().map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        (dir, pb)
    } else {
        let bytes = video_bytes.ok_or_else(|| "Data video hasil encode kosong.".to_string())?;
        let dir = std::env::temp_dir().join(format!("synkcut_export_{stamp}_{seq}"));
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| format!("Gagal membuat direktori sementara: {e}"))?;
        let vid = dir.join("encoded_video.mp4");
        tokio::fs::write(&vid, &bytes)
            .await
            .map_err(|e| {
                let _ = std::fs::remove_dir_all(&dir);
                format!("Gagal menulis file video sementara: {e}")
            })?;
        (dir, vid)
    };

    let _ = app.emit(
        "export-progress",
        ExportProgressEvent {
            stage: "muxing".to_string(),
            percent: 82.0,
            message: "FFmpeg Sidecar mencampur Voiceover, BGM Auto-Ducking, & SFX...".to_string(),
        },
    );

    let temp_video_str = temp_video.to_string_lossy().to_string();
    let safe_dur = if duration_sec.is_finite() {
        duration_sec.clamp(1.0, 600.0)
    } else {
        15.0
    };
    let mut args: Vec<String> = vec!["-y".to_string(), "-i".to_string(), temp_video_str];
    let mut next_input_idx: usize = 1;

    // Input 1 (optional): Voiceover (validated local file or optional demo chime)
    let valid_audio = audio_path
        .filter(|p| !p.trim().is_empty() && PathBuf::from(p).is_file());
    let has_voice = valid_audio.is_some() || generate_demo_audio;

    if let Some(ref audio) = valid_audio {
        args.extend(["-i".to_string(), audio.clone()]);
        next_input_idx += 1;
    } else if generate_demo_audio {
        let filter_src = format!(
            "aevalsrc=0.14*sin(2*PI*330*t)*exp(-3*mod(t\\,1.5))+0.08*sin(2*PI*495*t)*exp(-4*mod(t+0.75\\,1.5)):s=44100:d={safe_dur:.2}"
        );
        args.extend(["-f".to_string(), "lavfi".to_string(), "-i".to_string(), filter_src]);
        next_input_idx += 1;
    }

    // Optional BGM input (looped cleanly to duration)
    let mut bgm_input_idx: Option<usize> = None;
    let raw_bgm_vol = mix_plan
        .as_ref()
        .and_then(|m| m.bgm_volume)
        .unwrap_or(0.24);
    let bgm_volume = if raw_bgm_vol.is_finite() {
        raw_bgm_vol.clamp(0.0, 1.0)
    } else {
        0.24
    };
    let auto_ducking = mix_plan
        .as_ref()
        .and_then(|m| m.auto_ducking)
        .unwrap_or(true);

    if let Some(bgm_id) = mix_plan
        .as_ref()
        .and_then(|m| m.bgm_preset.as_deref())
        .filter(|s| !s.trim().is_empty() && *s != "none")
    {
        if let Ok(bgm_file) = audio_pack::ensure_asset_file(&app, "bgm", bgm_id) {
            args.extend([
                "-stream_loop".to_string(),
                "-1".to_string(),
                "-t".to_string(),
                format!("{safe_dur:.2}"),
                "-i".to_string(),
                bgm_file.to_string_lossy().to_string(),
            ]);
            bgm_input_idx = Some(next_input_idx);
            next_input_idx += 1;
        }
    }

    // Optional timed SFX inputs (up to 48 beats supported!)
    let mut sfx_inputs: Vec<(usize, u64, f64)> = Vec::new();
    if let Some(events) = mix_plan.as_ref().and_then(|m| m.sfx_events.as_ref()) {
        for ev in events.iter().take(48) {
            if ev.preset.trim().is_empty() || ev.preset == "none" {
                continue;
            }
            if let Ok(sfx_file) = audio_pack::ensure_asset_file(&app, "sfx", &ev.preset) {
                let safe_ev_vol = if ev.volume.is_finite() {
                    ev.volume.clamp(0.0, 1.5)
                } else {
                    0.65
                };
                args.extend(["-i".to_string(), sfx_file.to_string_lossy().to_string()]);
                sfx_inputs.push((next_input_idx, ev.timestamp_ms, safe_ev_vol));
                next_input_idx += 1;
            }
        }
    }

    if let Some((filter_graph, audio_map)) =
        build_audio_mix_graph(has_voice, bgm_input_idx, bgm_volume, auto_ducking, &sfx_inputs)
    {
        args.extend([
            "-filter_complex".to_string(),
            filter_graph,
            "-map".to_string(),
            "0:v:0".to_string(),
            "-map".to_string(),
            audio_map,
            "-c:v".to_string(),
            "copy".to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "192k".to_string(),
            "-t".to_string(),
            format!("{safe_dur:.2}"),
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

    let sidecar_cmd = match app.shell().sidecar("ffmpeg") {
        Ok(c) => c.args(&args),
        Err(e) => {
            if temp_dir.file_name().is_some_and(|n| n.to_string_lossy().starts_with("synkcut_export_")) {
                let _ = tokio::fs::remove_dir_all(&temp_dir).await;
            }
            return Err(format!("Sidecar ffmpeg tidak ditemukan: {e}"));
        }
    };

    let output_res = tokio::time::timeout(std::time::Duration::from_secs(180), sidecar_cmd.output()).await;

    if temp_dir.file_name().is_some_and(|n| n.to_string_lossy().starts_with("synkcut_export_")) {
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    let output = output_res
        .map_err(|_| "Proses FFmpeg muxing melebihi batas waktu 3 menit.".to_string())?
        .map_err(|e| format!("Gagal menjalankan proses FFmpeg muxing: {e}"))?;

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
        duration_ms: (safe_dur * 1000.0).round() as u64,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemotionExportFile {
    relative_path: String,
    content: String,
}

#[tauri::command]
async fn export_remotion_project(
    target_dir: String,
    files: Vec<RemotionExportFile>,
    audio_path: Option<String>,
) -> Result<String, String> {
    let root = PathBuf::from(target_dir.trim());
    if target_dir.trim().is_empty() {
        return Err("Folder tujuan export Remotion tidak boleh kosong.".to_string());
    }
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("Gagal membuat folder Remotion: {e}"))?;

    for f in files {
        let rel_raw = f.relative_path.replace('\\', "/");
        if rel_raw.is_empty() || rel_raw.contains(':') {
            continue;
        }
        let rel_path = std::path::Path::new(&rel_raw);
        // Security: strictly require every path segment to be `Component::Normal` (prevents `C:` prefix & `..` traversal!)
        if !rel_path
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
        {
            continue;
        }
        let allowed_ext = rel_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| {
                matches!(
                    e.to_ascii_lowercase().as_str(),
                    "ts" | "tsx" | "js" | "json" | "css" | "md" | "html" | "gitignore"
                )
            })
            .unwrap_or(rel_raw.ends_with(".gitignore"));
        if !allowed_ext {
            continue;
        }
        let dest = root.join(rel_path);
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Gagal membuat subfolder Remotion: {e}"))?;
        }
        tokio::fs::write(&dest, f.content.as_bytes())
            .await
            .map_err(|e| format!("Gagal menulis {}: {e}", rel_raw))?;
    }

    if let Some(src_audio) = audio_path.filter(|p| !p.trim().is_empty()) {
        let src_path = PathBuf::from(&src_audio);
        if src_path.is_file() {
            let public_dir = root.join("public");
            let _ = tokio::fs::create_dir_all(&public_dir).await;
            let ext = match src_path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_ascii_lowercase())
                .as_deref()
            {
                Some("mp3") => "mp3",
                Some("m4a") => "m4a",
                Some("ogg") => "ogg",
                _ => "wav",
            };
            let dst_audio = public_dir.join(format!("voiceover.{ext}"));
            let _ = tokio::fs::copy(&src_path, &dst_audio).await;
        }
    }

    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
fn reveal_in_explorer(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let canonical = std::fs::canonicalize(&path).map_err(|_| "File tidak ditemukan.".to_string())?;
    app.opener()
        .reveal_item_in_dir(canonical)
        .map_err(|e| format!("Gagal membuka Explorer: {e}"))
}

fn spawn_startup_temp_cleanup() {
    std::thread::spawn(|| {
        let two_hours = std::time::Duration::from_secs(2 * 3600);
        if let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let s = name.to_string_lossy();
                if s.starts_with("synkcut_export_")
                    || s.starts_with("synkcut_thumbs_")
                    || s.starts_with("synkcut_ytref_")
                {
                    let is_stale = entry
                        .metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.elapsed().ok())
                        .is_some_and(|age| age > two_hours);
                    if is_stale {
                        let _ = std::fs::remove_dir_all(entry.path());
                    }
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    spawn_startup_temp_cleanup();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_sidecars,
            probe_media,
            extract_thumbnails,
            extract_footage_frames,
            write_export_video_chunk,
            cleanup_export_temp,
            mux_export_mp4,
            export_remotion_project,
            reveal_in_explorer,
            byok::get_byok_status,
            byok::save_byok_key,
            byok::save_provider_config,
            byok::set_active_provider,
            byok::complete_onboarding,
            byok::delete_byok_key,
            byok::fetch_provider_models,
            byok::test_byok_connection,
            projects::list_projects,
            projects::load_project,
            projects::save_project,
            projects::duplicate_project,
            projects::rename_project,
            projects::delete_project,
            ai::ai_generate_script,
            ai::ai_plan_storyboard,
            ai::ai_generate_beat_codes,
            ai::ai_repair_beat_code,
            ai::ai_generate_3d_diorama,
            ai::ai_critique_3d_frames,
            ai::ai_repair_3d_diorama,
            ai::ai_assemble_project,
            ai::ai_copilot_patch,
            motion_skills::list_motion_skills,
            motion_skills::toggle_motion_skill,
            motion_skills::save_custom_motion_skill,
            motion_skills::import_motion_skill_url,
            motion_skills::delete_custom_motion_skill,
            style_ref::extract_youtube_style_reference,
            style_ref::analyze_style_reference,
            style_ref::analyze_design_reference,
            audio::generate_tts_audio,
            audio::process_user_audio,
            audio_pack::get_audio_pack_catalog,
            audio_pack::ensure_audio_pack_asset
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

    #[test]
    fn test_build_audio_mix_graph_with_ducking_and_sfx() {
        let (graph, out_label) =
            build_audio_mix_graph(true, Some(2), 0.25, true, &[(3, 1500, 0.7)])
                .expect("should produce mix graph");
        assert!(graph.contains("sidechaincompress"));
        assert!(graph.contains("adelay=1500|1500"));
        assert!(graph.contains("amix=inputs=3"));
        assert_eq!(out_label, "[aout]");
    }
}
