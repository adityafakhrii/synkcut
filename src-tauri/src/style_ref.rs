use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

use crate::ai::{call_llm_json, resolve_active_key, strip_json_fences};
use crate::byok;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StyleReferenceResult {
    pub source_type: String,
    pub url: Option<String>,
    pub title: String,
    pub thumbnails: Vec<String>,
    pub style_dna_summary: String,
    pub suggested_theme: String,
    pub suggested_caption: String,
    pub suggested_accent: String,
    pub suggested_engines: Vec<String>,
    pub layer_used: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeStyleRequest {
    pub source_type: String,
    pub title: Option<String>,
    pub url: Option<String>,
    pub thumbnails: Vec<String>,
}

/// Extract canonical 11-char YouTube video ID from standard watch, youtu.be, or Shorts URLs.
pub fn extract_youtube_video_id(raw_url: &str) -> Option<String> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_lowercase();
    if !lower.contains("youtube.com") && !lower.contains("youtu.be") {
        return None;
    }

    // Remove fragment and split query
    let without_frag = trimmed.split('#').next().unwrap_or(trimmed);
    let (path_part, query_part) = match without_frag.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (without_frag, None),
    };

    // 1. Check ?v=VIDEO_ID
    if let Some(q) = query_part {
        for pair in q.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                if k == "v" && is_valid_yt_id(v) {
                    return Some(v.to_string());
                }
            }
        }
    }

    // 2. Check /shorts/ID, /embed/ID, or youtu.be/ID
    let segments: Vec<&str> = path_part
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();

    for (idx, seg) in segments.iter().enumerate() {
        let s_lower = seg.to_lowercase();
        if (s_lower == "shorts" || s_lower == "embed" || s_lower == "live")
            && idx + 1 < segments.len()
        {
            let cand = segments[idx + 1];
            if is_valid_yt_id(cand) {
                return Some(cand.to_string());
            }
        }
        if s_lower.ends_with("youtu.be") && idx + 1 < segments.len() {
            let cand = segments[idx + 1];
            if is_valid_yt_id(cand) {
                return Some(cand.to_string());
            }
        }
    }

    None
}

fn is_valid_yt_id(s: &str) -> bool {
    let len = s.len();
    (10..=12).contains(&len)
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn sanitize_theme(val: Option<&str>) -> String {
    match val.unwrap_or("carbon") {
        "carbon" | "paper" | "coral" | "mint" | "blue" => val.unwrap().to_string(),
        _ => "carbon".to_string(),
    }
}

fn sanitize_caption(val: Option<&str>) -> String {
    match val.unwrap_or("bold_pop") {
        "bold_pop" | "clean_minimal" | "kinetic_punch" | "luxury_editorial" | "neon_tech" => {
            val.unwrap().to_string()
        }
        _ => "bold_pop".to_string(),
    }
}

fn sanitize_accent(val: Option<&str>) -> String {
    match val {
        Some(hex) if hex.starts_with('#') && (hex.len() == 7 || hex.len() == 4) => hex.to_string(),
        _ => "#38E59D".to_string(),
    }
}

fn sanitize_engines(arr: Option<&Vec<Value>>) -> Vec<String> {
    let valid = [
        "flow_diagram",
        "motion_chart",
        "tech_cards",
        "stick_figure",
        "breakdown_3d",
    ];
    let mut out: Vec<String> = arr
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str())
                .filter(|s| valid.contains(s))
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default();
    if out.is_empty() {
        out = vec!["flow_diagram".to_string(), "tech_cards".to_string()];
    }
    out
}

fn fallback_style_dna(title: &str) -> (String, String, String, String, Vec<String>) {
    let lower = title.to_lowercase();
    if lower.contains("3d") || lower.contains("iphone") || lower.contains("hp") || lower.contains("laptop") || lower.contains("teardown") || lower.contains("bedah") {
        (
            "Gaya tech breakdown gelap dengan visual 3D lapis demi lapis, label teknis bersih, dan pacing informatif.".to_string(),
            "carbon".to_string(),
            "neon_tech".to_string(),
            "#38E59D".to_string(),
            vec!["breakdown_3d".to_string(), "motion_chart".to_string(), "tech_cards".to_string()],
        )
    } else if lower.contains("stick") || lower.contains("kartun") || lower.contains("cerita") || lower.contains("animasi") {
        (
            "Gaya explainer ringan berlatar kertas hangat dengan karakter ilustrasi ekspresif dan alur cerita santai.".to_string(),
            "paper".to_string(),
            "clean_minimal".to_string(),
            "#F59E0B".to_string(),
            vec!["stick_figure".to_string(), "flow_diagram".to_string()],
        )
    } else if lower.contains("data") || lower.contains("grafik") || lower.contains("uang") || lower.contains("saham") || lower.contains("bisnis") {
        (
            "Gaya data-driven tegas dengan grafik angka berjalan, perbandingan kontras tinggi, dan subtitle tebal.".to_string(),
            "blue".to_string(),
            "bold_pop".to_string(),
            "#38BDF8".to_string(),
            vec!["motion_chart".to_string(), "tech_cards".to_string(), "flow_diagram".to_string()],
        )
    } else {
        (
            "Gaya motion modern kontras tinggi dengan alur diagram bertahap, tipografi tegas, dan ritme cepat 9:16.".to_string(),
            "carbon".to_string(),
            "bold_pop".to_string(),
            "#38E59D".to_string(),
            vec!["flow_diagram".to_string(), "tech_cards".to_string(), "motion_chart".to_string()],
        )
    }
}

async fn analyze_images_with_byok(
    app: &AppHandle,
    title: &str,
    thumbnails: &[String],
) -> Option<Value> {
    let (provider, api_key) = resolve_active_key(app).ok()?;

    let system_prompt = "Kamu adalah Art Director & Motion Designer untuk Synkcut. \
        Analisa frame/screenshot referensi video yang dilampirkan untuk mengekstrak DNA gaya visual (palet warna, suasana terang/gelap, jenis animasi yang cocok, gaya tipografi, dan pacing). \
        INGAT: kita hanya meniru GAYA/MOOD untuk diterapkan ke mesin AI Motion native Synkcut (bukan menyalin konten mentah). \
        Balas HANYA dalam JSON valid.";

    let user_prompt = format!(
        "Referensi judul/konteks: \"{}\"\n\
        Jumlah frame terlampir: {}.\n\n\
        Balas JSON persis seperti ini:\n\
        {{\n\
          \"styleDnaSummary\": \"Ringkasan 1-2 kalimat Bahasa Indonesia tentang warna, mood, pacing, dan karakter visual referensi ini\",\n\
          \"suggestedTheme\": \"carbon|paper|coral|mint|blue\",\n\
          \"suggestedCaption\": \"bold_pop|clean_minimal|kinetic_punch|luxury_editorial|neon_tech\",\n\
          \"suggestedAccent\": \"#38E59D atau #F59E0B atau #38BDF8 atau #F43F5E atau #FFFFFF\",\n\
          \"suggestedEngines\": [\"flow_diagram\", \"motion_chart\", \"tech_cards\", \"stick_figure\", \"breakdown_3d\"]\n\
        }}",
        title,
        thumbnails.len()
    );

    call_llm_json(&provider, &api_key, system_prompt, &user_prompt, thumbnails)
        .await
        .ok()
}

/// Layer 2: Ask Gemini 2.5 Flash directly with YouTube URL via fileData when yt-dlp is unavailable
async fn analyze_youtube_via_gemini_direct(
    app: &AppHandle,
    canonical_url: &str,
    title: &str,
) -> Option<Value> {
    let status = byok::get_byok_status(app.clone());
    let gemini_key = byok::read_stored_key("gemini")?;
    if status.active_provider != "gemini" && gemini_key.trim().is_empty() {
        return None;
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .ok()?;

    let system_prompt = "Kamu adalah Art Director & Motion Designer Synkcut. \
        Tonton sekilas referensi video YouTube berikut (maks 30 detik awal) dan ekstrak DNA gaya visualnya (warna, mood terang/gelap, ritme animasi, dan jenis motion explainer yang paling cocok). \
        Balas HANYA JSON valid.";

    let user_prompt = format!(
        "Judul referensi: \"{title}\".\n\
        Balas JSON persis:\n\
        {{\n\
          \"styleDnaSummary\": \"Ringkasan 1-2 kalimat Bahasa Indonesia tentang warna, mood, pacing, dan karakter motion referensi\",\n\
          \"suggestedTheme\": \"carbon|paper|coral|mint|blue\",\n\
          \"suggestedCaption\": \"bold_pop|clean_minimal|kinetic_punch|luxury_editorial|neon_tech\",\n\
          \"suggestedAccent\": \"#38E59D|#F59E0B|#38BDF8|#F43F5E|#FFFFFF\",\n\
          \"suggestedEngines\": [\"flow_diagram\", \"motion_chart\", \"tech_cards\", \"stick_figure\", \"breakdown_3d\"]\n\
        }}"
    );

    let payload = json!({
        "systemInstruction": { "parts": [{ "text": system_prompt }] },
        "contents": [{
            "role": "user",
            "parts": [
                { "fileData": { "mimeType": "video/mp4", "fileUri": canonical_url } },
                { "text": user_prompt }
            ]
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.4
        }
    });

    let endpoint = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
    );
    let res = client.post(endpoint).json(&payload).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    let val: Value = res.json().await.ok()?;
    let raw_txt = val["candidates"][0]["content"]["parts"][0]["text"].as_str()?;
    serde_json::from_str::<Value>(&strip_json_fences(raw_txt)).ok()
}

fn find_yt_dlp_executable(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(app_dir) = app.path().app_data_dir() {
        let local_bin = app_dir.join("bin").join("yt-dlp.exe");
        if local_bin.exists() {
            return Some(local_bin);
        }
    }
    if let Ok(res_dir) = app.path().resource_dir() {
        let bundled = res_dir.join("binaries").join("yt-dlp.exe");
        if bundled.exists() {
            return Some(bundled);
        }
    }
    // Check system PATH via `where yt-dlp`
    #[cfg(target_os = "windows")]
    {
        if let Ok(out) = std::process::Command::new("where").arg("yt-dlp").output() {
            if out.status.success() {
                if let Some(first) = String::from_utf8_lossy(&out.stdout).lines().next() {
                    let p = PathBuf::from(first.trim());
                    if p.exists() {
                        return Some(p);
                    }
                }
            }
        }
    }
    None
}

/// Layer 1: Ephemeral <=30s <=360p clip sample via yt-dlp -> FFmpeg 4-frame JPEG extract -> instant cleanup
async fn try_yt_dlp_frame_sampler(app: &AppHandle, canonical_url: &str) -> Option<Vec<String>> {
    let yt_dlp_bin = find_yt_dlp_executable(app)?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let temp_dir = std::env::temp_dir().join(format!("synkcut_ytref_{stamp}"));
    tokio::fs::create_dir_all(&temp_dir).await.ok()?;

    let out_template = temp_dir.join("clip.%(ext)s");
    let download_fut = tokio::process::Command::new(&yt_dlp_bin)
        .args([
            "--no-playlist",
            "--no-warnings",
            "--download-sections",
            "*00:00:00-00:00:30",
            "-f",
            "bv*[height<=360][ext=mp4]/b[height<=360]/worst[ext=mp4]/worst",
            "-o",
            out_template.to_string_lossy().as_ref(),
            canonical_url,
        ])
        .output();

    let downloaded_ok = match tokio::time::timeout(Duration::from_secs(26), download_fut).await {
        Ok(Ok(out)) => out.status.success(),
        _ => false,
    };

    let mut clip_file: Option<PathBuf> = None;
    if downloaded_ok {
        if let Ok(mut rd) = tokio::fs::read_dir(&temp_dir).await {
            while let Ok(Some(entry)) = rd.next_entry().await {
                let p = entry.path();
                if p.is_file() {
                    clip_file = Some(p);
                    break;
                }
            }
        }
    }

    let mut frames: Vec<String> = Vec::new();
    if let Some(clip_path) = clip_file {
        let clip_str = clip_path.to_string_lossy().to_string();
        for (i, ts) in [1.5_f64, 5.5, 11.0, 18.0].iter().enumerate() {
            let jpg_path = temp_dir.join(format!("f_{i}.jpg"));
            if let Ok(cmd) = app.shell().sidecar("ffmpeg") {
                if let Ok(out) = cmd
                    .args([
                        "-y",
                        "-ss",
                        &format!("{ts:.1}"),
                        "-i",
                        &clip_str,
                        "-frames:v",
                        "1",
                        "-vf",
                        "scale=360:-1",
                        "-q:v",
                        "5",
                        jpg_path.to_string_lossy().as_ref(),
                    ])
                    .output()
                    .await
                {
                    if out.status.success() {
                        if let Ok(bytes) = tokio::fs::read(&jpg_path).await {
                            if !bytes.is_empty() {
                                frames.push(format!(
                                    "data:image/jpeg;base64,{}",
                                    BASE64.encode(bytes)
                                ));
                            }
                        }
                    }
                }
            }
        }
    }

    // Ephemeral guarantee: ALWAYS remove downloaded reference clip immediately
    let _ = tokio::fs::remove_dir_all(&temp_dir).await;

    if frames.is_empty() {
        None
    } else {
        Some(frames)
    }
}

async fn fetch_youtube_oembed_and_thumb(
    canonical_url: &str,
    video_id: &str,
) -> (String, Option<String>) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
    {
        Ok(c) => c,
        Err(_) => return (format!("YouTube ({video_id})"), None),
    };

    let oembed_url = format!("https://www.youtube.com/oembed?url={canonical_url}&format=json");
    let mut title = format!("YouTube ({video_id})");
    if let Ok(res) = client.get(&oembed_url).send().await {
        if res.status().is_success() {
            if let Ok(val) = res.json::<Value>().await {
                if let Some(t) = val["title"].as_str().filter(|s| !s.trim().is_empty()) {
                    title = t.trim().to_string();
                }
            }
        }
    }

    let mut thumb_data_url: Option<String> = None;
    for thumb_url in [
        format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"),
        format!("https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"),
    ] {
        if let Ok(res) = client.get(&thumb_url).send().await {
            if res.status().is_success() {
                if let Ok(bytes) = res.bytes().await {
                    if !bytes.is_empty() {
                        thumb_data_url =
                            Some(format!("data:image/jpeg;base64,{}", BASE64.encode(bytes)));
                        break;
                    }
                }
            }
        }
    }

    (title, thumb_data_url)
}

#[tauri::command]
pub async fn extract_youtube_style_reference(
    app: AppHandle,
    url: String,
) -> Result<StyleReferenceResult, String> {
    let Some(video_id) = extract_youtube_video_id(&url) else {
        return Err(
            "Link belum valid. Gunakan link YouTube atau YouTube Shorts (mis. youtube.com/watch?v=... atau youtube.com/shorts/...)."
                .to_string(),
        );
    };

    let canonical_url = format!("https://www.youtube.com/watch?v={video_id}");
    let (title, oembed_thumb) = fetch_youtube_oembed_and_thumb(&canonical_url, &video_id).await;

    // Layer 1: Try yt-dlp ephemeral <=30s <=360p 4-frame sampler
    if let Some(frames) = try_yt_dlp_frame_sampler(&app, &canonical_url).await {
        let ai_dna = analyze_images_with_byok(&app, &title, &frames).await;
        return Ok(build_style_result(
            "youtube",
            Some(canonical_url),
            title,
            frames,
            ai_dna,
            "yt_dlp",
        ));
    }

    let fallback_thumbs: Vec<String> = oembed_thumb.into_iter().collect();

    // Layer 2: Try Gemini direct YouTube URL multimodal analysis
    if let Some(ai_dna) = analyze_youtube_via_gemini_direct(&app, &canonical_url, &title).await {
        return Ok(build_style_result(
            "youtube",
            Some(canonical_url),
            title,
            fallback_thumbs,
            Some(ai_dna),
            "gemini_direct",
        ));
    }

    // Layer 3: Guaranteed oEmbed + thumbnail analysis (Vision BYOK if configured, else smart local fallback)
    let ai_dna = if !fallback_thumbs.is_empty() {
        analyze_images_with_byok(&app, &title, &fallback_thumbs).await
    } else {
        None
    };

    Ok(build_style_result(
        "youtube",
        Some(canonical_url),
        title,
        fallback_thumbs,
        ai_dna,
        "oembed_thumbnail",
    ))
}

#[tauri::command]
pub async fn analyze_style_reference(
    app: AppHandle,
    req: AnalyzeStyleRequest,
) -> Result<StyleReferenceResult, String> {
    if req.thumbnails.is_empty() {
        return Err("Tambahkan minimal 1 gambar screenshot atau klip referensi terlebih dahulu.".to_string());
    }

    let safe_thumbs: Vec<String> = req.thumbnails.into_iter().take(4).collect();
    let title = req
        .title
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            if req.source_type == "local_video" {
                "Klip Referensi Lokal".to_string()
            } else {
                "Screenshot Referensi Gaya".to_string()
            }
        });

    let ai_dna = analyze_images_with_byok(&app, &title, &safe_thumbs).await;
    let layer = if ai_dna.is_some() {
        "vision_ai"
    } else {
        "local_fallback"
    };

    Ok(build_style_result(
        &req.source_type,
        req.url,
        title,
        safe_thumbs,
        ai_dna,
        layer,
    ))
}

fn build_style_result(
    source_type: &str,
    url: Option<String>,
    title: String,
    thumbnails: Vec<String>,
    ai_dna: Option<Value>,
    layer_used: &str,
) -> StyleReferenceResult {
    let (fb_summary, fb_theme, fb_caption, fb_accent, fb_engines) = fallback_style_dna(&title);

    if let Some(val) = ai_dna {
        let summary = val["styleDnaSummary"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .unwrap_or(fb_summary);
        StyleReferenceResult {
            source_type: source_type.to_string(),
            url,
            title,
            thumbnails,
            style_dna_summary: summary,
            suggested_theme: sanitize_theme(val["suggestedTheme"].as_str()),
            suggested_caption: sanitize_caption(val["suggestedCaption"].as_str()),
            suggested_accent: sanitize_accent(val["suggestedAccent"].as_str()),
            suggested_engines: sanitize_engines(val["suggestedEngines"].as_array()),
            layer_used: layer_used.to_string(),
        }
    } else {
        StyleReferenceResult {
            source_type: source_type.to_string(),
            url,
            title,
            thumbnails,
            style_dna_summary: fb_summary,
            suggested_theme: fb_theme,
            suggested_caption: fb_caption,
            suggested_accent: fb_accent,
            suggested_engines: fb_engines,
            layer_used: layer_used.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_youtube_video_id_formats() {
        assert_eq!(
            extract_youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(
            extract_youtube_video_id("https://youtu.be/abcDEF12345?si=xyz"),
            Some("abcDEF12345".to_string())
        );
        assert_eq!(
            extract_youtube_video_id("https://www.youtube.com/shorts/9bZkp7q19f0?feature=share"),
            Some("9bZkp7q19f0".to_string())
        );
        // Reject Instagram or non-YouTube URLs cleanly
        assert_eq!(
            extract_youtube_video_id("https://www.instagram.com/reel/Cxyz12345/"),
            None
        );
        assert_eq!(extract_youtube_video_id("not a url"), None);
    }

    #[test]
    fn test_build_style_result_fallback_and_sanitization() {
        let res = build_style_result(
            "youtube",
            Some("https://www.youtube.com/watch?v=abcDEF12345".to_string()),
            "Bedah Isi iPhone 3D Teardown".to_string(),
            vec![],
            None,
            "oembed_thumbnail",
        );
        assert_eq!(res.suggested_theme, "carbon");
        assert!(res.suggested_engines.contains(&"breakdown_3d".to_string()));
        assert_eq!(res.layer_used, "oembed_thumbnail");
    }
}
