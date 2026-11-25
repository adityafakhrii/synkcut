use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

use crate::audio::{align_words_proportionally, synthesize_tts_with_fallback, WordTimestamp};
use crate::byok;
use crate::motion_skills;
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

fn strip_thinking_blocks(raw: &str) -> String {
    let mut out = raw.to_string();
    loop {
        let lower = out.to_ascii_lowercase();
        let Some(start) = lower.find("<think>") else {
            break;
        };
        if let Some(end_rel) = lower[start..].find("</think>") {
            let end = start + end_rel + "</think>".len();
            out.replace_range(start..end, "");
        } else {
            // Unclosed thinking tag before nothing useful — stop stripping
            break;
        }
    }
    out
}

pub fn strip_json_fences(raw: &str) -> String {
    let no_think = strip_thinking_blocks(raw);
    let trimmed = no_think.trim();

    // Handle ```json ... ``` anywhere inside prose
    if let Some(fence_pos) = trimmed.find("```") {
        let after_open = &trimmed[fence_pos + 3..];
        let body_start = after_open
            .find('\n')
            .map(|i| i + 1)
            .unwrap_or_else(|| {
                if after_open.to_ascii_lowercase().starts_with("json") {
                    4
                } else {
                    0
                }
            });
        let rest = &after_open[body_start..];
        if let Some(close_pos) = rest.find("```") {
            let fenced = rest[..close_pos].trim();
            if !fenced.is_empty() {
                return fenced.to_string();
            }
        }
        return rest.trim_end_matches("```").trim().to_string();
    }

    trimmed.to_string()
}

/// Extract a valid JSON value even if an LLM wraps it in `<think>`, markdown fences, or brief commentary.
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
    // Fallback: try raw without thinking blocks in case a stray ``` appeared inside prose
    let raw_no_think = strip_thinking_blocks(raw);
    if let (Some(start), Some(end)) = (raw_no_think.find('{'), raw_no_think.rfind('}')) {
        if end > start {
            if let Ok(val) = serde_json::from_str::<Value>(&raw_no_think[start..=end]) {
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

fn format_reqwest_error_chain(err: &reqwest::Error) -> String {
    let mut parts = vec![err.to_string()];
    let mut src: Option<&(dyn std::error::Error + 'static)> = std::error::Error::source(err);
    let mut depth = 0;
    while let Some(cause) = src {
        if depth >= 4 {
            break;
        }
        let msg = cause.to_string();
        if !parts.iter().any(|p| p == &msg) {
            parts.push(msg);
        }
        src = cause.source();
        depth += 1;
    }
    parts.join(" -> ")
}

fn extract_text_from_parts_array(arr: &[Value]) -> Option<String> {
    let mut regular = Vec::new();
    let mut fallback = Vec::new();
    for part in arr {
        let is_thought = part["thought"].as_bool() == Some(true)
            || matches!(
                part["type"].as_str(),
                Some("thinking" | "reasoning" | "thought")
            );
        let txt = part["text"]
            .as_str()
            .or_else(|| part["content"].as_str())
            .or_else(|| part.as_str());
        if let Some(s) = txt {
            if !s.is_empty() {
                if is_thought {
                    fallback.push(s);
                } else {
                    regular.push(s);
                }
            }
        }
    }
    if !regular.is_empty() {
        let joined = regular.join("");
        if !joined.trim().is_empty() {
            return Some(joined);
        }
    }
    if let Some(last) = fallback.last() {
        if !last.trim().is_empty() {
            return Some((*last).to_string());
        }
    }
    None
}

pub fn extract_gemini_text(val: &Value) -> Option<String> {
    if let Some(parts) = val["candidates"][0]["content"]["parts"].as_array() {
        if let Some(txt) = extract_text_from_parts_array(parts) {
            return Some(txt);
        }
    }
    val["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(ToString::to_string)
}

pub fn extract_openai_message_text(val: &Value) -> Option<String> {
    // 1. Standard OpenAI Chat Completions: choices[0].message.content
    let msg_content = &val["choices"][0]["message"]["content"];
    if let Some(s) = msg_content.as_str() {
        if !s.trim().is_empty() {
            return Some(s.to_string());
        }
    }
    if let Some(arr) = msg_content.as_array() {
        if let Some(joined) = extract_text_from_parts_array(arr) {
            return Some(joined);
        }
    }

    // 2. Streaming delta chunk: choices[0].delta.content
    let delta_content = &val["choices"][0]["delta"]["content"];
    if let Some(s) = delta_content.as_str() {
        if !s.trim().is_empty() {
            return Some(s.to_string());
        }
    }
    if let Some(arr) = delta_content.as_array() {
        if let Some(joined) = extract_text_from_parts_array(arr) {
            return Some(joined);
        }
    }

    // 3. Legacy completions: choices[0].text
    if let Some(s) = val["choices"][0]["text"].as_str() {
        if !s.trim().is_empty() {
            return Some(s.to_string());
        }
    }

    // 4. OpenAI Responses API: output_text or output[].content[].text
    if let Some(s) = val["output_text"].as_str() {
        if !s.trim().is_empty() {
            return Some(s.to_string());
        }
    }
    if let Some(outputs) = val["output"].as_array() {
        let mut chunks = Vec::new();
        for item in outputs {
            if let Some(content_arr) = item["content"].as_array() {
                if let Some(t) = extract_text_from_parts_array(content_arr) {
                    chunks.push(t);
                }
            }
        }
        let joined = chunks.join("\n");
        if !joined.trim().is_empty() {
            return Some(joined);
        }
    }

    // 5. Ollama native /api/chat and /api/generate
    if let Some(s) = val["message"]["content"].as_str() {
        if !s.trim().is_empty() {
            return Some(s.to_string());
        }
    }
    if let Some(s) = val["response"].as_str() {
        if !s.trim().is_empty() {
            return Some(s.to_string());
        }
    }

    // 6. Anthropic Messages API: content[].text
    if let Some(arr) = val["content"].as_array() {
        if let Some(joined) = extract_text_from_parts_array(arr) {
            return Some(joined);
        }
    }

    // 7. Gemini format returned via proxy
    if let Some(gem) = extract_gemini_text(val) {
        return Some(gem);
    }

    None
}

pub fn extract_api_error_message(val: &Value) -> Option<String> {
    let err = val.get("error")?;
    if err.is_null() {
        return None;
    }
    if let Some(s) = err.as_str() {
        let t = s.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    if let Some(msg) = err["message"].as_str() {
        let t = msg.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    Some(err.to_string().chars().take(220).collect())
}

fn extract_stream_chunk_delta(chunk: &Value) -> Option<String> {
    // OpenAI chat completions SSE delta
    if let Some(s) = chunk["choices"][0]["delta"]["content"].as_str() {
        if !s.is_empty() {
            return Some(s.to_string());
        }
    }
    if let Some(arr) = chunk["choices"][0]["delta"]["content"].as_array() {
        if let Some(t) = extract_text_from_parts_array(arr) {
            return Some(t);
        }
    }
    if let Some(s) = chunk["choices"][0]["text"].as_str() {
        if !s.is_empty() {
            return Some(s.to_string());
        }
    }
    // OpenAI Responses API SSE delta
    if chunk["type"].as_str() == Some("response.output_text.delta") {
        if let Some(s) = chunk["delta"].as_str() {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    // Anthropic SSE content_block_delta / content_block_start
    if chunk["delta"]["type"].as_str() != Some("thinking_delta") {
        if let Some(s) = chunk["delta"]["text"].as_str() {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    if chunk["content_block"]["type"].as_str() == Some("text") {
        if let Some(s) = chunk["content_block"]["text"].as_str() {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    // Gemini SSE
    if let Some(gem) = extract_gemini_text(chunk) {
        return Some(gem);
    }
    // Ollama streaming JSON lines
    if let Some(s) = chunk["message"]["content"].as_str() {
        if !s.is_empty() {
            return Some(s.to_string());
        }
    }
    if let Some(s) = chunk["response"].as_str() {
        if !s.is_empty() {
            return Some(s.to_string());
        }
    }
    None
}

/// Parses an HTTP response body from ANY OpenAI-compatible, Gemini, Anthropic, or Ollama proxy:
/// supports standard JSON, UTF-8 BOM JSON, SSE (`text/event-stream` `data: {...}`), NDJSON,
/// and JSON embedded inside stray wrapper text.
pub fn parse_http_json_or_sse(raw: &str) -> Result<Value, String> {
    let trimmed = raw.trim_start_matches('\u{feff}').trim();
    if trimmed.is_empty() {
        return Err("Server mengembalikan body respons kosong (0 bytes).".to_string());
    }

    // 1. Standard JSON body
    if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
        return Ok(val);
    }

    // 2. Server-Sent Events (SSE): lines like `data: {"choices":[{"delta":{"content":"..."}}]}`
    let mut sse_delta_buf = String::new();
    let mut sse_full_msg: Option<String> = None;
    let mut sse_error: Option<Value> = None;
    let mut saw_sse_data = false;

    for line in trimmed.lines() {
        let clean_line = line.trim();
        if let Some(payload_raw) = clean_line.strip_prefix("data:") {
            saw_sse_data = true;
            let payload = payload_raw.trim();
            if payload.is_empty() || payload == "[DONE]" {
                continue;
            }
            if let Ok(chunk) = serde_json::from_str::<Value>(payload) {
                if sse_error.is_none() && chunk.get("error").is_some_and(|e| !e.is_null()) {
                    sse_error = chunk.get("error").cloned();
                }
                if let Some(delta) = extract_stream_chunk_delta(&chunk) {
                    sse_delta_buf.push_str(&delta);
                } else if let Some(full) = chunk["choices"][0]["message"]["content"].as_str() {
                    if !full.trim().is_empty() {
                        sse_full_msg = Some(full.to_string());
                    }
                }
            }
        }
    }

    if saw_sse_data {
        let final_text = if !sse_delta_buf.trim().is_empty() {
            Some(sse_delta_buf)
        } else {
            sse_full_msg
        };
        if let Some(text) = final_text {
            return Ok(json!({
                "choices": [{ "message": { "content": text } }],
                "candidates": [{ "content": { "parts": [{ "text": text }] } }],
                "_decodedFrom": "sse"
            }));
        }
        if let Some(err_val) = sse_error {
            return Ok(json!({ "error": err_val }));
        }
    }

    // 3. NDJSON (multiple JSON objects separated by newlines, e.g. Ollama / custom streaming proxy)
    let mut ndjson_buf = String::new();
    let mut ndjson_error: Option<Value> = None;
    let mut ndjson_objects = 0usize;
    let mut last_ndjson_val: Option<Value> = None;

    for line in trimmed.lines() {
        let clean_line = line.trim();
        if !clean_line.starts_with('{') {
            continue;
        }
        if let Ok(chunk) = serde_json::from_str::<Value>(clean_line) {
            ndjson_objects += 1;
            if ndjson_error.is_none() && chunk.get("error").is_some_and(|e| !e.is_null()) {
                ndjson_error = chunk.get("error").cloned();
            }
            if let Some(delta) = extract_stream_chunk_delta(&chunk) {
                ndjson_buf.push_str(&delta);
            }
            last_ndjson_val = Some(chunk);
        }
    }

    if ndjson_objects > 0 {
        if !ndjson_buf.trim().is_empty() {
            return Ok(json!({
                "choices": [{ "message": { "content": ndjson_buf } }],
                "candidates": [{ "content": { "parts": [{ "text": ndjson_buf }] } }],
                "_decodedFrom": "ndjson"
            }));
        }
        if let Some(err_val) = ndjson_error {
            return Ok(json!({ "error": err_val }));
        }
        if let Some(val) = last_ndjson_val {
            return Ok(val);
        }
    }

    // 4. Embedded JSON object inside stray prefix/suffix
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if end > start {
            if let Ok(val) = serde_json::from_str::<Value>(&trimmed[start..=end]) {
                return Ok(val);
            }
        }
    }

    let preview: String = trimmed.chars().take(180).collect();
    Err(format!(
        "Respons server bukan JSON/SSE yang valid. Cuplikan body: {preview}"
    ))
}

/// Safely reads and decodes an HTTP response body into JSON across standard JSON,
/// gzip/brotli-compressed bodies, UTF-8 BOM, SSE streams, and NDJSON — with clear
/// diagnostic errors instead of opaque `error decoding response body`.
pub async fn decode_llm_http_body(res: reqwest::Response) -> Result<Value, String> {
    let status = res.status().as_u16();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    let bytes = res.bytes().await.map_err(|e| {
        format!(
            "Gagal membaca body respons HTTP {status} (Content-Type: {content_type}): {}",
            format_reqwest_error_chain(&e)
        )
    })?;

    let raw_text = String::from_utf8_lossy(&bytes);
    parse_http_json_or_sse(&raw_text)
        .map_err(|e| format!("Gagal decode respons HTTP {status} ({content_type}): {e}"))
}

/// Calls Gemini / OpenAI / OpenRouter / Custom OpenAI-compatible model with optional base64
/// images, enforces JSON output, and automatically falls back when models return 404/503/429
/// or when custom proxies stream SSE / reject `response_format` / reject vision images.
pub async fn call_llm_json(
    resolved: &byok::ResolvedProvider,
    system_prompt: &str,
    user_prompt: &str,
    image_data_urls: &[String],
) -> Result<(Value, String), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(240))
        .build()
        .map_err(|e| format!("Gagal membuat HTTP client: {e}"))?;

    match resolved.provider.as_str() {
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
                .connect_timeout(std::time::Duration::from_secs(12))
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .map_err(|e| format!("Gagal membuat HTTP client: {e}"))?;

            let mut last_err = String::from("Gagal menghubungi Gemini API.");

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
                    Err(e) => {
                        return Err(format!(
                            "Gagal menghubungi Gemini API: {}",
                            format_reqwest_error_chain(&e)
                        ))
                    }
                };

                let status = res.status().as_u16();
                if res.status().is_success() {
                    let val = match decode_llm_http_body(res).await {
                        Ok(v) => v,
                        Err(e) => {
                            last_err = format!("Gemini ({candidate}) {e}");
                            continue;
                        }
                    };
                    if let Some(api_err) = extract_api_error_message(&val) {
                        last_err = format!("Gemini ({candidate}) error: {api_err}");
                        continue;
                    }
                    if let Some(txt) = extract_gemini_text(&val) {
                        match parse_llm_json(&txt) {
                            Ok(parsed) => {
                                return Ok((parsed, format!("{} · {}", resolved.provider, candidate)));
                            }
                            Err(e) => {
                                last_err = format!("Gemini ({candidate}): {e}");
                                continue;
                            }
                        }
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

            Err(last_err)
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

            'model_loop: for candidate in candidates {
                let mut use_json_mode = true;
                let mut include_images = !image_data_urls.is_empty();
                let mut include_temperature = true;
                let mut reinforce_json_prompt = false;

                for _attempt in 0..4 {
                    let effective_user_prompt = if reinforce_json_prompt {
                        format!(
                            "{user_prompt}\n\nPENTING: Balas HANYA satu objek JSON valid tanpa markdown dan tanpa teks di luar JSON."
                        )
                    } else {
                        user_prompt.to_string()
                    };

                    let user_message = if include_images {
                        let mut content: Vec<Value> =
                            vec![json!({ "type": "text", "text": effective_user_prompt })];
                        for data_url in image_data_urls.iter().take(8) {
                            content.push(json!({
                                "type": "image_url",
                                "image_url": { "url": data_url }
                            }));
                        }
                        json!({ "role": "user", "content": content })
                    } else {
                        json!({ "role": "user", "content": effective_user_prompt })
                    };

                    let mut payload = json!({
                        "model": candidate,
                        "stream": false,
                        "messages": [
                            { "role": "system", "content": system_prompt },
                            user_message
                        ]
                    });
                    if include_temperature {
                        payload["temperature"] = json!(0.55);
                    }
                    if use_json_mode {
                        payload["response_format"] = json!({ "type": "json_object" });
                    }

                    let mut req = client
                        .post(&endpoint)
                        .header(reqwest::header::ACCEPT, "application/json, text/event-stream")
                        .json(&payload);
                    if !resolved.api_key.trim().is_empty() {
                        req = req.bearer_auth(&resolved.api_key);
                    }
                    if resolved.provider == "openrouter" {
                        req = req
                            .header("HTTP-Referer", "https://synkcut.app")
                            .header("X-Title", "Synkcut Studio");
                    }

                    let res = match req.send().await {
                        Ok(r) => r,
                        Err(e) => {
                            last_err = format!(
                                "Gagal menghubungi {} API ({endpoint}): {}",
                                resolved.provider,
                                format_reqwest_error_chain(&e)
                            );
                            if include_images {
                                include_images = false;
                                continue;
                            }
                            if use_json_mode {
                                use_json_mode = false;
                                reinforce_json_prompt = true;
                                continue;
                            }
                            return Err(last_err);
                        }
                    };

                    let status = res.status().as_u16();
                    if res.status().is_success() {
                        let val = match decode_llm_http_body(res).await {
                            Ok(v) => v,
                            Err(decode_err) => {
                                last_err = format!(
                                    "{} ({candidate}): {decode_err}",
                                    resolved.provider
                                );
                                if include_images {
                                    include_images = false;
                                    continue;
                                }
                                if use_json_mode {
                                    use_json_mode = false;
                                    reinforce_json_prompt = true;
                                    continue;
                                }
                                continue 'model_loop;
                            }
                        };

                        // Some proxies wrap provider errors inside HTTP 200 JSON!
                        if let Some(api_err) = extract_api_error_message(&val) {
                            let lower_err = api_err.to_lowercase();
                            last_err = format!(
                                "{} API error (model {candidate}): {api_err}",
                                resolved.provider
                            );
                            if include_images
                                && (lower_err.contains("image")
                                    || lower_err.contains("vision")
                                    || lower_err.contains("multimodal")
                                    || lower_err.contains("content"))
                            {
                                include_images = false;
                                continue;
                            }
                            if include_temperature && lower_err.contains("temperature") {
                                include_temperature = false;
                                continue;
                            }
                            if use_json_mode {
                                use_json_mode = false;
                                reinforce_json_prompt = true;
                                continue;
                            }
                            continue 'model_loop;
                        }

                        if let Some(txt) = extract_openai_message_text(&val) {
                            match parse_llm_json(&txt) {
                                Ok(parsed) => {
                                    return Ok((
                                        parsed,
                                        format!("{} · {}", resolved.provider, candidate),
                                    ));
                                }
                                Err(parse_err) => {
                                    last_err = format!(
                                        "{} ({candidate}): {parse_err}",
                                        resolved.provider
                                    );
                                    if use_json_mode {
                                        use_json_mode = false;
                                        reinforce_json_prompt = true;
                                        continue;
                                    }
                                    if !reinforce_json_prompt {
                                        reinforce_json_prompt = true;
                                        continue;
                                    }
                                    continue 'model_loop;
                                }
                            }
                        }

                        last_err = format!("Respons {} ({candidate}) kosong.", resolved.provider);
                        if include_images {
                            include_images = false;
                            continue;
                        }
                        if use_json_mode {
                            use_json_mode = false;
                            reinforce_json_prompt = true;
                            continue;
                        }
                        continue 'model_loop;
                    }

                    let body_txt = res.text().await.unwrap_or_default();
                    let lower_body = body_txt.to_lowercase();
                    last_err = format!(
                        "{} API error (HTTP {status}, model {candidate}): {}",
                        resolved.provider,
                        body_txt.chars().take(220).collect::<String>()
                    );

                    if matches!(status, 400 | 422 | 500)
                        && include_images
                        && (lower_body.contains("image")
                            || lower_body.contains("vision")
                            || lower_body.contains("multimodal")
                            || lower_body.contains("content"))
                    {
                        include_images = false;
                        continue;
                    }
                    if matches!(status, 400 | 422)
                        && include_temperature
                        && lower_body.contains("temperature")
                    {
                        include_temperature = false;
                        continue;
                    }
                    if matches!(status, 400 | 422 | 500 | 502) && use_json_mode {
                        use_json_mode = false;
                        reinforce_json_prompt = true;
                        continue;
                    }
                    if status == 404 || status == 503 {
                        continue 'model_loop;
                    }
                    return Err(last_err);
                }
            }

            Err(last_err)
        }
        _ => Err(format!("Provider tidak didukung: {}", resolved.provider)),
    }
}

/// Strip stage directions, timestamps, and visual notes so TTS & captions ONLY contain pure spoken words!
pub fn sanitize_spoken_vo_line(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return s;
    }

    // If the LLM wrote `... VO: "actual spoken words" ...`, extract the spoken part cleanly!
    let lower = s.to_lowercase();
    if let Some(vo_pos) = lower.find("vo:") {
        let after = s[vo_pos + 3..].trim();
        let cleaned_after = after
            .trim_start_matches(['"', '“', '”', '\'', ' '])
            .split("Subtitle")
            .next()
            .unwrap_or(after)
            .split("[Visual")
            .next()
            .unwrap_or(after)
            .trim()
            .trim_end_matches(['"', '“', '”', '\'', ' ']);
        if cleaned_after.split_whitespace().count() >= 3 {
            s = cleaned_after.to_string();
        }
    }

    // Strip leading timestamp patterns like `0-3 detik |`, `3–15 detik:`, `00:05 - 00:12 |`
    if let Some(pipe_pos) = s.find('|') {
        let prefix = s[..pipe_pos].to_lowercase();
        if prefix.contains("detik") || prefix.contains("scene") || prefix.contains("beat") || prefix.contains(':') {
            s = s[pipe_pos + 1..].trim().to_string();
        }
    }

    // Strip bracketed stage directions like `[Kamera zoom ke laptop]` or `(3D diorama)`
    let mut out = String::with_capacity(s.len());
    let mut bracket_depth = 0usize;
    for ch in s.chars() {
        match ch {
            '[' => bracket_depth += 1,
            ']' => bracket_depth = bracket_depth.saturating_sub(1),
            _ if bracket_depth == 0 => out.push(ch),
            _ => {}
        }
    }

    // Remove trailing cue phrases like "Subtitle tebal di tengah."
    let mut cleaned = out.trim().to_string();
    for cue in [
        "Subtitle tebal di tengah.",
        "Subtitle tebal di tengah",
        "Subtitle di tengah.",
        "Subtitle di tengah",
    ] {
        cleaned = cleaned.replace(cue, "");
    }

    cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Rescale beat timings proportionally so the entire video timeline matches `target_duration_ms` 100%!
pub fn rescale_beats_to_duration(beats: &mut [StoryboardBeat], target_duration_ms: u64) {
    if beats.is_empty() || target_duration_ms < 1000 {
        return;
    }
    let old_total = beats.iter().map(|b| b.end_ms).max().unwrap_or(0);
    if old_total > 0 && old_total.abs_diff(target_duration_ms) <= 180 {
        if let Some(last) = beats.last_mut() {
            last.end_ms = target_duration_ms;
        }
        return;
    }

    // Use word count weights if old_total is 0 or heavily skewed (e.g. last beat stuck at 20s)
    let word_counts: Vec<usize> = beats
        .iter()
        .map(|b| b.text.split_whitespace().count().max(1))
        .collect();
    let total_words: usize = word_counts.iter().sum::<usize>().max(1);
    let mut cursor = 0u64;
    let n = beats.len();
    for (i, beat) in beats.iter_mut().enumerate() {
        beat.start_ms = cursor;
        if i == n - 1 {
            beat.end_ms = target_duration_ms;
        } else {
            let span = (((word_counts[i] as f64) / (total_words as f64)) * (target_duration_ms as f64))
                .round()
                .max(700.0) as u64;
            let remaining_min = ((n - 1 - i) as u64) * 600;
            let end = (cursor + span).min(target_duration_ms.saturating_sub(remaining_min));
            beat.end_ms = end.max(cursor + 500);
            cursor = beat.end_ms;
        }
    }
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
        _ => 4,
    };

    let system_prompt = "Kamu adalah Creative Director & Copywriter video pendek (Reels, TikTok, Shorts) kelas dunia di Indonesia.\n\
        ATURAN KERAS WAJIB:\n\
        1. Tulis HANYA kalimat lisan (spoken-word voiceover) yang BENAR-BENAR DIUCAPKAN narator dengan suara lantang — mengalir natural, tajam, langsung stop-scroll di 3 detik pertama.\n\
        2. DILARANG KERAS memasukkan arahan visual, arahan kamera, timestamp, label 'VO:', 'Narator:', '3–15 detik |', '3D diorama:', 'Kartu teks:', 'Subtitle tebal di tengah', atau tanda kurung siku `[...]` ke dalam `hooks`, `bodySegments`, maupun `cta`! Jika prompt user berisi poin-poin arahan visual, ubah maknanya menjadi kalimat narasi lisan yang mulus.\n\
        3. Sesuaikan panjang kata dengan target durasi (~2.3 kata per detik; misal 60 detik = ~125-145 kata total, 30 detik = ~65-75 kata total).\n\
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
            let cleaned = sanitize_spoken_vo_line(h["text"].as_str().unwrap_or(""));
            hooks.push(HookOption {
                id: h["id"]
                    .as_str()
                    .map(ToString::to_string)
                    .unwrap_or_else(|| format!("h{}", i + 1)),
                angle: h["angle"].as_str().unwrap_or("Hook").to_string(),
                text: cleaned,
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
                .filter_map(|v| v.as_str().map(sanitize_spoken_vo_line))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_else(|| vec!["Tunjukkan keunggulan utama produk secara langsung.".to_string()]);

    let cta = sanitize_spoken_vo_line(
        val["cta"]
            .as_str()
            .unwrap_or("Cek link sekarang sebelum promo berakhir!"),
    );

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
        // Guard against compressed/mismatched word timestamps stretching the last beat into a long silent tail!
        let last_word_end = words.last().map(|w| w.end_ms).unwrap_or(0);
        let word_scale = if last_word_end > 0 {
            let ratio = (last_word_end as f64) / (safe_total as f64);
            if !(0.86..=1.04).contains(&ratio) {
                (safe_total as f64) / (last_word_end as f64)
            } else {
                1.0
            }
        } else {
            1.0
        };

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

            let remaining_min = ((counts.len() - 1 - i) as u64) * 600;
            let end_ms = if i == counts.len() - 1 {
                safe_total
            } else {
                words
                    .get(next_idx.saturating_sub(1))
                    .map(|w| ((w.end_ms as f64) * word_scale).round() as u64)
                    .unwrap_or(start_ms + 1500)
                    .max(start_ms + 700)
                    .min(safe_total.saturating_sub(remaining_min))
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

/// Sanitize any LLM-produced `aiMotion` JSON so frontend renderers NEVER crash on missing fields
/// AND NEVER inject unrelated sample assets (like smartphone breakdowns into a coffee video!).
pub fn sanitize_ai_motion_value(raw: &Value, fallback_text: &str, default_theme: &str) -> Value {
    let eng = raw["engine"]
        .as_str()
        .filter(|e| {
            matches!(
                *e,
                "diorama_3d"
                    | "custom_code"
                    | "flow_diagram"
                    | "motion_chart"
                    | "tech_cards"
                    | "stick_figure"
                    | "breakdown_3d"
            )
        })
        .unwrap_or("custom_code");

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
        "diorama_3d" => {
            let d3 = raw.get("diorama3d").filter(|v| v.is_object());
            let setup_code = d3
                .and_then(|v| v["setupCode"].as_str())
                .map(clean_js_code_output)
                .unwrap_or_default();
            let animate_code = d3
                .and_then(|v| v["animateCode"].as_str())
                .map(clean_js_code_output)
                .unwrap_or_default();
            let visual_concept = d3
                .and_then(|v| v["visualConcept"].as_str())
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| format!("Visual 3D Diorama untuk: {title}"));
            let world_preset = d3
                .and_then(|v| v["worldPreset"].as_str())
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("ground_cutaway");
            let skills_used: Vec<String> = d3
                .and_then(|v| v["skillsUsed"].as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(ToString::to_string))
                        .collect()
                })
                .unwrap_or_else(|| vec!["3d-diorama-storytelling".to_string()]);
            json!({
                "engine": "diorama_3d",
                "theme": theme,
                "title": title,
                "subtitle": subtitle,
                "takeaway": takeaway,
                "diorama3d": {
                    "setupCode": setup_code,
                    "animateCode": animate_code,
                    "visualConcept": visual_concept,
                    "worldPreset": world_preset,
                    "cameraNote": d3.and_then(|v| v["cameraNote"].as_str()).unwrap_or(""),
                    "skillsUsed": skills_used,
                    "verified": d3.and_then(|v| v["verified"].as_bool()).unwrap_or(false)
                }
            })
        }
        "custom_code" => {
            let cc = raw.get("customCode").filter(|v| v.is_object());
            let code = cc
                .and_then(|v| v["code"].as_str())
                .or_else(|| raw["code"].as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let visual_concept = cc
                .and_then(|v| v["visualConcept"].as_str())
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| format!("Visual motion kustom untuk: {title}"));
            let emotional_intent = cc
                .and_then(|v| v["emotionalIntent"].as_str())
                .filter(|s| matches!(*s, "playful" | "bold" | "calm" | "urgent" | "luxury" | "editorial"))
                .unwrap_or("bold");
            let skills_used: Vec<String> = cc
                .and_then(|v| v["skillsUsed"].as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(ToString::to_string))
                        .collect()
                })
                .unwrap_or_else(|| vec!["motion-craft-physics".to_string(), "kinetic-typography".to_string()]);
            json!({
                "engine": "custom_code",
                "theme": theme,
                "title": title,
                "subtitle": subtitle,
                "takeaway": takeaway,
                "customCode": {
                    "code": code,
                    "visualConcept": visual_concept,
                    "emotionalIntent": emotional_intent,
                    "skillsUsed": skills_used,
                    "verified": cc.and_then(|v| v["verified"].as_bool()).unwrap_or(false)
                }
            })
        }
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
                    // Derive steps strictly from the beat's real narration text (NEVER dummy Masukan/Proses/Validasi!)
                    let words: Vec<&str> = fallback_text.split_whitespace().collect();
                    if words.len() >= 6 {
                        let chunk_sz = (words.len() / 3).max(2);
                        words
                            .chunks(chunk_sz)
                            .take(3)
                            .map(|c| c.join(" "))
                            .collect()
                    } else if !fallback_text.trim().is_empty() {
                        vec![fallback_text.trim().to_string()]
                    } else {
                        vec![title.clone()]
                    }
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

/// Zero-Sample-Asset fallback: NEVER picks unrelated smartphone 3D breakdowns or dummy diagrams!
/// Falls back cleanly to `custom_code` (which renders pure brand-styled dynamic kinetic typography of the real beat text)
/// when LLM custom code is unavailable.
fn build_fallback_ai_motion(
    _role: &str,
    _scene_idx: usize,
    text: &str,
    project_title: &str,
    theme: &str,
    _preferred_engines: &[String],
) -> Value {
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

    sanitize_ai_motion_value(
        &json!({
            "engine": "custom_code",
            "theme": theme,
            "title": title,
            "subtitle": project_title,
            "customCode": {
                "code": "",
                "visualConcept": format!("Tipografi kinetik dinamis untuk: {title}"),
                "emotionalIntent": "bold",
                "skillsUsed": ["motion-craft-physics", "kinetic-typography"],
                "verified": true
            }
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

    // 1.5. Deep-merge unified `world3d` if AI Copilot edited 3D Diorama setup/animation
    if let Some(new_w3) = patch.get("world3d") {
        if new_w3.is_null() {
            updated["world3d"] = Value::Null;
        } else if let Some(w3_obj) = new_w3.as_object() {
            let orig_w3 = original.get("world3d").and_then(Value::as_object);
            let raw_setup = w3_obj
                .get("setupCode")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty() && *s != "[3d-world-setup-preserved]")
                .map(clean_js_code_output)
                .or_else(|| {
                    orig_w3
                        .and_then(|o| o.get("setupCode").and_then(Value::as_str))
                        .map(ToString::to_string)
                })
                .unwrap_or_default();
            let raw_anim = w3_obj
                .get("animateCode")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty() && *s != "[3d-world-animate-preserved]")
                .map(clean_js_code_output)
                .or_else(|| {
                    orig_w3
                        .and_then(|o| o.get("animateCode").and_then(Value::as_str))
                        .map(ToString::to_string)
                })
                .unwrap_or_default();
            let world_preset = w3_obj
                .get("worldPreset")
                .and_then(Value::as_str)
                .or_else(|| orig_w3.and_then(|o| o.get("worldPreset").and_then(Value::as_str)))
                .unwrap_or("ground_cutaway")
                .to_string();
            let summary = w3_obj
                .get("summary")
                .and_then(Value::as_str)
                .or_else(|| orig_w3.and_then(|o| o.get("summary").and_then(Value::as_str)))
                .unwrap_or("3D Diorama World")
                .to_string();
            updated["world3d"] = json!({
                "setupCode": raw_setup,
                "animateCode": raw_anim,
                "worldPreset": world_preset,
                "summary": summary,
                "verified": false
            });
            updated["version"] = json!("2.1");
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
                let has_diorama = reflowed.iter().any(|s| s["aiMotion"]["engine"] == "diorama_3d")
                    || updated.get("world3d").is_some_and(Value::is_object);
                let has_custom = reflowed.iter().any(|s| s["aiMotion"]["engine"] == "custom_code");
                if has_diorama {
                    updated["version"] = json!("2.1");
                } else if has_custom {
                    updated["version"] = json!("2.0");
                } else if reflowed.iter().any(|s| s["visualSource"] == "motion") {
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

    // Send a compact summary (omit huge words[], base64 thumbnails, and unselected scene codes to save BYOK tokens!)
    let mut compact_project = project.clone();
    if let Some(vo) = compact_project.get_mut("voiceover").and_then(Value::as_object_mut) {
        vo.insert("words".to_string(), json!([]));
    }
    if let Some(sr) = compact_project.get_mut("styleReference").and_then(Value::as_object_mut) {
        sr.insert("thumbnails".to_string(), json!([]));
        if sr.get("logoDataUrl").is_some() {
            sr.insert("logoDataUrl".to_string(), json!("[brand-logo-loaded]"));
        }
    }
    if let Some(scenes_arr) = compact_project.get_mut("scenes").and_then(Value::as_array_mut) {
        for s in scenes_arr.iter_mut() {
            let sid = s["id"].as_str().unwrap_or("");
            let is_selected = selected_scene_id.as_deref() == Some(sid);
            if !is_selected {
                if let Some(cc) = s
                    .get_mut("aiMotion")
                    .and_then(|m| m.get_mut("customCode"))
                    .and_then(Value::as_object_mut)
                {
                    cc.insert("code".to_string(), json!("[custom-motion-code-preserved]"));
                }
            }
        }
    }

    let has_3d_world = project.get("world3d").is_some_and(Value::is_object)
        || instruction.to_lowercase().contains("3d")
        || instruction.to_lowercase().contains("diorama")
        || instruction.to_lowercase().contains("karakter")
        || instruction.to_lowercase().contains("kamera");

    let active_skills_text = motion_skills::build_active_skills_prompt(
        &app,
        &[
            if has_3d_world {
                "3d-diorama-storytelling".to_string()
            } else {
                "motion-craft-physics".to_string()
            },
            "procedural-illustration-svg".to_string(),
            "kinetic-typography".to_string(),
            "product-ui-brand-storytelling".to_string(),
        ],
    );

    let extra_3d_ref = if has_3d_world {
        format!("\n\n{DIORAMA_3D_SDK_REFERENCE}")
    } else {
        String::new()
    };

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

    let system_prompt = format!(
        "Kamu adalah AI Video, 3D Diorama & Freeform Motion Director di aplikasi Synkcut v2.1.\n\
        Tugasmu menerapkan revisi kreatif user ke JSON proyek Synkcut secara presisi tanpa merusak path media lokal atau field wajib.\n\
        ATURAN KERAS:\n\
        1. Selalu kembalikan SEMUA scene proyek di array `scenes` (atau hanya scene target jika edit 1 scene), JANGAN hapus scene lain kecuali user minta menghapus.\n\
        2. JANGAN PERNAH memakai aset contoh / placeholder generik (seperti smartphone untuk topik kopi, atau label 'Masukan/Proses Inti').\n\
        3. Untuk mengubah dunia 3D Diorama (Three.js PBR), kembalikan field root `world3d`: {{\"setupCode\": \"...\", \"animateCode\": \"...\", \"worldPreset\": \"...\", \"summary\": \"...\"}} dan pastikan scene memakai `aiMotion.engine: \"diorama_3d\"`.\n\
        4. Untuk mengubah visual AI Motion 2D secara BEBAS / CUSTOM (tanpa template!), set `visualSource: \"motion\"` dan `aiMotion`: {{\n\
           \"engine\": \"custom_code\", \"theme\": \"carbon|paper\", \"title\": \"...\",\n\
           \"customCode\": {{\n\
             \"visualConcept\": \"deskripsi singkat visual baru\",\n\
             \"emotionalIntent\": \"playful|bold|calm|urgent|luxury|editorial\",\n\
             \"skillsUsed\": [\"motion-craft-physics\", \"procedural-illustration-svg\"],\n\
             \"code\": \"// Pure JS body of renderBeat(ctx, state, M) — lihat Motion SDK M di bawah!\"\n\
           }}\n\
        }}\n\
        5. Jika scene lain tidak diubah dan kode-nya bertuliskan \"[custom-motion-code-preserved]\", biarkan saja atau jangan ubah scene itu (backend otomatis mempertahankan kode aslinya!).\n\
        6. Untuk mengganti klip footage/cut: ubah `footageIndex` (atau `media.path`) dan `media.trimStartMs`.\n\
        7. Untuk mengubah arahan desain custom / gaya subtitle (termasuk \"black_pill\", \"outline_bold\", \"clean_shadow\", `captionPlacement: \"center_middle\"`): ubah `globalStyle.customDesign`.\n\
        8. Nilai captionPreset: bold_pop, clean_minimal, kinetic_punch, luxury_editorial, neon_tech.\n\
        9. Nilai transitionIn.preset: hard_cut, whip_pan, pop_zoom, glitch_flash, smooth_crossfade.\n\
        10. Nilai sfx[].preset: whoosh_fast, whoosh_soft, pop_text, ding_notif, impact_boom, riser, camera_shutter, keyboard_click, cash_register, vinyl_scratch, glitch_zap, swoosh_reverse.\n\n\
        {sdk_ref}{extra_3d_ref}\n\n\
        {active_skills_text}\n\n\
        Balas HANYA dalam JSON: {{\"reply\":\"ringkasan singkat Bahasa Indonesia apa yang diubah\",\"world3d\":{{...opsional jika 3D...}},\"globalStyle\":{{...}},\"scenes\":[...]}}",
        sdk_ref = MOTION_SDK_COMPACT_REFERENCE
    );

    let focus_hint = selected_scene_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|id| format!("\nScene yang sedang dipilih user di Studio: \"{id}\" (jika user menyebut 'scene ini' atau 'beat ini', fokus ubah scene tersebut)."))
        .unwrap_or_default();

    let user_prompt = format!(
        "Proyek saat ini:\n{}{}{}\n\nInstruksi revisi user: \"{}\"",
        serde_json::to_string(&compact_project).unwrap_or_default(),
        footage_hint,
        focus_hint,
        instruction.trim()
    );

    let (mut val, provider_used) = call_llm_json(&resolved, &system_prompt, &user_prompt, &[]).await?;
    // Restore any `[custom-motion-code-preserved]` markers from original project before merging!
    if let (Some(orig_scenes), Some(patch_scenes)) = (
        project.get("scenes").and_then(Value::as_array),
        val.get_mut("scenes").and_then(Value::as_array_mut),
    ) {
        for ps in patch_scenes.iter_mut() {
            let sid = ps["id"].as_str().unwrap_or("");
            let code_marker = ps["aiMotion"]["customCode"]["code"].as_str().unwrap_or("");
            if code_marker == "[custom-motion-code-preserved]" || code_marker.trim().is_empty() {
                if let Some(orig) = orig_scenes.iter().find(|o| o["id"].as_str() == Some(sid)) {
                    if let Some(orig_code) = orig["aiMotion"]["customCode"]["code"].as_str() {
                        if let Some(cc) = ps
                            .get_mut("aiMotion")
                            .and_then(|m| m.get_mut("customCode"))
                            .and_then(Value::as_object_mut)
                        {
                            cc.insert("code".to_string(), Value::String(orig_code.to_string()));
                        }
                    }
                }
            }
        }
    }

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

/* ==================== V2.0 FREEFORM AI MOTION ENGINE (ZERO SAMPLE ASSETS) ==================== */

const MOTION_SDK_COMPACT_REFERENCE: &str = r#"=== SYNKCUT MOTION SDK `M` (Pure JS Body of `renderBeat(ctx, state, M)`) ===
Contract: Write ONLY the pure JavaScript body of `function renderBeat(ctx, state, M) { ... }`.
NO `window`, `document`, `fetch`, `eval`, `import`, `setTimeout`, or infinite loops. Every frame MUST be deterministic from `state`.
`state` fields:
- `frame` (float), `fps` (30|60), `totalFrames`, `timeMs`, `durationMs`, `progress` (0..1)
- `width`, `height`, `u` (= width / 1080 — ALWAYS multiply pixel sizes/radii/fonts by `u`!)
- `text` (narration string), `title`, `role` ("hook"|"body"|"cta")
- `words`: [{ word, startMs, endMs }] (relative to beat start!), `activeWordIndex`
- `hasBrandLogo` (bool)
- `design.isLight`, `design.palette`: { bgTop, bgBottom, surfaceBg, surfaceBorder, textPrimary, textSecondary, accentPrimary, accentSecondary, accentInk }
`M` helpers:
- `M.spring(frame, fps, { stiffness=180, damping=18, mass=1, delay=0, from=0, to=1 })` -> smooth spring number
- `M.interpolate(val, [in0, in1], [out0, out1], { easing?, extrapolateLeft='clamp', extrapolateRight='clamp' })`
- `M.stagger(index, delayFrames, frame, fps, springCfg?)` -> staggered 0..1 spring
- `M.clamp(v, a=0, b=1)`, `M.lerp(a, b, t)`, `M.rng(seed)` -> deterministic () => 0..1, `M.withAlpha(color, alpha)`
- `M.ease`: `.outCubic`, `.inCubic`, `.inOutCubic`, `.outExpo`, `.inOutQuart`, `.backOut`, `.anticipation`, `.bezier(x1,y1,x2,y2)`
- `M.squash(impact01, strength=0.18)` -> `{ sx, sy }` (area-conserving squash & stretch)
- `M.wordHit(state, keyword)` -> 0 before spoken, ramps 0..1 when keyword is spoken!
- `M.withCamera(ctx, state, { zoom=1, panX=0, panY=0, rotateDeg=0, shake=0 }, () => { ... })`
- `M.drawBackdrop(ctx, state, { pattern?, glowX?, glowY?, glowColor?, glowAlpha?, vignette? })` -> ALWAYS call FIRST!
- `M.drawBrandLogo(ctx, state, cx, cy, maxW, maxH, alpha=1)` -> draws authentic brand logo if `state.hasBrandLogo`
- `M.font(kind, weight, sizePx)` -> kind: 'heading'|'body'|'mono'|'display'|'serif'
- `M.wrapText(ctx, text, maxW)` -> string[], `M.fitText(ctx, text, maxW, startPx, minPx=24, kind='heading', weight=800)`
- `M.drawRoundRect(ctx, x, y, w, h, r)`
- `M.drawCard(ctx, state, x, y, w, h, { radius?, highlighted?, fill?, border? })`
- `M.drawPill(ctx, state, text, cx, cy, { fill?, textColor?, fontSize?, padX?, padY?, kind? })`
- `M.drawMaskedText(ctx, text, x, y, progress, { font?, color?, align='center', direction='up', maxWidth?, lineHeight? })`
- `M.drawKineticHeadline(ctx, state, text, cx, cy, { maxWidth?, fontSize?, color?, accentColor?, highlightWord?, delayFrames=3 })`
- `M.drawSvgPath(ctx, pathData, { x=0, y=0, scale=1, stroke?, fill?, lineWidth=4, strokeProgress=1, glowColor?, glowBlur=0 })`
- `M.drawLiquidWave(ctx, x, y, w, h, fillRatio, colorTop, colorBottom, phase, amplitude=10)`
- `M.drawBrowserWindow(ctx, state, x, y, w, h, { url, typedProgress=1, contentFn? })`
- `M.drawCursor(ctx, x, y, { clickProgress=0, scale=1, color='#FFFFFF', rippleColor? })`
- `M.drawCounter(ctx, cx, cy, { from=0, to=100, progress, prefix='', suffix='', decimals=0, fontSize=110, color?, kind='display' })`
- `M.drawProgressRing(ctx, cx, cy, r, progress, { color?, trackColor?, lineWidth?, label?, labelColor? })`
- `M.drawParticles(ctx, cx, cy, count, progress, { seed=1, color?, color2?, spread=260, size=10, shape='circle'|'star'|'rect' })`
- `M.drawSpotlight(ctx, cx, cy, radius, color, alpha=0.28)`
CRITICAL LAYOUT RULE: Keep hero visuals inside `y = height * 0.11 .. height * 0.68` and `x = width * 0.08 .. width * 0.92` so bottom captions (`y = 74%..88%`) NEVER overlap!"#;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoryboardBeat {
    pub id: String,
    pub role: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub title: String,
    pub visual_concept: String,
    pub emotional_intent: String,
    pub skills_used: Vec<String>,
    pub transition_in: String,
    pub sfx: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStoryboardRequest {
    pub project_title: String,
    pub format: String,
    pub full_script: String,
    pub duration_ms: u64,
    #[serde(default)]
    pub words: Vec<WordTimestamp>,
    #[serde(default)]
    pub custom_design: Option<Value>,
    #[serde(default)]
    pub style_reference: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStoryboardResponse {
    pub beats: Vec<StoryboardBeat>,
    pub provider_used: String,
    pub recommended_medium: String,
    pub medium_reason: String,
    pub auto_design: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateBeatCodesRequest {
    pub project_title: String,
    pub format: String,
    pub beats: Vec<StoryboardBeat>,
    #[serde(default)]
    pub words: Vec<WordTimestamp>,
    #[serde(default)]
    pub custom_design: Option<Value>,
    #[serde(default)]
    pub style_reference: Option<Value>,
    pub audio_path: Option<String>,
    pub audio_source: String,
    pub trim_silence: bool,
    pub caption_preset: String,
    pub accent_color: String,
    pub bgm_preset: String,
    pub auto_ducking: bool,
    pub auto_sfx: bool,
    #[serde(default)]
    pub footage: Vec<FootageInputItem>,
    #[serde(default)]
    pub visual_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairBeatCodeRequest {
    pub beat: StoryboardBeat,
    pub broken_code: String,
    pub error_message: String,
    #[serde(default)]
    pub custom_design: Option<Value>,
    #[serde(default)]
    pub has_brand_logo: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairBeatCodeResponse {
    pub code: String,
    pub provider_used: String,
}

/// Split script into crisp 2.5–4.5 second micro-beats (never 15-second static scenes!).
pub fn segment_script_into_micro_beats(
    raw_script: &str,
    duration_ms: u64,
    words: &[WordTimestamp],
) -> Vec<(String, String, u64, u64)> {
    let base_cuts = segment_raw_script_into_cuts(raw_script);
    if base_cuts.is_empty() {
        return Vec::new();
    }

    // Subdivide any beat whose estimated duration exceeds 4.8 seconds into ~3-second micro-beats!
    let total_words: usize = base_cuts
        .iter()
        .map(|(_, t)| t.split_whitespace().count().max(1))
        .sum::<usize>()
        .max(1);
    let safe_dur = duration_ms.max((total_words as u64) * 380).max(4000);
    let ms_per_word = (safe_dur as f64) / (total_words as f64);
    let max_words_per_beat = ((4300.0 / ms_per_word).round() as usize).clamp(7, 13);

    let mut fine_texts: Vec<String> = Vec::new();
    for (_, txt) in base_cuts {
        let wlist: Vec<&str> = txt.split_whitespace().collect();
        if wlist.len() <= max_words_per_beat {
            fine_texts.push(txt);
        } else {
            let chunks_n = ((wlist.len() as f64) / (max_words_per_beat as f64)).ceil() as usize;
            let per_chunk = (wlist.len() + chunks_n - 1) / chunks_n.max(1);
            for chunk in wlist.chunks(per_chunk.max(4)) {
                fine_texts.push(chunk.join(" "));
            }
        }
    }

    // Cap at 12 crisp micro-beats for fast generation + tight pacing
    while fine_texts.len() > 12 {
        let mut best_i = 0;
        let mut best_wc = usize::MAX;
        for i in 0..fine_texts.len() - 1 {
            let wc = fine_texts[i].split_whitespace().count()
                + fine_texts[i + 1].split_whitespace().count();
            if wc < best_wc {
                best_wc = wc;
                best_i = i;
            }
        }
        let next = fine_texts.remove(best_i + 1);
        fine_texts[best_i].push(' ');
        fine_texts[best_i].push_str(&next);
    }

    let total = fine_texts.len();
    let segs: Vec<(String, String)> = fine_texts
        .into_iter()
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
        .collect();

    let timings = compute_scene_timings(&segs, safe_dur, words);
    segs.into_iter()
        .zip(timings)
        .map(|((role, txt), (s, e))| (role, txt, s, e))
        .collect()
}

pub fn clean_js_code_output(raw: &str) -> String {
    let trimmed = strip_thinking_blocks(raw).trim().to_string();
    let unfenced = if trimmed.contains("```") {
        strip_json_fences(&trimmed)
    } else {
        trimmed
    };
    let mut s = unfenced.trim().to_string();
    // If LLM wrapped the body inside `function renderBeat(...) { ... }`, `setupWorld(...) { ... }`, or `animateFrame(...) { ... }`, unwrap cleanly
    for fn_sig in ["function renderBeat", "function setupWorld", "function animateFrame"] {
        if let Some(fn_pos) = s.find(fn_sig) {
            if let Some(open_brace) = s[fn_pos..].find('{') {
                if let Some(close_brace) = s.rfind('}') {
                    let inner_start = fn_pos + open_brace + 1;
                    if close_brace > inner_start {
                        s = s[inner_start..close_brace].trim().to_string();
                        break;
                    }
                }
            }
        }
    }
    s
}

#[tauri::command]
pub async fn ai_plan_storyboard(
    app: AppHandle,
    req: PlanStoryboardRequest,
) -> Result<PlanStoryboardResponse, String> {
    let micro = segment_script_into_micro_beats(&req.full_script, req.duration_ms, &req.words);
    if micro.is_empty() {
        return Err("Script kosong — tulis atau generate script terlebih dahulu.".to_string());
    }

    let resolved = byok::resolve_active_provider(&app)?;
    let skills_catalog = motion_skills::build_skills_catalog_for_storyboard(&app);

    let has_user_design = req.custom_design.as_ref().is_some_and(Value::is_object);
    let design_hint = req
        .custom_design
        .as_ref()
        .map(|d| {
            format!(
                "Arahan Desain Custom (WAJIB DIIKUTI): {} — {}. Medium Referensi: {}, Palette: bgTop={}, accentPrimary={}, accentSecondary={}, isLight={}",
                d["name"].as_str().unwrap_or("Custom"),
                d["artDirectionNotes"].as_str().or_else(|| d["summary"].as_str()).unwrap_or(""),
                d["renderMedium"].as_str().unwrap_or("auto"),
                d["palette"]["bgTop"].as_str().unwrap_or("#0B0F17"),
                d["palette"]["accentPrimary"].as_str().unwrap_or("#38E59D"),
                d["palette"]["accentSecondary"].as_str().unwrap_or("#F59E0B"),
                d["isLight"].as_bool().unwrap_or(false)
            )
        })
        .unwrap_or_else(|| "User belum melampirkan referensi desain — WAJIB rancang `autoDesign` (palet warna, mood terang/gelap, tipografi, gaya subtitle, & BGM) yang 100% unik sesuai karakter topik/brand di prompt user!".to_string());

    let brand_headings = req
        .style_reference
        .as_ref()
        .and_then(|sr| sr["brandHeadings"].as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join(" | ")
        })
        .unwrap_or_default();

    let beat_lines: String = micro
        .iter()
        .enumerate()
        .map(|(i, (role, txt, s, e))| {
            format!(
                "- Beat #{i} ({role}, {:.1}s–{:.1}s, durasi {}ms): \"{txt}\"",
                (*s as f64) / 1000.0,
                (*e as f64) / 1000.0,
                e.saturating_sub(*s)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let system_prompt = "Kamu adalah Creative Director & Motion Graphics Storyboarder kelas dunia.\n\
        Tugasmu merancang ARAHAN VISUAL 100% KUSTOM TANPA TEMPLATE mengikuti prompt & referensi user:\n\
        ATURAN KERAS:\n\
        1. Tentukan `recommendedMedium` terbaik untuk topik ini:\n\
           - Jika user melampirkan referensi desain yang sudah punya `renderMedium`, PATUHI 100% medium referensi tersebut.\n\
           - Jika user tidak menyebutkan 2D/3D dan tanpa referensi: untuk promo produk, iklan SaaS/edtech, penawaran harga, aplikasi, atau review (`ad_promo`, `review`), pilih `\"2d_freeform\"` agar tipografi kinetik, UI demo, & ilustrasi produknya tajam dan modern. Untuk cerita spasial, dunia fisik, arsitektur, eksperimen sains, atau storytelling antar tokoh (`storytelling`, `education`) yang memang jauh lebih hidup secara 3D, pilih `\"3d_diorama\"` — atau `\"2d_freeform\"` jika lebih kuat sebagai explainer grafis.\n\
        2. Jika user tidak melampirkan referensi, rancang `autoDesign` (palet warna hex, mood terang/gelap, font, gaya subtitle, BGM) yang OTENTIK dengan karakter produk/topik (misal edukasi anak = cerah & playful; kopi/kuliner = hangat & kaya; tech/AI = modern presisi; editorial/luxury = kontras elegan) — JANGAN selalu hitam-hijau monoton!\n\
        3. DILARANG KERAS mengulang pola visual atau metafora yang sama pada 2 beat berturut-turut, dan DILARANG memakai aset/konsep yang tidak nyambung dengan topik.\n\
        4. Pilih 2-3 ID skill motion terbaik dari katalog skill untuk tiap beat.\n\
        Balas HANYA dalam JSON valid.";

    let auto_design_schema = if has_user_design {
        String::new()
    } else {
        ",\n          \"autoDesign\": {\n\
            \"name\": \"Nama gaya visual unik 2-4 kata sesuai topik\",\n\
            \"summary\": \"Ringkasan 1 kalimat gaya warna & suasana untuk topik ini\",\n\
            \"artDirectionNotes\": \"Arahan konkret untuk visual beat (warna, komposisi, mood, ritme)\",\n\
            \"renderMedium\": \"2d_freeform|3d_diorama\",\n\
            \"captionPlacement\": \"bottom_safe|center_middle\",\n\
            \"recommendedBgm\": \"upbeat_promo|lofi_chill|cinematic_pulse|minimal_tech\",\n\
            \"isLight\": true,\n\
            \"palette\": {\n\
              \"bgTop\": \"#HEX\", \"bgBottom\": \"#HEX\", \"surfaceBg\": \"rgba(r,g,b,0.9)\", \"surfaceBorder\": \"rgba(r,g,b,0.18)\",\n\
              \"textPrimary\": \"#HEX\", \"textSecondary\": \"#HEX\", \"accentPrimary\": \"#HEX\", \"accentSecondary\": \"#HEX\", \"accentInk\": \"#HEX\"\n\
            },\n\
            \"typography\": { \"headingFont\": \"sans|serif|mono|display\", \"bodyFont\": \"sans|serif|mono\", \"captionFont\": \"sans|serif|mono|display\", \"captionUppercase\": false },\n\
            \"visualStyle\": { \"backgroundPattern\": \"grid|dots|diagonal|aurora|paper_grain|minimal\", \"cardStyle\": \"glass|solid|brutalist|hairline|neon\", \"cornerStyle\": \"sharp|rounded|pill\", \"captionLook\": \"bold_outline|black_pill|outline_bold|clean_shadow|custom_pill|editorial_bar|minimal_clean\" },\n\
            \"pacing\": \"snappy|balanced|cinematic\"\n\
          }".to_string()
    };

    let user_prompt = format!(
        "Proyek: \"{}\" (format: {})\n{}\n{}\n\n\
        Katalog Motion Skills tersedia (pilih ID yang paling cocok per beat):\n{}\n\n\
        Daftar Micro-Beat (durasi dikunci ke suara dubbing):\n{}\n\n\
        Balas JSON persis seperti ini:\n\
        {{\n\
          \"recommendedMedium\": \"2d_freeform|3d_diorama\",\n\
          \"mediumReason\": \"Alasan singkat 1 kalimat Bahasa Indonesia kenapa medium ini paling cocok dengan prompt/referensi user\"{auto_design_schema},\n\
          \"beats\": [\n\
            {{\n\
              \"beatIndex\": 0,\n\
              \"title\": \"Judul visual singkat 2-5 kata\",\n\
              \"visualConcept\": \"Deskripsi konkret 1-2 kalimat tentang objek, ilustrasi, layout, dan aksi gerak yang HARUS digambar di beat ini (100% spesifik ke isi kalimat, TANPA mengulang beat sebelumnya)\",\n\
              \"emotionalIntent\": \"playful|bold|calm|urgent|luxury|editorial\",\n\
              \"skillsUsed\": [\"motion-craft-physics\", \"procedural-illustration-svg\"],\n\
              \"transitionIn\": \"hard_cut|whip_pan|pop_zoom|glitch_flash|smooth_crossfade\",\n\
              \"sfx\": \"impact_boom|whoosh_fast|whoosh_soft|pop_text|ding_notif|riser|camera_shutter|keyboard_click|cash_register|glitch_zap|none\"\n\
            }}\n\
          ]\n\
        }}",
        req.project_title.trim(),
        req.format,
        design_hint,
        if brand_headings.is_empty() {
            String::new()
        } else {
            format!("Fakta/Heading Brand Website: [{brand_headings}]")
        },
        skills_catalog,
        beat_lines
    );

    let (val, provider_used) = call_llm_json(&resolved, system_prompt, &user_prompt, &[]).await?;
    let ai_beats = val["beats"].as_array().cloned().unwrap_or_default();

    let ref_medium = req
        .custom_design
        .as_ref()
        .and_then(|d| d["renderMedium"].as_str())
        .filter(|m| matches!(*m, "2d_freeform" | "3d_diorama"));

    let recommended_medium = ref_medium
        .or_else(|| {
            val["recommendedMedium"]
                .as_str()
                .filter(|m| matches!(*m, "2d_freeform" | "3d_diorama"))
        })
        .unwrap_or("2d_freeform")
        .to_string();

    let medium_reason = val["mediumReason"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| {
            if recommended_medium == "3d_diorama" {
                "Dipilih 3D Scene/Diorama agar ruang, objek, dan cerita spasial tampil lebih hidup.".to_string()
            } else {
                "Dipilih 2D Motion Bebas agar tipografi kinetik, ilustrasi, dan pesan utama tampil tajam.".to_string()
            }
        });

    let auto_design = if has_user_design {
        None
    } else {
        val.get("autoDesign")
            .filter(|v| v.is_object())
            .map(|ad| {
                let mut sanitized =
                    sanitize_custom_design_value(ad, &format!("{} {}", req.project_title, req.full_script), &[]);
                sanitized.render_medium = recommended_medium.clone();
                serde_json::to_value(sanitized).ok()
            })
            .flatten()
    };

    let mut out_beats = Vec::with_capacity(micro.len());
    for (i, (role, txt, start_ms, end_ms)) in micro.into_iter().enumerate() {
        let matched = ai_beats
            .iter()
            .find(|b| b["beatIndex"].as_u64() == Some(i as u64))
            .or_else(|| ai_beats.get(i));

        let fallback_title: String = txt.split_whitespace().take(4).collect::<Vec<_>>().join(" ");
        let title = matched
            .and_then(|b| b["title"].as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .unwrap_or(fallback_title);

        let visual_concept = matched
            .and_then(|b| b["visualConcept"].as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| format!("Ilustrasi & tipografi kinetik kustom menggambarkan: {txt}"));

        let emotional_intent = matched
            .and_then(|b| b["emotionalIntent"].as_str())
            .filter(|s| matches!(*s, "playful" | "bold" | "calm" | "urgent" | "luxury" | "editorial"))
            .unwrap_or(if role == "hook" { "bold" } else { "playful" })
            .to_string();

        let mut skills_used: Vec<String> = matched
            .and_then(|b| b["skillsUsed"].as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(ToString::to_string))
                    .collect()
            })
            .unwrap_or_default();
        if skills_used.is_empty() {
            skills_used = vec![
                "motion-craft-physics".to_string(),
                if i == 0 {
                    "kinetic-typography".to_string()
                } else {
                    "procedural-illustration-svg".to_string()
                },
            ];
        }

        let transition_in = if i == 0 {
            "hard_cut".to_string()
        } else {
            matched
                .and_then(|b| b["transitionIn"].as_str())
                .filter(|t| matches!(*t, "hard_cut" | "whip_pan" | "pop_zoom" | "glitch_flash" | "smooth_crossfade"))
                .unwrap_or("pop_zoom")
                .to_string()
        };

        let sfx = matched
            .and_then(|b| b["sfx"].as_str())
            .filter(|s| !s.trim().is_empty() && *s != "none")
            .unwrap_or(match role.as_str() {
                "hook" => "impact_boom",
                "cta" => "riser",
                _ => "whoosh_fast",
            })
            .to_string();

        out_beats.push(StoryboardBeat {
            id: format!("beat_{}", i + 1),
            role,
            start_ms,
            end_ms,
            text: txt,
            title,
            visual_concept,
            emotional_intent,
            skills_used,
            transition_in,
            sfx,
        });
    }

    Ok(PlanStoryboardResponse {
        beats: out_beats,
        provider_used,
        recommended_medium,
        medium_reason,
        auto_design,
    })
}

async fn generate_single_beat_code(
    resolved: byok::ResolvedProvider,
    project_title: String,
    beat: StoryboardBeat,
    beat_index: usize,
    total_beats: usize,
    prev_concept: Option<String>,
    design_summary: String,
    has_brand_logo: bool,
    local_words_json: String,
    skills_rules: String,
) -> (usize, Result<String, String>) {
    let dur_ms = beat.end_ms.saturating_sub(beat.start_ms).max(1000);
    let prev_note = prev_concept
        .map(|p| format!("\nBeat sebelumnya menggambar: \"{p}\". WAJIB buat komposisi & ilustrasi yang BERBEDA TOTAL dari beat sebelumnya!"))
        .unwrap_or_default();

    let system_prompt = format!(
        "Kamu adalah Senior Motion Graphics Engineer (Remotion + Canvas 2D + SVG + Disney Animation Physics).\n\
        Tugasmu menulis KODE ANIMASI PROCEDURAL BARU DARI NOL untuk 1 beat video pendek vertikal 9:16.\n\
        ATURAN WAJIB:\n\
        1. Panggil `M.drawBackdrop(ctx, state)` di baris pertama.\n\
        2. Gambar ilustrasi/visual NYATA sesuai `visualConcept` menggunakan Canvas 2D, gradien, `Path2D`/`M.drawSvgPath`, `M.drawLiquidWave`, `M.drawBrowserWindow`, `M.drawCursor`, `M.drawCounter`, `M.drawKineticHeadline`, `M.drawParticles`, `M.withCamera`, `M.spring`, dan `M.interpolate`.\n\
        3. DILARANG KERAS memakai aset tidak nyambung atau placeholder dummy!\n\
        4. Gunakan `const {{ width, height, u, frame, fps, progress, design }} = state; const P = design.palette;` — semua koordinat & ukuran WAJIB proporsional terhadap `width`, `height`, dan `u`!\n\
        5. Jaga area utama di `y = height * 0.11 .. height * 0.68` dan `x = width * 0.08 .. width * 0.92` (JANGAN menutupi zona caption bawah `74%..90%`).\n\
        6. Animasi HARUS terasa hidup & mulus (pakai `M.spring`, stagger, subtle continuous motion, dan exit momentum 0.2s terakhir).\n\
        7. Kembalikan JSON: {{\"code\": \"...pure JS function body...\"}}.\n\n\
        {MOTION_SDK_COMPACT_REFERENCE}\n\n\
        {skills_rules}"
    );

    let user_prompt = format!(
        "Proyek: \"{project_title}\" | Beat {}/{total_beats} (role: {}, durasi: {}ms)\n\
        Judul Beat: \"{}\"\n\
        Narasi Dubbing Beat Ini: \"{}\"\n\
        Konsep Visual yang HARUS Digambar: \"{}\"\n\
        Emotional Intent: {}\n\
        Brand Logo Tersedia (`state.hasBrandLogo`): {}\n\
        Design DNA: {}{prev_note}\n\
        Word Timestamps Lokal Beat Ini (ms dari awal beat): {}\n\n\
        Tulis kode JS bersih, ekspresif, kaya detail visual, dan 100% bebas error dalam JSON `{{\"code\": \"...\"}}`.",
        beat_index + 1,
        beat.role,
        dur_ms,
        beat.title,
        beat.text,
        beat.visual_concept,
        beat.emotional_intent,
        has_brand_logo,
        design_summary,
        local_words_json
    );

    match call_llm_json(&resolved, &system_prompt, &user_prompt, &[]).await {
        Ok((val, _)) => {
            let raw_code = val["code"]
                .as_str()
                .or_else(|| val["renderCode"].as_str())
                .unwrap_or("");
            let cleaned = clean_js_code_output(raw_code);
            if cleaned.len() < 40 {
                (beat_index, Err("Kode animasi yang dikembalikan terlalu pendek.".to_string()))
            } else {
                (beat_index, Ok(cleaned))
            }
        }
        Err(e) => (beat_index, Err(e)),
    }
}

#[tauri::command]
pub async fn ai_generate_beat_codes(
    app: AppHandle,
    req: GenerateBeatCodesRequest,
) -> Result<Value, String> {
    if req.beats.is_empty() {
        return Err("Storyboard beat kosong.".to_string());
    }

    let resolved = byok::resolve_active_provider(&app)?;
    let raw_custom_design = req.custom_design.as_ref().or_else(|| {
        req.style_reference
            .as_ref()
            .and_then(|sr| sr.get("customDesign"))
            .filter(|v| v.is_object())
    });
    let sanitized_custom = raw_custom_design
        .map(|cd| sanitize_custom_design_value(cd, &req.project_title, &[]));
    let custom_design_json = sanitized_custom
        .as_ref()
        .and_then(|d| serde_json::to_value(d).ok())
        .unwrap_or(Value::Null);
    let effective_accent = sanitized_custom
        .as_ref()
        .map(|d| d.palette.accent_primary.clone())
        .unwrap_or_else(|| req.accent_color.clone());
    let motion_theme = if sanitized_custom.as_ref().map(|d| d.is_light).unwrap_or(false) {
        "paper"
    } else {
        "carbon"
    };
    let has_brand_logo = req
        .style_reference
        .as_ref()
        .and_then(|sr| sr["logoDataUrl"].as_str())
        .is_some_and(|s| s.starts_with("data:image/"));

    let design_summary = sanitized_custom
        .as_ref()
        .map(|d| {
            format!(
                "{} (isLight={}, bgTop={}, bgBottom={}, textPrimary={}, accentPrimary={}, accentSecondary={}, cardStyle={}, pattern={}) — {}",
                d.name,
                d.is_light,
                d.palette.bg_top,
                d.palette.bg_bottom,
                d.palette.text_primary,
                d.palette.accent_primary,
                d.palette.accent_secondary,
                d.visual_style.card_style,
                d.visual_style.background_pattern,
                d.art_direction_notes
            )
        })
        .unwrap_or_else(|| format!("Tema {}, aksen {}", motion_theme, effective_accent));

    // Generate all beat codes in parallel batches of up to 4 concurrent LLM calls!
    let total_beats = req.beats.len();
    let mut codes: Vec<String> = vec![String::new(); total_beats];
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(4));
    let mut join_set = tokio::task::JoinSet::new();

    for (idx, beat) in req.beats.iter().enumerate() {
        let sem = semaphore.clone();
        let res_clone = resolved.clone();
        let proj_title = req.project_title.clone();
        let beat_clone = beat.clone();
        let prev_concept = if idx > 0 {
            Some(req.beats[idx - 1].visual_concept.clone())
        } else {
            None
        };
        let design_sum = design_summary.clone();
        let skills_rules = motion_skills::build_active_skills_prompt(&app, &beat.skills_used);
        let local_words: Vec<Value> = req
            .words
            .iter()
            .filter(|w| w.end_ms > beat.start_ms && w.start_ms < beat.end_ms)
            .take(18)
            .map(|w| {
                json!({
                    "word": w.word,
                    "startMs": w.start_ms.saturating_sub(beat.start_ms),
                    "endMs": w.end_ms.saturating_sub(beat.start_ms)
                })
            })
            .collect();
        let local_words_json = serde_json::to_string(&local_words).unwrap_or_else(|_| "[]".to_string());

        join_set.spawn(async move {
            let _permit = sem.acquire_owned().await;
            generate_single_beat_code(
                res_clone,
                proj_title,
                beat_clone,
                idx,
                total_beats,
                prev_concept,
                design_sum,
                has_brand_logo,
                local_words_json,
                skills_rules,
            )
            .await
        });
    }

    while let Some(joined) = join_set.join_next().await {
        if let Ok((idx, Ok(code))) = joined {
            if idx < codes.len() {
                codes[idx] = code;
            }
        }
    }

    // Lock 2D beat timings & words 100% to actual voiceover file duration on disk!
    let mut synced_beats = req.beats.clone();
    let mut synced_words = req.words.clone();
    if let Some(ref ap) = req.audio_path {
        if !ap.trim().is_empty() {
            if let Ok(actual_ms) = crate::audio::probe_audio_duration_ms(&app, ap).await {
                if actual_ms >= 1500 {
                    rescale_beats_to_duration(&mut synced_beats, actual_ms);
                    if let Some(last_end) = synced_words.last().map(|w| w.end_ms) {
                        if last_end > 0 {
                            let ratio = (last_end as f64) / (actual_ms as f64);
                            if !(0.88..=1.04).contains(&ratio) {
                                let sc = (actual_ms as f64) / (last_end as f64);
                                for w in &mut synced_words {
                                    w.start_ms = ((w.start_ms as f64) * sc).round().min(actual_ms as f64) as u64;
                                    w.end_ms = ((w.end_ms as f64) * sc).round().min(actual_ms as f64) as u64;
                                    if w.end_ms < w.start_ms {
                                        w.end_ms = w.start_ms;
                                    }
                                }
                                if let Some(last) = synced_words.last_mut() {
                                    last.end_ms = actual_ms;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let vmode = req.visual_mode.as_deref().unwrap_or("motion");
    let mut scenes_json = Vec::with_capacity(total_beats);
    for (idx, beat) in synced_beats.iter().enumerate() {
        let use_footage = vmode == "hybrid" && !req.footage.is_empty() && idx % 2 == 0;
        let clip = if use_footage {
            req.footage.get((idx / 2) % req.footage.len())
        } else {
            None
        };

        let sfx_arr = if req.auto_sfx && !beat.sfx.is_empty() && beat.sfx != "none" {
            vec![json!({
                "preset": beat.sfx,
                "offsetMs": 0,
                "volume": 0.65
            })]
        } else {
            Vec::new()
        };

        let ai_motion_val = if use_footage {
            Value::Null
        } else {
            json!({
                "engine": "custom_code",
                "theme": motion_theme,
                "title": beat.title,
                "subtitle": req.project_title.trim(),
                "customCode": {
                    "code": codes[idx],
                    "visualConcept": beat.visual_concept,
                    "emotionalIntent": beat.emotional_intent,
                    "skillsUsed": beat.skills_used,
                    "verified": false
                }
            })
        };

        scenes_json.push(json!({
            "id": beat.id,
            "role": beat.role,
            "startMs": beat.start_ms,
            "endMs": beat.end_ms,
            "text": beat.text,
            "visualSource": if use_footage { "footage" } else { "motion" },
            "aiMotion": ai_motion_val,
            "media": {
                "path": clip.map(|c| Value::String(c.path.clone())).unwrap_or(Value::Null),
                "secondaryPath": Value::Null,
                "trimStartMs": 0,
                "fit": "cover"
            },
            "motion": {
                "preset": if use_footage { "zoom_punch" } else { "static_clean" },
                "intensity": if use_footage { 0.72 } else { 0.35 }
            },
            "transitionIn": {
                "preset": if idx == 0 { "hard_cut" } else { beat.transition_in.as_str() },
                "durationMs": if idx == 0 || beat.transition_in == "hard_cut" { 0 } else { 240 }
            },
            "sfx": sfx_arr,
            "overlays": []
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

    Ok(json!({
        "version": "2.0",
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
                "volume": 0.22,
                "autoDucking": req.auto_ducking
            },
            "safeZone": "tiktok_reels"
        },
        "voiceover": {
            "source": req.audio_source,
            "audioPath": req.audio_path,
            "trimSilence": req.trim_silence,
            "words": synced_words
        },
        "scenes": scenes_json
    }))
}

#[tauri::command]
pub async fn ai_repair_beat_code(
    app: AppHandle,
    req: RepairBeatCodeRequest,
) -> Result<RepairBeatCodeResponse, String> {
    let resolved = byok::resolve_active_provider(&app)?;
    let skills_rules = motion_skills::build_active_skills_prompt(&app, &req.beat.skills_used);
    let system_prompt = format!(
        "Kamu adalah Motion Graphics Debugger untuk Synkcut.\n\
        Perbaiki kode JS `renderBeat(ctx, state, M)` berikut agar 100% lolos eksekusi 4 frame tanpa error, tanpa NaN, dan menggambar visual yang jelas serta bergerak mulus sesuai konsepnya.\n\
        Balas HANYA JSON `{{\"code\": \"...kode perbaikan lengkap...\"}}`.\n\n\
        {MOTION_SDK_COMPACT_REFERENCE}\n\n\
        {skills_rules}"
    );
    let design_hint = req
        .custom_design
        .as_ref()
        .map(|d| {
            format!(
                "\nPalette Custom: bgTop={}, accentPrimary={}, accentSecondary={}, isLight={}",
                d["palette"]["bgTop"].as_str().unwrap_or("#0B0F17"),
                d["palette"]["accentPrimary"].as_str().unwrap_or("#38E59D"),
                d["palette"]["accentSecondary"].as_str().unwrap_or("#F59E0B"),
                d["isLight"].as_bool().unwrap_or(false)
            )
        })
        .unwrap_or_default();
    let user_prompt = format!(
        "Beat: \"{}\" (narasi: \"{}\")\nKonsep Visual: \"{}\"\nError / Masalah Validasi: \"{}\"\nBrand Logo tersedia: {}{design_hint}\n\nKode sebelumnya yang bermasalah:\n```js\n{}\n```",
        req.beat.title,
        req.beat.text,
        req.beat.visual_concept,
        req.error_message,
        req.has_brand_logo,
        req.broken_code.chars().take(4500).collect::<String>()
    );
    let (val, provider_used) = call_llm_json(&resolved, &system_prompt, &user_prompt, &[]).await?;
    let fixed = clean_js_code_output(val["code"].as_str().unwrap_or(""));
    if fixed.len() < 30 {
        return Err("AI tidak mengembalikan kode perbaikan yang valid.".to_string());
    }
    Ok(RepairBeatCodeResponse {
        code: fixed,
        provider_used,
    })
}

/* ==================== V2.1 BY-CODE 3D DIORAMA & CHARACTER ENGINE ==================== */

const DIORAMA_3D_SDK_REFERENCE: &str = r#"=== SYNKCUT 3D DIORAMA SDK `D3` (100% By-Code Three.js PBR) ===
You write TWO deterministic pure JS function bodies (NO window/document/fetch/eval/setTimeout/imports):
1) `setupCode` — body of `function setupWorld(world, D3) { ... }` (called ONCE to build the entire miniature 3D world, props, & characters!)
2) `animateCode` — body of `function animateFrame(world, state, D3) { ... }` (called every frame 30-60fps for smooth continuous camera choreography, character acting, object motion, & 3D-tracked HUD!)

`world` handle:
- `world.objects[name]` -> stored THREE.Object3D props
- `world.characters[name]` -> stored CharacterRig actors
- `world.data` -> plain object to store custom parameters/references
- `world.add(obj, name?)` -> attach any custom THREE.Object3D directly to the world root

`state` fields in `animateFrame`:
- `globalTimeMs`, `totalDurationMs`, `globalProgress` (0..1 across entire video!)
- `beatIndex` (0..beatCount-1), `beatCount`, `beatProgress` (0..1 inside current beat), `beatTimeMs`, `beatDurationMs`
- `title`, `text`, `role` ("hook"|"body"|"cta"), `width`, `height`, `u`, `design`

`D3` Atmosphere & Lighting (REQUIRED — choose ANY mood matching the user's prompt & reference!):
- `D3.setupAtmosphere(world, { bgTop, bgMid, bgBottom, isDark=false, ambientColor?, ambientIntensity?, keyColor?, keyIntensity?, keyPos?, fillColor?, fillIntensity?, fogColor?, stars=false })` -> works for daylight, night, cyberpunk neon, outer space (`stars: true`), warm indoor, dark studio, or pastel!
- `D3.setupDaylight(world, { skyTop?, skyMid?, skyBottom?, sunColor?, sunIntensity?, sunPos? })` -> quick bright daylight shorthand
- `D3.addClouds(world, { count=6, y=10 })` + in animate: `D3.animateClouds(world, tSec)`

`D3` OPTIONAL Environment Helpers (use ONLY when they genuinely fit the user's topic — otherwise build custom 3D environments from scratch with `D3.setupAtmosphere` + `D3.THREE` + primitives!):
- `D3.buildOceanCutaway(world, { width=22, depth=16, waterHeight=11, surfaceColor?, deepColor?, seabedColor?, fishCount=7 })` + `D3.animateOcean(world, tSec)`
- `D3.buildGroundCutaway(world, { style:'desert'|'grass'|'farm'|'urban', width=22, depth=22, thickness=4.5, withPit=false, pitRadius=3.6, withPond=false, treeCount=5 })`
- `D3.buildRoomCutaway(world, { width=13, depth=11, height=6.8, wallColor?, floorColor?, trimColor? })`
- `D3.buildStudioStage(world, { bgTop?, bgBottom?, stageColor?, radius=8.5 })`

`D3` OPTIONAL Stylized Articulated 3D Characters (add ONLY when the script involves human actors):
- `const hero = D3.createCharacter(world, { name:'hero', pos:[x,y,z], rotY:0, scale:1, skin:'#F2C39B', outfitColor:'#2563EB', pantsColor:'#1E293B', hat:'hair'|'peci'|'cap'|'turban'|'helmet'|'none', glasses:false, mustache:false })`
- In `animateCode`: `D3.poseCharacter(world.characters.hero, { action:'idle'|'point'|'wave'|'handshake'|'walk'|'think'|'surprised'|'sit'|'sleep'|'talk'|'cheer', phase: tSec, headTurn?: 0 })`

`D3` HIGH-CRAFT BLENDER-STYLE 3D PREFABS (ALWAYS PREFER THESE over raw boxes! All accept `(parent, opts)` & have crisp PBR materials + Canvas UI textures):
- `D3.laptop(parent, { name?, pos?, rot?, scale?, screenText:'Makasih!', accent:'#FACC15', bodyColor? })`
- `D3.smartphone(parent, { name?, pos?, rot?, scale?, screenText:'Chat AI', accent:'#38BDF8', bodyColor? })`
- `D3.serverRack(parent, { name?, pos?, rot?, scale?, blades:6, ledColor:'#FF4D2E', heatGlow:true })`
- `D3.gpuChip(parent, { name?, pos?, rot?, scale?, glowColor:'#FF5722', hot:true })`
- `D3.coolingTower(parent, { name?, pos?, rot?, scale?, color?, steam:true })`
- `D3.waterBottle(parent, { name?, pos?, rot?, scale?, fill:0.75, waterColor:'#38BDF8', label:'500 ml' })`
- `D3.chatBubble3D(parent, { name?, pos?, rot?, scale?, text:'Makasih ya!', subtitle?, bg:'#FACC15', textColor:'#0F172A' })`
- `D3.barChart3D(parent, { name?, pos?, rot?, scale?, title:'Energi', items:[{ label:'Search', value:1, color:'#38BDF8' }, { label:'AI', value:10, color:'#F97316' }] })`
- `D3.building(parent, { name?, pos?, rot?, scale?, width:4.2, height:3.6, depth:3.2, color:'#334155', windowColor:'#38BDF8' })`
- `D3.globe(parent, { name?, pos?, rot?, scale?, radius:1.6, ringColor:'#38BDF8' })`
- `D3.lightbulb(parent, { name?, pos?, rot?, scale?, on:true, glowColor:'#FACC15' })`

`D3` Basic 3D Primitives (pass `world` OR a parent THREE.Group as 1st arg!):
- `D3.group(parent, { name?, pos?, rot?, scale? })`
- `D3.box(parent, { name?, size:[w,h,d], color, roughness?, metalness?, opacity?, emissive?, emissiveIntensity?, pos?, rot?, scale? })`
- `D3.roundedBox(parent, { name?, size:[w,h,d], color, roughness?, metalness?, opacity?, emissive?, pos?, rot?, scale? })`
- `D3.plane(parent, { name?, size:[w,h], color, roughness?, metalness?, opacity?, pos?, rot?, scale? })`
- `D3.capsule(parent, { name?, radius?, length?, color, roughness?, metalness?, pos?, rot?, scale? })`
- `D3.cylinder(parent, { name?, radius?, rTop?, rBottom?, height, color, roughness?, metalness?, pos?, rot? })`
- `D3.sphere(parent, { name?, radius, color, roughness?, metalness?, opacity?, emissive?, pos?, rot?, scale? })`
- `D3.cone(parent, { name?, radius, height, color, pos?, rot? })`
- `D3.torus(parent, { name?, radius, tube, color, pos?, rot? })`
- `D3.tube(parent, [[x,y,z], [x2,y2,z2], ...], { name?, radius=0.12, color, metalness? })` (pipes, anchor cables, arches, wires!)
- `D3.truss(parent, { name?, height=4.5, baseWidth=1.4, topWidth=0.55, levels=4, color, pos? })` (towers, rigs, cranes, stadiums!)
- `D3.table(parent, { name?, size:[w,h,d], color?, pos?, rotY? })`
- `D3.tree(parent, { style:'palm'|'round'|'pine', scale=1, pos:[x,y,z] })`
- `D3.fish(parent, { color, scale, pos })`
- `D3.particles3D(world, { name?, count=24, area:[6,5,6], center:[0,2,0], color:'#FFFFFF', radius:0.09 })`

`D3` Beat Stage Isolation & Auto-Framing (CRITICAL — NEVER let props from other beats block the camera!):
- `D3.showOnly(world, ['stage_1'], ['stage_1', 'stage_2', 'stage_3'])` -> shows ONLY active stage groups and hides others!
- `D3.setVisible(world, ['propName'], true|false)` -> toggles visibility cleanly per beat!
- `D3.focusCameraOn(world, 'stage_1', [4.5, 3.2, 6.5], 38)` -> auto-aims camera at the exact 3D bounding-box center of an object!

`D3` Continuous 3D Camera Choreography (CRITICAL for viral Shorts flow!):
- `D3.setCamera(world, [x,y,z], [lx,ly,lz], fov=38)`
- `D3.lerpCamera(world, [{ t:0, pos:[...], lookAt:[...], fov:38 }, { t:0.35, ... }, { t:0.7, ... }, { t:1, ... }], state.globalProgress)`

`D3` 3D-Tracked 2D HUD Overlays (call in `animateCode` AFTER camera update):
- `D3.drawPopupTitle(world, 'JUDUL PENDEK', { yRatio:0.18, accentWord:'KATA', color:'#FFFFFF', accentColor:'#FACC15', progress })` (use on Beat 0 hook!)
- `D3.drawRuler(world, { minLabel:'0 m', maxLabel:'1500 m', progress: state.globalProgress, accent:'#FACC15' })` (great for depth/height topics!)
- `D3.drawBadgeAt3D(world, [x,y,z], { text:'?', bg:'#FACC15', textColor:'#111827', scale:1, pulse: Math.sin(tSec*5) })`
- `D3.drawCalloutAt3D(world, [x,y,z], 'Label Singkat', { color:'#FACC15', side:'right', progress:1 })`
- Math helpers: `D3.clamp`, `D3.lerp`, `D3.ease`, `D3.spring`, `D3.interpolate`, `D3.rng(seed)`, `D3.THREE`."#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Generate3DDioramaRequest {
    pub project_title: String,
    pub format: String,
    pub beats: Vec<StoryboardBeat>,
    #[serde(default)]
    pub words: Vec<WordTimestamp>,
    #[serde(default)]
    pub custom_design: Option<Value>,
    #[serde(default)]
    pub style_reference: Option<Value>,
    pub audio_path: Option<String>,
    pub audio_source: String,
    pub trim_silence: bool,
    pub caption_preset: String,
    pub accent_color: String,
    pub bgm_preset: String,
    pub auto_ducking: bool,
    pub auto_sfx: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repair3DDioramaRequest {
    pub project_title: String,
    pub world_preset: String,
    pub broken_setup_code: String,
    pub broken_animate_code: String,
    pub error_message: String,
    pub beats_summary: String,
    #[serde(default)]
    pub preview_frames: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Critique3DFramesRequest {
    pub project_title: String,
    pub world_summary: String,
    pub frames: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Critique3DFramesResponse {
    pub ok: bool,
    pub skipped: bool,
    pub issue: String,
    pub fix_hint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repair3DDioramaResponse {
    pub setup_code: String,
    pub animate_code: String,
    pub provider_used: String,
}

#[derive(Clone)]
struct Cached3DSetup {
    setup_code: String,
    world_preset: String,
    world_summary: String,
    object_names: Vec<String>,
    character_names: Vec<String>,
    recommended_caption_look: Option<String>,
    recommended_bgm: Option<String>,
}

static DIORAMA_3D_SETUP_CACHE: OnceLock<Mutex<HashMap<String, Cached3DSetup>>> = OnceLock::new();

fn diorama_setup_cache() -> &'static Mutex<HashMap<String, Cached3DSetup>> {
    DIORAMA_3D_SETUP_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub async fn ai_generate_3d_diorama(
    app: AppHandle,
    req: Generate3DDioramaRequest,
) -> Result<Value, String> {
    if req.beats.is_empty() {
        return Err("Storyboard beat kosong.".to_string());
    }

    let resolved = byok::resolve_active_provider(&app)?;
    let full_text_context = format!(
        "{} {}",
        req.project_title,
        req.beats
            .iter()
            .map(|b| b.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    );
    let inferred_preset = crate::style_ref::infer_world_preset(&full_text_context.to_lowercase());

    let raw_custom_design = req.custom_design.as_ref().or_else(|| {
        req.style_reference
            .as_ref()
            .and_then(|sr| sr.get("customDesign"))
            .filter(|v| v.is_object())
    });

    let had_user_custom_design = raw_custom_design.is_some();
    let mut sanitized_custom = raw_custom_design
        .map(|cd| sanitize_custom_design_value(cd, &full_text_context, &[]))
        .unwrap_or_else(|| {
            sanitize_custom_design_value(
                &json!({
                    "renderMedium": "3d_diorama",
                    "worldPreset": inferred_preset,
                    "captionPlacement": "center_middle",
                    "visualStyle": { "captionLook": "outline_bold" }
                }),
                &format!("3d diorama {full_text_context}"),
                &[],
            )
        });

    // Respect user's reference / prompt design direction — NEVER forcibly overwrite their chosen caption style!
    sanitized_custom.render_medium = "3d_diorama".to_string();
    if sanitized_custom.world_preset == "auto" {
        sanitized_custom.world_preset = inferred_preset.to_string();
    }
    if !had_user_custom_design {
        sanitized_custom.caption_placement = "center_middle".to_string();
    }

    let skills_rules =
        motion_skills::build_active_skills_prompt(&app, &["3d-diorama-storytelling".to_string()]);

    let beat_lines: String = req
        .beats
        .iter()
        .enumerate()
        .map(|(i, b)| {
            format!(
                "- Beat #{i} ({}, {:.1}s–{:.1}s): title=\"{}\" | konsep=\"{}\"",
                b.role,
                (b.start_ms as f64) / 1000.0,
                (b.end_ms as f64) / 1000.0,
                b.title,
                b.visual_concept
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let cache_key = format!(
        "{}::{}::{}",
        req.project_title.trim(),
        req.beats.len(),
        req.beats
            .first()
            .map(|b| b.text.as_str())
            .unwrap_or("")
            .chars()
            .take(64)
            .collect::<String>()
    );

    // STAGE 1: Build compact 3D world (`setupCode`) — automatically resumed from checkpoint if already built!
    let cached_stage1 = diorama_setup_cache()
        .lock()
        .ok()
        .and_then(|m| m.get(&cache_key).cloned());

    let stage1: Cached3DSetup = if let Some(hit) = cached_stage1 {
        let _ = app.emit(
            "generation-progress",
            "Melanjutkan dari checkpoint: Dunia 3D siap, menyusun animasi kamera (Tahap 2/2)...",
        );
        hit
    } else {
        let _ = app.emit(
            "generation-progress",
            "Tahap 1/2: Membangun objek, pencahayaan & dunia 3D...",
        );

        let setup_system = format!(
            "Kamu adalah Technical 3D Artist (Blender Diorama / Three.js PBR) kelas dunia di Synkcut.\n\
            Tugasmu menulis `setupCode` (body fungsi `setupWorld(world, D3)`) yang DETAIL, TAJAM, KONTRAS TINGGI, dan 100% sesuai topik user (target 35–65 baris).\n\
            ATURAN WAJIB ANTI-JELEK:\n\
            1. WAJIB pakai **High-Craft 3D Prefabs** (`D3.laptop`, `D3.smartphone`, `D3.serverRack`, `D3.gpuChip`, `D3.coolingTower`, `D3.waterBottle`, `D3.chatBubble3D`, `D3.barChart3D`, `D3.building`, `D3.globe`, `D3.lightbulb`, `D3.createCharacter`) kapan pun objek itu cocok dengan topik — JANGAN membangun laptop/server/grafik cuma dari kotak polos tanpa detail!\n\
            2. WAJIB KELOMPOKKAN OBJEK KE DALAM 3–5 STAGE GROUP (`const s1 = D3.group(world, {{ name:'stage_1', pos:[0,0,0] }}); ...`) agar tiap fase cerita punya panggung bersih di pusat `[0,0,0]` dan bisa di-toggle dengan `D3.showOnly(world, ...)` di Tahap 2 — DILARANG menumpuk papan/kartu di depan kamera (`z > 1.5`) saat stage lain tampil!\n\
            3. KONTRAS & PENCAHAYAAN ANTI-SILAU: DILARANG membuat semua objek + lantai + langit sama-sama krem/putih pucat! Jika tema terang, pakai langit biru cerah (`bgTop:'#3B9AE1'`, `bgBottom:'#CFE9FA'`) atau studio kontras gelap-terang (`#1E293B` vs `#FACC15` / `#38BDF8` / `#F97316`). Pastikan setiap objek utama punya siluet dan warna yang langsung menonjol!\n\
            4. Balas HANYA JSON valid:\n\
            {{\n\
              \"worldPreset\": \"custom|ocean_cross_section|ground_cutaway|desert_cutaway|room_cutaway|outdoor_farm|studio_stage\",\n\
              \"worldSummary\": \"Ringkasan 1 kalimat Bahasa Indonesia\",\n\
              \"objectNames\": [\"stage_1\", \"stage_2\", \"namaObjek1\"],\n\
              \"characterNames\": [\"namaKarakter1\"],\n\
              \"recommendedCaptionLook\": \"outline_bold|black_pill|clean_shadow|bold_outline|custom_pill\",\n\
              \"recommendedBgm\": \"upbeat_promo|lofi_chill|cinematic_pulse|minimal_tech\",\n\
              \"setupCode\": \"...pure JS body of setupWorld(world, D3)...\"\n\
            }}\n\n\
            {DIORAMA_3D_SDK_REFERENCE}\n\n\
            {skills_rules}"
        );

        let setup_user = format!(
            "Proyek: \"{}\" (format: {})\n\
            Arahan Referensi: {} — {}\n\
            Palet: bgTop={}, bgBottom={}, accent={}, isLight={}\n\n\
            Ringkasan Beat ({} beat):\n{}\n\n\
            Tulis `setupCode` ringkas & kaya visual sesuai topik di atas dalam JSON!",
            req.project_title.trim(),
            req.format,
            sanitized_custom.name,
            sanitized_custom.art_direction_notes,
            sanitized_custom.palette.bg_top,
            sanitized_custom.palette.bg_bottom,
            sanitized_custom.palette.accent_primary,
            sanitized_custom.is_light,
            req.beats.len(),
            beat_lines
        );

        let (val1, _) = call_llm_json(&resolved, &setup_system, &setup_user, &[]).await?;
        let setup_code = clean_js_code_output(val1["setupCode"].as_str().unwrap_or(""));
        if setup_code.len() < 30 {
            return Err("Tahap 1/2 (Bangun Dunia 3D) mengembalikan kode terlalu pendek.".to_string());
        }
        let world_preset = val1["worldPreset"]
            .as_str()
            .filter(|s| {
                matches!(
                    *s,
                    "custom"
                        | "ocean_cross_section"
                        | "ground_cutaway"
                        | "desert_cutaway"
                        | "room_cutaway"
                        | "outdoor_farm"
                        | "studio_stage"
                )
            })
            .unwrap_or(&sanitized_custom.world_preset)
            .to_string();
        let world_summary = val1["worldSummary"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| format!("Dunia 3D untuk {}", req.project_title.trim()));
        let object_names: Vec<String> = val1["objectNames"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        let character_names: Vec<String> = val1["characterNames"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        let built = Cached3DSetup {
            setup_code,
            world_preset,
            world_summary,
            object_names,
            character_names,
            recommended_caption_look: val1["recommendedCaptionLook"]
                .as_str()
                .map(ToString::to_string),
            recommended_bgm: val1["recommendedBgm"].as_str().map(ToString::to_string),
        };

        // Save Stage 1 checkpoint so any Stage 2 retry resumes instantaneously!
        if let Ok(mut map) = diorama_setup_cache().lock() {
            if map.len() > 8 {
                map.clear();
            }
            map.insert(cache_key.clone(), built.clone());
        }
        built
    };

    // STAGE 2: Build compact continuous 3D camera + character/object animation (`animateCode`)!
    let _ = app.emit(
        "generation-progress",
        "Tahap 2/2: Mengatur kamera 3D kontinu, aksi objek & HUD...",
    );

    let anim_system = format!(
        "Kamu adalah 3D Camera & Motion Choreographer (Three.js) di Synkcut.\n\
        Dunia 3D sudah dibangun di Tahap 1 (`setupCode` dilampirkan agar kamu tahu koordinat `[x,y,z]` persis tiap objek!). Tugasmu menulis `animateCode` (body fungsi `animateFrame(world, state, D3)`) yang sinematik, rapi (30–55 baris), dan 100% bebas halangan kamera.\n\
        ATURAN WAJIB:\n\
        1. Hitung `const tSec = state.globalTimeMs / 1000;`. Panggil `D3.animateClouds(world, tSec)` / `D3.animateOcean(world, tSec)` jika relevan.\n\
        2. ISOLASI STAGE PER BEAT: Jika `setupCode` membuat grup stage (`stage_1`, `stage_2`, dll.), WAJIB panggil `D3.showOnly(world, [stageAktif], [semuaStage])` sesuai `state.beatIndex` agar properti beat lain TIDAK PERNAH menutupi kamera!\n\
        3. FRAMING KAMERA AKURAT: Pastikan kamera (`D3.lerpCamera` atau `D3.focusCameraOn(world, namaStageAktif, [dx, dy, dz], 38)`) SELALU melihat objek utama dari jarak ideal (`4.5`–`11` unit, sudut agak serong 3/4 dari atas) dan TIDAK PERNAH berada di belakang papan/dinding!\n\
        4. Gerakkan objek/karakter secara hidup sesuai `state.beatIndex` & `state.beatProgress`, plus `D3.drawPopupTitle` di Beat 0 dan `D3.drawBadgeAt3D`/`D3.drawCalloutAt3D` bila relevan.\n\
        5. Balas HANYA JSON valid: {{\"animateCode\": \"...pure JS body, ringkas 30-55 baris...\", \"beatNotes\": [\"arah kamera beat 0\", \"...\"]}}\n\n\
        {DIORAMA_3D_SDK_REFERENCE}"
    );

    let setup_preview: String = stage1.setup_code.chars().take(3600).collect();
    let anim_user = format!(
        "Proyek: \"{}\" | Dunia 3D: {}\n\
        `world.objects` tersedia: {:?}\n\
        `world.characters` tersedia: {:?}\n\n\
        Kode `setupCode` Tahap 1 (baca koordinat `[x,y,z]` dan nama stage agar kamera 100% tepat & tidak terhalang!):\n```js\n{}\n```\n\n\
        Daftar Beat ({} beat):\n{}\n\n\
        Tulis `animateCode` sinematik dengan framing kamera 100% akurat & bebas halangan dalam JSON!",
        req.project_title.trim(),
        stage1.world_summary,
        stage1.object_names,
        stage1.character_names,
        setup_preview,
        req.beats.len(),
        beat_lines
    );

    let (val2, _provider) = call_llm_json(&resolved, &anim_system, &anim_user, &[]).await?;
    let animate_code = clean_js_code_output(val2["animateCode"].as_str().unwrap_or(""));
    if animate_code.len() < 30 {
        return Err("Tahap 2/2 (Animasi Kamera 3D) mengembalikan kode terlalu pendek.".to_string());
    }

    // Both stages succeeded — clear Stage 1 checkpoint cleanly
    if let Ok(mut map) = diorama_setup_cache().lock() {
        map.remove(&cache_key);
    }

    let setup_code = stage1.setup_code;
    let world_preset = stage1.world_preset;
    let world_summary = stage1.world_summary;

    if !had_user_custom_design {
        if let Some(rec_look) = stage1.recommended_caption_look.as_deref() {
            if matches!(
                rec_look,
                "black_pill"
                    | "outline_bold"
                    | "clean_shadow"
                    | "bold_outline"
                    | "custom_pill"
                    | "editorial_bar"
                    | "minimal_clean"
            ) {
                sanitized_custom.visual_style.caption_look = rec_look.to_string();
            }
        }
    }
    let effective_bgm = if req.bgm_preset == "auto" || req.bgm_preset.trim().is_empty() {
        stage1
            .recommended_bgm
            .as_deref()
            .filter(|s| matches!(*s, "upbeat_promo" | "lofi_chill" | "cinematic_pulse" | "minimal_tech"))
            .unwrap_or(&sanitized_custom.recommended_bgm)
            .to_string()
    } else {
        req.bgm_preset.clone()
    };
    sanitized_custom.world_preset = world_preset.clone();
    sanitized_custom.recommended_bgm = effective_bgm.clone();

    let beat_notes: Vec<String> = val2["beatNotes"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                .collect()
        })
        .unwrap_or_default();

    let custom_design_json = serde_json::to_value(&sanitized_custom).unwrap_or(Value::Null);
    let effective_accent = if !sanitized_custom.palette.accent_primary.trim().is_empty() {
        sanitized_custom.palette.accent_primary.clone()
    } else {
        req.accent_color.clone()
    };

    // Lock beat timeline & words 100% to actual voiceover file duration on disk so audio & video NEVER drift!
    let mut synced_beats = req.beats.clone();
    let mut synced_words = req.words.clone();
    if let Some(ref ap) = req.audio_path {
        if !ap.trim().is_empty() {
            if let Ok(actual_ms) = crate::audio::probe_audio_duration_ms(&app, ap).await {
                if actual_ms >= 1500 {
                    rescale_beats_to_duration(&mut synced_beats, actual_ms);
                    if let Some(last_end) = synced_words.last().map(|w| w.end_ms) {
                        if last_end > 0 {
                            let ratio = (last_end as f64) / (actual_ms as f64);
                            if !(0.88..=1.04).contains(&ratio) {
                                let sc = (actual_ms as f64) / (last_end as f64);
                                for w in &mut synced_words {
                                    w.start_ms = ((w.start_ms as f64) * sc).round().min(actual_ms as f64) as u64;
                                    w.end_ms = ((w.end_ms as f64) * sc).round().min(actual_ms as f64) as u64;
                                    if w.end_ms < w.start_ms {
                                        w.end_ms = w.start_ms;
                                    }
                                }
                                if let Some(last) = synced_words.last_mut() {
                                    last.end_ms = actual_ms;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut scenes_json = Vec::with_capacity(synced_beats.len());
    for (idx, beat) in synced_beats.iter().enumerate() {
        let sfx_arr = if req.auto_sfx && !beat.sfx.is_empty() && beat.sfx != "none" {
            vec![json!({
                "preset": beat.sfx,
                "offsetMs": 0,
                "volume": 0.62
            })]
        } else {
            Vec::new()
        };
        let cam_note = beat_notes
            .get(idx)
            .cloned()
            .unwrap_or_else(|| beat.visual_concept.clone());

        scenes_json.push(json!({
            "id": beat.id,
            "role": beat.role,
            "startMs": beat.start_ms,
            "endMs": beat.end_ms,
            "text": beat.text,
            "visualSource": "motion",
            "aiMotion": {
                "engine": "diorama_3d",
                "theme": "paper",
                "title": beat.title,
                "subtitle": req.project_title.trim(),
                "diorama3d": {
                    "visualConcept": beat.visual_concept,
                    "worldPreset": world_preset,
                    "cameraNote": cam_note,
                    "skillsUsed": ["3d-diorama-storytelling"],
                    "verified": false
                }
            },
            "media": {
                "path": Value::Null,
                "secondaryPath": Value::Null,
                "trimStartMs": 0,
                "fit": "cover"
            },
            "motion": {
                "preset": "static_clean",
                "intensity": 0.2
            },
            "transitionIn": {
                "preset": "hard_cut",
                "durationMs": 0
            },
            "sfx": sfx_arr,
            "overlays": []
        }));
    }

    let now_ts = chrono::Utc::now().timestamp_millis();
    let now_iso = chrono::Utc::now().to_rfc3339();

    Ok(json!({
        "version": "2.1",
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
        "footageLibrary": [],
        "world3d": {
            "setupCode": setup_code,
            "animateCode": animate_code,
            "worldPreset": world_preset,
            "summary": world_summary,
            "verified": false
        },
        "globalStyle": {
            "captionPreset": req.caption_preset,
            "accentColor": effective_accent,
            "showProgressBar": true,
            "customDesign": custom_design_json,
            "bgm": {
                "preset": effective_bgm,
                "volume": 0.22,
                "autoDucking": req.auto_ducking
            },
            "safeZone": "tiktok_reels"
        },
        "voiceover": {
            "source": req.audio_source,
            "audioPath": req.audio_path,
            "trimSilence": req.trim_silence,
            "words": synced_words
        },
        "scenes": scenes_json
    }))
}

#[tauri::command]
pub async fn ai_critique_3d_frames(
    app: AppHandle,
    req: Critique3DFramesRequest,
) -> Result<Critique3DFramesResponse, String> {
    if req.frames.is_empty() {
        return Ok(Critique3DFramesResponse {
            ok: true,
            skipped: true,
            issue: String::new(),
            fix_hint: String::new(),
        });
    }
    let resolved = match byok::resolve_active_provider(&app) {
        Ok(r) => r,
        Err(_) => {
            return Ok(Critique3DFramesResponse {
                ok: true,
                skipped: true,
                issue: String::new(),
                fix_hint: String::new(),
            })
        }
    };

    let system_prompt = "Kamu adalah 3D Art Director & Visual QA Inspector.\n\
        Lihat 2 screenshot render Three.js WebGL dari video 3D vertikal 9:16 ini.\n\
        Cek dengan kritis apakah ada masalah FATAL:\n\
        - Kamera terhalang papan/kotak putih/tembok di depan lensa\n\
        - Gambar terlalu putih pucat / silau (overexposed / washed out) sampai objek tidak jelas\n\
        - Objek utama tidak terlihat, terlalu jauh/kecil, atau cuma bentuk abstrak tidak jelas\n\
        Balas HANYA JSON valid:\n\
        {\"ok\": true|false, \"issue\": \"masalah utama singkat jika ok=false\", \"fixHint\": \"instruksi konkret memperbaiki kamera/warna/stage jika ok=false\"}";

    let user_prompt = format!(
        "Proyek 3D: \"{}\" — Konsep: {}\n\
        Periksa 2 frame render WebGL terlampir (Frame Awal & Frame Tengah). Apakah visual 3D-nya sudah jelas, kontras baik, dan bebas halangan kamera?",
        req.project_title, req.world_summary
    );

    // Gracefully skip if user's custom model is text-only / does not accept images
    match call_llm_json(&resolved, system_prompt, &user_prompt, &req.frames).await {
        Ok((val, _)) => {
            let ok = val["ok"].as_bool().unwrap_or(true);
            let issue = val["issue"].as_str().unwrap_or("").trim().to_string();
            let fix_hint = val["fixHint"].as_str().unwrap_or("").trim().to_string();
            Ok(Critique3DFramesResponse {
                ok,
                skipped: false,
                issue,
                fix_hint,
            })
        }
        Err(_) => Ok(Critique3DFramesResponse {
            ok: true,
            skipped: true,
            issue: String::new(),
            fix_hint: String::new(),
        }),
    }
}

#[tauri::command]
pub async fn ai_repair_3d_diorama(
    app: AppHandle,
    req: Repair3DDioramaRequest,
) -> Result<Repair3DDioramaResponse, String> {
    let resolved = byok::resolve_active_provider(&app)?;
    let system_prompt = format!(
        "Kamu adalah Senior Three.js 3D Artist & Debugger di Synkcut.\n\
        Perbaiki `setupCode` dan `animateCode` berikut agar 100% bebas error, pakai High-Craft 3D Prefabs (`D3.laptop`, `D3.serverRack`, `D3.gpuChip`, `D3.waterBottle`, `D3.chatBubble3D`, `D3.barChart3D`, `D3.coolingTower`, `D3.building`), pisahkan stage tiap fase dengan `D3.showOnly(...)` agar kamera TIDAK PERNAH terhalang papan/dinding, dan pastikan kontras warna tajam tidak pucat silau!\n\
        Balas HANYA JSON: {{\"setupCode\": \"...\", \"animateCode\": \"...\"}}.\n\n\
        {DIORAMA_3D_SDK_REFERENCE}"
    );
    let user_prompt = format!(
        "Proyek: \"{}\" (worldPreset: {})\nBeat: {}\nMasalah / Kritik Visual: \"{}\"\n\nsetupCode sebelumnya:\n```js\n{}\n```\n\nanimateCode sebelumnya:\n```js\n{}\n```",
        req.project_title,
        req.world_preset,
        req.beats_summary,
        req.error_message,
        req.broken_setup_code.chars().take(4000).collect::<String>(),
        req.broken_animate_code.chars().take(4000).collect::<String>()
    );

    let (val, provider_used) = if !req.preview_frames.is_empty() {
        match call_llm_json(&resolved, &system_prompt, &user_prompt, &req.preview_frames).await {
            Ok(res) => res,
            Err(_) => call_llm_json(&resolved, &system_prompt, &user_prompt, &[]).await?,
        }
    } else {
        call_llm_json(&resolved, &system_prompt, &user_prompt, &[]).await?
    };
    let fixed_setup = clean_js_code_output(val["setupCode"].as_str().unwrap_or(""));
    let fixed_anim = clean_js_code_output(val["animateCode"].as_str().unwrap_or(""));
    if fixed_setup.len() < 30 || fixed_anim.len() < 30 {
        return Err("AI tidak mengembalikan perbaikan kode 3D yang lengkap.".to_string());
    }
    Ok(Repair3DDioramaResponse {
        setup_code: fixed_setup,
        animate_code: fixed_anim,
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
    fn test_sanitize_spoken_vo_line_strips_stage_directions() {
        let dirty = "3–15 detik | Dinding terbuka: rak GPU hitam. VO: \"Pesan lo dikirim ke server, dan GPU langsung kerja keras.\" Subtitle tebal di tengah.";
        let clean = sanitize_spoken_vo_line(dirty);
        assert_eq!(clean, "Pesan lo dikirim ke server, dan GPU langsung kerja keras.");

        let dirty2 = "0-3 detik | [Kamera zoom ke laptop] Setiap kali lo bilang makasih ke AI!";
        assert_eq!(
            sanitize_spoken_vo_line(dirty2),
            "Setiap kali lo bilang makasih ke AI!"
        );
    }

    #[test]
    fn test_rescale_beats_to_duration_locks_audio_length() {
        let mut beats = vec![
            StoryboardBeat {
                id: "b1".into(),
                role: "hook".into(),
                start_ms: 0,
                end_ms: 5000,
                text: "Satu dua tiga empat lima".into(),
                title: "Hook".into(),
                visual_concept: "A".into(),
                emotional_intent: "bold".into(),
                skills_used: vec![],
                transition_in: "hard_cut".into(),
                sfx: "pop_text".into(),
            },
            StoryboardBeat {
                id: "b2".into(),
                role: "cta".into(),
                start_ms: 5000,
                end_ms: 51200,
                text: "Enam tujuh delapan sembilan sepuluh".into(),
                title: "CTA".into(),
                visual_concept: "B".into(),
                emotional_intent: "bold".into(),
                skills_used: vec![],
                transition_in: "hard_cut".into(),
                sfx: "riser".into(),
            },
        ];
        rescale_beats_to_duration(&mut beats, 32000);
        assert_eq!(beats[0].start_ms, 0);
        assert_eq!(beats[1].end_ms, 32000);
        assert_eq!(beats[0].end_ms, beats[1].start_ms);
        assert!(beats[0].end_ms >= 14000 && beats[0].end_ms <= 18000);
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

    #[test]
    fn test_parse_http_json_or_sse_supports_bom_sse_ndjson_and_errors() {
        // 1. UTF-8 BOM + normal JSON
        let bom_json = "\u{feff}{\"choices\":[{\"message\":{\"content\":\"{\\\"ok\\\":true}\"}}]}";
        let v1 = parse_http_json_or_sse(bom_json).unwrap();
        assert_eq!(extract_openai_message_text(&v1).as_deref(), Some("{\"ok\":true}"));

        // 2. OpenAI SSE stream (`text/event-stream`)
        let sse = "data: {\"id\":\"1\",\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n\
                   data: {\"id\":\"1\",\"choices\":[{\"delta\":{\"content\":\"{\\\"projectTitle\\\":\\\"Promo \"}}]}\n\n\
                   data: {\"id\":\"1\",\"choices\":[{\"delta\":{\"content\":\"Codepolitan\\\"}\"}}]}\n\n\
                   data: [DONE]\n";
        let v2 = parse_http_json_or_sse(sse).unwrap();
        assert_eq!(v2["_decodedFrom"], "sse");
        let txt2 = extract_openai_message_text(&v2).unwrap();
        let parsed2 = parse_llm_json(&txt2).unwrap();
        assert_eq!(parsed2["projectTitle"], "Promo Codepolitan");

        // 3. Ollama NDJSON streaming
        let ndjson = "{\"message\":{\"content\":\"{\\\"hooks\\\":\"}}\n{\"message\":{\"content\":\"[]}\"}}\n";
        let v3 = parse_http_json_or_sse(ndjson).unwrap();
        assert_eq!(v3["_decodedFrom"], "ndjson");
        assert_eq!(extract_openai_message_text(&v3).as_deref(), Some("{\"hooks\":[]}"));

        // 4. HTTP 200 SSE embedded error
        let sse_err = "data: {\"error\":{\"message\":\"response_format json_object unsupported\"}}\n\ndata: [DONE]\n";
        let v4 = parse_http_json_or_sse(sse_err).unwrap();
        assert_eq!(
            extract_api_error_message(&v4).as_deref(),
            Some("response_format json_object unsupported")
        );
    }

    #[test]
    fn test_parse_llm_json_strips_thinking_blocks_and_prose_fences() {
        let thinking_out = "<think>Saya perlu memikirkan struktur {hook} dulu.</think>\nBerikut hasilnya:\n```json\n{\"projectTitle\":\"Codepolitan Junior\",\"cta\":\"Klik sekarang\"}\n```";
        let val = parse_llm_json(thinking_out).unwrap();
        assert_eq!(val["projectTitle"], "Codepolitan Junior");
        assert_eq!(val["cta"], "Klik sekarang");
    }

    #[test]
    fn test_extract_gemini_text_skips_thought_parts() {
        let resp = json!({
            "candidates": [{
                "content": {
                    "parts": [
                        { "thought": true, "text": "Internal reasoning {not json}" },
                        { "text": "{\"projectTitle\":\"Final\"}" }
                    ]
                }
            }]
        });
        assert_eq!(
            extract_gemini_text(&resp).as_deref(),
            Some("{\"projectTitle\":\"Final\"}")
        );
    }

    #[test]
    fn test_coffee_lapisan_never_falls_back_to_smartphone_sample() {
        let motion = build_fallback_ai_motion(
            "body",
            1,
            "3 Lapis Racikan Pas, tuang es batu 5 detik siap seruput kopi susu gula aren!",
            "Kopi Susu Gula Aren",
            "carbon",
            &[],
        );
        // Must NEVER trigger smartphone 3D breakdown or dummy Masukan/Proses Inti!
        assert_eq!(motion["engine"], "custom_code");
        let serialized = motion.to_string();
        assert!(!serialized.contains("MagSafe"));
        assert!(!serialized.contains("OLED"));
        assert!(!serialized.contains("Masukan"));
    }

    #[test]
    fn test_segment_script_into_micro_beats_avoids_long_15s_scenes() {
        let script = "Pernah bingung kenapa anak terus main HP seharian tanpa henti? Di CODEPOLITAN Junior, screen time anak diubah jadi bikin game sendiri pakai blok Scratch yang seru banget. Belajarnya santai sambil melatih logika dan problem solving sejak dini. Investasi skill masa depan cuma satu koma dua juta sudah lengkap dengan bimbingan mentor. Daftar sekarang di junior dot codepolitan dot com!";
        let beats = segment_script_into_micro_beats(script, 36_000, &[]);
        assert!(beats.len() >= 6, "expected at least 6 micro-beats, got {}", beats.len());
        for (_, _, s, e) in &beats {
            assert!(
                e.saturating_sub(*s) <= 8500,
                "no micro-beat should be 15s static (got {}ms)",
                e.saturating_sub(*s)
            );
        }
    }

    #[test]
    fn test_clean_js_code_output_unwraps_fences_and_function_wrapper() {
        let raw = "```javascript\nfunction renderBeat(ctx, state, M) {\n  M.drawBackdrop(ctx, state);\n}\n```";
        assert_eq!(clean_js_code_output(raw), "M.drawBackdrop(ctx, state);");
        let setup_raw = "```js\nfunction setupWorld(world, D3) {\n  D3.buildOceanCutaway(world);\n}\n```";
        assert_eq!(clean_js_code_output(setup_raw), "D3.buildOceanCutaway(world);");
    }

    #[test]
    fn test_sanitize_ai_motion_supports_diorama_3d_and_copilot_preserves_world3d() {
        let raw_motion = json!({
            "engine": "diorama_3d",
            "title": "Anjungan Minyak Laut",
            "diorama3d": {
                "visualConcept": "Rig minyak mengapung di atas laut cutaway 1500m",
                "worldPreset": "ocean_cross_section",
                "cameraNote": "Dive dari permukaan laut ke bawah air"
            }
        });
        let sanitized = sanitize_ai_motion_value(&raw_motion, "Anjungan minyak", "paper");
        assert_eq!(sanitized["engine"], "diorama_3d");
        assert_eq!(sanitized["diorama3d"]["worldPreset"], "ocean_cross_section");

        let orig = json!({
            "version": "2.1",
            "world3d": {
                "setupCode": "D3.buildOceanCutaway(world);",
                "animateCode": "D3.animateOcean(world, state.globalTimeMs / 1000);",
                "worldPreset": "ocean_cross_section",
                "summary": "Laut cutaway"
            },
            "scenes": [{
                "id": "beat_1",
                "role": "hook",
                "startMs": 0,
                "endMs": 3200,
                "text": "Kok anjungan minyak bisa ngapung?",
                "visualSource": "motion",
                "aiMotion": sanitized,
                "media": { "path": null, "trimStartMs": 0, "fit": "cover" },
                "motion": { "preset": "static_clean", "intensity": 0.2 },
                "transitionIn": { "preset": "hard_cut", "durationMs": 0 },
                "sfx": [],
                "overlays": []
            }]
        });

        let patch = json!({
            "world3d": {
                "setupCode": "D3.buildOceanCutaway(world, { fishCount: 12 });",
                "animateCode": "[3d-world-animate-preserved]"
            }
        });
        let merged = merge_and_sanitize_copilot_patch(&orig, &patch, Some("beat_1"), "Tambah ikan");
        assert_eq!(merged["version"], "2.1");
        assert!(merged["world3d"]["setupCode"].as_str().unwrap().contains("fishCount: 12"));
        assert_eq!(
            merged["world3d"]["animateCode"],
            "D3.animateOcean(world, state.globalTimeMs / 1000);"
        );
    }
}
