use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;
use tauri::{AppHandle, Manager};

const SERVICE_NAME: &str = "id.synkcut.studio.byok";
const PROVIDERS: [&str; 3] = ["gemini", "openai", "openrouter"];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredAppConfig {
    pub active_provider: String,
    pub onboarding_completed: bool,
}

impl Default for StoredAppConfig {
    fn default() -> Self {
        Self {
            active_provider: "gemini".to_string(),
            onboarding_completed: false,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyInfo {
    pub configured: bool,
    pub masked_key: Option<String>,
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
}

fn validate_provider(provider: &str) -> Result<&'static str, String> {
    match provider {
        "gemini" => Ok("gemini"),
        "openai" => Ok("openai"),
        "openrouter" => Ok("openrouter"),
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

fn read_config(app: &AppHandle) -> StoredAppConfig {
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

#[tauri::command]
pub fn get_byok_status(app: AppHandle) -> ByokStatus {
    let cfg = read_config(&app);
    let mut map = HashMap::new();

    for p in PROVIDERS {
        let key = read_stored_key(p);
        map.insert(
            p.to_string(),
            ProviderKeyInfo {
                configured: key.is_some(),
                masked_key: key.as_deref().map(mask_api_key),
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
    let valid = validate_provider(&provider)?;
    let trimmed = api_key.trim();
    if trimmed.len() < 8 {
        return Err("API Key terlalu pendek. Pastikan lo menyalin key secara utuh.".to_string());
    }

    let entry = get_keyring_entry(valid)?;
    entry
        .set_password(trimmed)
        .map_err(|e| format!("Gagal menyimpan API Key ke Windows Credential Manager: {e}"))?;

    let mut cfg = read_config(&app);
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
    let entry = get_keyring_entry(valid)?;
    let _ = entry.delete_credential();
    Ok(get_byok_status(app))
}

#[tauri::command]
pub async fn test_byok_connection(
    provider: String,
    api_key: Option<String>,
) -> Result<ConnectionTestResult, String> {
    let valid = validate_provider(&provider)?;
    let resolved_key = match api_key.as_deref().map(str::trim) {
        Some(k) if !k.is_empty() => k.to_string(),
        _ => read_stored_key(valid).ok_or_else(|| {
            "API Key belum diisi. Masukkan API Key dulu sebelum mengetes koneksi.".to_string()
        })?,
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| format!("Gagal menginisialisasi HTTP client: {e}"))?;

    let start = Instant::now();
    let response = match valid {
        "gemini" => {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models?key={resolved_key}"
            );
            client.get(url).send().await
        }
        "openai" => {
            client
                .get("https://api.openai.com/v1/models")
                .bearer_auth(&resolved_key)
                .send()
                .await
        }
        "openrouter" => {
            client
                .get("https://openrouter.ai/api/v1/auth/key")
                .bearer_auth(&resolved_key)
                .send()
                .await
        }
        _ => unreachable!(),
    };

    let latency_ms = start.elapsed().as_millis() as u64;

    match response {
        Ok(res) => {
            let status = res.status();
            if status.is_success() {
                let detail = match valid {
                    "gemini" => Some("Gemini API aktif & siap dipakai untuk script + multimodal".to_string()),
                    "openai" => Some("OpenAI API aktif & siap dipakai".to_string()),
                    "openrouter" => Some("OpenRouter API aktif & siap dipakai".to_string()),
                    _ => None,
                };
                Ok(ConnectionTestResult {
                    ok: true,
                    provider: valid.to_string(),
                    latency_ms,
                    message: format!("Koneksi berhasil ({latency_ms} ms). API Key valid."),
                    detail,
                })
            } else if status.as_u16() == 400 || status.as_u16() == 401 || status.as_u16() == 403 {
                Ok(ConnectionTestResult {
                    ok: false,
                    provider: valid.to_string(),
                    latency_ms,
                    message: "API Key ditolak oleh provider. Periksa apakah key sudah disalin dengan benar dan masih aktif.".to_string(),
                    detail: Some(format!("HTTP {}", status.as_u16())),
                })
            } else if status.as_u16() == 429 {
                Ok(ConnectionTestResult {
                    ok: false,
                    provider: valid.to_string(),
                    latency_ms,
                    message: "API Key valid tetapi batas kuota/rate limit tercapai. Coba lagi sebentar atau cek kuota akun lo.".to_string(),
                    detail: Some("HTTP 429 Rate Limited".to_string()),
                })
            } else {
                Ok(ConnectionTestResult {
                    ok: false,
                    provider: valid.to_string(),
                    latency_ms,
                    message: format!(
                        "Server provider mengembalikan status HTTP {}. Coba lagi beberapa saat.",
                        status.as_u16()
                    ),
                    detail: None,
                })
            }
        }
        Err(err) => Ok(ConnectionTestResult {
            ok: false,
            provider: valid.to_string(),
            latency_ms,
            message: "Tidak dapat terhubung ke server provider. Pastikan koneksi internet aktif.".to_string(),
            detail: Some(err.to_string()),
        }),
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
        assert!(validate_provider("unknown").is_err());
    }
}
