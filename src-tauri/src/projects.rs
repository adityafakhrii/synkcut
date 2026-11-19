use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub format: String,
    pub caption_preset: String,
    pub accent_color: String,
    pub hook_text: String,
    pub first_overlay_type: Option<String>,
    pub first_overlay_title: Option<String>,
    pub first_overlay_text: Option<String>,
    pub scene_count: usize,
    pub duration_ms: u64,
    pub has_footage: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn sanitize_project_id(raw: &str) -> Result<String, String> {
    let cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    if cleaned.is_empty() || cleaned.len() > 80 {
        return Err("ID proyek tidak valid.".to_string());
    }
    Ok(cleaned)
}

fn projects_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Gagal mengakses direktori data aplikasi: {e}"))?
        .join("projects");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Gagal membuat folder My Projects: {e}"))?;
    Ok(dir)
}

fn project_file_path(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let safe_id = sanitize_project_id(project_id)?;
    let folder = projects_root_dir(app)?.join(safe_id);
    Ok(folder.join("project.synk.json"))
}

fn extract_summary(val: &Value) -> Result<ProjectSummary, String> {
    let id = val["meta"]["id"]
        .as_str()
        .ok_or_else(|| "Field meta.id tidak ditemukan".to_string())?
        .to_string();
    let name = val["meta"]["name"]
        .as_str()
        .unwrap_or("Proyek Tanpa Nama")
        .to_string();
    let format = val["meta"]["format"]
        .as_str()
        .unwrap_or("ad_promo")
        .to_string();
    let caption_preset = val["globalStyle"]["captionPreset"]
        .as_str()
        .unwrap_or("bold_pop")
        .to_string();
    let accent_color = val["globalStyle"]["accentColor"]
        .as_str()
        .unwrap_or("#BEF264")
        .to_string();

    let scenes = val["scenes"].as_array();
    let scene_count = scenes.map(|s| s.len()).unwrap_or(0);
    let duration_ms = scenes
        .map(|arr| {
            arr.iter()
                .filter_map(|sc| sc["endMs"].as_u64())
                .max()
                .unwrap_or(0)
        })
        .unwrap_or(0);
    let has_footage = scenes
        .map(|arr| {
            arr.iter()
                .any(|sc| sc["media"]["path"].as_str().map(|p| !p.is_empty()).unwrap_or(false))
        })
        .unwrap_or(false);

    let first_scene = scenes.and_then(|arr| arr.first());
    let hook_text = first_scene
        .and_then(|s| s["text"].as_str())
        .unwrap_or("")
        .to_string();

    let first_overlay = first_scene
        .and_then(|s| s["overlays"].as_array())
        .and_then(|ov| ov.first());
    let first_overlay_type = first_overlay
        .and_then(|o| o["type"].as_str())
        .map(ToString::to_string);
    let first_overlay_title = first_overlay
        .and_then(|o| o["title"].as_str())
        .map(ToString::to_string);
    let first_overlay_text = first_overlay
        .and_then(|o| o["text"].as_str())
        .map(ToString::to_string);

    let now = Utc::now().to_rfc3339();
    let created_at = val["meta"]["createdAt"]
        .as_str()
        .unwrap_or(&now)
        .to_string();
    let updated_at = val["meta"]["updatedAt"]
        .as_str()
        .unwrap_or(&created_at)
        .to_string();

    Ok(ProjectSummary {
        id,
        name,
        format,
        caption_preset,
        accent_color,
        hook_text,
        first_overlay_type,
        first_overlay_title,
        first_overlay_text,
        scene_count,
        duration_ms,
        has_footage,
        created_at,
        updated_at,
    })
}

#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<ProjectSummary>, String> {
    let root = projects_root_dir(&app)?;
    let mut items = Vec::new();

    let entries = std::fs::read_dir(&root)
        .map_err(|e| format!("Gagal membaca daftar proyek lokal: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path().join("project.synk.json");
        if !path.exists() {
            continue;
        }
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(val) = serde_json::from_str::<Value>(&raw) {
                if let Ok(summary) = extract_summary(&val) {
                    items.push(summary);
                }
            }
        }
    }

    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

#[tauri::command]
pub fn load_project(app: AppHandle, project_id: String) -> Result<Value, String> {
    let path = project_file_path(&app, &project_id)?;
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Proyek tidak ditemukan atau gagal dibaca: {e}"))?;
    serde_json::from_str::<Value>(&raw)
        .map_err(|e| format!("File proyek rusak (JSON tidak valid): {e}"))
}

#[tauri::command]
pub fn save_project(app: AppHandle, mut project: Value) -> Result<ProjectSummary, String> {
    let id = project["meta"]["id"]
        .as_str()
        .ok_or_else(|| "meta.id wajib diisi saat menyimpan proyek.".to_string())?
        .to_string();
    let safe_id = sanitize_project_id(&id)?;

    let now = Utc::now().to_rfc3339();
    if let Some(meta) = project.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("id".to_string(), Value::String(safe_id.clone()));
        if !meta.contains_key("createdAt") || meta["createdAt"].is_null() {
            meta.insert("createdAt".to_string(), Value::String(now.clone()));
        }
        meta.insert("updatedAt".to_string(), Value::String(now));
    }

    let path = project_file_path(&app, &safe_id)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Gagal membuat folder proyek: {e}"))?;
    }

    let serialized = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Gagal serialisasi JSON proyek: {e}"))?;
    std::fs::write(&path, serialized)
        .map_err(|e| format!("Gagal menyimpan file project.synk.json: {e}"))?;

    extract_summary(&project)
}

#[tauri::command]
pub fn duplicate_project(app: AppHandle, project_id: String) -> Result<ProjectSummary, String> {
    let mut project = load_project(app.clone(), project_id)?;
    let now_ts = Utc::now().timestamp_millis();
    let new_id = format!("proj_{now_ts}");
    let now_iso = Utc::now().to_rfc3339();

    if let Some(meta) = project.get_mut("meta").and_then(Value::as_object_mut) {
        let old_name = meta
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Proyek")
            .to_string();
        meta.insert("id".to_string(), Value::String(new_id));
        meta.insert(
            "name".to_string(),
            Value::String(format!("{old_name} (Salinan)")),
        );
        meta.insert("createdAt".to_string(), Value::String(now_iso.clone()));
        meta.insert("updatedAt".to_string(), Value::String(now_iso));
    }

    save_project(app, project)
}

#[tauri::command]
pub fn rename_project(
    app: AppHandle,
    project_id: String,
    new_name: String,
) -> Result<ProjectSummary, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("Nama proyek tidak boleh kosong.".to_string());
    }

    let mut project = load_project(app.clone(), project_id)?;
    if let Some(meta) = project.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("name".to_string(), Value::String(trimmed.to_string()));
    }
    save_project(app, project)
}

#[tauri::command]
pub fn delete_project(app: AppHandle, project_id: String) -> Result<(), String> {
    let safe_id = sanitize_project_id(&project_id)?;
    let folder = projects_root_dir(&app)?.join(safe_id);
    if folder.exists() {
        std::fs::remove_dir_all(&folder)
            .map_err(|e| format!("Gagal menghapus folder proyek: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_project_id() {
        assert_eq!(sanitize_project_id("proj_123-abc"), Ok("proj_123-abc".to_string()));
        assert_eq!(sanitize_project_id("../evil/path"), Ok("evilpath".to_string()));
        assert!(sanitize_project_id("...///").is_err());
    }

    #[test]
    fn test_extract_summary() {
        let val = serde_json::json!({
            "meta": {
                "id": "proj_test_1",
                "name": "Iklan Kopi",
                "format": "ad_promo",
                "createdAt": "2026-11-20T00:00:00Z",
                "updatedAt": "2026-11-20T01:00:00Z"
            },
            "globalStyle": { "captionPreset": "bold_pop", "accentColor": "#BEF264" },
            "scenes": [
                {
                    "endMs": 3000,
                    "text": "Kopi enak tiap pagi",
                    "media": { "path": null },
                    "overlays": [{ "type": "promo_badge", "text": "DISKON 50%" }]
                },
                { "endMs": 8500, "text": "Coba sekarang", "media": { "path": "clip.mp4" } }
            ]
        });

        let summary = extract_summary(&val).expect("should parse summary");
        assert_eq!(summary.id, "proj_test_1");
        assert_eq!(summary.scene_count, 2);
        assert_eq!(summary.duration_ms, 8500);
        assert!(summary.has_footage);
        assert_eq!(summary.hook_text, "Kopi enak tiap pagi");
        assert_eq!(summary.first_overlay_text.as_deref(), Some("DISKON 50%"));
    }
}
