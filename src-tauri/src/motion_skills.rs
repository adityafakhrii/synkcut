use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MotionSkillInfo {
    pub id: String,
    pub name: String,
    pub source: String,
    pub category: String,
    pub summary: String,
    pub enabled: bool,
    pub built_in: bool,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SkillsConfig {
    #[serde(default)]
    disabled_ids: Vec<String>,
}

struct BuiltinSkillDef {
    id: &'static str,
    name: &'static str,
    source: &'static str,
    category: &'static str,
    summary: &'static str,
    content: &'static str,
}

const BUILTIN_SKILLS: &[BuiltinSkillDef] = &[
    BuiltinSkillDef {
        id: "motion-craft-physics",
        name: "Motion Craft & Disney Physics",
        source: "LottieFiles/motion-design-skill + Disney 12 Principles",
        category: "Fisika & Timing",
        summary: "Fisika spring teredam, anticipation, overshoot, squash & stretch, stagger 40–80ms, dan kurva asimetris.",
        content: r#"# Skill: Motion Craft & Disney Physics
- Apply 3 Pillars: Emotional Intent -> Visual Narrative (Setup -> Action -> Resolution) -> Motion Craft.
- NEVER animate all elements linearly or at the same instant. Use M.spring(frame, fps, cfg) with deliberate weight classes:
  * playful: { stiffness: 220, damping: 14, mass: 0.95 }
  * bold/snappy: { stiffness: 280, damping: 22, mass: 1.0 }
  * calm/luxury: { stiffness: 120, damping: 20, mass: 1.15 }
  * heavy impact: { stiffness: 170, damping: 15, mass: 1.35 }
- Entrances use fast deceleration (spring / ease.outExpo); exits use acceleration (ease.inCubic) in the final 0.25s.
- Apply staggered choreography: Hero element enters first (delay 0), supporting items lag by 2-5 frames (40-80ms), ambient accents lag 6-10 frames.
- Add brief anticipation before big launches and subtle squash & stretch ONLY on impact moments (keep area conserved: sx = 1 + k, sy = 1 / (1 + k)).
- Move objects along gentle parabolic arcs instead of sterile straight lines."#,
    },
    BuiltinSkillDef {
        id: "shortform-beat-choreography",
        name: "Short-Form Micro-Beat Pacing",
        source: "iart-ai/motion-skills (TikTok/Shorts & Explainer Packs)",
        category: "Pacing & Komposisi",
        summary: "Ritme 2.5–4.5 detik/beat, zona aman 9:16 anti-nabrak caption, dan larangan pengulangan komposisi antar beat.",
        content: r#"# Skill: Short-Form Micro-Beat Pacing (9:16)
- Keep EVERY visual beat tightly focused on ONE clear hero idea synced to the spoken narration.
- STRICT 9:16 Safe Zone: place primary visual illustrations and hero typography inside y = height * 0.11 .. height * 0.68 and x = width * 0.08 .. width * 0.92. Keep y = height * 0.72 .. height * 0.90 uncluttered for live word captions!
- Anti-Repetition Rule: NEVER repeat the exact same visual layout, shape stack, or camera move from the previous beat. Alternate silhouettes (full-bleed typography -> layered object illustration -> split comparison -> product/UI interaction -> bold stat/price reveal).
- Keep the frame alive during holds: add subtle breathing float, gentle parallax drift, liquid ripples, or soft rotating light so the scene never freezes dead."#,
    },
    BuiltinSkillDef {
        id: "kinetic-typography",
        name: "Kinetic Typography & Word Sync",
        source: "iart-ai/motion-skills + skilldb.dev/motion-graphics-skills",
        category: "Tipografi",
        summary: "Masked clip-rect reveals, highlight sweep sinkron kata voiceover, kontras ukuran ekstrem, anti-terpotong.",
        content: r#"# Skill: Kinetic Typography & Word Sync
- Use M.drawMaskedText or M.drawKineticHeadline so lines emerge cleanly from invisible horizontal/vertical clip masks rather than cheap fade-ins.
- Sync emphasis to spoken voiceover using M.wordHit(state, keyword) or state.activeWordIndex so key words (prices, product names, numbers, action verbs) pop with spring scale + highlighter bar sweep right when spoken.
- Always measure text with M.fitText / M.wrapText so long Indonesian words NEVER clip off the left/right edges.
- Pair bold oversized hero display words (72-116*u) with crisp smaller mono/sans context labels (24-34*u) for strong editorial hierarchy."#,
    },
    BuiltinSkillDef {
        id: "procedural-illustration-svg",
        name: "Procedural Illustration & Vector Motion",
        source: "iart-ai/motion-skills + LottieFiles",
        category: "Ilustrasi Kustom",
        summary: "Gambar objek nyata kontekstual (minuman, blok kode, kemasan, ikon SVG stroke-draw, cairan, partikel) dari nol.",
        content: r#"# Skill: Procedural Illustration & Vector Motion (ZERO Generic Templates!)
- ALWAYS draw bespoke illustrations that authentically depict the concrete subject in the script:
  * Drinks / coffee / food: translucent glass/bottle shapes with clip-masked animated liquid layers (M.drawLiquidWave), floating ice cubes with specular highlights, pouring streams, rising aroma steam curves, condensation droplets.
  * Kids coding / Scratch / apps: interlocking colorful notched code puzzle blocks snapping together on curved arcs with sparkle bursts and a moving mini character/rocket reacting to the code.
  * Finance / pricing / offers: animated price tag/counter (M.drawCounter), stamp slam with recoil shake, glowing checkmarks drawn via M.drawSvgPath strokeProgress.
  * Tech / workflow / concepts: clean custom vector icons, flowing signal dots along bezier curves, spotlight reveals, radial progress rings.
- Use M.drawSvgPath(ctx, pathData, { strokeProgress }) for crisp animated vector line-art and checkmarks.
- Layer depth cleanly: soft drop shadow -> main body with directional gradient -> crisp rim highlight -> ambient accent particles (M.drawParticles)."#,
    },
    BuiltinSkillDef {
        id: "product-ui-brand-storytelling",
        name: "Product UI & Brand Storytelling",
        source: "brand-launch-video-star + skilldb.dev/motion-graphics-skills",
        category: "Brand & Produk",
        summary: "Cause -> Effect demo (browser URL mengetik + kursor klik CTA, perbandingan sebelum/sesudah, integrasi logo asli).",
        content: r#"# Skill: Product UI & Brand Storytelling
- Show real Cause -> Effect chains instead of abstract decorative boxes:
  * Website / CTA beats: render M.drawBrowserWindow typing the exact brand URL (e.g. junior.codepolitan.com), glide M.drawCursor along a curved arc to the CTA button, trigger click compression + expanding ripple + celebratory burst.
  * Before vs After / Value comparison: animated split divider or paired visual meters contrasting the pain point (muted/desaturated) against the solution (vibrant brand accent).
- Respect the user's CustomDesignDirection palette (`state.design.palette`) and typography (`state.design.typography`) on every element.
- When `state.hasBrandLogo` is true, showcase the authentic brand logo cleanly with `M.drawBrandLogo(...)` on intro or CTA payoff beats — NEVER invent a fake logo."#,
    },
    BuiltinSkillDef {
        id: "camera-match-transitions",
        name: "Virtual Camera & Match-Cut Continuity",
        source: "brand-launch-video-star + Disney Principles",
        category: "Kamera & Transisi",
        summary: "Virtual 2D camera rig (dolly zoom, whip-pan momentum, impact shake) dan exit momentum untuk sambungan halus.",
        content: r#"# Skill: Virtual Camera & Match-Cut Continuity
- Wrap the hero composition inside `M.withCamera(ctx, state, { zoom, panX, panY, rotateDeg, shake }, () => { ... })`.
- Entry (first 0.35s): subtle push-in settle (`zoom: M.interpolate(p, [0, 0.2], [1.06, 1.0], { easing: M.ease.outExpo })`) or directional arrival.
- Mid-beat: gentle continuous drift (`zoom` breathing `1.00 -> 1.03`) so the camera feels cinematic, never locked stiff.
- Impact moments: tiny 120ms camera recoil shake (`shake: 6 * u * decay`) synchronized with slam/stamp events.
- Exit (last 0.18s): subtle scale/drift momentum carrying energy cleanly into the next beat."#,
    },
    BuiltinSkillDef {
        id: "3d-diorama-storytelling",
        name: "3D Diorama & Character Storytelling",
        source: "Synkcut 3D Engine (Zack D. / AkuTahu / Kenapa Yaaa? style)",
        category: "3D Diorama & Karakter",
        summary: "Dunia 3D cutaway PBR siang hari, karakter 3D berpose ekspresif, kamera 3D kontinu antar beat, dan HUD terikat koordinat 3D.",
        content: r#"# Skill: 3D Diorama & Character Storytelling (100% By-Code Three.js PBR)
- Build ONE cohesive 3D miniature world in `setupWorld(world, D3)` with bright Blender-style daylight (`D3.setupDaylight` + `D3.addClouds`), soft shadows, and tactile clay/matte PBR surfaces (`roughness: 0.65-0.88`).
- Choose the matching cutaway world builder (`D3.buildOceanCutaway`, `D3.buildGroundCutaway`, `D3.buildRoomCutaway`, or `D3.buildStudioStage`) so the environment visually explains the topic immediately — NEVER leave an empty dark void.
- Populate with bespoke 3D props built from `D3.box`, `D3.roundedBox`, `D3.cylinder`, `D3.sphere`, `D3.cone`, `D3.torus`, `D3.tube`, `D3.lathe`, `D3.truss`, `D3.tree`, `D3.table`, `D3.particles3D` AND stylized articulated 3D humans via `D3.createCharacter(...)`.
- Drive expressive acting in `animateFrame(world, state, D3)` with `D3.poseCharacter(char, { action, phase, headTurn })` synced to `state.beatIndex` and `state.beatProgress` (`idle`, `point`, `wave`, `handshake`, `walk`, `think`, `surprised`, `sit`, `sleep`, `talk`).
- Choreograph CONTINUOUS 3D camera movement across beats using `D3.lerpCamera(world, keyframes, state.globalProgress)`: wide establishing -> dramatic dive/push-in -> side cutaway reveal -> character close-up -> grand pullback finale!
- Layer crisp 3D-tracked HUD graphics (`D3.drawRuler`, `D3.drawBadgeAt3D`, `D3.drawPopupTitle`, `D3.drawCalloutAt3D`) while keeping the vertical center-middle zone (y = 0.54..0.64) clear for viral Shorts captions."#,
    },
];

fn skills_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Gagal mengakses AppData: {e}"))?
        .join("motion_skills");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Gagal membuat folder motion_skills: {e}"))?;
    Ok(dir)
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(skills_dir(app)?.join("config.json"))
}

fn read_skills_config(app: &AppHandle) -> SkillsConfig {
    let Ok(path) = config_path(app) else {
        return SkillsConfig::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<SkillsConfig>(&raw).ok())
        .unwrap_or_default()
}

fn write_skills_config(app: &AppHandle, cfg: &SkillsConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let raw = serde_json::to_string_pretty(cfg)
        .map_err(|e| format!("Gagal serialisasi konfigurasi skill: {e}"))?;
    std::fs::write(path, raw).map_err(|e| format!("Gagal menyimpan konfigurasi skill: {e}"))
}

pub fn sanitize_skill_id(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else if ch.is_whitespace() || ch == '.' || ch == '/' {
            if !out.ends_with('-') {
                out.push('-');
            }
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "custom-skill".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}

pub fn resolve_skill_markdown_urls(raw_url: &str) -> Vec<String> {
    let trimmed = raw_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Vec::new();
    }
    let normalized = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    // Convert GitHub repo/blob URLs directly to raw markdown candidates
    if let Some(after) = normalized
        .strip_prefix("https://github.com/")
        .or_else(|| normalized.strip_prefix("http://github.com/"))
    {
        let clean = after.trim_end_matches(".git");
        if clean.contains("/blob/") {
            let raw = format!(
                "https://raw.githubusercontent.com/{}",
                clean.replacen("/blob/", "/", 1)
            );
            return vec![raw];
        }
        let parts: Vec<&str> = clean.split('/').filter(|s| !s.is_empty()).collect();
        if parts.len() >= 2 {
            let owner = parts[0];
            let repo = parts[1];
            return vec![
                format!("https://raw.githubusercontent.com/{owner}/{repo}/main/SKILL.md"),
                format!("https://raw.githubusercontent.com/{owner}/{repo}/master/SKILL.md"),
                format!("https://raw.githubusercontent.com/{owner}/{repo}/main/README.md"),
                format!("https://raw.githubusercontent.com/{owner}/{repo}/master/README.md"),
            ];
        }
    }

    vec![normalized]
}

fn load_custom_skills(app: &AppHandle, disabled: &HashSet<String>) -> Vec<MotionSkillInfo> {
    let Ok(dir) = skills_dir(app) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if path.file_name().and_then(|n| n.to_str()) == Some("config.json") {
            continue;
        }
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(mut skill) = serde_json::from_str::<MotionSkillInfo>(&raw) {
                skill.built_in = false;
                skill.enabled = !disabled.contains(&skill.id);
                out.push(skill);
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub fn load_all_skills(app: &AppHandle) -> Vec<MotionSkillInfo> {
    let cfg = read_skills_config(app);
    let disabled: HashSet<String> = cfg.disabled_ids.into_iter().collect();

    let mut list: Vec<MotionSkillInfo> = BUILTIN_SKILLS
        .iter()
        .map(|s| MotionSkillInfo {
            id: s.id.to_string(),
            name: s.name.to_string(),
            source: s.source.to_string(),
            category: s.category.to_string(),
            summary: s.summary.to_string(),
            enabled: !disabled.contains(s.id),
            built_in: true,
            content: s.content.to_string(),
        })
        .collect();

    list.extend(load_custom_skills(app, &disabled));
    list
}

/// Build a concise catalog string of enabled skills for the Storyboard Director to auto-route per beat.
pub fn build_skills_catalog_for_storyboard(app: &AppHandle) -> String {
    let enabled: Vec<MotionSkillInfo> = load_all_skills(app)
        .into_iter()
        .filter(|s| s.enabled)
        .collect();
    if enabled.is_empty() {
        return "- motion-craft-physics: spring physics & anticipation\n- procedural-illustration-svg: custom contextual visuals".to_string();
    }
    enabled
        .iter()
        .map(|s| format!("- `{}` ({}): {}", s.id, s.category, s.summary))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Build the concrete rulebook injected into the Beat Code Generator for a specific beat's selected skills.
pub fn build_active_skills_prompt(app: &AppHandle, requested_ids: &[String]) -> String {
    let enabled: Vec<MotionSkillInfo> = load_all_skills(app)
        .into_iter()
        .filter(|s| s.enabled)
        .collect();

    let mut chosen: Vec<&MotionSkillInfo> = Vec::new();
    // Always include motion-craft-physics + shortform-beat-choreography if enabled
    for core_id in ["motion-craft-physics", "shortform-beat-choreography"] {
        if let Some(sk) = enabled.iter().find(|s| s.id == core_id) {
            chosen.push(sk);
        }
    }
    for req_id in requested_ids {
        if let Some(sk) = enabled.iter().find(|s| s.id == *req_id) {
            if !chosen.iter().any(|c| c.id == sk.id) {
                chosen.push(sk);
            }
        }
    }
    // Include up to 2 user custom skills automatically so imported skills always take effect!
    for custom_sk in enabled.iter().filter(|s| !s.built_in).take(2) {
        if !chosen.iter().any(|c| c.id == custom_sk.id) {
            chosen.push(custom_sk);
        }
    }
    if chosen.len() < 3 {
        if let Some(illus) = enabled.iter().find(|s| s.id == "procedural-illustration-svg") {
            if !chosen.iter().any(|c| c.id == illus.id) {
                chosen.push(illus);
            }
        }
    }

    chosen
        .into_iter()
        .map(|s| {
            let trimmed: String = s.content.chars().take(1600).collect();
            format!("=== SKILL: {} ({}) ===\n{}", s.name, s.id, trimmed)
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[tauri::command]
pub fn list_motion_skills(app: AppHandle) -> Vec<MotionSkillInfo> {
    load_all_skills(&app)
}

#[tauri::command]
pub fn toggle_motion_skill(
    app: AppHandle,
    skill_id: String,
    enabled: bool,
) -> Result<Vec<MotionSkillInfo>, String> {
    let mut cfg = read_skills_config(&app);
    cfg.disabled_ids.retain(|id| id != &skill_id);
    if !enabled {
        cfg.disabled_ids.push(skill_id);
    }
    write_skills_config(&app, &cfg)?;
    Ok(load_all_skills(&app))
}

#[tauri::command]
pub fn save_custom_motion_skill(
    app: AppHandle,
    name: String,
    category: Option<String>,
    summary: Option<String>,
    source: Option<String>,
    content: String,
) -> Result<Vec<MotionSkillInfo>, String> {
    let trimmed_name = name.trim();
    let trimmed_content = content.trim();
    if trimmed_name.is_empty() || trimmed_content.is_empty() {
        return Err("Nama skill dan isi panduan markdown wajib diisi.".to_string());
    }

    let id = format!("custom-{}", sanitize_skill_id(trimmed_name));
    let skill = MotionSkillInfo {
        id: id.clone(),
        name: trimmed_name.to_string(),
        source: source
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Custom Skill".to_string()),
        category: category
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Kustom".to_string()),
        summary: summary
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                trimmed_content
                    .lines()
                    .find(|l| !l.trim().is_empty() && !l.trim().starts_with('#') && !l.trim().starts_with("---"))
                    .unwrap_or("Skill motion kustom pengguna")
                    .chars()
                    .take(120)
                    .collect()
            }),
        enabled: true,
        built_in: false,
        content: trimmed_content.chars().take(6000).collect(),
    };

    let file_path = skills_dir(&app)?.join(format!("{id}.json"));
    let raw = serde_json::to_string_pretty(&skill)
        .map_err(|e| format!("Gagal serialisasi skill: {e}"))?;
    std::fs::write(file_path, raw).map_err(|e| format!("Gagal menyimpan skill: {e}"))?;

    Ok(load_all_skills(&app))
}

#[tauri::command]
pub async fn import_motion_skill_url(
    app: AppHandle,
    url: String,
) -> Result<Vec<MotionSkillInfo>, String> {
    let candidates = resolve_skill_markdown_urls(&url);
    if candidates.is_empty() {
        return Err("Masukkan URL GitHub repo atau link file SKILL.md yang valid.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Synkcut/2.0")
        .build()
        .map_err(|e| format!("Gagal membuat HTTP client: {e}"))?;

    let mut fetched_text: Option<(String, String)> = None;
    for cand in &candidates {
        if let Ok(res) = client.get(cand).send().await {
            if res.status().is_success() {
                if let Ok(txt) = res.text().await {
                    let trimmed = txt.trim();
                    if !trimmed.is_empty() && !trimmed.starts_with("<!DOCTYPE html") && !trimmed.starts_with("<html") {
                        fetched_text = Some((cand.clone(), trimmed.to_string()));
                        break;
                    }
                }
            }
        }
    }

    let (used_url, markdown) = fetched_text.ok_or_else(|| {
        "Tidak menemukan file SKILL.md / README.md di URL tersebut. Coba tempel link raw markdown atau salin isinya manual.".to_string()
    })?;

    let inferred_name = markdown
        .lines()
        .find_map(|l| l.trim().strip_prefix("# ").map(|s| s.trim().to_string()))
        .or_else(|| {
            url.trim_end_matches('/')
                .trim_end_matches(".git")
                .split('/')
                .last()
                .map(|s| s.replace('-', " "))
        })
        .unwrap_or_else(|| "Imported Motion Skill".to_string());

    save_custom_motion_skill(
        app,
        inferred_name,
        Some("Imported Skill".to_string()),
        None,
        Some(used_url),
        markdown,
    )
}

#[tauri::command]
pub fn delete_custom_motion_skill(
    app: AppHandle,
    skill_id: String,
) -> Result<Vec<MotionSkillInfo>, String> {
    let path = skills_dir(&app)?.join(format!("{}.json", sanitize_skill_id(&skill_id)));
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("Gagal menghapus skill: {e}"))?;
    }
    let mut cfg = read_skills_config(&app);
    cfg.disabled_ids.retain(|id| id != &skill_id);
    let _ = write_skills_config(&app, &cfg);
    Ok(load_all_skills(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_skill_markdown_urls_converts_github_repos() {
        let urls = resolve_skill_markdown_urls("https://github.com/LottieFiles/motion-design-skill.git");
        assert_eq!(
            urls[0],
            "https://raw.githubusercontent.com/LottieFiles/motion-design-skill/main/SKILL.md"
        );
        let blob = resolve_skill_markdown_urls(
            "https://github.com/iart-ai/motion-skills/blob/main/skills/kinetic/SKILL.md",
        );
        assert_eq!(
            blob[0],
            "https://raw.githubusercontent.com/iart-ai/motion-skills/main/skills/kinetic/SKILL.md"
        );
    }

    #[test]
    fn test_sanitize_skill_id() {
        assert_eq!(sanitize_skill_id("LottieFiles Motion Craft!"), "lottiefiles-motion-craft");
    }

    #[test]
    fn test_builtin_skills_include_3d_diorama_storytelling() {
        assert!(
            BUILTIN_SKILLS.iter().any(|s| s.id == "3d-diorama-storytelling"),
            "3d-diorama-storytelling skill must be bundled offline"
        );
        assert_eq!(BUILTIN_SKILLS.len(), 7);
    }
}
