use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::audio::{align_words_proportionally, synthesize_tts_with_fallback, WordTimestamp};
use crate::byok;
use crate::style_ref::sanitize_custom_design_value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateScriptRequest {
    pub topic: String,
    pub format: String,
    pub tone: String,
    pub target_duration_sec: u32,
    #[serde(default)]
    pub visual_mode: Option<String>, // "motion" | "footage" | "hybrid"
    #[serde(default)]
    pub style_reference_summary: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookOption {
    pub id: String,
    pub angle: String,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedScriptResponse {
    pub project_title: String,
    pub hooks: Vec<HookOption>,
    pub body_segments: Vec<String>,
    pub cta: String,
    pub provider_used: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FootageInputItem {
    pub path: String,
    pub file_name: String,
    pub duration_ms: u64,
    pub thumbnails: Vec<String>, // data:image/jpeg;base64,...
    #[serde(default)]
    pub frame_timestamps_ms: Vec<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssembleProjectRequest {
    pub project_title: String,
    pub format: String,
    pub hook_text: String,
    pub body_segments: Vec<String>,
    pub cta_text: String,
    #[serde(default)]
    pub raw_script: Option<String>,
    pub audio_path: Option<String>,
    pub audio_source: String,
    pub trim_silence: bool,
    pub duration_ms: u64,
    pub words: Vec<WordTimestamp>,
    pub footage: Vec<FootageInputItem>,
    pub caption_preset: String,
    pub accent_color: String,
    pub motion_preset: String,
    pub transition_preset: String,
    pub overlay_mode: String, // "auto" | "notification_banner" | "promo_badge" | "none"
    pub bgm_preset: String,
    pub auto_ducking: bool,
    pub auto_sfx: bool,
    #[serde(default)]
    pub visual_mode: Option<String>, // "motion" | "footage" | "hybrid"
    #[serde(default)]
    pub motion_theme: Option<String>, // "carbon" | "paper" | "coral" | "mint" | "blue"
    #[serde(default)]
    pub preferred_engines: Option<Vec<String>>,
    #[serde(default)]
    pub style_reference: Option<Value>,
    #[serde(default)]
    pub custom_design: Option<Value>,
    #[serde(default)]
    pub auto_generate_voiceover: Option<bool>,
    #[serde(default)]
    pub tts_engine: Option<String>,
    #[serde(default)]
    pub tts_voice: Option<String>,
    #[serde(default)]
    pub tts_tone: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotPatchResponse {
    pub project: Value,
    pub reply: String,
    pub provider_used: String,
}

pub fn strip_json_fences(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with("```") {
        let without_open = trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```JSON")
            .trim_start_matches("```");
        without_open.trim_end_matches("```").trim().to_string()
    } else {
        trimmed.to_string()
    }
}

/// Extract a valid JSON value even if an LLM wraps it in markdown fences or brief commentary.
pub fn parse_llm_json(raw: &str) -> Result<Value, String> {
    let cleaned = strip_json_fences(raw);
    if let Ok(val) = serde_json::from_str::<Value>(&cleaned) {
        return Ok(val);
    }
    if let (Some(start), Some(end)) = (cleaned.find('{'), cleaned.rfind('}')) {
        if end > start {
            if let Ok(val) = serde_json::from_str::<Value>(&cleaned[start..=end]) {
                return Ok(val);
            }
        }
    }
    Err(format!(
        "Output AI bukan JSON valid. Awal respons: {}",
        cleaned.chars().take(160).collect::<String>()
    ))
}

fn parse_data_url_mime_and_b64(data_url: &str) -> (&str, &str) {
    if let Some((header, b64)) = data_url.split_once(',') {
        let mime = header
            .strip_prefix("data:")
            .and_then(|rest| rest.split(';').next())
            .filter(|m| m.starts_with("image/"))
            .unwrap_or("image/jpeg");
        (mime, b64)
    } else {
        ("image/jpeg", data_url)
    }
}

fn extract_openai_message_text(val: &Value) -> Option<String> {
    let content = &val["choices"][0]["message"]["content"];
    if let Some(s) = content.as_str() {
        if !s.trim().is_empty() {
            return Some(s.to_string());
        }
    }
    if let Some(arr) = content.as_array() {
        let joined: String = arr
            .iter()
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n");
        if !joined.trim().is_empty() {
            return Some(joined);
        }
    }
    None
}

/// Calls Gemini / OpenAI / OpenRouter / Custom OpenAI-compatible model with optional base64
/// images, enforces JSON output, and automatically falls back when models return 404/503/429.
pub async fn call_llm_json(
    resolved: &byok::ResolvedProvider,
    system_prompt: &str,
    user_prompt: &str,
    image_data_urls: &[String],
) -> Result<(Value, String), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(55))
        .build()
        .map_err(|e| format!("Gagal membuat HTTP client: {e}"))?;

    let (raw_text, used_model): (String, String) = match resolved.provider.as_str() {
        "gemini" => {
            let mut parts: Vec<Value> = vec![json!({ "text": user_prompt })];
            for data_url in image_data_urls.iter().take(12) {
                let (mime, raw_b64) = parse_data_url_mime_and_b64(data_url);
                parts.push(json!({
                    "inlineData": {
                        "mimeType": mime,
                        "data": raw_b64
                    }
                }));
            }

            let payload = json!({
                "systemInstruction": { "parts": [{ "text": system_prompt }] },
                "contents": [{ "role": "user", "parts": parts }],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "temperature": 0.55
                }
            });

            let mut candidates: Vec<String> = vec![resolved.model.clone()];
            for fb in byok::GEMINI_FALLBACK_MODELS {
                if !candidates.iter().any(|c| c == fb) {
                    candidates.push(fb.to_string());
                }
            }

            let gemini_client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(32))
                .build()
                .map_err(|e| format!("Gagal membuat HTTP client: {e}"))?;

            let mut last_err = String::from("Gagal menghubungi Gemini API.");
            let mut success_result: Option<(String, String)> = None;

            for candidate in candidates {
                let url = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{candidate}:generateContent?key={}",
                    resolved.api_key
                );
                let res = match gemini_client.post(url).json(&payload).send().await {
                    Ok(r) => r,
                    Err(e) if e.is_timeout() => {
                        last_err = format!("Gemini model {candidate} timeout.");
                        continue;
                    }
                    Err(e) => return Err(format!("Gagal menghubungi Gemini API: {e}")),
                };

                let status = res.status().as_u16();
                if res.status().is_success() {
                    let val: Value = res.json().await.map_err(|e| e.to_string())?;
                    if let Some(txt) = val["candidates"][0]["content"]["parts"][0]["text"].as_str() {
                        success_result = Some((txt.to_string(), candidate));
                        break;
                    }
                    last_err = format!("Respons Gemini ({candidate}) kosong.");
                    continue;
                }

                let body_txt = res.text().await.unwrap_or_default();
                last_err = format!(
                    "Gemini API error (HTTP {status}, model {candidate}): {}",
                    body_txt.chars().take(220).collect::<String>()
                );

                let retryable = status == 404
                    || status == 503
                    || status == 429
                    || body_txt.contains("no longer available")
                    || body_txt.contains("is not found")
                    || body_txt.contains("high demand")
                    || body_txt.contains("JSON mode");

                if retryable {
                    continue;
                }

                return Err(last_err);
            }

            success_result.ok_or(last_err)?
        }
        "openai" | "openrouter" | "custom" => {
            let endpoint = match resolved.provider.as_str() {
                "openai" => "https://api.openai.com/v1/chat/completions".to_string(),
                "openrouter" => "https://openrouter.ai/api/v1/chat/completions".to_string(),
                "custom" => {
                    let raw = resolved.base_url.as_deref().unwrap_or("").trim();
                    if raw.is_empty() {
                        return Err("Base URL Custom Model belum diatur. Buka Pengaturan AI terlebih dahulu.".to_string());
                    }
                    byok::normalize_chat_completions_url(raw)
                }
                _ => unreachable!(),
            };

            let mut candidates: Vec<String> = vec![resolved.model.clone()];
            match resolved.provider.as_str() {
                "openai" => {
                    for fb in ["gpt-4.1-mini", "gpt-4o-mini"] {
                        if !candidates.iter().any(|c| c == fb) {
                            candidates.push(fb.to_string());
                        }
                    }
                }
                "openrouter" => {
                    for fb in ["google/gemini-3-flash-preview", "openai/gpt-4.1-mini", "openrouter/free"] {
                        if !candidates.iter().any(|c| c == fb) {
                            candidates.push(fb.to_string());
                        }
                    }
                }
                _ => {}
            }

            let mut last_err = format!("Gagal menghubungi {} API.", resolved.provider);
            let mut success_result: Option<(String, String)> = None;

            'model_loop: for candidate in candidates {
                let mut use_json_mode = true;
                let mut include_images = !image_data_urls.is_empty();

                for _attempt in 0..3 {
                    let user_message = if include_images {
                        let mut content: Vec<Value> = vec![json!({ "type": "text", "text": user_prompt })];
                        for data_url in image_data_urls.iter().take(8) {
                            content.push(json!({
                                "type": "image_url",
                                "image_url": { "url": data_url }
                            }));
                        }
                        json!({ "role": "user", "content": content })
                    } else {
                        json!({ "role": "user", "content": user_prompt })
                    };

                    let mut payload = json!({
                        "model": candidate,
                        "temperature": 0.55,
                        "messages": [
                            { "role": "system", "content": system_prompt },
                            user_message
                        ]
                    });
                    if use_json_mode {
                        payload["response_format"] = json!({ "type": "json_object" });
                    }

                    let mut req = client.post(&endpoint).json(&payload);
                    if !resolved.api_key.trim().is_empty() {
                        req = req.bearer_auth(&resolved.api_key);
                    }
                    if resolved.provider == "openrouter" {
                        req = req
                            .header("HTTP-Referer", "https://synkcut.app")
                            .header("X-Title", "Synkcut Studio");
                    }

                    let res = req.send().await.map_err(|e| {
                        format!("Gagal menghubungi {} API ({endpoint}): {e}", resolved.provider)
                    })?;

                    let status = res.status().as_u16();
                    if res.status().is_success() {
                        let val: Value = res.json().await.map_err(|e| e.to_string())?;
                        let txt = extract_openai_message_text(&val)
                            .ok_or_else(|| format!("Respons {} ({candidate}) kosong.", resolved.provider))?;
                        success_result = Some((txt, candidate));
                        break 'model_loop;
                    }

                    let body_txt = res.text().await.unwrap_or_default();
                    let lower_body = body_txt.to_lowercase();
                    last_err = format!(
                        "{} API error (HTTP {status}, model {candidate}): {}",
                        resolved.provider,
                        body_txt.chars().take(220).collect::<String>()
                    );

                    if (status == 400 || status == 422) && include_images && (lower_body.contains("image") || lower_body.contains("vision") || lower_body.contains("multimodal") || lower_body.contains("content")) {
                        include_images = false;
                        continue;
                    }
                    if (status == 400 || status == 422) && use_json_mode {
                        use_json_mode = false;
                        continue;
                    }
                    if status == 404 || status == 503 {
                        continue 'model_loop;
                    }
                    return Err(last_err);
                }
            }

            success_result.ok_or(last_err)?
        }
        _ => return Err(format!("Provider tidak didukung: {}", resolved.provider)),
    };

    let parsed = parse_llm_json(&raw_text)?;
    Ok((parsed, format!("{} · {}", resolved.provider, used_model)))
}

#[tauri::command]
pub async fn ai_generate_script(
    app: AppHandle,
    req: GenerateScriptRequest,
) -> Result<GeneratedScriptResponse, String> {
    if req.topic.trim().is_empty() {
        return Err("Isi topik atau detail produk terlebih dahulu.".to_string());
    }

    let resolved = byok::resolve_active_provider(&app)?;

    let body_count = match req.target_duration_sec {
        0..=20 => 1,
        21..=45 => 2,
        _ => 3,
    };

    let system_prompt = "Kamu adalah Creative Director & Copywriter video pendek (Reels, TikTok, Shorts) kelas dunia di Indonesia. \
        Tulis naskah yang tajam, spoken-word (enak diucapkan voiceover), langsung stop-scroll di 3 detik pertama, tanpa basa-basi klise. \
        Balas HANYA dalam JSON valid.";

    let visual_hint = match req.visual_mode.as_deref() {
        Some("motion") => "\n- Mode Visual: AI Motion Video (tanpa footage kamera — susun segmen agar tiap scene cocok divisualisasikan dengan diagram, grafik, kartu poin, kartun stick-figure, atau 3D breakdown).",
        Some("hybrid") => "\n- Mode Visual: Campur (gabungan footage lokal & AI Motion — buat segmen jelas mana penjelasan visual/data dan mana aksi/demo).",
        _ => "\n- Mode Visual: Footage Multi-Klip (tulis kalimat padat & visual yang cocok dipotong cepat antar klip B-roll/demo).",
    };
    let style_hint = req
        .style_reference_summary
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\n- Arahan Desain & Pacing Custom: {}", s.trim()))
        .unwrap_or_default();

    let user_prompt = format!(
        "Buatkan skrip video pendek Bahasa Indonesia untuk topik/produk ini:\n\
        - Topik/Produk: \"{}\"\n\
        - Format Konten: {}\n\
        - Gaya Bahasa: {}\n\
        - Target Durasi: {} detik (buat tepat {} segmen body){}{}\n\n\
        Balas dalam struktur JSON persis seperti ini:\n\
        {{\n\
          \"projectTitle\": \"Judul singkat maks 5 kata\",\n\
          \"hooks\": [\n\
            {{ \"id\": \"h1\", \"angle\": \"Pain Point\", \"text\": \"kalimat hook 1 (maks 14 kata)\" }},\n\
            {{ \"id\": \"h2\", \"angle\": \"Curiosity\", \"text\": \"kalimat hook 2 (maks 14 kata)\" }},\n\
            {{ \"id\": \"h3\", \"angle\": \"Bold Claim\", \"text\": \"kalimat hook 3 (maks 14 kata)\" }}\n\
          ],\n\
          \"bodySegments\": [\"segmen body 1\", \"...\"],\n\
          \"cta\": \"kalimat penutup / CTA kuat (maks 14 kata)\"\n\
        }}",
        req.topic.trim(),
        req.format,
        req.tone,
        req.target_duration_sec,
        body_count,
        visual_hint,
        style_hint
    );

    let (val, provider_used) = call_llm_json(&resolved, system_prompt, &user_prompt, &[]).await?;

    let project_title = val["projectTitle"]
        .as_str()
        .unwrap_or("Konten Baru Synkcut")
        .trim()
        .to_string();

    let mut hooks: Vec<HookOption> = Vec::new();
    if let Some(arr) = val["hooks"].as_array() {
        for (i, h) in arr.iter().take(3).enumerate() {
            hooks.push(HookOption {
                id: h["id"]
                    .as_str()
                    .map(ToString::to_string)
                    .unwrap_or_else(|| format!("h{}", i + 1)),
                angle: h["angle"].as_str().unwrap_or("Hook").to_string(),
                text: h["text"].as_str().unwrap_or("").trim().to_string(),
            });
        }
    }
    if hooks.is_empty() {
        return Err("AI tidak mengembalikan opsi Hook. Coba generate ulang.".to_string());
    }

    let body_segments: Vec<String> = val["bodySegments"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_else(|| vec!["Tunjukkan keunggulan utama produk secara langsung.".to_string()]);

    let cta = val["cta"]
        .as_str()
        .unwrap_or("Cek link sekarang sebelum promo berakhir!")
        .trim()
        .to_string();

    Ok(GeneratedScriptResponse {
        project_title,
        hooks,
        body_segments,
        cta,
        provider_used,
    })
}

/// Split a full raw video script cleanly into dynamic spoken-word visual cuts
/// (~6–14 words per cut along sentence/line/clause boundaries) while keeping 100% of user's text!
pub fn segment_raw_script_into_cuts(raw_script: &str) -> Vec<(String, String)> {
    let cleaned = raw_script.trim();
    if cleaned.is_empty() {
        return Vec::new();
    }

    // 1. Split by newlines and sentence terminators (. ! ? ;)
    let mut sentences: Vec<String> = Vec::new();
    let mut current = String::new();
    for ch in cleaned.chars() {
        if ch == '\n' || ch == '\r' {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                sentences.push(trimmed.to_string());
            }
            current.clear();
            continue;
        }
        current.push(ch);
        if matches!(ch, '.' | '!' | '?' | ';') {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                sentences.push(trimmed.to_string());
            }
            current.clear();
        }
    }
    if !current.trim().is_empty() {
        sentences.push(current.trim().to_string());
    }

    // 2. Subdivide overly long sentences (>16 words) cleanly on commas or midpoints
    let mut raw_cuts: Vec<String> = Vec::new();
    for sent in sentences {
        let word_count = sent.split_whitespace().count();
        if word_count <= 16 {
            raw_cuts.push(sent);
            continue;
        }
        // Try splitting by comma first
        let comma_parts: Vec<&str> = sent.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
        if comma_parts.len() > 1 {
            let mut buf = String::new();
            for (idx, part) in comma_parts.iter().enumerate() {
                let candidate = if buf.is_empty() {
                    part.to_string()
                } else {
                    format!("{buf}, {part}")
                };
                if candidate.split_whitespace().count() > 13 && !buf.is_empty() {
                    raw_cuts.push(format!("{buf},"));
                    buf = part.to_string();
                } else {
                    buf = candidate;
                }
                if idx == comma_parts.len() - 1 && !buf.is_empty() {
                    raw_cuts.push(buf.clone());
                    buf.clear();
                }
            }
        } else {
            // Split evenly into ~10-word visual beats
            let words: Vec<&str> = sent.split_whitespace().collect();
            for chunk in words.chunks(10) {
                raw_cuts.push(chunk.join(" "));
            }
        }
    }

    // 3. Merge tiny fragments (<4 words) with neighbors if we already have >= 3 cuts
    let mut cuts: Vec<String> = Vec::new();
    for part in raw_cuts {
        if let Some(last) = cuts.last_mut() {
            let last_wc = last.split_whitespace().count();
            let cur_wc = part.split_whitespace().count();
            if (cur_wc <= 3 || last_wc <= 3) && last_wc + cur_wc <= 14 {
                last.push(' ');
                last.push_str(&part);
                continue;
            }
        }
        cuts.push(part);
    }

    // Cap at 16 cuts max by merging adjacent shortest beats if needed
    while cuts.len() > 16 {
        let mut best_idx = 0;
        let mut best_sum = usize::MAX;
        for i in 0..cuts.len() - 1 {
            let sum = cuts[i].split_whitespace().count() + cuts[i + 1].split_whitespace().count();
            if sum < best_sum {
                best_sum = sum;
                best_idx = i;
            }
        }
        let next = cuts.remove(best_idx + 1);
        cuts[best_idx].push(' ');
        cuts[best_idx].push_str(&next);
    }

    let total = cuts.len();
    cuts.into_iter()
        .enumerate()
        .map(|(i, text)| {
            let role = if i == 0 {
                "hook"
            } else if total >= 3 && i == total - 1 {
                "cta"
            } else {
                "body"
            };
            (role.to_string(), text)
        })
        .collect()
}

/// Partition total duration across ordered segments based on real word timestamps or word counts
fn compute_scene_timings(
    segments: &[(String, String)], // (role, text)
    total_duration_ms: u64,
    words: &[WordTimestamp],
) -> Vec<(u64, u64)> {
    let safe_total = total_duration_ms.max(3000);
    let counts: Vec<usize> = segments
        .iter()
        .map(|(_, t)| t.split_whitespace().count().max(1))
        .collect();
    let total_words: usize = counts.iter().sum::<usize>().max(1);

    let mut ranges: Vec<(u64, u64)> = Vec::with_capacity(segments.len());

    if !words.is_empty() && words.len() >= segments.len() {
        let mut word_idx = 0usize;
        for (i, count) in counts.iter().enumerate() {
            let start_ms = if i == 0 { 0 } else { ranges[i - 1usize].1 };

            let proportional_words =
                ((*count as f64 / total_words as f64) * words.len() as f64).round() as usize;
            let next_idx = if i == counts.len() - 1 {
                words.len()
            } else {
                (word_idx + proportional_words.max(1)).min(words.len() - (counts.len() - 1 - i))
            };

            let end_ms = if i == counts.len() - 1 {
                safe_total
            } else {
                words
                    .get(next_idx.saturating_sub(1))
                    .map(|w| w.end_ms)
                    .unwrap_or(start_ms + 1500)
                    .max(start_ms + 800)
                    .min(safe_total.saturating_sub(400))
            };

            ranges.push((start_ms, end_ms));
            word_idx = next_idx;
        }
        return ranges;
    }

    let mut cursor = 0u64;
    for (i, count) in counts.iter().enumerate() {
        let span = ((count * safe_total as usize) / total_words).max(900) as u64;
        let end = if i == counts.len() - 1 {
            safe_total
        } else {
            (cursor + span).min(safe_total.saturating_sub(800))
        };
        ranges.push((cursor, end));
        cursor = end;
    }
    ranges
}

fn default_breakdown_3d_parts(preset_id: &str) -> Value {
    match preset_id {
        "laptop" => json!([
            { "name": "Retina Display", "shape": "slab", "size": [146, 2.6, 98], "pos": [0, 11.8, 0], "radius": 6, "material": "screen", "level": 4 },
            { "name": "Unibody Chassis", "shape": "frame", "size": [150, 6.8, 102], "pos": [0, 4.4, 0], "radius": 7, "wall": 6.5, "material": "aluminum", "color": "#cbd5e1", "level": 3 },
            { "name": "Mainboard & SoC", "shape": "slab", "size": [130, 2.2, 46], "pos": [0, 5.6, -22], "radius": 3, "material": "pcb", "level": 2 },
            { "name": "Cooling Blower", "shape": "ring", "size": [40, 4.0, 40], "pos": [34, 4.0, -20], "radius": 20, "inner": 13, "material": "steel", "color": "#64748b", "level": 1 },
            { "name": "Battery 70Wh", "shape": "slab", "size": [126, 4.6, 42], "pos": [0, 1.0, 22], "radius": 4, "material": "battery", "text": "70 Wh|6-Cell Pack", "level": 0 }
        ]),
        "earbuds" => json!([
            { "name": "Silicone Ear Tip", "shape": "torus", "size": [22, 6.5, 22], "pos": [0, 23, 0], "radius": 11, "material": "rubber", "color": "#e2e8f0", "level": 4 },
            { "name": "Acoustic Shell", "shape": "capsule", "size": [20, 16, 20], "pos": [0, 12, 0], "material": "ceramic", "color": "#f8fafc", "level": 3 },
            { "name": "11mm Copper Driver", "shape": "cylinder", "size": [16, 3.0, 16], "pos": [0, 9.5, 0], "radius": 8, "material": "coil", "level": 2 },
            { "name": "ANC Audio PCB", "shape": "cylinder", "size": [15, 2.0, 15], "pos": [0, 6.0, 0], "radius": 7.5, "material": "pcb", "level": 1 },
            { "name": "Micro Lithium Cell", "shape": "cylinder", "size": [12, 8.0, 12], "pos": [0, 0, 0], "radius": 6, "material": "gold", "level": 0 }
        ]),
        "smartwatch" => json!([
            { "name": "Sapphire Glass", "shape": "slab", "size": [42, 2.0, 48], "pos": [0, 11.4, 0], "radius": 11, "material": "glass", "color": "#e0f2fe", "level": 4 },
            { "name": "AMOLED Display", "shape": "slab", "size": [38, 1.6, 44], "pos": [0, 9.5, 0], "radius": 9, "material": "screen", "level": 3 },
            { "name": "Titanium Case", "shape": "frame", "size": [44, 8.2, 50], "pos": [0, 2.2, 0], "radius": 12, "wall": 4.2, "material": "aluminum", "color": "#a8a29e", "level": 2 },
            { "name": "SiP Chip Board", "shape": "slab", "size": [32, 2.0, 34], "pos": [0, 5.0, 0], "radius": 5, "material": "pcb", "level": 1 },
            { "name": "Heart Rate Sensor", "shape": "lens", "size": [24, 3.6, 24], "pos": [0, 0, 0], "radius": 11, "material": "lens", "level": 0 }
        ]),
        _ => json!([
            { "name": "Cover Glass", "shape": "slab", "size": [72, 1.4, 148], "pos": [0, 8.6, 0], "radius": 10, "material": "glass", "level": 5 },
            { "name": "OLED Display", "shape": "slab", "size": [69, 1.8, 144], "pos": [0, 6.6, 0], "radius": 9, "material": "screen", "level": 4 },
            { "name": "Titanium Frame", "shape": "frame", "size": [74, 5.6, 150], "pos": [0, 1.6, 0], "radius": 11, "wall": 3.6, "material": "aluminum", "level": 3 },
            { "name": "Logic Board SoC", "shape": "slab", "size": [60, 1.8, 56], "pos": [0, 3.8, -36], "radius": 4, "material": "pcb", "level": 2 },
            { "name": "Li-ion 5000mAh", "shape": "slab", "size": [56, 4.0, 76], "pos": [0, 2.0, 22], "radius": 4, "material": "battery", "text": "5000 mAh|Li-ion", "level": 1 },
            { "name": "MagSafe Coil", "shape": "cylinder", "size": [50, 1.4, 50], "pos": [0, 0.2, 10], "radius": 25, "material": "coil", "level": 0 }
        ]),
    }
}

/// Sanitize any LLM-produced `aiMotion` JSON so frontend renderers NEVER crash on missing fields!
pub fn sanitize_ai_motion_value(raw: &Value, fallback_text: &str, default_theme: &str) -> Value {
    let eng = raw["engine"]
        .as_str()
        .filter(|e| {
            matches!(
                *e,
                "flow_diagram" | "motion_chart" | "tech_cards" | "stick_figure" | "breakdown_3d"
            )
        })
        .unwrap_or("flow_diagram");

    let theme = raw["theme"]
        .as_str()
        .filter(|t| matches!(*t, "carbon" | "paper" | "coral" | "mint" | "blue"))
        .unwrap_or(default_theme);

    let short_seed: String = fallback_text
        .split_whitespace()
        .take(5)
        .collect::<Vec<_>>()
        .join(" ");
    let title = raw["title"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            if short_seed.is_empty() {
                "AI Motion".to_string()
            } else {
                short_seed
            }
        });
    let subtitle = raw["subtitle"].as_str().unwrap_or("").to_string();
    let takeaway = raw["takeaway"].as_str().unwrap_or("").to_string();

    match eng {
        "motion_chart" => {
            let c = raw.get("chart").filter(|v| v.is_object());
            let chart_type = c
                .and_then(|v| v["chartType"].as_str())
                .filter(|s| matches!(*s, "bar" | "line" | "stat_counter"))
                .unwrap_or("bar");
            let mut data_items: Vec<Value> = Vec::new();
            if let Some(arr) = c
                .and_then(|v| v["data"].as_array().or_else(|| v["items"].as_array()))
            {
                for (i, item) in arr.iter().take(8).enumerate() {
                    let lbl = item["label"]
                        .as_str()
                        .or_else(|| item["name"].as_str())
                        .or_else(|| item["category"].as_str())
                        .unwrap_or("")
                        .trim();
                    let safe_lbl = if lbl.is_empty() {
                        format!("Item {}", i + 1)
                    } else {
                        lbl.to_string()
                    };
                    let val_num = item["value"]
                        .as_f64()
                        .or_else(|| item["y"].as_f64())
                        .or_else(|| {
                            item["value"]
                                .as_str()
                                .and_then(|s| s.replace(|ch: char| !ch.is_ascii_digit() && ch != '.', "").parse::<f64>().ok())
                        })
                        .unwrap_or(50.0);
                    data_items.push(json!({ "label": safe_lbl, "value": val_num }));
                }
            }
            if data_items.is_empty() {
                data_items = vec![
                    json!({ "label": "Sebelum", "value": 35 }),
                    json!({ "label": "Tahap 1", "value": 68 }),
                    json!({ "label": "Optimal", "value": 95 }),
                ];
            }
            let callout = c
                .and_then(|v| v["callout"].as_str())
                .unwrap_or("auto");
            json!({
                "engine": "motion_chart",
                "theme": theme,
                "title": title,
                "subtitle": subtitle,
                "takeaway": takeaway,
                "chart": {
                    "chartType": chart_type,
                    "data": data_items,
                    "prefix": c.and_then(|v| v["prefix"].as_str()).unwrap_or(""),
                    "suffix": c.and_then(|v| v["suffix"].as_str()).unwrap_or("%"),
                    "callout": callout,
                    "goodDirection": if c.and_then(|v| v["goodDirection"].as_str()) == Some("down") { "down" } else { "up" },
                    "highlightIndex": c.and_then(|v| v["highlightIndex"].as_u64()).unwrap_or((data_items.len().saturating_sub(1)) as u64)
                }
            })
        }
        "tech_cards" => {
            let tc = raw.get("techCards").filter(|v| v.is_object());
            let layout = tc
                .and_then(|v| v["layout"].as_str())
                .filter(|s| matches!(*s, "staggered_steps" | "terminal_code" | "comparison_split"))
                .unwrap_or("staggered_steps");
            let mut cards: Vec<Value> = Vec::new();
            if let Some(arr) = tc.and_then(|v| v["cards"].as_array()) {
                for (i, item) in arr.iter().take(4).enumerate() {
                    cards.push(json!({
                        "badge": item["badge"].as_str().unwrap_or(&format!("0{}", i + 1)),
                        "title": item["title"].as_str().or_else(|| item["label"].as_str()).unwrap_or(&format!("Poin {}", i + 1)),
                        "detail": item["detail"].as_str().or_else(|| item["description"].as_str()).unwrap_or("")
                    }));
                }
            }
            if cards.is_empty() {
                cards = vec![
                    json!({ "badge": "01", "title": "Poin Inti Pertama", "detail": "Fokus langsung ke solusi utama." }),
                    json!({ "badge": "02", "title": "Bukti Visual", "detail": "Sajikan data atau contoh nyata." }),
                    json!({ "badge": "03", "title": "Langkah Aksi", "detail": "Mudah langsung dipraktikkan." }),
                ];
            }
            let code_lines: Vec<String> = tc
                .and_then(|v| v["codeLines"].as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(ToString::to_string))
                        .collect()
                })
                .filter(|v: &Vec<String>| !v.is_empty())
                .unwrap_or_else(|| vec!["// Synkcut AI Motion".to_string(), "const ready = true;".to_string()]);
            json!({
                "engine": "tech_cards",
                "theme": theme,
                "title": title,
                "subtitle": subtitle,
                "takeaway": takeaway,
                "techCards": {
                    "layout": layout,
                    "cards": cards,
                    "codeTitle": tc.and_then(|v| v["codeTitle"].as_str()).unwrap_or("app.ts"),
                    "codeLines": code_lines,
                    "highlightLine": tc.and_then(|v| v["highlightLine"].as_u64()).unwrap_or(0),
                    "leftTitle": tc.and_then(|v| v["leftTitle"].as_str()).unwrap_or("Sebelum"),
                    "leftItems": tc.and_then(|v| v["leftItems"].as_array()).cloned().unwrap_or_else(|| vec![json!("Manual & lama")]),
                    "rightTitle": tc.and_then(|v| v["rightTitle"].as_str()).unwrap_or("Sesudah"),
                    "rightItems": tc.and_then(|v| v["rightItems"].as_array()).cloned().unwrap_or_else(|| vec![json!("Otomatis & cepat")])
                }
            })
        }
        "stick_figure" => {
            let sf = raw.get("stickFigure").filter(|v| v.is_object());
            let setting = sf
                .and_then(|v| v["setting"].as_str())
                .filter(|s| matches!(*s, "room" | "office" | "street" | "classroom" | "plain"))
                .unwrap_or("office");
            let mut figures: Vec<Value> = sf
                .and_then(|v| v["figures"].as_array())
                .map(|arr| {
                    arr.iter()
                        .take(3)
                        .enumerate()
                        .map(|(i, f)| {
                            json!({
                                "id": f["id"].as_str().unwrap_or(&format!("f{i}")),
                                "kind": match f["kind"].as_str().unwrap_or("person") {
                                    "cat" | "dog" => f["kind"].as_str().unwrap(),
                                    _ => "person"
                                },
                                "x": f["x"].as_f64().unwrap_or(if i == 0 { 0.28 } else { 0.72 }).clamp(0.14, 0.86),
                                "label": f["label"].as_str().unwrap_or(&format!("Karakter {}", i + 1)),
                                "facing": f["facing"].as_str().unwrap_or(if i == 0 { "right" } else { "left" }),
                                "color": f["color"].as_str().unwrap_or("#38bdf8")
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            if figures.is_empty() {
                figures = vec![
                    json!({ "id": "a", "kind": "person", "x": 0.26, "label": "Kamu", "facing": "right", "color": "#38bdf8" }),
                    json!({ "id": "b", "kind": "person", "x": 0.74, "label": "Sistem", "facing": "left", "color": "#10b981" }),
                ];
            }
            let first_id = figures[0]["id"].as_str().unwrap_or("a").to_string();
            let mut beats: Vec<Value> = sf
                .and_then(|v| v["beats"].as_array())
                .map(|arr| {
                    arr.iter()
                        .take(6)
                        .enumerate()
                        .map(|(i, b)| {
                            json!({
                                "who": b["who"].as_str().unwrap_or(&first_id),
                                "action": b["action"].as_str().unwrap_or("talk"),
                                "atSec": b["atSec"].as_f64().unwrap_or((i as f64) * 0.9).max(0.0),
                                "durationSec": b["durationSec"].as_f64().unwrap_or(1.4).max(0.4),
                                "say": b["say"].as_str().unwrap_or("")
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            if beats.is_empty() {
                beats = vec![
                    json!({ "who": first_id, "action": "talk", "atSec": 0.0, "durationSec": 1.6, "say": "Lihat alurnya!" }),
                ];
            }
            json!({
                "engine": "stick_figure",
                "theme": theme,
                "title": title,
                "subtitle": subtitle,
                "takeaway": takeaway,
                "stickFigure": {
                    "setting": setting,
                    "figures": figures,
                    "props": sf.and_then(|v| v["props"].as_array()).cloned().unwrap_or_else(|| vec![json!({ "type": "desk", "x": 0.25 })]),
                    "beats": beats,
                    "arrow": sf.and_then(|v| v.get("arrow")).cloned().unwrap_or(Value::Null)
                }
            })
        }
        "breakdown_3d" => {
            let b3 = raw.get("breakdown3d").filter(|v| v.is_object());
            let preset_id = b3
                .and_then(|v| v["presetId"].as_str())
                .filter(|s| matches!(*s, "smartphone" | "laptop" | "earbuds" | "smartwatch" | "custom"))
                .unwrap_or("smartphone");
            let parts = b3
                .and_then(|v| v["parts"].as_array())
                .filter(|arr| !arr.is_empty())
                .cloned()
                .map(Value::Array)
                .unwrap_or_else(|| default_breakdown_3d_parts(preset_id));
            json!({
                "engine": "breakdown_3d",
                "theme": theme,
                "title": title,
                "subtitle": subtitle,
                "takeaway": takeaway,
                "breakdown3d": {
                    "presetId": preset_id,
                    "axis": b3.and_then(|v| v["axis"].as_str()).filter(|a| matches!(*a, "x" | "y" | "z")).unwrap_or("y"),
                    "spin": b3.and_then(|v| v["spin"].as_f64()).unwrap_or(0.72),
                    "spinSpeed": b3.and_then(|v| v["spinSpeed"].as_f64()).unwrap_or(0.14),
                    "parts": parts
                }
            })
        }
        _ => {
            let fl = raw.get("flow").filter(|v| v.is_object());
            let pattern = fl
                .and_then(|v| v["pattern"].as_str())
                .filter(|s| matches!(*s, "flow" | "spread" | "cycle" | "converge" | "compare"))
                .unwrap_or("flow");
            let steps: Vec<String> = fl
                .and_then(|v| v["steps"].as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| {
                            item.as_str()
                                .or_else(|| item["label"].as_str())
                                .or_else(|| item["title"].as_str())
                                .map(|s| s.trim().to_string())
                        })
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .filter(|v: &Vec<String>| !v.is_empty())
                .unwrap_or_else(|| {
                    vec![
                        "Masukan".to_string(),
                        "Proses Inti".to_string(),
                        "Validasi".to_string(),
                        "Hasil Akhir".to_string(),
                    ]
                });
            let mut flow_obj = json!({
                "pattern": pattern,
                "steps": steps,
                "branches": fl.and_then(|v| v["branches"].as_u64()).unwrap_or(3).clamp(2, 4),
                "depth": fl.and_then(|v| v["depth"].as_u64()).unwrap_or(3).clamp(2, 4),
                "center": fl.and_then(|v| v["center"].as_str()).unwrap_or("Hasil"),
                "direction": if fl.and_then(|v| v["direction"].as_str()) == Some("out") { "out" } else { "in" }
            });
            if let Some(sources) = fl.and_then(|v| v["sources"].as_array()) {
                flow_obj["sources"] = Value::Array(sources.clone());
            }
            if let Some(groups) = fl.and_then(|v| v["groups"].as_array()) {
                flow_obj["groups"] = Value::Array(groups.clone());
            }
            json!({
                "engine": "flow_diagram",
                "theme": theme,
                "title": title,
                "subtitle": subtitle,
                "takeaway": takeaway,
                "flow": flow_obj
            })
        }
    }
}

/// Build a clean, deterministic v1.1 `AiMotionSpec` fallback tailored to scene text, index, theme, and preferred engines.
fn build_fallback_ai_motion(
    role: &str,
    scene_idx: usize,
    text: &str,
    project_title: &str,
    theme: &str,
    preferred_engines: &[String],
) -> Value {
    let lower = text.to_lowercase();
    let short_title: String = text
        .split_whitespace()
        .take(5)
        .collect::<Vec<_>>()
        .join(" ");
    let title = if short_title.is_empty() {
        project_title.to_string()
    } else {
        short_title
    };

    let picked_engine = if lower.contains("3d")
        || lower.contains("bedah")
        || lower.contains("smartphone")
        || lower.contains("laptop")
        || lower.contains("komponen")
        || lower.contains("lapisan")
    {
        "breakdown_3d"
    } else if lower.contains('%')
        || lower.contains("persen")
        || lower.contains("angka")
        || lower.contains("grafik")
        || lower.contains("naik")
        || lower.contains("turun")
        || lower.contains("detik")
        || lower.contains("ms")
    {
        "motion_chart"
    } else if lower.contains("analogi")
        || lower.contains("cerita")
        || lower.contains("ibarat")
        || lower.contains("bayangin")
        || lower.contains("seperti")
    {
        "stick_figure"
    } else if lower.contains("kode")
        || lower.contains("terminal")
        || lower.contains("langkah")
        || lower.contains("tips")
        || lower.contains("banding")
        || role == "cta"
    {
        "tech_cards"
    } else if !preferred_engines.is_empty() {
        preferred_engines[scene_idx % preferred_engines.len()].as_str()
    } else {
        match scene_idx % 4 {
            0 => "flow_diagram",
            1 => "motion_chart",
            2 => "tech_cards",
            _ => "stick_figure",
        }
    };

    sanitize_ai_motion_value(
        &json!({
            "engine": picked_engine,
            "theme": if picked_engine == "stick_figure" && theme == "carbon" { "paper" } else { theme },
            "title": title,
            "subtitle": project_title
        }),
        text,
        theme,
    )
}

#[tauri::command]
pub async fn ai_assemble_project(
    app: AppHandle,
    req: AssembleProjectRequest,
) -> Result<Value, String> {
    let visual_mode = req.visual_mode.as_deref().unwrap_or("footage");

    // Strict validation for Footage mode: script + at least 1 footage clip!
    let raw_script_trimmed = req.raw_script.as_deref().unwrap_or("").trim();
    let mut segments: Vec<(String, String)> = if !raw_script_trimmed.is_empty() {
        segment_raw_script_into_cuts(raw_script_trimmed)
    } else {
        let mut segs = Vec::new();
        if !req.hook_text.trim().is_empty() {
            segs.push(("hook".to_string(), req.hook_text.trim().to_string()));
        }
        for body in &req.body_segments {
            if !body.trim().is_empty() {
                segs.push(("body".to_string(), body.trim().to_string()));
            }
        }
        if !req.cta_text.trim().is_empty() {
            segs.push(("cta".to_string(), req.cta_text.trim().to_string()));
        }
        segs
    };

    if segments.is_empty() {
        return Err("Script video wajib diisi sebelum meracik video.".to_string());
    }
    if visual_mode == "footage" && req.footage.is_empty() {
        return Err("Mode Footage wajib melampirkan minimal 1 video footage lokal.".to_string());
    }

    // If user uploaded multiple footage clips and only had 1-2 long segments, split longer segments so multi-clip cuts shine!
    if visual_mode == "footage" && req.footage.len() > 1 && segments.len() < req.footage.len() {
        let combined = segments
            .iter()
            .map(|(_, t)| t.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let split_more = segment_raw_script_into_cuts(&combined);
        if split_more.len() > segments.len() {
            segments = split_more;
        }
    }

    let full_text = segments
        .iter()
        .map(|(_, t)| t.as_str())
        .collect::<Vec<_>>()
        .join(" ");

    // Auto-generate real Voiceover TTS when missing (guaranteed ON by default for footage mode or when requested!)
    let mut final_audio_path = req.audio_path.clone().filter(|p| !p.trim().is_empty());
    let mut final_audio_source = req.audio_source.clone();
    let mut measured_duration_ms = req.duration_ms;
    let mut final_words = req.words.clone();

    let should_auto_tts = final_audio_path.is_none()
        && req
            .auto_generate_voiceover
            .unwrap_or(visual_mode == "footage");

    if should_auto_tts {
        let tts_engine = req.tts_engine.as_deref().unwrap_or("auto");
        let tts_voice = req.tts_voice.as_deref().unwrap_or("Kore");
        let tts_tone = req.tts_tone.as_deref().unwrap_or("santai");
        if let Ok(audio_res) = synthesize_tts_with_fallback(
            &app,
            &full_text,
            tts_voice,
            tts_tone,
            tts_engine,
            true,
        )
        .await
        {
            final_audio_path = Some(audio_res.audio_path);
            final_audio_source = "tts".to_string();
            measured_duration_ms = audio_res.duration_ms;
            if !audio_res.words.is_empty() {
                final_words = audio_res.words;
            }
        }
    }

    let total_duration_ms = if measured_duration_ms >= 2000 {
        measured_duration_ms
    } else {
        ((full_text.split_whitespace().count() as u64) * 390).max(7500)
    };

    if final_words.is_empty() {
        final_words = align_words_proportionally(&full_text, total_duration_ms);
    }

    let timings = compute_scene_timings(&segments, total_duration_ms, &final_words);

    // Resolve Custom Design Direction (from explicit customDesign OR styleReference.customDesign)
    let raw_custom_design = req.custom_design.as_ref().or_else(|| {
        req.style_reference
            .as_ref()
            .and_then(|sr| sr.get("customDesign"))
            .filter(|v| v.is_object())
    });
    let sanitized_custom_design = raw_custom_design.map(|cd| {
        sanitize_custom_design_value(cd, &req.project_title, &[])
    });

    let effective_accent = sanitized_custom_design
        .as_ref()
        .map(|d| d.palette.accent_primary.clone())
        .unwrap_or_else(|| req.accent_color.clone());

    let effective_motion_default = sanitized_custom_design
        .as_ref()
        .map(|d| d.preferred_motion.clone())
        .unwrap_or_else(|| req.motion_preset.clone());

    let effective_transition_default = sanitized_custom_design
        .as_ref()
        .map(|d| d.preferred_transition.clone())
        .unwrap_or_else(|| req.transition_preset.clone());

    let motion_theme = match req.motion_theme.as_deref() {
        Some("carbon" | "paper" | "coral" | "mint" | "blue") => req.motion_theme.as_deref().unwrap(),
        _ => {
            if sanitized_custom_design.as_ref().map(|d| d.is_light).unwrap_or(false) {
                "paper"
            } else {
                "carbon"
            }
        }
    };

    let preferred_engines = req
        .preferred_engines
        .clone()
        .filter(|e| !e.is_empty())
        .or_else(|| {
            sanitized_custom_design
                .as_ref()
                .map(|d| d.preferred_engines.clone())
        })
        .unwrap_or_default();

    // Ask Multimodal AI Director to match timestamped footage frames AND/OR author native AI Motion specs
    let mut ai_scene_decisions: Vec<Value> = Vec::new();
    if let Ok(resolved) = byok::resolve_active_provider(&app) {
        let mut all_thumbs: Vec<String> = Vec::new();
        let mut footage_desc = String::new();
        let max_per_clip = if req.footage.len() <= 2 {
            4
        } else if req.footage.len() <= 4 {
            3
        } else {
            2
        };

        for (idx, clip) in req.footage.iter().enumerate() {
            let take_n = clip.thumbnails.len().min(max_per_clip);
            let mut ts_list: Vec<String> = Vec::new();
            for t_i in 0..take_n {
                if all_thumbs.len() < 12 {
                    all_thumbs.push(clip.thumbnails[t_i].clone());
                    let ts_ms = clip
                        .frame_timestamps_ms
                        .get(t_i)
                        .copied()
                        .unwrap_or_else(|| {
                            ((t_i as f64 + 0.5) / (take_n.max(1) as f64) * clip.duration_ms as f64)
                                .round() as u64
                        });
                    ts_list.push(format!("{}ms", ts_ms));
                }
            }
            footage_desc.push_str(&format!(
                "- Klip #{idx}: nama=\"{}\", durasi={}ms, sampel frame pada [{}]\n",
                clip.file_name,
                clip.duration_ms,
                ts_list.join(", ")
            ));
        }

        let style_dna = sanitized_custom_design
            .as_ref()
            .map(|d| format!("{} — {}", d.name, d.art_direction_notes))
            .or_else(|| {
                req.style_reference
                    .as_ref()
                    .and_then(|sr| sr["styleDnaSummary"].as_str())
                    .map(ToString::to_string)
            })
            .unwrap_or_default();

        if let Some(ref_thumbs) = req
            .style_reference
            .as_ref()
            .and_then(|sr| sr["thumbnails"].as_array())
        {
            for t in ref_thumbs.iter().take(2) {
                if let Some(s) = t.as_str() {
                    if all_thumbs.len() < 12 {
                        all_thumbs.push(s.to_string());
                    }
                }
            }
        }

        let seg_desc: String = segments
            .iter()
            .enumerate()
            .map(|(i, (role, txt))| {
                let (s, e) = timings[i];
                format!("- Scene #{i} ({role}, {s}–{e}ms, durasi={}ms): \"{txt}\"", e.saturating_sub(s))
            })
            .collect::<Vec<_>>()
            .join("\n");

        let system_prompt = "Kamu adalah Multimodal Video Editor & AI Motion Director untuk Synkcut. \
            Untuk mode 'footage', WAJIB buat rangkaian cut video otomatis yang menyatu jadi 1 video utuh dari footage yang tersedia: \
            pilih footageIndex yang paling relevan dengan teks scene, manfaatkan SEMUA klip secara bervariasi, dan pilih trimStartMs (dalam milidetik) yang paling menarik serta AMAN (trimStartMs + durasiScene <= durasiKlip). \
            Untuk mode 'motion', semua scene pakai visualSource='motion' dengan objek aiMotion lengkap. \
            Untuk mode 'hybrid', campurkan visualSource='footage' dan 'motion'. \
            Engine aiMotion valid: flow_diagram, motion_chart, tech_cards, stick_figure, breakdown_3d. \
            Balas HANYA dalam JSON valid.";

        let user_prompt = format!(
            "Rakit keputusan editing & cut otomatis untuk proyek \"{}\" (format: {}, visualMode: {}, temaMotionDefault: {}).\n\
            Engine prioritas: {:?}.\n\
            Arahan Desain Custom: {}.\n\
            Preset default: motion={}, transition={}, overlayMode={}, autoSfx={}.\n\n\
            Daftar Footage Lokal (dengan timestamp frame sampel terlampir secara berurutan):\n{}\n\
            Daftar Scene Cut (durasi SUDAH dikunci presisi ke voiceover asli):\n{}\n\n\
            Balas JSON dengan struktur persis:\n\
            {{\"scenes\":[{{\
              \"sceneIndex\":0,\
              \"visualSource\":\"footage|motion\",\
              \"footageIndex\":0,\
              \"trimStartMs\":0,\
              \"aiMotion\":null,\
              \"motion\":\"zoom_punch|smooth_ken_burns|shake_impact|slide_reveal|static_clean\",\
              \"transitionIn\":\"hard_cut|whip_pan|pop_zoom|glitch_flash|smooth_crossfade\",\
              \"sfx\":\"impact_boom|whoosh_fast|whoosh_soft|pop_text|ding_notif|riser|camera_shutter|keyboard_click|cash_register|vinyl_scratch|glitch_zap|swoosh_reverse|none\",\
              \"overlayType\":\"hook_headline|notification_banner|promo_badge|doodle_highlight|split_screen|none\",\
              \"overlayTitle\":\"opsional judul notif singkat\",\
              \"overlayText\":\"opsional teks overlay singkat maks 32 karakter\"\
            }}]}}",
            req.project_title,
            req.format,
            visual_mode,
            motion_theme,
            preferred_engines,
            if style_dna.is_empty() { "(Tidak ada)" } else { style_dna.as_str() },
            effective_motion_default,
            effective_transition_default,
            req.overlay_mode,
            req.auto_sfx,
            if footage_desc.is_empty() {
                "(Belum ada footage lokal — gunakan footageIndex: null)"
            } else {
                footage_desc.as_str()
            },
            seg_desc
        );

        if let Ok((val, _)) =
            call_llm_json(&resolved, system_prompt, &user_prompt, &all_thumbs).await
        {
            if let Some(arr) = val["scenes"].as_array() {
                ai_scene_decisions = arr.clone();
            }
        }
    }

    // Track per-clip playback cursor so multi-cut fallback or same-clip consecutive cuts advance smoothly!
    let mut clip_cursor_ms: Vec<u64> = vec![0; req.footage.len()];
    let mut last_footage_idx: Option<usize> = None;
    let mut last_trim_ms: u64 = u64::MAX;

    let mut scenes_json = Vec::with_capacity(segments.len());
    let mut has_any_motion_scene = false;

    for (i, (role, text)) in segments.iter().enumerate() {
        let (start_ms, end_ms) = timings[i];
        let scene_dur_ms = end_ms.saturating_sub(start_ms).max(800);
        let decision = ai_scene_decisions
            .iter()
            .find(|d| d["sceneIndex"].as_u64() == Some(i as u64))
            .or_else(|| ai_scene_decisions.get(i));

        let scene_visual_source = match visual_mode {
            "motion" => "motion",
            "hybrid" => {
                if let Some(vs) = decision.and_then(|d| d["visualSource"].as_str()) {
                    if vs == "motion" {
                        "motion"
                    } else if vs == "footage" && !req.footage.is_empty() {
                        "footage"
                    } else if req.footage.is_empty() || i % 2 == 1 {
                        "motion"
                    } else {
                        "footage"
                    }
                } else if req.footage.is_empty() || i % 2 == 1 {
                    "motion"
                } else {
                    "footage"
                }
            }
            _ => "footage",
        };

        let ai_motion_val = if scene_visual_source == "motion" {
            has_any_motion_scene = true;
            let raw_motion = decision
                .and_then(|d| d.get("aiMotion"))
                .filter(|v| v.is_object() && v["engine"].is_string());
            if let Some(m) = raw_motion {
                sanitize_ai_motion_value(m, text, motion_theme)
            } else {
                build_fallback_ai_motion(
                    role,
                    i,
                    text,
                    &req.project_title,
                    motion_theme,
                    &preferred_engines,
                )
            }
        } else {
            Value::Null
        };

        let mut footage_idx = if scene_visual_source == "motion" || req.footage.is_empty() {
            None
        } else {
            decision
                .and_then(|d| d["footageIndex"].as_u64())
                .map(|n| n as usize)
                .filter(|&idx| idx < req.footage.len())
                .or_else(|| Some(i % req.footage.len()))
        };

        // Ensure multi-footage cuts don't repeat exact same clip + trim monotonously back-to-back
        let (media_path, trim_start_ms) = match footage_idx {
            Some(mut idx) => {
                let mut raw_trim = decision
                    .and_then(|d| d["trimStartMs"].as_u64())
                    .unwrap_or(clip_cursor_ms[idx]);

                if req.footage.len() > 1
                    && last_footage_idx == Some(idx)
                    && raw_trim.abs_diff(last_trim_ms) < 600
                {
                    // Rotate cleanly to next clip for dynamic multi-clip cut rhythm
                    idx = (idx + 1) % req.footage.len();
                    footage_idx = Some(idx);
                    raw_trim = clip_cursor_ms[idx];
                }

                let clip = &req.footage[idx];
                let max_safe_trim = clip.duration_ms.saturating_sub(scene_dur_ms.min(clip.duration_ms));
                let safe_trim = if clip.duration_ms > 1200 {
                    if raw_trim > max_safe_trim && max_safe_trim > 0 {
                        raw_trim % max_safe_trim
                    } else {
                        raw_trim.min(max_safe_trim)
                    }
                } else {
                    0
                };

                // Advance clip cursor so subsequent cuts from the same clip pick fresh moments
                let next_cur = safe_trim.saturating_add(scene_dur_ms);
                clip_cursor_ms[idx] = if clip.duration_ms > 1500 && next_cur + 1000 < clip.duration_ms {
                    next_cur
                } else {
                    0
                };

                last_footage_idx = Some(idx);
                last_trim_ms = safe_trim;
                (Value::String(clip.path.clone()), safe_trim)
            }
            None => (Value::Null, 0),
        };

        let motion = if scene_visual_source == "motion" {
            "static_clean"
        } else {
            decision
                .and_then(|d| d["motion"].as_str())
                .filter(|m| {
                    matches!(
                        *m,
                        "zoom_punch"
                            | "smooth_ken_burns"
                            | "shake_impact"
                            | "slide_reveal"
                            | "static_clean"
                    )
                })
                .unwrap_or(&effective_motion_default)
        };

        let transition_in = if i == 0 {
            "hard_cut"
        } else {
            decision
                .and_then(|d| d["transitionIn"].as_str())
                .filter(|t| {
                    matches!(
                        *t,
                        "hard_cut"
                            | "whip_pan"
                            | "pop_zoom"
                            | "glitch_flash"
                            | "smooth_crossfade"
                    )
                })
                .unwrap_or(&effective_transition_default)
        };

        let mut sfx_arr = Vec::new();
        if req.auto_sfx {
            let sfx_preset = decision
                .and_then(|d| d["sfx"].as_str())
                .filter(|s| *s != "none" && !s.is_empty())
                .unwrap_or(match role.as_str() {
                    "hook" => "impact_boom",
                    "cta" => "riser",
                    _ => "whoosh_fast",
                });
            sfx_arr.push(json!({
                "preset": sfx_preset,
                "offsetMs": 0,
                "volume": 0.65
            }));
        }

        let mut overlays = Vec::new();
        if req.overlay_mode != "none" && scene_visual_source != "motion" {
            let chosen_ov = if req.overlay_mode == "auto" {
                decision
                    .and_then(|d| d["overlayType"].as_str())
                    .unwrap_or(if i == 0 {
                        "hook_headline"
                    } else if role == "cta" {
                        "promo_badge"
                    } else {
                        "none"
                    })
            } else if i == 0 || role == "cta" {
                req.overlay_mode.as_str()
            } else {
                "none"
            };

            let valid_ov = matches!(
                chosen_ov,
                "hook_headline"
                    | "notification_banner"
                    | "promo_badge"
                    | "doodle_highlight"
                    | "split_screen"
            );

            if valid_ov {
                let ov_text = decision
                    .and_then(|d| d["overlayText"].as_str())
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|| {
                        if chosen_ov == "split_screen" {
                            "DETAIL PRODUK".to_string()
                        } else if role == "cta" {
                            "CEK SEKARANG".to_string()
                        } else {
                            req.project_title.clone()
                        }
                    });
                let ov_title = decision
                    .and_then(|d| d["overlayTitle"].as_str())
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or("Synkcut · Baru saja");

                overlays.push(json!({
                    "id": format!("ov_{i}"),
                    "type": chosen_ov,
                    "title": if chosen_ov == "notification_banner" { Value::String(ov_title.to_string()) } else { Value::Null },
                    "text": ov_text,
                    "position": "top"
                }));
            }
        }

        let secondary_path =
            if overlays.iter().any(|o| o["type"] == "split_screen") && req.footage.len() > 1 {
                let alt_idx = (footage_idx.unwrap_or(0) + 1) % req.footage.len();
                Value::String(req.footage[alt_idx].path.clone())
            } else {
                Value::Null
            };

        scenes_json.push(json!({
            "id": format!("scene_{}", i + 1),
            "role": role,
            "startMs": start_ms,
            "endMs": end_ms,
            "text": text,
            "visualSource": scene_visual_source,
            "aiMotion": ai_motion_val,
            "media": {
                "path": media_path,
                "secondaryPath": secondary_path,
                "trimStartMs": trim_start_ms,
                "fit": "cover"
            },
            "motion": {
                "preset": motion,
                "intensity": if scene_visual_source == "motion" { 0.4 } else { 0.78 }
            },
            "transitionIn": {
                "preset": transition_in,
                "durationMs": if transition_in == "hard_cut" { 0 } else { 240 }
            },
            "sfx": sfx_arr,
            "overlays": overlays
        }));
    }

    let footage_library: Vec<Value> = req
        .footage
        .iter()
        .map(|f| {
            json!({
                "path": f.path,
                "fileName": f.file_name,
                "durationMs": f.duration_ms
            })
        })
        .collect();

    let now_ts = chrono::Utc::now().timestamp_millis();
    let now_iso = chrono::Utc::now().to_rfc3339();
    let proj_version = if has_any_motion_scene || req.style_reference.is_some() || sanitized_custom_design.is_some() {
        "1.1"
    } else {
        "1.0"
    };

    let custom_design_json = sanitized_custom_design
        .as_ref()
        .and_then(|d| serde_json::to_value(d).ok())
        .unwrap_or(Value::Null);

    Ok(json!({
        "version": proj_version,
        "meta": {
            "id": format!("proj_{now_ts}"),
            "name": req.project_title.trim(),
            "format": req.format,
            "aspectRatio": "9:16",
            "fps": 30,
            "createdAt": now_iso,
            "updatedAt": now_iso
        },
        "styleReference": req.style_reference.unwrap_or(Value::Null),
        "footageLibrary": footage_library,
        "globalStyle": {
            "captionPreset": req.caption_preset,
            "accentColor": effective_accent,
            "showProgressBar": true,
            "customDesign": custom_design_json,
            "bgm": {
                "preset": req.bgm_preset,
                "volume": 0.24,
                "autoDucking": req.auto_ducking
            },
            "safeZone": "tiktok_reels"
        },
        "voiceover": {
            "source": final_audio_source,
            "audioPath": final_audio_path,
            "trimSilence": req.trim_silence,
            "words": final_words
        },
        "scenes": scenes_json
    }))
}

fn sanitize_single_scene_from_patch(
    raw_scene: &Value,
    idx: usize,
    matched_orig: Option<&Value>,
    footage_library: &[Value],
) -> Value {
    let mut scene = raw_scene.clone();
    if !scene.is_object() {
        scene = matched_orig.cloned().unwrap_or_else(|| json!({}));
    }
    let obj = scene.as_object_mut().unwrap();

    // 1. id
    let scene_id = obj
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            matched_orig
                .and_then(|o| o["id"].as_str())
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| format!("scene_{}", idx + 1));
    obj.insert("id".to_string(), Value::String(scene_id));

    // 2. role
    let role = obj
        .get("role")
        .and_then(Value::as_str)
        .filter(|r| matches!(*r, "hook" | "body" | "cta"))
        .or_else(|| matched_orig.and_then(|o| o["role"].as_str()))
        .unwrap_or(if idx == 0 { "hook" } else { "body" })
        .to_string();
    obj.insert("role".to_string(), Value::String(role.clone()));

    // 3. text
    let text = obj
        .get("text")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| matched_orig.and_then(|o| o["text"].as_str()).map(ToString::to_string))
        .unwrap_or_default();
    obj.insert("text".to_string(), Value::String(text.clone()));

    // 4. visualSource & aiMotion
    let visual_source = obj
        .get("visualSource")
        .and_then(Value::as_str)
        .filter(|v| matches!(*v, "footage" | "motion"))
        .map(ToString::to_string)
        .or_else(|| {
            if obj.get("aiMotion").filter(|v| v.is_object()).is_some() {
                Some("motion".to_string())
            } else {
                matched_orig
                    .and_then(|o| o["visualSource"].as_str())
                    .map(ToString::to_string)
            }
        })
        .unwrap_or_else(|| "footage".to_string());
    obj.insert("visualSource".to_string(), Value::String(visual_source.clone()));

    if visual_source == "motion" {
        let raw_motion = obj
            .get("aiMotion")
            .filter(|v| v.is_object())
            .or_else(|| matched_orig.and_then(|o| o.get("aiMotion")).filter(|v| v.is_object()));
        let sanitized_motion = match raw_motion {
            Some(m) => sanitize_ai_motion_value(m, &text, "carbon"),
            None => build_fallback_ai_motion(&role, idx, &text, "AI Motion", "carbon", &[]),
        };
        obj.insert("aiMotion".to_string(), sanitized_motion);
    } else if obj.get("aiMotion").is_none() {
        obj.insert("aiMotion".to_string(), Value::Null);
    }

    // 5. media (protect local paths + support footageIndex & trimStartMs updates!)
    let orig_media = matched_orig.and_then(|o| o.get("media")).and_then(Value::as_object);
    let mut media_obj = obj
        .get("media")
        .and_then(Value::as_object)
        .cloned()
        .or_else(|| orig_media.cloned())
        .unwrap_or_default();

    // Optional AI shortcut: top-level `footageIndex` resolves against project's `footageLibrary`
    if let Some(f_idx) = obj.get("footageIndex").and_then(Value::as_u64) {
        if let Some(lib_item) = footage_library.get(f_idx as usize) {
            if let Some(p) = lib_item["path"].as_str() {
                media_obj.insert("path".to_string(), Value::String(p.to_string()));
            }
        }
    }
    if let Some(top_trim) = obj.get("trimStartMs").and_then(Value::as_u64) {
        media_obj.insert("trimStartMs".to_string(), json!(top_trim));
    }

    let cur_path_valid = media_obj
        .get("path")
        .and_then(Value::as_str)
        .map(|p| !p.trim().is_empty())
        .unwrap_or(false);
    if !cur_path_valid {
        if let Some(orig_path) = orig_media.and_then(|m| m.get("path")).filter(|v| v.is_string()) {
            media_obj.insert("path".to_string(), orig_path.clone());
        } else {
            media_obj.insert("path".to_string(), Value::Null);
        }
    }
    if media_obj.get("secondaryPath").is_none() {
        media_obj.insert(
            "secondaryPath".to_string(),
            orig_media
                .and_then(|m| m.get("secondaryPath"))
                .cloned()
                .unwrap_or(Value::Null),
        );
    }
    let trim_ms = media_obj
        .get("trimStartMs")
        .and_then(Value::as_u64)
        .or_else(|| orig_media.and_then(|m| m["trimStartMs"].as_u64()))
        .unwrap_or(0);
    // Clamp trimStartMs safely if clip duration is known in footageLibrary
    let clamped_trim = if let Some(cur_path) = media_obj.get("path").and_then(Value::as_str) {
        if let Some(lib_item) = footage_library.iter().find(|it| it["path"].as_str() == Some(cur_path)) {
            let clip_dur = lib_item["durationMs"].as_u64().unwrap_or(0);
            if clip_dur > 1500 {
                trim_ms.min(clip_dur.saturating_sub(1000))
            } else {
                0
            }
        } else {
            trim_ms
        }
    } else {
        trim_ms
    };
    media_obj.insert("trimStartMs".to_string(), json!(clamped_trim));
    if !matches!(media_obj.get("fit").and_then(Value::as_str), Some("cover" | "contain")) {
        media_obj.insert("fit".to_string(), json!("cover"));
    }
    obj.insert("media".to_string(), Value::Object(media_obj));

    // 6. motion (NEVER missing or null!)
    let orig_motion = matched_orig.and_then(|o| o.get("motion")).and_then(Value::as_object);
    let raw_motion = obj.get("motion").and_then(Value::as_object);
    let motion_preset = raw_motion
        .and_then(|m| m.get("preset").and_then(Value::as_str))
        .or_else(|| obj.get("motion").and_then(Value::as_str))
        .filter(|m| {
            matches!(
                *m,
                "zoom_punch" | "smooth_ken_burns" | "shake_impact" | "slide_reveal" | "static_clean"
            )
        })
        .or_else(|| orig_motion.and_then(|m| m.get("preset").and_then(Value::as_str)))
        .unwrap_or(if visual_source == "motion" { "static_clean" } else { "zoom_punch" });
    let motion_intensity = raw_motion
        .and_then(|m| m.get("intensity").and_then(Value::as_f64))
        .or_else(|| orig_motion.and_then(|m| m.get("intensity").and_then(Value::as_f64)))
        .unwrap_or(if visual_source == "motion" { 0.4 } else { 0.75 })
        .clamp(0.0, 1.0);
    obj.insert(
        "motion".to_string(),
        json!({ "preset": motion_preset, "intensity": motion_intensity }),
    );

    // 7. transitionIn (NEVER missing or null!)
    let orig_trans = matched_orig.and_then(|o| o.get("transitionIn")).and_then(Value::as_object);
    let raw_trans = obj.get("transitionIn").and_then(Value::as_object);
    let trans_preset = raw_trans
        .and_then(|t| t.get("preset").and_then(Value::as_str))
        .or_else(|| obj.get("transitionIn").and_then(Value::as_str))
        .filter(|t| {
            matches!(
                *t,
                "hard_cut" | "whip_pan" | "pop_zoom" | "glitch_flash" | "smooth_crossfade"
            )
        })
        .or_else(|| orig_trans.and_then(|t| t.get("preset").and_then(Value::as_str)))
        .unwrap_or(if idx == 0 { "hard_cut" } else { "pop_zoom" });
    let trans_dur = raw_trans
        .and_then(|t| t.get("durationMs").and_then(Value::as_u64))
        .or_else(|| orig_trans.and_then(|t| t.get("durationMs").and_then(Value::as_u64)))
        .unwrap_or(if trans_preset == "hard_cut" { 0 } else { 240 })
        .min(800);
    obj.insert(
        "transitionIn".to_string(),
        json!({ "preset": trans_preset, "durationMs": trans_dur }),
    );

    // 8. sfx
    let sfx_arr = obj
        .get("sfx")
        .and_then(Value::as_array)
        .or_else(|| matched_orig.and_then(|o| o["sfx"].as_array()))
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let preset = item["preset"].as_str()?;
                    if preset.is_empty() || preset == "none" {
                        return None;
                    }
                    Some(json!({
                        "preset": preset,
                        "offsetMs": item["offsetMs"].as_u64().unwrap_or(0),
                        "volume": item["volume"].as_f64().unwrap_or(0.65).clamp(0.05, 1.0)
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    obj.insert("sfx".to_string(), Value::Array(sfx_arr));

    // 9. overlays (guarantee every overlay has string `id`, valid `type`, string `text`, `position`)
    let overlays_arr = obj
        .get("overlays")
        .and_then(Value::as_array)
        .or_else(|| matched_orig.and_then(|o| o["overlays"].as_array()))
        .map(|arr| {
            arr.iter()
                .enumerate()
                .filter_map(|(oi, item)| {
                    let ov_type = item["type"].as_str()?;
                    if !matches!(
                        ov_type,
                        "hook_headline"
                            | "notification_banner"
                            | "promo_badge"
                            | "doodle_highlight"
                            | "split_screen"
                    ) {
                        return None;
                    }
                    Some(json!({
                        "id": item["id"].as_str().unwrap_or(&format!("ov_{idx}_{oi}")),
                        "type": ov_type,
                        "title": item.get("title").and_then(Value::as_str),
                        "text": item["text"].as_str().unwrap_or(""),
                        "position": match item["position"].as_str().unwrap_or("top") {
                            "center" | "bottom" => item["position"].as_str().unwrap(),
                            _ => "top"
                        }
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    obj.insert("overlays".to_string(), Value::Array(overlays_arr));

    // Remove temporary helper keys
    obj.remove("footageIndex");
    obj.remove("trimStartMs");

    scene
}

/// Deeply merge & sanitize an AI Copilot JSON patch onto the original project.
/// Guarantees zero missing fields, preserves local media & BGM subfields, and supports partial single-scene updates!
fn merge_and_sanitize_copilot_patch(
    original: &Value,
    patch: &Value,
    selected_scene_id: Option<&str>,
    instruction: &str,
) -> Value {
    let mut updated = original.clone();

    // 1. Deep-merge globalStyle safely
    if let Some(new_style) = patch.get("globalStyle").and_then(Value::as_object) {
        if !updated.get("globalStyle").map(Value::is_object).unwrap_or(false) {
            updated["globalStyle"] = json!({
                "captionPreset": "bold_pop",
                "accentColor": "#38E59D",
                "showProgressBar": true,
                "bgm": { "preset": "none", "volume": 0.24, "autoDucking": true },
                "safeZone": "tiktok_reels"
            });
        }
        let orig_style = updated["globalStyle"].as_object_mut().unwrap();

        if let Some(cp) = new_style.get("captionPreset").and_then(Value::as_str) {
            if matches!(
                cp,
                "bold_pop" | "clean_minimal" | "kinetic_punch" | "luxury_editorial" | "neon_tech"
            ) {
                orig_style.insert("captionPreset".to_string(), Value::String(cp.to_string()));
            }
        }
        if let Some(ac) = new_style.get("accentColor").and_then(Value::as_str) {
            if ac.starts_with('#') && (ac.len() == 4 || ac.len() == 7) {
                orig_style.insert("accentColor".to_string(), Value::String(ac.to_string()));
            }
        }
        if let Some(spb) = new_style.get("showProgressBar").and_then(Value::as_bool) {
            orig_style.insert("showProgressBar".to_string(), Value::Bool(spb));
        }
        if let Some(sz) = new_style.get("safeZone").and_then(Value::as_str) {
            if matches!(sz, "tiktok_reels" | "none") {
                orig_style.insert("safeZone".to_string(), Value::String(sz.to_string()));
            }
        }

        // Deep-merge BGM so partial bgm patch never wipes volume/autoDucking or becomes null!
        if let Some(new_bgm) = new_style.get("bgm") {
            let mut merged_bgm = orig_style
                .get("bgm")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_else(|| {
                    json!({ "preset": "none", "volume": 0.24, "autoDucking": true })
                        .as_object()
                        .unwrap()
                        .clone()
                });
            if let Some(bgm_obj) = new_bgm.as_object() {
                if let Some(p) = bgm_obj.get("preset").and_then(Value::as_str) {
                    merged_bgm.insert("preset".to_string(), Value::String(p.to_string()));
                }
                if let Some(v) = bgm_obj.get("volume").and_then(Value::as_f64) {
                    merged_bgm.insert("volume".to_string(), json!(v.clamp(0.05, 0.85)));
                }
                if let Some(d) = bgm_obj.get("autoDucking").and_then(Value::as_bool) {
                    merged_bgm.insert("autoDucking".to_string(), Value::Bool(d));
                }
            } else if let Some(preset_str) = new_bgm.as_str() {
                merged_bgm.insert("preset".to_string(), Value::String(preset_str.to_string()));
            }
            orig_style.insert("bgm".to_string(), Value::Object(merged_bgm));
        }

        // Deep-sanitize customDesign if AI created/updated custom art direction
        if let Some(new_cd) = new_style.get("customDesign") {
            if new_cd.is_null() {
                orig_style.insert("customDesign".to_string(), Value::Null);
            } else if new_cd.is_object() {
                let title_hint = original["meta"]["name"].as_str().unwrap_or("Custom Design");
                let sanitized = sanitize_custom_design_value(new_cd, title_hint, &[]);
                if let Ok(cd_val) = serde_json::to_value(&sanitized) {
                    orig_style.insert("accentColor".to_string(), Value::String(sanitized.palette.accent_primary));
                    orig_style.insert("customDesign".to_string(), cd_val);
                }
            }
        }
    }

    // 2. Merge scenes safely (handling BOTH full-array patches AND partial single-scene patches!)
    let footage_library: Vec<Value> = original
        .get("footageLibrary")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let orig_scenes = original
        .get("scenes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let lower_instr = instruction.to_lowercase();
    let user_requested_delete = lower_instr.contains("hapus")
        || lower_instr.contains("buang")
        || lower_instr.contains("kurangi scene")
        || lower_instr.contains("sisakan")
        || lower_instr.contains("delete")
        || lower_instr.contains("remove");

    if let Some(new_scenes) = patch.get("scenes").and_then(Value::as_array) {
        if !new_scenes.is_empty() {
            // Detect partial single-scene update from fast LLMs so we NEVER accidentally delete other scenes!
            let is_partial_single_scene = new_scenes.len() == 1
                && orig_scenes.len() > 1
                && !user_requested_delete;

            let working_scenes: Vec<Value> = if is_partial_single_scene {
                let raw_single = &new_scenes[0];
                let target_id = raw_single
                    .get("id")
                    .and_then(Value::as_str)
                    .or(selected_scene_id);
                let target_idx = target_id
                    .and_then(|tid| orig_scenes.iter().position(|s| s["id"].as_str() == Some(tid)))
                    .unwrap_or(0);

                orig_scenes
                    .iter()
                    .enumerate()
                    .map(|(idx, orig_s)| {
                        if idx == target_idx {
                            sanitize_single_scene_from_patch(raw_single, idx, Some(orig_s), &footage_library)
                        } else {
                            sanitize_single_scene_from_patch(orig_s, idx, Some(orig_s), &footage_library)
                        }
                    })
                    .collect()
            } else {
                new_scenes
                    .iter()
                    .enumerate()
                    .map(|(idx, raw_s)| {
                        let sid = raw_s.get("id").and_then(Value::as_str);
                        let matched_orig = sid
                            .and_then(|id| orig_scenes.iter().find(|s| s["id"].as_str() == Some(id)))
                            .or_else(|| orig_scenes.get(idx));
                        sanitize_single_scene_from_patch(raw_s, idx, matched_orig, &footage_library)
                    })
                    .collect()
            };

            // Guarantee contiguous valid timings across all scenes
            let mut cursor_ms: u64 = 0;
            let mut reflowed: Vec<Value> = Vec::with_capacity(working_scenes.len());
            for (idx, mut scene) in working_scenes.into_iter().enumerate() {
                let matched_orig = orig_scenes
                    .iter()
                    .find(|s| s["id"].as_str() == scene["id"].as_str())
                    .or_else(|| orig_scenes.get(idx));
                let orig_dur = matched_orig
                    .map(|o| {
                        o["endMs"]
                            .as_u64()
                            .unwrap_or(2500)
                            .saturating_sub(o["startMs"].as_u64().unwrap_or(0))
                    })
                    .unwrap_or(2500);
                let raw_start = scene["startMs"].as_u64().unwrap_or(cursor_ms);
                let raw_end = scene["endMs"].as_u64().unwrap_or(raw_start + orig_dur);
                let dur = if raw_end > raw_start {
                    raw_end - raw_start
                } else {
                    orig_dur
                }
                .clamp(800, 20000);

                if let Some(obj) = scene.as_object_mut() {
                    obj.insert("startMs".to_string(), json!(cursor_ms));
                    obj.insert("endMs".to_string(), json!(cursor_ms + dur));
                }
                cursor_ms += dur;
                reflowed.push(scene);
            }

            if !reflowed.is_empty() {
                if reflowed.iter().any(|s| s["visualSource"] == "motion") {
                    updated["version"] = json!("1.1");
                }
                updated["scenes"] = Value::Array(reflowed);
            }
        }
    }

    updated
}

#[tauri::command]
pub async fn ai_copilot_patch(
    app: AppHandle,
    project: Value,
    instruction: String,
    selected_scene_id: Option<String>,
) -> Result<CopilotPatchResponse, String> {
    if instruction.trim().is_empty() {
        return Err("Instruksi revisi kosong.".to_string());
    }
    let resolved = byok::resolve_active_provider(&app)?;

    // Send a compact summary (omit huge words[] & base64 thumbnails to save BYOK tokens!)
    let mut compact_project = project.clone();
    if let Some(vo) = compact_project.get_mut("voiceover").and_then(Value::as_object_mut) {
        vo.insert("words".to_string(), json!([]));
    }
    if let Some(sr) = compact_project.get_mut("styleReference").and_then(Value::as_object_mut) {
        sr.insert("thumbnails".to_string(), json!([]));
    }

    let footage_hint = project
        .get("footageLibrary")
        .and_then(Value::as_array)
        .filter(|arr| !arr.is_empty())
        .map(|arr| {
            let lines: Vec<String> = arr
                .iter()
                .enumerate()
                .map(|(i, c)| {
                    format!(
                        "  - footageIndex={i}: nama=\"{}\", durasi={}ms, path=\"{}\"",
                        c["fileName"].as_str().unwrap_or("clip.mp4"),
                        c["durationMs"].as_u64().unwrap_or(0),
                        c["path"].as_str().unwrap_or("")
                    )
                })
                .collect();
            format!(
                "\nKatalog Footage Lokal Proyek (untuk mengganti klip/cut scene, set footageIndex atau media.path & media.trimStartMs):\n{}",
                lines.join("\n")
            )
        })
        .unwrap_or_default();

    let system_prompt = "Kamu adalah AI Video & AI Motion Director di aplikasi Synkcut. \
        Tugasmu menerapkan revisi kreatif user ke JSON proyek Synkcut secara presisi tanpa merusak path media lokal atau field wajib. \
        PENTING: Selalu kembalikan SEMUA scene proyek di array `scenes` (jangan hapus scene lain kecuali user minta menghapus scene). \
        Untuk mengganti klip footage atau titik potong cut pada suatu scene, ubah `footageIndex` (atau `media.path`) dan `media.trimStartMs` (ms). \
        Untuk mengubah arah desain custom (warna latar, pola, font, gaya kartu), ubah objek `globalStyle.customDesign`. \
        Jika user minta mengubah scene jadi AI Motion / diagram / grafik / kartu / stick figure / 3D breakdown, set visualSource=\"motion\" dan isi aiMotion dengan: \
        engine (flow_diagram | motion_chart | tech_cards | stick_figure | breakdown_3d), theme (carbon | paper | coral | mint | blue), title, subtitle, takeaway, serta field engine yang cocok (flow / chart / techCards / stickFigure / breakdown3d). \
        Nilai captionPreset valid: bold_pop, clean_minimal, kinetic_punch, luxury_editorial, neon_tech. \
        Nilai motion.preset valid: zoom_punch, smooth_ken_burns, shake_impact, slide_reveal, static_clean. \
        Nilai transitionIn.preset valid: hard_cut, whip_pan, pop_zoom, glitch_flash, smooth_crossfade. \
        Nilai overlays[].type valid: hook_headline, notification_banner, promo_badge, doodle_highlight, split_screen. \
        Nilai sfx[].preset valid: whoosh_fast, whoosh_soft, pop_text, ding_notif, impact_boom, riser, camera_shutter, keyboard_click, cash_register, vinyl_scratch, glitch_zap, swoosh_reverse. \
        Nilai globalStyle.bgm.preset valid: upbeat_promo, lofi_education, cinematic_story, tech_modern, trendy_funk, chill_aesthetic, none. \
        Balas HANYA dalam JSON: {\"reply\":\"ringkasan singkat Bahasa Indonesia apa yang diubah\",\"globalStyle\":{...},\"scenes\":[...]}";

    let focus_hint = selected_scene_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|id| format!("\nScene yang sedang dipilih user di Studio: \"{id}\" (jika user menyebut 'scene ini' atau 'scene aktif', fokus ke scene tersebut dan pertahankan scene lainnya)."))
        .unwrap_or_default();

    let user_prompt = format!(
        "Proyek saat ini:\n{}{}{}\n\nInstruksi revisi user: \"{}\"",
        serde_json::to_string(&compact_project).unwrap_or_default(),
        footage_hint,
        focus_hint,
        instruction.trim()
    );

    let (val, provider_used) = call_llm_json(&resolved, system_prompt, &user_prompt, &[]).await?;
    let reply = val["reply"]
        .as_str()
        .unwrap_or("Revisi berhasil diterapkan pada proyek.")
        .to_string();

    let updated = merge_and_sanitize_copilot_patch(
        &project,
        &val,
        selected_scene_id.as_deref(),
        &instruction,
    );

    Ok(CopilotPatchResponse {
        project: updated,
        reply,
        provider_used,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_json_fences() {
        let fenced = "```json\n{\"ok\":true}\n```";
        assert_eq!(strip_json_fences(fenced), "{\"ok\":true}");
        assert_eq!(strip_json_fences("{\"ok\":true}"), "{\"ok\":true}");
    }

    #[test]
    fn test_parse_llm_json_handles_prose_wrapper() {
        let wrapped = "Berikut hasil JSON revisi:\n```json\n{\"reply\":\"Berhasil\",\"scenes\":[]}\n```\nSemoga membantu!";
        let val = parse_llm_json(wrapped).expect("should parse prose-wrapped json");
        assert_eq!(val["reply"], "Berhasil");
    }

    #[test]
    fn test_parse_data_url_mime_detects_png_and_webp() {
        let (m1, b1) = parse_data_url_mime_and_b64("data:image/png;base64,AAAA");
        assert_eq!(m1, "image/png");
        assert_eq!(b1, "AAAA");
        let (m2, b2) = parse_data_url_mime_and_b64("data:image/webp;base64,BBBB");
        assert_eq!(m2, "image/webp");
        assert_eq!(b2, "BBBB");
    }

    #[test]
    fn test_segment_raw_script_into_cuts_preserves_all_words() {
        let script = "Pernah bingung kenapa video pendek lo sepi penonton? Ternyata tiga detik pertama menentukan segalanya! Gunakan potongan klip cepat yang langsung menunjukkan hasil nyata. Lalu tutup dengan ajakan jelas supaya penonton langsung klik link.";
        let cuts = segment_raw_script_into_cuts(script);
        assert_eq!(cuts.len(), 4);
        assert_eq!(cuts[0].0, "hook");
        assert_eq!(cuts[1].0, "body");
        assert_eq!(cuts[2].0, "body");
        assert_eq!(cuts[3].0, "cta");
        let rejoined = cuts.iter().map(|(_, t)| t.as_str()).collect::<Vec<_>>().join(" ");
        assert_eq!(
            rejoined.split_whitespace().count(),
            script.split_whitespace().count()
        );
    }

    #[test]
    fn test_compute_scene_timings_matches_total() {
        let segs = vec![
            ("hook".to_string(), "Satu dua tiga".to_string()),
            ("body".to_string(), "Empat lima enam tujuh".to_string()),
            ("cta".to_string(), "Delapan sembilan".to_string()),
        ];
        let ranges = compute_scene_timings(&segs, 9000, &[]);
        assert_eq!(ranges.len(), 3);
        assert_eq!(ranges[0].0, 0);
        assert_eq!(ranges[2].1, 9000);
        assert_eq!(ranges[0].1, ranges[1].0);
        assert_eq!(ranges[1].1, ranges[2].0);
    }

    #[test]
    fn test_copilot_patch_survives_partial_scene_and_missing_fields_without_blank_crash() {
        let orig = json!({
            "globalStyle": {
                "captionPreset": "bold_pop",
                "accentColor": "#38E59D",
                "bgm": { "preset": "upbeat_promo", "volume": 0.25, "autoDucking": true }
            },
            "footageLibrary": [
                { "path": "D:\\clips\\a.mp4", "fileName": "a.mp4", "durationMs": 12000 },
                { "path": "D:\\clips\\b.mp4", "fileName": "b.mp4", "durationMs": 9000 }
            ],
            "scenes": [
                {
                    "id": "scene_1",
                    "role": "hook",
                    "startMs": 0,
                    "endMs": 3000,
                    "text": "Hook lama",
                    "media": { "path": "D:\\clips\\a.mp4", "trimStartMs": 0, "fit": "cover" },
                    "motion": { "preset": "zoom_punch", "intensity": 0.8 },
                    "transitionIn": { "preset": "hard_cut", "durationMs": 0 },
                    "sfx": [],
                    "overlays": []
                },
                {
                    "id": "scene_2",
                    "role": "cta",
                    "startMs": 3000,
                    "endMs": 6000,
                    "text": "CTA lama",
                    "media": { "path": "D:\\clips\\b.mp4", "trimStartMs": 1000, "fit": "cover" },
                    "motion": { "preset": "static_clean", "intensity": 0.5 },
                    "transitionIn": { "preset": "whip_pan", "durationMs": 200 },
                    "sfx": [],
                    "overlays": []
                }
            ]
        });

        // Simulate notoriously sparse LLM response:
        // - bgm is null or partial
        // - only returns 1 scene WITHOUT motion, transitionIn, role, text, media!
        let sparse_patch = json!({
            "globalStyle": { "bgm": { "preset": "lofi_education" }, "accentColor": null },
            "scenes": [
                {
                    "id": "scene_1",
                    "visualSource": "motion",
                    "aiMotion": {
                        "engine": "motion_chart",
                        "title": "Grafik Penjualan",
                        "chart": {
                            "chartType": "bar",
                            "data": [{ "name": "Jan", "value": "40%" }, { "name": "Feb", "value": 95 }]
                        }
                    }
                }
            ]
        });

        let merged = merge_and_sanitize_copilot_patch(
            &orig,
            &sparse_patch,
            Some("scene_1"),
            "Ubah scene ini jadi grafik batang chart",
        );

        // Scene 2 MUST NOT be deleted on single-scene partial patch!
        assert_eq!(merged["scenes"].as_array().unwrap().len(), 2);
        // GlobalStyle BGM volume & autoDucking MUST be preserved, accentColor must stay valid!
        assert_eq!(merged["globalStyle"]["bgm"]["preset"], "lofi_education");
        assert_eq!(merged["globalStyle"]["bgm"]["volume"], 0.25);
        assert_eq!(merged["globalStyle"]["bgm"]["autoDucking"], true);
        assert_eq!(merged["globalStyle"]["accentColor"], "#38E59D");
        // Scene 1 MUST have valid motion, transitionIn, role, text, media, and sanitized chart data!
        assert_eq!(merged["scenes"][0]["role"], "hook");
        assert_eq!(merged["scenes"][0]["text"], "Hook lama");
        assert!(merged["scenes"][0]["motion"]["preset"].is_string());
        assert!(merged["scenes"][0]["transitionIn"]["preset"].is_string());
        assert_eq!(merged["scenes"][0]["aiMotion"]["chart"]["data"][0]["label"], "Jan");
        assert_eq!(merged["scenes"][0]["aiMotion"]["chart"]["data"][0]["value"], 40.0);
    }

    #[test]
    fn test_copilot_patch_resolves_footage_index_and_clamps_trim() {
        let orig = json!({
            "globalStyle": { "captionPreset": "bold_pop", "accentColor": "#38E59D" },
            "footageLibrary": [
                { "path": "D:\\clips\\clip1.mp4", "fileName": "clip1.mp4", "durationMs": 8000 },
                { "path": "D:\\clips\\clip2.mp4", "fileName": "clip2.mp4", "durationMs": 5000 }
            ],
            "scenes": [{
                "id": "scene_1",
                "role": "hook",
                "startMs": 0,
                "endMs": 3000,
                "text": "Demo produk",
                "media": { "path": "D:\\clips\\clip1.mp4", "trimStartMs": 0, "fit": "cover" },
                "motion": { "preset": "zoom_punch", "intensity": 0.8 },
                "transitionIn": { "preset": "hard_cut", "durationMs": 0 },
                "sfx": [],
                "overlays": []
            }]
        });

        let patch = json!({
            "scenes": [{
                "id": "scene_1",
                "footageIndex": 1,
                "trimStartMs": 99000
            }]
        });

        let merged = merge_and_sanitize_copilot_patch(&orig, &patch, Some("scene_1"), "Ganti ke klip kedua");
        assert_eq!(merged["scenes"][0]["media"]["path"], "D:\\clips\\clip2.mp4");
        assert_eq!(merged["scenes"][0]["media"]["trimStartMs"], 4000);
    }
}
