use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;
use tauri::{AppHandle, Manager};

const SERVICE_NAME: &str = "id.synkcut.studio.byok";
pub const PROVIDERS: [&str; 4] = ["gemini", "openai", "openrouter", "custom"];

/// Verified fast, JSON-capable Gemini models (ordered by live speed & reliability).
pub const GEMINI_FALLBACK_MODELS: [&str; 6] = [
    "gemini-3.5-flash-lite",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
];

pub fn default_model_for(provider: &str) -> &'static str {
    match provider {
        "gemini" => "gemini-3.5-flash-lite",
        "openai" => "gpt-4.1-mini",
        "openrouter" => "google/gemini-3-flash-preview",
        "custom" => "deepseek-chat",
        _ => "gemini-3.5-flash-lite",
    }
}

/// Normalize any OpenAI-compatible base URL into its `/chat/completions` endpoint.
pub fn normalize_chat_completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.ends_with("/chat/completions") {
        return trimmed.to_string();
    }
    if trimmed.ends_with("/v1")
        || trimmed.ends_with("/v1beta")
        || trimmed.ends_with("/v2")
        || trimmed.ends_with("/openai")
    {
        return format!("{trimmed}/chat/completions");
    }
    // Common local/custom roots like http://localhost:11434 or https://api.deepseek.com
    format!("{trimmed}/v1/chat/completions")
}

/// Normalize any OpenAI-compatible base URL into its `/models` endpoint.
pub fn normalize_models_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }
    if let Some(root) = trimmed.strip_suffix("/chat/completions") {
        return format!("{root}/models");
    }
    if trimmed.ends_with("/models") {
        return trimmed.to_string();
    }
    if trimmed.ends_with("/v1")
        || trimmed.ends_with("/v1beta")
        || trimmed.ends_with("/v2")
        || trimmed.ends_with("/openai")
    {
        return format!("{trimmed}/models");
    }
    format!("{trimmed}/v1/models")
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredAppConfig {
    #[serde(default = "default_active_provider")]
    pub active_provider: String,
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default)]
    pub models: HashMap<String, String>,
    #[serde(default)]
    pub custom_base_url: String,
}

fn default_active_provider() -> String {
    "gemini".to_string()
}

impl Default for StoredAppConfig {
    fn default() -> Self {
        Self {
            active_provider: "gemini".to_string(),
            onboarding_completed: false,
            models: HashMap::new(),
            custom_base_url: String::new(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyInfo {
    pub configured: bool,
    pub masked_key: Option<String>,
    pub model: String,
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ByokStatus {
    pub active_provider: String,
    pub onboarding_completed: bool,
    pub providers: HashMap<String, ProviderKeyInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub ok: bool,
    pub provider: String,
    pub latency_ms: u64,
    pub message: String,
    pub detail: Option<String>,
    pub resolved_model: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedProvider {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub base_url: Option<String>,
}

fn validate_provider(provider: &str) -> Result<&'static str, String> {
    match provider {
        "gemini" => Ok("gemini"),
        "openai" => Ok("openai"),
        "openrouter" => Ok("openrouter"),
        "custom" => Ok("custom"),
        _ => Err(format!("Provider tidak dikenal: {provider}")),
    }
}

pub fn mask_api_key(key: &str) -> String {
    let trimmed = key.trim();
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= 8 {
        return "••••••••".to_string();
    }
    let prefix: String = chars[..4].iter().collect();
    let suffix: String = chars[chars.len() - 4..].iter().collect();
    format!("{prefix}••••{suffix}")
}

fn config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Gagal mengakses direktori data aplikasi: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Gagal membuat direktori data aplikasi: {e}"))?;
    Ok(dir.join("byok_config.json"))
}

pub fn read_config(app: &AppHandle) -> StoredAppConfig {
    let Ok(path) = config_file_path(app) else {
        return StoredAppConfig::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<StoredAppConfig>(&raw).ok())
        .unwrap_or_default()
}

fn write_config(app: &AppHandle, config: &StoredAppConfig) -> Result<(), String> {
    let path = config_file_path(app)?;
    let raw = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Gagal serialisasi konfigurasi: {e}"))?;
    std::fs::write(path, raw).map_err(|e| format!("Gagal menyimpan konfigurasi: {e}"))
}

fn get_keyring_entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, provider)
        .map_err(|e| format!("Gagal membuka Windows Credential Manager: {e}"))
}

pub fn read_stored_key(provider: &str) -> Option<String> {
    let entry = get_keyring_entry(provider).ok()?;
    match entry.get_password() {
        Ok(val) if !val.trim().is_empty() => Some(val),
        _ => None,
    }
}

pub fn effective_model(cfg: &StoredAppConfig, provider: &str) -> String {
    cfg.models
        .get(provider)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| default_model_for(provider).to_string())
}

pub fn is_provider_configured(cfg: &StoredAppConfig, provider: &str, key: Option<&str>) -> bool {
    if provider == "custom" {
        let has_url = !cfg.custom_base_url.trim().is_empty();
        let has_model = cfg
            .models
            .get("custom")
            .map(|m| !m.trim().is_empty())
            .unwrap_or(false);
        has_url && has_model
    } else {
        key.map(|k| !k.trim().is_empty()).unwrap_or(false)
    }
}

pub fn resolve_active_provider(app: &AppHandle) -> Result<ResolvedProvider, String> {
    let cfg = read_config(app);

    let try_build = |prov: &str| -> Option<ResolvedProvider> {
        let key = read_stored_key(prov);
        if !is_provider_configured(&cfg, prov, key.as_deref()) {
            return None;
        }
        Some(ResolvedProvider {
            provider: prov.to_string(),
            api_key: key.unwrap_or_default(),
            model: effective_model(&cfg, prov),
            base_url: if prov == "custom" {
                Some(cfg.custom_base_url.trim().to_string())
            } else {
                None
            },
        })
    };

    if let Some(active) = try_build(&cfg.active_provider) {
        return Ok(active);
    }
    for fallback in PROVIDERS {
        if let Some(found) = try_build(fallback) {
            return Ok(found);
        }
    }
    Err("Belum ada AI Provider atau Custom Model yang diatur. Buka menu Pengaturan AI terlebih dahulu.".to_string())
}

pub fn get_gemini_model_for_app(app: &AppHandle) -> String {
    let cfg = read_config(app);
    effective_model(&cfg, "gemini")
}

/// Query Google Gemini `/v1beta/models` and return candidate `generateContent`-capable chat model IDs.
pub async fn discover_gemini_live_models(
    client: &reqwest::Client,
    api_key: &str,
) -> Result<Vec<String>, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models?key={api_key}&pageSize=200"
    );
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Gagal menghubungi Gemini API: {e}"))?;

    if !res.status().is_success() {
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        return Err(format!(
            "Gemini API menolak permintaan (HTTP {status}): {}",
            body.chars().take(180).collect::<String>()
        ));
    }

    let val: Value = crate::ai::decode_llm_http_body(res).await?;
    let mut models: Vec<String> = val["models"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let methods = m["supportedGenerationMethods"].as_array()?;
                    let supports_gen = methods
                        .iter()
                        .any(|x| x.as_str() == Some("generateContent"));
                    if !supports_gen {
                        return None;
                    }
                    let raw_name = m["name"].as_str()?;
                    let id = raw_name.strip_prefix("models/").unwrap_or(raw_name);
                    let lower = id.to_lowercase();
                    // Keep text/multimodal chat Gemini/Gemma models; exclude specialized tts/image/audio/tools
                    if (!lower.starts_with("gemini-") && !lower.starts_with("gemma-"))
                        || lower.contains("tts")
                        || lower.contains("embedding")
                        || lower.contains("image")
                        || lower.contains("imagen")
                        || lower.contains("veo")
                        || lower.contains("aqa")
                        || lower.contains("robotics")
                        || lower.contains("computer-use")
                        || lower.contains("deep-research")
                        || lower.contains("transcribe")
                        || lower.contains("nano-banana")
                        || lower.contains("lyria")
                        || lower.contains("antigravity")
                    {
                        return None;
                    }
                    Some(id.to_string())
                })
                .collect()
        })
        .unwrap_or_default();

    models.sort();
    models.dedup();
    Ok(models)
}

/// Concurrently probes candidate Gemini models against `generateContent` (with JSON mode)
/// and returns ONLY models that genuinely succeed with HTTP 200, ordered fastest-first.
pub async fn probe_verified_gemini_models(api_key: &str) -> Result<Vec<String>, String> {
    let list_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| format!("Gagal membuat HTTP client: {e}"))?;

    let candidates = discover_gemini_live_models(&list_client, api_key).await?;
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let probe_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(9))
        .build()
        .map_err(|e| format!("Gagal membuat HTTP client: {e}"))?;

    let ping_payload = json!({
        "contents": [{ "role": "user", "parts": [{ "text": "Balas JSON {\"ok\":true}" }] }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "maxOutputTokens": 24,
            "temperature": 0.0
        }
    });

    let mut join_set = tokio::task::JoinSet::new();
    for model_id in candidates {
        let client = probe_client.clone();
        let key = api_key.to_string();
        let payload = ping_payload.clone();
        join_set.spawn(async move {
            let start = Instant::now();
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent?key={key}"
            );
            match client.post(url).json(&payload).send().await {
                Ok(res) if res.status().is_success() => {
                    Some((model_id, start.elapsed().as_millis() as u64))
                }
                _ => None,
            }
        });
    }

    let mut verified: Vec<(String, u64)> = Vec::new();
    while let Some(joined) = join_set.join_next().await {
        if let Ok(Some(item)) = joined {
            verified.push(item);
        }
    }

    // Sort fastest verified Gemini Flash models first
    verified.sort_by(|a, b| {
        let priority = |id: &str| -> u8 {
            if id == "gemini-3.5-flash-lite" {
                0
            } else if id.starts_with("gemini-") {
                1
            } else {
                2
            }
        };
        priority(&a.0)
            .cmp(&priority(&b.0))
            .then_with(|| a.1.cmp(&b.1))
            .then_with(|| a.0.cmp(&b.0))
    });

    Ok(verified.into_iter().map(|(id, _)| id).collect())
}

#[tauri::command]
pub fn get_byok_status(app: AppHandle) -> ByokStatus {
    let cfg = read_config(&app);
    let mut map = HashMap::new();

    for p in PROVIDERS {
        let key = read_stored_key(p);
        let configured = is_provider_configured(&cfg, p, key.as_deref());
        let model = if p == "custom" {
            cfg.models
                .get("custom")
                .map(|m| m.trim().to_string())
                .unwrap_or_default()
        } else {
            effective_model(&cfg, p)
        };
        map.insert(
            p.to_string(),
            ProviderKeyInfo {
                configured,
                masked_key: key.as_deref().map(mask_api_key),
                model,
                base_url: if p == "custom" && !cfg.custom_base_url.trim().is_empty() {
                    Some(cfg.custom_base_url.trim().to_string())
                } else {
                    None
                },
            },
        );
    }

    ByokStatus {
        active_provider: cfg.active_provider,
        onboarding_completed: cfg.onboarding_completed,
        providers: map,
    }
}

#[tauri::command]
pub fn save_byok_key(
    app: AppHandle,
    provider: String,
    api_key: String,
    set_active: Option<bool>,
) -> Result<ByokStatus, String> {
    save_provider_config(app, provider, Some(api_key), None, None, set_active)
}

#[tauri::command]
pub fn save_provider_config(
    app: AppHandle,
    provider: String,
    api_key: Option<String>,
    model: Option<String>,
    base_url: Option<String>,
    set_active: Option<bool>,
) -> Result<ByokStatus, String> {
    let valid = validate_provider(&provider)?;
    let mut cfg = read_config(&app);

    if valid == "custom" {
        if let Some(raw_url) = base_url {
            let trimmed_url = raw_url.trim();
            if trimmed_url.is_empty() {
                return Err("Base URL Custom Model wajib diisi (mis. https://api.deepseek.com/v1 atau http://localhost:11434/v1).".to_string());
            }
            if !trimmed_url.starts_with("http://") && !trimmed_url.starts_with("https://") {
                return Err("Base URL harus diawali http:// atau https://.".to_string());
            }
            cfg.custom_base_url = trimmed_url.to_string();
        }
        if let Some(raw_model) = model {
            let trimmed_model = raw_model.trim();
            if trimmed_model.is_empty() {
                return Err("Nama Model ID untuk Custom Model wajib diisi (mis. deepseek-chat atau qwen2.5:14b).".to_string());
            }
            cfg.models
                .insert("custom".to_string(), trimmed_model.to_string());
        }
        if let Some(raw_key) = api_key {
            let trimmed_key = raw_key.trim();
            if !trimmed_key.is_empty() {
                let entry = get_keyring_entry("custom")?;
                entry.set_password(trimmed_key).map_err(|e| {
                    format!("Gagal menyimpan API Key ke Windows Credential Manager: {e}")
                })?;
            }
        }
        if !is_provider_configured(&cfg, "custom", read_stored_key("custom").as_deref()) {
            return Err("Isi Base URL dan Model ID terlebih dahulu sebelum menyimpan Custom Model.".to_string());
        }
    } else {
        if let Some(raw_key) = api_key {
            let trimmed = raw_key.trim();
            if !trimmed.is_empty() {
                if trimmed.len() < 8 {
                    return Err("API Key terlalu pendek. Pastikan lo menyalin key secara utuh.".to_string());
                }
                let entry = get_keyring_entry(valid)?;
                entry.set_password(trimmed).map_err(|e| {
                    format!("Gagal menyimpan API Key ke Windows Credential Manager: {e}")
                })?;
            }
        }

        if let Some(raw_model) = model {
            let trimmed_model = raw_model.trim();
            if trimmed_model.is_empty() {
                cfg.models.remove(valid);
            } else {
                cfg.models
                    .insert(valid.to_string(), trimmed_model.to_string());
            }
        }

        if read_stored_key(valid).is_none() {
            return Err("Masukkan API Key yang valid sebelum menyimpan.".to_string());
        }
    }

    if set_active.unwrap_or(true) {
        cfg.active_provider = valid.to_string();
    }
    cfg.onboarding_completed = true;
    write_config(&app, &cfg)?;

    Ok(get_byok_status(app))
}

#[tauri::command]
pub fn set_active_provider(app: AppHandle, provider: String) -> Result<ByokStatus, String> {
    let valid = validate_provider(&provider)?;
    let mut cfg = read_config(&app);
    cfg.active_provider = valid.to_string();
    write_config(&app, &cfg)?;
    Ok(get_byok_status(app))
}

#[tauri::command]
pub fn complete_onboarding(app: AppHandle) -> Result<ByokStatus, String> {
    let mut cfg = read_config(&app);
    cfg.onboarding_completed = true;
    write_config(&app, &cfg)?;
    Ok(get_byok_status(app))
}

#[tauri::command]
pub fn delete_byok_key(app: AppHandle, provider: String) -> Result<ByokStatus, String> {
    let valid = validate_provider(&provider)?;
    if let Ok(entry) = get_keyring_entry(valid) {
        let _ = entry.delete_credential();
    }
    if valid == "custom" {
        let mut cfg = read_config(&app);
        cfg.custom_base_url.clear();
        cfg.models.remove("custom");
        let _ = write_config(&app, &cfg);
    }
    Ok(get_byok_status(app))
}

#[tauri::command]
pub async fn fetch_provider_models(
    app: AppHandle,
    provider: String,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<String>, String> {
    let valid = validate_provider(&provider)?;
    let cfg = read_config(&app);

    let resolved_key = match api_key.as_deref().map(str::trim) {
        Some(k) if !k.is_empty() => Some(k.to_string()),
        _ => read_stored_key(valid),
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Gagal membuat HTTP client: {e}"))?;

    match valid {
        "gemini" => {
            let key = resolved_key.ok_or_else(|| {
                "Masukkan API Key Google Gemini terlebih dahulu untuk mengecek model yang lolos koneksi."
                    .to_string()
            })?;
            probe_verified_gemini_models(&key).await
        }
        "openai" => {
            let key = resolved_key.ok_or_else(|| {
                "Masukkan API Key OpenAI terlebih dahulu untuk mengambil daftar model.".to_string()
            })?;
            let res = client
                .get("https://api.openai.com/v1/models")
                .bearer_auth(&key)
                .send()
                .await
                .map_err(|e| format!("Gagal menghubungi OpenAI API: {e}"))?;
            if !res.status().is_success() {
                return Err(format!(
                    "OpenAI menolak permintaan (HTTP {}). Periksa API Key lo.",
                    res.status().as_u16()
                ));
            }
            let val: Value = crate::ai::decode_llm_http_body(res).await?;
            let mut ids: Vec<String> = val["data"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m["id"].as_str())
                        .filter(|id| {
                            let l = id.to_lowercase();
                            (l.starts_with("gpt-")
                                || l.starts_with("o1")
                                || l.starts_with("o3")
                                || l.starts_with("o4")
                                || l.starts_with("chatgpt"))
                                && !l.contains("audio")
                                && !l.contains("realtime")
                                && !l.contains("tts")
                                && !l.contains("transcribe")
                                && !l.contains("image")
                                && !l.contains("search")
                        })
                        .map(ToString::to_string)
                        .collect()
                })
                .unwrap_or_default();
            ids.sort();
            ids.reverse();
            ids.truncate(40);
            Ok(ids)
        }
        "openrouter" => {
            let mut req = client.get("https://openrouter.ai/api/v1/models");
            if let Some(ref key) = resolved_key {
                req = req.bearer_auth(key);
            }
            let res = req
                .send()
                .await
                .map_err(|e| format!("Gagal menghubungi OpenRouter API: {e}"))?;
            if !res.status().is_success() {
                return Err(format!(
                    "OpenRouter mengembalikan HTTP {}.",
                    res.status().as_u16()
                ));
            }
            let val: Value = crate::ai::decode_llm_http_body(res).await?;
            let mut ids: Vec<String> = vec![
                "openrouter/free".to_string(),
                "openrouter/auto".to_string(),
            ];
            if let Some(arr) = val["data"].as_array() {
                for m in arr {
                    if let Some(id) = m["id"].as_str() {
                        let l = id.to_lowercase();
                        if l.contains("gemini")
                            || l.contains("gpt-4.1")
                            || l.contains("gpt-4o")
                            || l.contains("gpt-5")
                            || l.contains("claude")
                            || l.contains("deepseek")
                            || l.ends_with(":free")
                        {
                            if !ids.iter().any(|x| x == id) {
                                ids.push(id.to_string());
                            }
                        }
                    }
                    if ids.len() >= 50 {
                        break;
                    }
                }
            }
            Ok(ids)
        }
        "custom" => {
            let raw_url = base_url
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(cfg.custom_base_url.trim());
            if raw_url.is_empty() {
                return Err("Isi Base URL Custom Model dulu sebelum mengambil daftar model.".to_string());
            }
            let models_url = normalize_models_url(raw_url);
            let mut req = client.get(&models_url);
            if let Some(ref key) = resolved_key {
                if !key.trim().is_empty() {
                    req = req.bearer_auth(key);
                }
            }
            let res = req.send().await.map_err(|e| {
                format!("Tidak bisa menghubungi {models_url}. Pastikan endpoint/server lokal aktif ({e}).")
            })?;
            if !res.status().is_success() {
                return Err(format!(
                    "Endpoint mengembalikan HTTP {}. Ketik Model ID secara manual jika endpoint tidak menyediakan /models.",
                    res.status().as_u16()
                ));
            }
            let val: Value = crate::ai::decode_llm_http_body(res).await?;
            let mut ids: Vec<String> = val["data"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m["id"].as_str().map(ToString::to_string))
                        .collect()
                })
                .unwrap_or_default();
            // Ollama native /api/tags format fallback
            if ids.is_empty() {
                if let Some(arr) = val["models"].as_array() {
                    for m in arr {
                        if let Some(name) = m["name"].as_str().or_else(|| m["id"].as_str()) {
                            ids.push(name.to_string());
                        }
                    }
                }
            }
            ids.truncate(60);
            if ids.is_empty() {
                return Err("Endpoint merespons, tapi tidak mengembalikan daftar model. Silakan ketik Model ID manual.".to_string());
            }
            Ok(ids)
        }
        _ => unreachable!(),
    }
}

#[tauri::command]
pub async fn test_byok_connection(
    app: AppHandle,
    provider: String,
    api_key: Option<String>,
    model: Option<String>,
    base_url: Option<String>,
) -> Result<ConnectionTestResult, String> {
    let valid = validate_provider(&provider)?;
    let cfg = read_config(&app);

    let resolved_key = match api_key.as_deref().map(str::trim) {
        Some(k) if !k.is_empty() => Some(k.to_string()),
        _ => read_stored_key(valid),
    };

    if valid != "custom" && resolved_key.is_none() {
        return Err("API Key belum diisi. Masukkan API Key dulu sebelum mengetes koneksi.".to_string());
    }

    let chosen_model = model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| effective_model(&cfg, valid));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(18))
        .build()
        .map_err(|e| format!("Gagal menginisialisasi HTTP client: {e}"))?;

    let start = Instant::now();

    match valid {
        "gemini" => {
            let key = resolved_key.unwrap_or_default();
            let ping_payload = json!({
                "contents": [{ "role": "user", "parts": [{ "text": "Balas JSON {\"ok\":true}" }] }],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "maxOutputTokens": 24,
                    "temperature": 0.0
                }
            });

            // Try chosen model first, then verified fast fallback models if 404/503/429/timeout
            let mut candidates = vec![chosen_model.clone()];
            for fb in GEMINI_FALLBACK_MODELS {
                if !candidates.iter().any(|c| c == fb) {
                    candidates.push(fb.to_string());
                }
            }

            let mut last_status = 0u16;
            let mut last_body = String::new();
            let mut any_quota_429 = false;

            let probe_client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .map_err(|e| format!("Gagal menginisialisasi HTTP client: {e}"))?;

            for candidate in candidates {
                let url = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{candidate}:generateContent?key={key}"
                );
                match probe_client.post(&url).json(&ping_payload).send().await {
                    Ok(res) => {
                        let status = res.status().as_u16();
                        if res.status().is_success() {
                            let latency_ms = start.elapsed().as_millis() as u64;
                            let note = if candidate != chosen_model {
                                format!(
                                    "Model '{chosen_model}' tidak aktif/sibuk (HTTP {last_status}), otomatis beralih ke '{candidate}' yang lolos koneksi!"
                                )
                            } else {
                                format!("Model '{candidate}' lolos tes JSON & siap dipakai AI Director.")
                            };
                            return Ok(ConnectionTestResult {
                                ok: true,
                                provider: "gemini".to_string(),
                                latency_ms,
                                message: format!("Koneksi berhasil ({latency_ms} ms)."),
                                detail: Some(note),
                                resolved_model: Some(candidate),
                            });
                        }
                        last_status = status;
                        last_body = res.text().await.unwrap_or_default();

                        // Invalid API key / forbidden -> fail immediately
                        if status == 401 || status == 403 || (status == 400 && !last_body.contains("JSON mode")) {
                            let latency_ms = start.elapsed().as_millis() as u64;
                            return Ok(ConnectionTestResult {
                                ok: false,
                                provider: "gemini".to_string(),
                                latency_ms,
                                message: "API Key Gemini ditolak. Pastikan key disalin utuh dan masih aktif.".to_string(),
                                detail: Some(format!("HTTP {status}: {}", last_body.chars().take(160).collect::<String>())),
                                resolved_model: None,
                            });
                        }
                        if status == 429 {
                            any_quota_429 = true;
                        }
                        // On 404, 503 (high demand), 429 (model-specific zero quota), or unsupported JSON mode -> try next verified model!
                    }
                    Err(err) => {
                        if err.is_timeout() {
                            last_status = 504;
                            last_body = "Timeout".to_string();
                            continue;
                        }
                        let latency_ms = start.elapsed().as_millis() as u64;
                        return Ok(ConnectionTestResult {
                            ok: false,
                            provider: "gemini".to_string(),
                            latency_ms,
                            message: "Tidak dapat terhubung ke server Google Gemini. Cek koneksi internet lo.".to_string(),
                            detail: Some(err.to_string()),
                            resolved_model: None,
                        });
                    }
                }
            }

            // Final resort: concurrently probe all models on this account and return the first live 200 model
            if let Ok(verified) = probe_verified_gemini_models(&key).await {
                if let Some(best) = verified.into_iter().next() {
                    let latency_ms = start.elapsed().as_millis() as u64;
                    return Ok(ConnectionTestResult {
                        ok: true,
                        provider: "gemini".to_string(),
                        latency_ms,
                        message: format!("Koneksi berhasil ({latency_ms} ms)."),
                        detail: Some(format!(
                            "Model '{chosen_model}' gagal, otomatis beralih ke '{best}' yang aktif di akun lo."
                        )),
                        resolved_model: Some(best),
                    });
                }
            }

            let latency_ms = start.elapsed().as_millis() as u64;
            let err_msg = if any_quota_429 {
                "Semua model Gemini terkena batas kuota (HTTP 429) pada API Key ini. Tunggu beberapa saat atau gunakan API Key lain.".to_string()
            } else {
                format!("Model '{chosen_model}' tidak merespons (HTTP {last_status}). Klik 'Tes & Ambil Model Aktif' untuk cek model yang tersedia.")
            };
            Ok(ConnectionTestResult {
                ok: false,
                provider: "gemini".to_string(),
                latency_ms,
                message: err_msg,
                detail: Some(last_body.chars().take(180).collect()),
                resolved_model: None,
            })
        }
        "openai" | "openrouter" | "custom" => {
            let endpoint = match valid {
                "openai" => "https://api.openai.com/v1/chat/completions".to_string(),
                "openrouter" => "https://openrouter.ai/api/v1/chat/completions".to_string(),
                "custom" => {
                    let raw = base_url
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .unwrap_or(cfg.custom_base_url.trim());
                    if raw.is_empty() {
                        return Err("Base URL Custom Model wajib diisi sebelum tes koneksi.".to_string());
                    }
                    normalize_chat_completions_url(raw)
                }
                _ => unreachable!(),
            };

            if chosen_model.trim().is_empty() {
                return Err("Nama Model ID wajib diisi sebelum tes koneksi.".to_string());
            }

            let payload = json!({
                "model": chosen_model,
                "stream": false,
                "max_tokens": 12,
                "temperature": 0.0,
                "messages": [{ "role": "user", "content": "Balas singkat: OK" }]
            });

            let mut req = client
                .post(&endpoint)
                .header(reqwest::header::ACCEPT, "application/json, text/event-stream")
                .json(&payload);
            if let Some(ref key) = resolved_key {
                if !key.trim().is_empty() {
                    req = req.bearer_auth(key);
                }
            }
            if valid == "openrouter" {
                req = req
                    .header("HTTP-Referer", "https://synkcut.app")
                    .header("X-Title", "Synkcut Studio");
            }

            match req.send().await {
                Ok(res) => {
                    let status = res.status().as_u16();
                    let latency_ms = start.elapsed().as_millis() as u64;
                    if res.status().is_success() {
                        match crate::ai::decode_llm_http_body(res).await {
                            Ok(val) => {
                                if let Some(api_err) = crate::ai::extract_api_error_message(&val) {
                                    return Ok(ConnectionTestResult {
                                        ok: false,
                                        provider: valid.to_string(),
                                        latency_ms,
                                        message: format!("Server mengembalikan error pada model '{chosen_model}'."),
                                        detail: Some(api_err),
                                        resolved_model: None,
                                    });
                                }
                                let mode_note = match val["_decodedFrom"].as_str() {
                                    Some("sse") => " (mode SSE kompatibel)",
                                    Some("ndjson") => " (mode NDJSON kompatibel)",
                                    _ => "",
                                };
                                Ok(ConnectionTestResult {
                                    ok: true,
                                    provider: valid.to_string(),
                                    latency_ms,
                                    message: format!("Koneksi berhasil ({latency_ms} ms)."),
                                    detail: Some(format!(
                                        "Model '{chosen_model}' aktif & siap dipakai AI Director{mode_note}."
                                    )),
                                    resolved_model: Some(chosen_model),
                                })
                            }
                            Err(decode_err) => Ok(ConnectionTestResult {
                                ok: false,
                                provider: valid.to_string(),
                                latency_ms,
                                message: format!("Server terhubung (HTTP {status}), tetapi format respons tidak bisa dibaca."),
                                detail: Some(decode_err),
                                resolved_model: None,
                            }),
                        }
                    } else {
                        let body = res.text().await.unwrap_or_default();
                        let friendly = match status {
                            401 | 403 => "API Key ditolak oleh server. Periksa apakah key sudah benar dan masih aktif.".to_string(),
                            402 => "Saldo kredit provider tidak cukup (HTTP 402). Di OpenRouter, coba pilih model gratis 'openrouter/free'.".to_string(),
                            404 => format!("Model '{chosen_model}' atau endpoint tidak ditemukan (HTTP 404). Klik 'Cek Daftar Model' atau cek Base URL."),
                            429 => "Batas kuota / rate limit tercapai (HTTP 429). Coba lagi sebentar.".to_string(),
                            _ => format!("Server mengembalikan HTTP {status}."),
                        };
                        Ok(ConnectionTestResult {
                            ok: false,
                            provider: valid.to_string(),
                            latency_ms,
                            message: friendly,
                            detail: Some(body.chars().take(180).collect()),
                            resolved_model: None,
                        })
                    }
                }
                Err(err) => {
                    let latency_ms = start.elapsed().as_millis() as u64;
                    let msg = if valid == "custom" {
                        format!("Gagal terhubung ke {endpoint}. Pastikan URL benar dan server (mis. Ollama/LM Studio) sedang menyala.")
                    } else {
                        "Tidak dapat terhubung ke server provider. Pastikan koneksi internet aktif.".to_string()
                    };
                    Ok(ConnectionTestResult {
                        ok: false,
                        provider: valid.to_string(),
                        latency_ms,
                        message: msg,
                        detail: Some(err.to_string()),
                        resolved_model: None,
                    })
                }
            }
        }
        _ => unreachable!(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mask_api_key() {
        assert_eq!(mask_api_key("AIzaSyD1234567890abcd"), "AIza••••abcd");
        assert_eq!(mask_api_key("short"), "••••••••");
    }

    #[test]
    fn test_validate_provider() {
        assert_eq!(validate_provider("gemini"), Ok("gemini"));
        assert_eq!(validate_provider("openai"), Ok("openai"));
        assert_eq!(validate_provider("openrouter"), Ok("openrouter"));
        assert_eq!(validate_provider("custom"), Ok("custom"));
        assert!(validate_provider("unknown").is_err());
    }

    #[test]
    fn test_normalize_custom_urls() {
        assert_eq!(
            normalize_chat_completions_url("https://api.deepseek.com/v1"),
            "https://api.deepseek.com/v1/chat/completions"
        );
        assert_eq!(
            normalize_chat_completions_url("https://api.deepseek.com/v1/chat/completions"),
            "https://api.deepseek.com/v1/chat/completions"
        );
        assert_eq!(
            normalize_chat_completions_url("http://localhost:11434"),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            normalize_models_url("https://api.groq.com/openai/v1/chat/completions"),
            "https://api.groq.com/openai/v1/models"
        );
        assert_eq!(
            normalize_models_url("http://localhost:11434/v1"),
            "http://localhost:11434/v1/models"
        );
    }

    #[test]
    fn test_custom_provider_configured_without_key() {
        let mut cfg = StoredAppConfig::default();
        assert!(!is_provider_configured(&cfg, "custom", None));
        cfg.custom_base_url = "http://localhost:11434/v1".to_string();
        cfg.models.insert("custom".to_string(), "qwen2.5:14b".to_string());
        assert!(is_provider_configured(&cfg, "custom", None));
    }
}
