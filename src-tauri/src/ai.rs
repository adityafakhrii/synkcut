use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::audio::{align_words_proportionally, WordTimestamp};
use crate::byok;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateScriptRequest {
    pub topic: String,
    pub format: String,
    pub tone: String,
    pub target_duration_sec: u32,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FootageInputItem {
    pub path: String,
    pub file_name: String,
    pub duration_ms: u64,
    pub thumbnails: Vec<String>, // data:image/jpeg;base64,...
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssembleProjectRequest {
    pub project_title: String,
    pub format: String,
    pub hook_text: String,
    pub body_segments: Vec<String>,
    pub cta_text: String,
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

fn resolve_active_key(app: &AppHandle) -> Result<(String, String), String> {
    let status = byok::get_byok_status(app.clone());
    if let Some(key) = byok::read_stored_key(&status.active_provider) {
        return Ok((status.active_provider, key));
    }
    for fallback in ["gemini", "openai", "openrouter"] {
        if let Some(key) = byok::read_stored_key(fallback) {
            return Ok((fallback.to_string(), key));
        }
    }
    Err("Belum ada API Key BYOK yang tersimpan. Silakan atur API Key di menu Pengaturan AI terlebih dahulu.".to_string())
}

/// Calls Gemini / OpenAI / OpenRouter with optional base64 JPEG images and enforces JSON output
async fn call_llm_json(
    provider: &str,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    image_data_urls: &[String],
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| format!("Gagal membuat HTTP client: {e}"))?;

    let raw_text: String = match provider {
        "gemini" => {
            let mut parts: Vec<Value> = vec![json!({ "text": user_prompt })];
            for data_url in image_data_urls.iter().take(8) {
                let raw_b64 = data_url
                    .split_once(",")
                    .map(|(_, b)| b)
                    .unwrap_or(data_url.as_str());
                parts.push(json!({
                    "inlineData": {
                        "mimeType": "image/jpeg",
                        "data": raw_b64
                    }
                }));
            }

            let payload = json!({
                "systemInstruction": { "parts": [{ "text": system_prompt }] },
                "contents": [{ "role": "user", "parts": parts }],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "temperature": 0.6
                }
            });

            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
            );
            let res = client
                .post(url)
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("Gagal menghubungi Gemini API: {e}"))?;

            if !res.status().is_success() {
                let status = res.status().as_u16();
                let body_txt = res.text().await.unwrap_or_default();
                return Err(format!(
                    "Gemini API error (HTTP {status}): {}",
                    body_txt.chars().take(180).collect::<String>()
                ));
            }

            let val: Value = res.json().await.map_err(|e| e.to_string())?;
            val["candidates"][0]["content"]["parts"][0]["text"]
                .as_str()
                .ok_or_else(|| "Respons Gemini kosong.".to_string())?
                .to_string()
        }
        "openai" | "openrouter" => {
            let (endpoint, model) = if provider == "openai" {
                ("https://api.openai.com/v1/chat/completions", "gpt-4o-mini")
            } else {
                (
                    "https://openrouter.ai/api/v1/chat/completions",
                    "google/gemini-2.5-flash",
                )
            };

            let mut user_content: Vec<Value> = vec![json!({ "type": "text", "text": user_prompt })];
            for data_url in image_data_urls.iter().take(6) {
                user_content.push(json!({
                    "type": "image_url",
                    "image_url": { "url": data_url }
                }));
            }

            let payload = json!({
                "model": model,
                "response_format": { "type": "json_object" },
                "temperature": 0.6,
                "messages": [
                    { "role": "system", "content": system_prompt },
                    { "role": "user", "content": user_content }
                ]
            });

            let mut req = client.post(endpoint).bearer_auth(api_key).json(&payload);
            if provider == "openrouter" {
                req = req
                    .header("HTTP-Referer", "https://synkcut.app")
                    .header("X-Title", "Synkcut Studio");
            }

            let res = req
                .send()
                .await
                .map_err(|e| format!("Gagal menghubungi {provider} API: {e}"))?;

            if !res.status().is_success() {
                let status = res.status().as_u16();
                let body_txt = res.text().await.unwrap_or_default();
                return Err(format!(
                    "{provider} API error (HTTP {status}): {}",
                    body_txt.chars().take(180).collect::<String>()
                ));
            }

            let val: Value = res.json().await.map_err(|e| e.to_string())?;
            val["choices"][0]["message"]["content"]
                .as_str()
                .ok_or_else(|| format!("Respons {provider} kosong."))?
                .to_string()
        }
        _ => return Err(format!("Provider tidak didukung: {provider}")),
    };

    let cleaned = strip_json_fences(&raw_text);
    serde_json::from_str::<Value>(&cleaned)
        .map_err(|e| format!("Output AI bukan JSON valid: {e}"))
}

#[tauri::command]
pub async fn ai_generate_script(
    app: AppHandle,
    req: GenerateScriptRequest,
) -> Result<GeneratedScriptResponse, String> {
    if req.topic.trim().is_empty() {
        return Err("Isi topik atau detail produk terlebih dahulu.".to_string());
    }

    let (provider, api_key) = resolve_active_key(&app)?;

    let body_count = match req.target_duration_sec {
        0..=20 => 1,
        21..=45 => 2,
        _ => 3,
    };

    let system_prompt = "Kamu adalah Creative Director & Copywriter video pendek (Reels, TikTok, Shorts) kelas dunia di Indonesia. \
        Tulis naskah yang tajam, spoken-word (enak diucapkan voiceover), langsung stop-scroll di 3 detik pertama, tanpa basa-basi klise. \
        Balas HANYA dalam JSON valid.";

    let user_prompt = format!(
        "Buatkan skrip video pendek Bahasa Indonesia untuk topik/produk ini:\n\
        - Topik/Produk: \"{}\"\n\
        - Format Konten: {}\n\
        - Gaya Bahasa: {}\n\
        - Target Durasi: {} detik (buat tepat {} segmen body)\n\n\
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
        body_count
    );

    let val = call_llm_json(&provider, &api_key, system_prompt, &user_prompt, &[]).await?;

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
        provider_used: provider,
    })
}

/// Partition total duration across ordered segments based on word count or real word timestamps
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

    // If real timestamps match roughly the same word count, align segment cuts to exact word boundaries!
    if !words.is_empty() && words.len() >= segments.len() {
        let mut word_idx = 0usize;
        for (i, count) in counts.iter().enumerate() {
            let start_ms = if i == 0 {
                0
            } else {
                ranges[i - 1usize].1
            };

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
                    .min(safe_total.saturating_sub(500))
            };

            ranges.push((start_ms, end_ms));
            word_idx = next_idx;
        }
        return ranges;
    }

    // Proportional duration fallback
    let mut cursor = 0u64;
    for (i, count) in counts.iter().enumerate() {
        let span = ((count * safe_total as usize) / total_words).max(1000) as u64;
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

#[tauri::command]
pub async fn ai_assemble_project(
    app: AppHandle,
    req: AssembleProjectRequest,
) -> Result<Value, String> {
    let mut segments: Vec<(String, String)> = vec![("hook".to_string(), req.hook_text.trim().to_string())];
    for body in &req.body_segments {
        if !body.trim().is_empty() {
            segments.push(("body".to_string(), body.trim().to_string()));
        }
    }
    segments.push(("cta".to_string(), req.cta_text.trim().to_string()));

    let full_text = segments
        .iter()
        .map(|(_, t)| t.as_str())
        .collect::<Vec<_>>()
        .join(" ");

    let total_duration_ms = if req.duration_ms >= 2000 {
        req.duration_ms
    } else {
        ((full_text.split_whitespace().count() as u64) * 390).max(7500)
    };

    let final_words = if req.words.is_empty() {
        align_words_proportionally(&full_text, total_duration_ms)
    } else {
        req.words.clone()
    };

    let timings = compute_scene_timings(&segments, total_duration_ms, &final_words);

    // Ask Multimodal AI Director to match local footage thumbnails & polish overlays/motions
    let mut ai_scene_decisions: Vec<Value> = Vec::new();
    if let Ok((provider, api_key)) = resolve_active_key(&app) {
        let mut all_thumbs: Vec<String> = Vec::new();
        let mut footage_desc = String::new();
        for (idx, clip) in req.footage.iter().enumerate() {
            let thumb_count = clip.thumbnails.len().min(2);
            for t in clip.thumbnails.iter().take(thumb_count) {
                all_thumbs.push(t.clone());
            }
            footage_desc.push_str(&format!(
                "- Klip #{idx}: nama=\"{}\", durasi={}ms (terlampir {} thumbnail)\n",
                clip.file_name, clip.duration_ms, thumb_count
            ));
        }

        let seg_desc: String = segments
            .iter()
            .enumerate()
            .map(|(i, (role, txt))| {
                let (s, e) = timings[i];
                format!("- Scene #{i} ({role}, {s}–{e}ms): \"{txt}\"")
            })
            .collect::<Vec<_>>()
            .join("\n");

        let system_prompt = "Kamu adalah Multimodal Video Director untuk Synkcut. \
            Lihat thumbnail footage lokal yang dilampirkan (jika ada) dan pasangkan klip paling relevan ke setiap scene Hook/Body/CTA. \
            Balas HANYA dalam JSON valid.";

        let user_prompt = format!(
            "Rakit keputusan editing untuk proyek \"{}\" (format: {}).\n\
            Preset default user: motion={}, transition={}, overlayMode={}, autoSfx={}.\n\n\
            Daftar Footage Lokal:\n{}\n\
            Daftar Scene (durasi sudah dikunci ke suara asli):\n{}\n\n\
            Balas JSON dengan struktur:\n\
            {{\"scenes\":[{{\
              \"sceneIndex\":0,\
              \"footageIndex\":0,\
              \"trimStartMs\":0,\
              \"motion\":\"zoom_punch|smooth_ken_burns|shake_impact|slide_reveal|static_clean\",\
              \"transitionIn\":\"hard_cut|whip_pan|pop_zoom|glitch_flash|smooth_crossfade\",\
              \"sfx\":\"impact_boom|whoosh_fast|whoosh_soft|pop_text|ding_notif|riser|camera_shutter|keyboard_click|cash_register|vinyl_scratch|glitch_zap|swoosh_reverse|none\",\
              \"overlayType\":\"hook_headline|notification_banner|promo_badge|doodle_highlight|split_screen|none\",\
              \"overlayTitle\":\"opsional judul notif singkat\",\
              \"overlayText\":\"opsional teks overlay singkat maks 32 karakter\"\
            }}]}}",
            req.project_title,
            req.format,
            req.motion_preset,
            req.transition_preset,
            req.overlay_mode,
            req.auto_sfx,
            if footage_desc.is_empty() {
                "(Belum ada footage lokal — gunakan footageIndex: null)"
            } else {
                footage_desc.as_str()
            },
            seg_desc
        );

        if let Ok(val) =
            call_llm_json(&provider, &api_key, system_prompt, &user_prompt, &all_thumbs).await
        {
            if let Some(arr) = val["scenes"].as_array() {
                ai_scene_decisions = arr.clone();
            }
        }
    }

    // Build deterministic valid SynkcutProject JSON combining real timings + AI Director decisions
    let mut scenes_json = Vec::with_capacity(segments.len());
    for (i, (role, text)) in segments.iter().enumerate() {
        let (start_ms, end_ms) = timings[i];
        let decision = ai_scene_decisions.get(i);

        let footage_idx = decision
            .and_then(|d| d["footageIndex"].as_u64())
            .map(|n| n as usize)
            .filter(|&idx| idx < req.footage.len())
            .or_else(|| {
                if req.footage.is_empty() {
                    None
                } else {
                    Some(i % req.footage.len())
                }
            });

        let (media_path, trim_start_ms) = match footage_idx {
            Some(idx) => {
                let clip = &req.footage[idx];
                let raw_trim = decision
                    .and_then(|d| d["trimStartMs"].as_u64())
                    .unwrap_or(0);
                let safe_trim = if clip.duration_ms > 2000 {
                    raw_trim.min(clip.duration_ms.saturating_sub(1500))
                } else {
                    0
                };
                (Value::String(clip.path.clone()), safe_trim)
            }
            None => (Value::Null, 0),
        };

        let motion = decision
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
            .unwrap_or(&req.motion_preset);

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
                .unwrap_or(&req.transition_preset)
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
        if req.overlay_mode != "none" {
            let chosen_ov = if req.overlay_mode == "auto" {
                decision
                    .and_then(|d| d["overlayType"].as_str())
                    .unwrap_or(if i == 0 {
                        "notification_banner"
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

        let secondary_path = if overlays.iter().any(|o| o["type"] == "split_screen") && req.footage.len() > 1 {
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
            "media": {
                "path": media_path,
                "secondaryPath": secondary_path,
                "trimStartMs": trim_start_ms,
                "fit": "cover"
            },
            "motion": {
                "preset": motion,
                "intensity": 0.78
            },
            "transitionIn": {
                "preset": transition_in,
                "durationMs": if transition_in == "hard_cut" { 0 } else { 240 }
            },
            "sfx": sfx_arr,
            "overlays": overlays
        }));
    }

    let now_ts = chrono::Utc::now().timestamp_millis();
    let now_iso = chrono::Utc::now().to_rfc3339();

    Ok(json!({
        "version": "1.0",
        "meta": {
            "id": format!("proj_{now_ts}"),
            "name": req.project_title.trim(),
            "format": req.format,
            "aspectRatio": "9:16",
            "fps": 30,
            "createdAt": now_iso,
            "updatedAt": now_iso
        },
        "globalStyle": {
            "captionPreset": req.caption_preset,
            "accentColor": req.accent_color,
            "showProgressBar": true,
            "bgm": {
                "preset": req.bgm_preset,
                "volume": 0.24,
                "autoDucking": req.auto_ducking
            },
            "safeZone": "tiktok_reels"
        },
        "voiceover": {
            "source": req.audio_source,
            "audioPath": req.audio_path,
            "trimSilence": req.trim_silence,
            "words": final_words
        },
        "scenes": scenes_json
    }))
}

/// Merge an AI Copilot JSON patch safely onto the original project, preserving local media paths
/// and guaranteeing contiguous scene timings (`>= 800ms` per scene).
fn merge_and_sanitize_copilot_patch(original: &Value, patch: &Value) -> Value {
    let mut updated = original.clone();

    if let Some(new_style) = patch.get("globalStyle").filter(|v| v.is_object()) {
        if let Some(orig_style) = updated.get_mut("globalStyle").and_then(Value::as_object_mut) {
            for (k, v) in new_style.as_object().unwrap() {
                orig_style.insert(k.clone(), v.clone());
            }
        } else {
            updated["globalStyle"] = new_style.clone();
        }
    }

    if let Some(new_scenes) = patch.get("scenes").and_then(Value::as_array) {
        if !new_scenes.is_empty() {
            let orig_scenes = original
                .get("scenes")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();

            let mut cursor_ms: u64 = 0;
            let mut sanitized: Vec<Value> = Vec::with_capacity(new_scenes.len());

            for (idx, raw_scene) in new_scenes.iter().enumerate() {
                let mut scene = raw_scene.clone();
                let Some(obj) = scene.as_object_mut() else {
                    continue;
                };

                let scene_id = obj
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
                    .unwrap_or_else(|| format!("scene_{}", idx + 1));
                obj.insert("id".to_string(), Value::String(scene_id.clone()));

                // Match original scene by id or index to protect local media file paths
                let matched_orig = orig_scenes
                    .iter()
                    .find(|s| s.get("id").and_then(Value::as_str) == Some(scene_id.as_str()))
                    .or_else(|| orig_scenes.get(idx));

                if let Some(orig_s) = matched_orig {
                    if let Some(orig_media) = orig_s.get("media").and_then(Value::as_object) {
                        let media_entry = obj
                            .entry("media".to_string())
                            .or_insert_with(|| Value::Object(orig_media.clone()));
                        if let Some(m_obj) = media_entry.as_object_mut() {
                            if let Some(orig_path) = orig_media.get("path").filter(|v| v.is_string()) {
                                let cur_valid = m_obj
                                    .get("path")
                                    .and_then(Value::as_str)
                                    .map(|p| !p.trim().is_empty())
                                    .unwrap_or(false);
                                if !cur_valid {
                                    m_obj.insert("path".to_string(), orig_path.clone());
                                }
                            }
                            if let Some(orig_sec) =
                                orig_media.get("secondaryPath").filter(|v| v.is_string())
                            {
                                if m_obj.get("secondaryPath").is_none() {
                                    m_obj.insert("secondaryPath".to_string(), orig_sec.clone());
                                }
                            }
                            if m_obj.get("trimStartMs").is_none() {
                                m_obj.insert(
                                    "trimStartMs".to_string(),
                                    orig_media.get("trimStartMs").cloned().unwrap_or(json!(0)),
                                );
                            }
                            if m_obj.get("fit").is_none() {
                                m_obj.insert("fit".to_string(), json!("cover"));
                            }
                        }
                    }
                }

                // Guarantee contiguous valid timings
                let raw_start = obj.get("startMs").and_then(Value::as_u64).unwrap_or(cursor_ms);
                let raw_end = obj
                    .get("endMs")
                    .and_then(Value::as_u64)
                    .unwrap_or(raw_start + 2500);
                let dur = raw_end.saturating_sub(raw_start).clamp(800, 20000);
                obj.insert("startMs".to_string(), json!(cursor_ms));
                obj.insert("endMs".to_string(), json!(cursor_ms + dur));
                cursor_ms += dur;

                if obj.get("sfx").and_then(Value::as_array).is_none() {
                    obj.insert("sfx".to_string(), json!([]));
                }
                if obj.get("overlays").and_then(Value::as_array).is_none() {
                    obj.insert("overlays".to_string(), json!([]));
                }

                sanitized.push(scene);
            }

            if !sanitized.is_empty() {
                updated["scenes"] = Value::Array(sanitized);
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
    let (provider, api_key) = resolve_active_key(&app)?;

    // Send a compact summary (omit huge words[] array to save BYOK tokens!)
    let mut compact_project = project.clone();
    if let Some(vo) = compact_project.get_mut("voiceover").and_then(Value::as_object_mut) {
        vo.insert("words".to_string(), json!([]));
    }

    let system_prompt = "Kamu adalah AI Video Director di aplikasi Synkcut. \
        Tugasmu menerapkan revisi kreatif user ke JSON proyek Synkcut secara presisi tanpa merusak path media lokal user. \
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
        .map(|id| format!("\nScene yang sedang dipilih user di Studio: \"{id}\" (jika user menyebut 'scene ini' atau 'scene aktif', fokus ke scene tersebut)."))
        .unwrap_or_default();

    let user_prompt = format!(
        "Proyek saat ini:\n{}{}\n\nInstruksi revisi user: \"{}\"",
        serde_json::to_string(&compact_project).unwrap_or_default(),
        focus_hint,
        instruction.trim()
    );

    let val = call_llm_json(&provider, &api_key, system_prompt, &user_prompt, &[]).await?;
    let reply = val["reply"]
        .as_str()
        .unwrap_or("Revisi berhasil diterapkan pada proyek.")
        .to_string();

    let updated = merge_and_sanitize_copilot_patch(&project, &val);

    Ok(CopilotPatchResponse {
        project: updated,
        reply,
        provider_used: provider,
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
    fn test_copilot_patch_protects_local_media_and_reflows_timings() {
        let orig = json!({
            "globalStyle": { "captionPreset": "bold_pop", "accentColor": "#38E59D" },
            "scenes": [
                {
                    "id": "scene_1",
                    "role": "hook",
                    "startMs": 0,
                    "endMs": 3000,
                    "text": "Hook lama",
                    "media": { "path": "D:\\footage\\clip1.mp4", "trimStartMs": 500, "fit": "cover" },
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
                    "media": { "path": "D:\\footage\\clip2.mp4", "trimStartMs": 0, "fit": "cover" },
                    "motion": { "preset": "static_clean", "intensity": 0.5 },
                    "transitionIn": { "preset": "whip_pan", "durationMs": 200 },
                    "sfx": [],
                    "overlays": []
                }
            ]
        });

        let patch = json!({
            "globalStyle": { "captionPreset": "luxury_editorial" },
            "scenes": [
                {
                    "id": "scene_1",
                    "role": "hook",
                    "startMs": 100,
                    "endMs": 2600,
                    "text": "Hook baru",
                    "media": { "path": null },
                    "motion": { "preset": "smooth_ken_burns", "intensity": 0.7 },
                    "transitionIn": { "preset": "hard_cut", "durationMs": 0 }
                },
                {
                    "id": "scene_2",
                    "role": "cta",
                    "startMs": 9999,
                    "endMs": 12999,
                    "text": "CTA baru",
                    "motion": { "preset": "zoom_punch", "intensity": 0.8 },
                    "transitionIn": { "preset": "pop_zoom", "durationMs": 220 }
                }
            ]
        });

        let merged = merge_and_sanitize_copilot_patch(&orig, &patch);
        assert_eq!(merged["globalStyle"]["captionPreset"], "luxury_editorial");
        assert_eq!(merged["globalStyle"]["accentColor"], "#38E59D");
        assert_eq!(merged["scenes"][0]["media"]["path"], "D:\\footage\\clip1.mp4");
        assert_eq!(merged["scenes"][1]["media"]["path"], "D:\\footage\\clip2.mp4");
        assert_eq!(merged["scenes"][0]["startMs"], 0);
        assert_eq!(merged["scenes"][0]["endMs"], 2500);
        assert_eq!(merged["scenes"][1]["startMs"], 2500);
        assert_eq!(merged["scenes"][1]["endMs"], 5500);
    }
}
