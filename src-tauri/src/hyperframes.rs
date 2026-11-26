use crate::ai::{call_llm_json, rescale_beats_to_duration, strip_json_fences, StoryboardBeat};
use crate::audio::WordTimestamp;
use crate::byok;
use crate::motion_skills;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const HYPERFRAMES_S3_SDK_REFERENCE: &str = r#"=== SYNKCUT v3.0 HYPERFRAMES + 6-SKILL ENGINE CONTRACT ===
Write ONE complete, self-contained 1080x1920 HTML5 document (`<!DOCTYPE html>...</html>`) combining:
1. HyperFrames deterministic seeking (`window.render(tSec)` + `window.__timelines = { main: masterTl }`)
2. Three.js r187 via local offline `./vendor/s3-kit.js` (`import * as S3 from './vendor/s3-kit.js'; const { THREE } = S3;`)
3. GSAP 3 via local offline `<script src="./vendor/gsap.min.js"></script>`
4. Design DNA CSS custom properties (`:root { --paper, --ink, --ink-secondary, --hairline, --accent, ... }`)
5. Motion Design SVG layer (`<svg id="hud-svg" viewBox="0 0 1080 1920">`) for 3D-tracked museum hairline pointers
6. Genjutsu + Impeccable + Unslop anti-slop discipline (0% neon glows, 0% eyebrow pills above headings, 0% glassmorphism blur cards, 0% corner brackets, 0% emoji in UI, WCAG AA >= 4.5:1)

LOCAL VENDOR SCRIPTS (MANDATORY — NEVER use CDN links for Three.js or GSAP!):
- `<script src="./vendor/gsap.min.js"></script>`
- `<script type="module"> import * as S3 from './vendor/s3-kit.js'; const { THREE } = S3; ... </script>`
- Google Fonts `<link>` IS allowed for distinctive editorial typography (`Newsreader`, `Bricolage Grotesque`, `DM Sans`, `Playfair Display`, `JetBrains Mono` for numeric data only).

EXACT AUDIO TRANSCRIPT INJECTION (MANDATORY):
Inside `<script type="module">`, ALWAYS read:
```js
const TRANSCRIPT = /*TRANSCRIPT*/null || window.__SYNKCUT_TRANSCRIPT__ || { totalDurationSec: 30, fps: 30, beats: [], words: [] };
const BEATS = TRANSCRIPT.beats || [];
const ALL_WORDS = TRANSCRIPT.words || [];
const TOTAL_SEC = Math.max(4, TRANSCRIPT.totalDurationSec || 30);
```
Group `BEATS` evenly into 4 or 5 Editorial Acts (`act0..act4` with exact start/end seconds from `BEATS` so every transition locks 100% to the Neural TTS voiceover!).

BUILT-IN `S3` ARCHITECTURAL 3D MAQUETTE KIT (`./vendor/s3-kit.js`):
- `const { renderer, scene, camera } = S3.createStudioWorld(canvas, { width:1080, height:1920, fogHex:0xe7ecf1, isDark:false, fov:34 });`
- `S3.makeStoneTexture(baseHex, grainRgba)` / `S3.makeConcreteRibTexture(baseHex)` / `S3.makeScreenTexture({ header, lines, highlight, accent, dark })`
- `S3.buildPlinth(w, d, h, { topColor, sideColor })` -> sculpted architectural stone plinth (top sits at y = 0!)
- `S3.buildSmartphone({ header, lines, highlight, accent, dark })` -> matte aluminum phone with clean UI
- `S3.buildServerRack({ blades:7, bodyColor, ledColor })` -> data center rack with `.userData.leds`
- `S3.buildGpuModule({ heatColor })` -> copper heatsink + silicon die (`.userData.coreMat`)
- `S3.buildCoolingTower({ scale, waterColor })` -> sculpted LatheGeometry hyperbolic concrete tower
- `S3.buildGlassBottle({ liquidColor, initialFill })` -> crystal LatheGeometry bottle (`.userData.setFill(0..1)`)
- `S3.buildGlobe({ radius, color, accentColor })` -> architectural wireframe globe + orbital ring
- `S3.buildConduit([[x,y,z], ...], { radius, color, beadCount })` -> smooth TubeGeometry pipe + `.userData.updateBeads(t)`
- `S3.buildBarMonolith([{ value, color, accent }], { maxHeight })` -> 3D bar comparison (`.userData.setProgress(0..1)`)
- `S3.buildNeuralLattice({ layers:[3,4,3], nodeColor, accentColor })` -> sculptural 3D neural network with `.userData.update(t)` traveling pulses
- `S3.buildTokenBlocks(['Prompt','Pola','Prediksi'], { accentColor, dark })` -> crisp 3D architectural token tiles with `.userData.highlight(idx)`
- `S3.buildScaleBalance({ metalColor, accentColor })` -> architectural balance scale with `.userData.setTilt(rad)`
- `S3.buildGlassLens({ rimColor, accentColor })` -> sculptural physical refractive lens assembly
- `S3.buildDocumentStack({ count:5, accentColor })` -> layered crisp architectural folio pages
- `S3.project3D(vec3, camera, 1080, 1920)` -> `{ x, y, visible }` for SVG hairline pointers!
- Plus full `THREE` (`S3.THREE`) for any custom subject-specific sculptural objects (`LatheGeometry`, `ExtrudeGeometry`, `TubeGeometry`).

STRICT EDITORIAL & 3D QUALITY LAWS (APPLE / NYT / VOX STUDIO STANDARD):
1. ZERO PRIMITIVE SLABS: NEVER build flat green grass slabs, raw untextured grey boxes, or floating blue sticks! ALWAYS place a sculpted `S3.buildPlinth(...)` at EACH Act's gallery X coordinate (`x = -26, -13, 0, +13, +26`, `z = 0`) and top it with a rich, topic-specific sculptural `S3` hero assembly + subtle secondary props so EVERY Act feels like a distinct museum diorama!
2. DYNAMIC CAMERA CHOREOGRAPHY: Frame each Act boldly (`camZ: 12.5..16.5`, `camY: 4.5..7.0`, `fov: 34`) so the 3D hero fills 55-70% of the middle stage! Glide smoothly along X between plinths with GSAP (`ease: 'power2.inOut'`) and pull back on the final Act (`camZ: 34..38, camY: 13`) to reveal the full illuminated gallery panorama!
3. GUARANTEED WCAG AAA SUBTITLE & TYPE CONTRAST:
   - Light theme (`isLight: true`): `--paper: #EAEEF2; --ink: #11161D; --ink-soft: #475361; --accent: #0B63A6; --accent-2: #C2411D;`
   - Dark theme (`isDark: true`): `--paper: #0E131B; --ink: #F1F5F9; --ink-soft: #94A3B8; --accent: #38BDF8; --accent-2: #F59E0B;`
   - SUBTITLES MUST ALWAYS USE `color: var(--ink)` (`#11161D` on light, `#F1F5F9` on dark) with `font-size: 40px; font-weight: 700; line-height: 1.32;` and active-word underline (`border-bottom: 3px solid var(--accent)`). NEVER `#FFFFFF` text on a light background!
4. MOBILE-READABLE TYPE SCALE & BALANCED VERTICAL RHYTHM (1080x1920):
   - Top Editorial Zone (`top: 108px`, `padding: 0 76px`): Headline `h1` `64px–70px` (`Newsreader` or `Bricolage Grotesque`, `line-height: 1.06`), Deck `28px–30px` (`DM Sans`, `color: var(--ink-soft)`). NEVER tiny `14px–18px` body text!
   - Middle Hero 3D Stage (`y: 420px..1260px`): Full-bleed sculptural 3D plinth + 1–2 crisp SVG hairline callout labels (`20px–22px`, never overlapping the 3D object center!).
   - Bottom Editorial Data/Note Band (`top: 1290px..1510px`): Swiss hairline rule + 2-column architectural notes (`24px–26px`) OR comparative data table / live tabular KPI counter (`76px–88px`). NO giant empty blank voids!
   - Karaoke Subtitle Zone (`bottom: 196px`): Quiet underlined 3–5 word chunks synchronized to `ALL_WORDS`.

DETERMINISTIC SEEK CONTRACT (MANDATORY):
- Define `window.render = function(t) { ... };` which:
  1. Calls `masterTl.time(time, false);`
  2. Updates 3D camera (`camera.position.set(...)`, `camera.lookAt(...)`), procedural object motion, and calls `renderer.render(scene, camera);`
  3. Updates SVG 3D hairline annotations and renders quiet underlined word-by-word karaoke subtitles from `ALL_WORDS` at `bottom: 196px`!
- Call `window.render(0.5);` once at the end of the module script.
- NEVER use `requestAnimationFrame`, `setInterval`, `setTimeout`, `fetch`, `XMLHttpRequest`, or `localStorage`."#;

const HYPERFRAME_SKILL_IDS: &[&str] = &[
    "hyperframes-engine",
    "threejs-skills-r187",
    "gsap-timeline-choreography",
    "design-dna-tokens",
    "motion-design-svg",
    "genjutsu-impeccable-unslop",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateHyperframeRequest {
    pub project_title: String,
    pub format: String,
    #[serde(default)]
    pub user_prompt: Option<String>,
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
pub struct RepairHyperframeRequest {
    pub project_title: String,
    pub broken_html: String,
    pub error_message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairHyperframeResponse {
    pub html: String,
    pub lint_fixes: Vec<String>,
    pub provider_used: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchHyperframeRequest {
    pub project_title: String,
    pub current_html: String,
    pub instruction: String,
    #[serde(default)]
    pub active_scene_index: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchHyperframeResponse {
    pub html: String,
    pub reply: String,
    pub lint_fixes: Vec<String>,
    pub provider_used: String,
}

fn clean_html_output(raw: &str) -> String {
    let trimmed = raw.trim();
    let unfenced = if trimmed.contains("```") {
        strip_json_fences(trimmed)
    } else {
        trimmed.to_string()
    };
    let s = unfenced.trim();
    if let Some(pos) = s.to_lowercase().find("<!doctype html") {
        s[pos..].trim().to_string()
    } else if let Some(pos) = s.to_lowercase().find("<html") {
        format!("<!DOCTYPE html>\n{}", s[pos..].trim())
    } else {
        s.to_string()
    }
}

/// Deterministic Impeccable + Genjutsu Anti-AI-Slop & Offline-Vendor Sanitizer.
pub fn lint_and_polish_hyperframe_html(raw_html: &str) -> (String, Vec<String>) {
    let mut html = clean_html_output(raw_html);
    let mut fixes: Vec<String> = Vec::new();

    // 1. Replace any external CDN Three.js / GSAP URLs with local offline vendor paths
    let mut redirected_cdn = false;
    for cdn_prefix in [
        "https://cdn.jsdelivr.net/npm/gsap",
        "https://unpkg.com/gsap",
        "https://cdnjs.cloudflare.com/ajax/libs/gsap",
    ] {
        while let Some(start) = html.find(cdn_prefix) {
            if let Some(end_rel) = html[start..].find(['"', '\'']) {
                html.replace_range(start..start + end_rel, "./vendor/gsap.min.js");
                redirected_cdn = true;
            } else {
                break;
            }
        }
    }
    for cdn_prefix in [
        "https://cdn.jsdelivr.net/npm/three",
        "https://unpkg.com/three",
        "https://esm.sh/three",
    ] {
        while let Some(start) = html.find(cdn_prefix) {
            if let Some(end_rel) = html[start..].find(['"', '\'']) {
                html.replace_range(start..start + end_rel, "./vendor/three.module.js");
                redirected_cdn = true;
            } else {
                break;
            }
        }
    }
    if redirected_cdn {
        fixes.push("Mengalihkan GSAP/Three.js CDN ke bundle lokal offline (./vendor/)".to_string());
    }

    // 2. Replace overused slop display fonts flagged by Impeccable
    let mut swapped_font = false;
    for (bad, good) in [
        ("Plus Jakarta Sans", "DM Sans"),
        ("Space Grotesk", "Bricolage Grotesque"),
        ("Instrument Serif", "Newsreader"),
        ("Plus+Jakarta+Sans", "DM+Sans"),
        ("Space+Grotesk", "Bricolage+Grotesque"),
        ("Instrument+Serif", "Newsreader"),
    ] {
        if html.contains(bad) {
            html = html.replace(bad, good);
            swapped_font = true;
        }
    }
    if swapped_font {
        fixes.push("Mengganti font AI generik ke tipografi editorial Newsreader / DM Sans / Bricolage Grotesque".to_string());
    }

    // 3. Remove colored zero-offset neon glow text-shadow / box-shadow declarations
    let mut removed_glow = false;
    let mut cleaned_lines = Vec::new();
    for line in html.lines() {
        let lower = line.to_lowercase();
        let is_zero_offset_glow = (lower.contains("box-shadow:") || lower.contains("text-shadow:"))
            && (lower.contains("0 0 ") || lower.contains("0px 0px "))
            && !lower.contains("rgba(0, 0, 0")
            && !lower.contains("rgba(0,0,0")
            && !lower.contains("rgba(17, 22, 29");
        if is_zero_offset_glow {
            removed_glow = true;
            continue;
        }
        cleaned_lines.push(line);
    }
    if removed_glow {
        html = cleaned_lines.join("\n");
        fixes.push("Menghapus neon glow 0-offset (aturan Impeccable dark-glow)".to_string());
    }

    // 4. Sandbox safety: neutralize live network calls or infinite timers inside generated HTML
    let mut hardened = false;
    for forbidden in ["fetch(", "XMLHttpRequest", "new WebSocket(", "window.open("] {
        if html.contains(forbidden) {
            html = html.replace(forbidden, "/* blocked */ void(");
            hardened = true;
        }
    }
    if hardened {
        fixes.push("Memblokir akses jaringan eksternal demi keamanan sandbox".to_string());
    }

    // 5. Ensure local GSAP script tag exists if gsap.timeline is referenced
    if html.contains("gsap.") && !html.contains("gsap.min.js") {
        if let Some(pos) = html.find("</head>") {
            html.insert_str(pos, "<script src=\"./vendor/gsap.min.js\"></script>\n");
            fixes.push("Menyuntikkan runtime GSAP 3 lokal offline".to_string());
        }
    }

    (html, fixes)
}

#[tauri::command]
pub async fn ai_generate_hyperframe_video(
    app: AppHandle,
    req: GenerateHyperframeRequest,
) -> Result<Value, String> {
    if req.beats.is_empty() {
        return Err("Storyboard beat kosong.".to_string());
    }

    let resolved = byok::resolve_active_provider(&app)?;
    let _ = app.emit(
        "generation-progress",
        "Menyusun komposisi HyperFrames (Three.js + GSAP + SVG + Impeccable)...",
    );

    // Lock beats & words 100% to actual voiceover file duration on disk!
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

    let total_ms = synced_beats.last().map(|b| b.end_ms).unwrap_or(30_000).max(4000);
    let skill_ids: Vec<String> = HYPERFRAME_SKILL_IDS.iter().map(|s| s.to_string()).collect();
    let skills_rules = motion_skills::build_active_skills_prompt(&app, &skill_ids);

    // Summarize beats cleanly into 4-5 Acts for tight cinematic pacing
    let act_count = synced_beats.len().clamp(3, 5);
    let mut act_lines = Vec::new();
    for act_i in 0..act_count {
        let start_idx = (act_i * synced_beats.len()) / act_count;
        let end_idx = (((act_i + 1) * synced_beats.len()) / act_count).max(start_idx + 1).min(synced_beats.len());
        let slice = &synced_beats[start_idx..end_idx];
        let a_start = slice.first().map(|b| b.start_ms).unwrap_or(0) as f64 / 1000.0;
        let a_end = slice.last().map(|b| b.end_ms).unwrap_or(total_ms) as f64 / 1000.0;
        let combined_txt: String = slice.iter().map(|b| b.text.as_str()).collect::<Vec<_>>().join(" ");
        let combined_vis: String = slice
            .iter()
            .map(|b| b.visual_concept.as_str())
            .take(2)
            .collect::<Vec<_>>()
            .join(" | ");
        act_lines.push(format!(
            "- Act #{act_i} ({a_start:.2}s–{a_end:.2}s, gallery X={}): Narasi=\"{}\" | Visual=\"{}\"",
            (act_i as i32 - 1) * 13,
            combined_txt,
            combined_vis
        ));
    }

    let user_prompt_ctx = req
        .user_prompt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|p| format!("Prompt Visual Asli User (WAJIB DIPATUHI 100% — tema gelap/terang, warna, objek): \"{p}\"\n"))
        .unwrap_or_default();

    let design_ctx = req
        .custom_design
        .as_ref()
        .map(|d| {
            format!(
                "Design DNA Referensi: {} (isLight={}, bgTop={}, accentPrimary={}, accentSecondary={}) — {}\n",
                d["name"].as_str().unwrap_or("Custom"),
                d["isLight"].as_bool().unwrap_or(true),
                d["palette"]["bgTop"].as_str().unwrap_or("#EAEEF2"),
                d["palette"]["accentPrimary"].as_str().unwrap_or("#0B63A6"),
                d["palette"]["accentSecondary"].as_str().unwrap_or("#C2411D"),
                d["artDirectionNotes"].as_str().or_else(|| d["summary"].as_str()).unwrap_or("")
            )
        })
        .unwrap_or_else(|| {
            "Design DNA Default (jika user tidak meminta gelap): Cool Architectural Mineral Mist (#EAEEF2 -> #DCE3EB), Ink #11161D, Aksen Fisik #0B63A6 & #C2411D, font Newsreader + DM Sans + JetBrains Mono.\n".to_string()
        });

    let system_prompt = format!(
        "Kamu adalah Creative Technologist & Award-Winning Motion Director di Synkcut v3.0 (HyperFrames + Three.js + GSAP 3 + SVG + Impeccable).\n\
        Tugasmu menulis SATU dokumen HTML5 1080x1920 yang utuh, bersih, anti-AI-slop, dengan dunia 3D miniatur arsitektural (S3 Kit / Three.js r187) + animasi kamera & editorial GSAP 3 + anotasi SVG hairline + subtitle karaoke sinkron kata.\n\
        ATURAN WAJIB:\n\
        1. Patuhi 100% tema/warna yang diminta di Prompt Asli User! Jika user minta gelap, pakai Dark Architectural Slate (`#0E131B`, `isDark: true`) dengan elevasi bersih TANPA neon glow murahan. Jika user tidak minta gelap, pakai palet material terang arsitektural (`#EAEEF2` Mineral Mist atau sesuai topik) yang kontras & lega!\n\
        2. Setiap Act WAJIB punya komposisi editorial BERBEDA (misal: Act 0 cover asimetris + 3D hero; Act 1 judul kiri + angka tabular raksasa kanan + rail bawah; Act 2 maquette 3D penuh + 2 kolom catatan ringan; Act 3 objek 3D utama + tabel perbandingan Swiss 1 aksen; Act 4 panorama wide semua miniatur + penutup tenang).\n\
        3. ZERO AI SLOP: DILARANG membuat eyebrow/kicker pill di atas judul, DILARANG neon `box-shadow: 0 0 ...`, DILARANG emoji di layar UI, DILARANG sudut siku HUD sci-fi, DILARANG font Inter / Plus Jakarta Sans / Space Grotesk.\n\
        4. WAJIB membaca `const TRANSCRIPT = /*TRANSCRIPT*/null || window.__SYNKCUT_TRANSCRIPT__;` dan mendefinisikan `window.render = function(t) {{ ... }}` yang deterministik + `window.__timelines = {{ main: masterTl }}`.\n\
        5. Pastikan teks judul (`font-size: 62px..70px`), objek 3D (jarak kamera `camZ: 15..20`), panel bawah (`top: 1320px..1410px`), dan subtitle (`bottom: 196px`) TIDAK PERNAH saling bertumpuk!\n\
        6. Balas HANYA JSON valid persis seperti ini:\n\
        {{\n\
          \"worldTheme\": \"Nama dunia material 2-4 kata (misal: Architectural Mineral Mist)\",\n\
          \"summary\": \"Ringkasan 1 kalimat Bahasa Indonesia tentang komposisi visual 3D+2D ini\",\n\
          \"html\": \"<!DOCTYPE html>...dokumen HTML lengkap...</html>\"\n\
        }}\n\n\
        {HYPERFRAMES_S3_SDK_REFERENCE}\n\n\
        {skills_rules}"
    );

    let user_prompt = format!(
        "Proyek: \"{}\" (format: {}, total durasi audio: {:.2} detik)\n\
        {user_prompt_ctx}\
        {design_ctx}\n\
        Struktur {act_count} Act yang HARUS disinkronkan dengan `TRANSCRIPT.beats`:\n{}\n\n\
        Tulis dokumen HTML5 HyperFrames 1080x1920 lengkap yang 100% bebas error, kaya detail 3D S3/Three.js + GSAP + SVG, dan 0% AI slop dalam JSON `{{\"worldTheme\":\"...\",\"summary\":\"...\",\"html\":\"...\"}}`!",
        req.project_title.trim(),
        req.format,
        (total_ms as f64) / 1000.0,
        act_lines.join("\n")
    );

    let (val, _provider_used) = call_llm_json(&resolved, &system_prompt, &user_prompt, &[]).await?;
    let raw_html = val["html"]
        .as_str()
        .or_else(|| val["code"].as_str())
        .unwrap_or("");
    if raw_html.trim().len() < 200 {
        return Err("AI mengembalikan HTML HyperFrames terlalu pendek atau kosong.".to_string());
    }

    let (mut polished_html, mut lint_fixes) = lint_and_polish_hyperframe_html(raw_html);
    let world_theme = val["worldTheme"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Architectural Editorial Studio")
        .trim()
        .to_string();
    let summary = val["summary"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Komposisi HyperFrames 3D + GSAP + SVG anti-slop")
        .trim()
        .to_string();

    // PASS 2: Antigravity-style Live 3-Frame CDP Vision Self-Critique & Impeccable Polish!
    let total_sec_f64 = (total_ms as f64) / 1000.0;
    let transcript_for_critic = json!({
        "totalDurationSec": (total_sec_f64 * 1000.0).round() / 1000.0,
        "fps": 30,
        "totalFrames": ((total_sec_f64 * 30.0).round() as u64).max(30),
        "beats": synced_beats.iter().map(|b| {
            let ss = (b.start_ms as f64) / 1000.0;
            let es = (b.end_ms as f64) / 1000.0;
            json!({
                "id": b.id,
                "role": b.role,
                "title": b.title,
                "text": b.text,
                "startSec": ss,
                "speechEndSec": es,
                "endSec": es,
                "words": synced_words.iter()
                    .filter(|w| (w.end_ms as f64) / 1000.0 > ss && (w.start_ms as f64) / 1000.0 < es)
                    .map(|w| json!({
                        "word": w.word,
                        "start": (w.start_ms as f64) / 1000.0,
                        "end": (w.end_ms as f64) / 1000.0
                    }))
                    .collect::<Vec<_>>()
            })
        }).collect::<Vec<_>>(),
        "words": synced_words.iter().map(|w| json!({
            "word": w.word,
            "start": (w.start_ms as f64) / 1000.0,
            "end": (w.end_ms as f64) / 1000.0
        })).collect::<Vec<_>>()
    });
    let safe_tr_json = transcript_for_critic.to_string().replace("</", "<\\/");
    let critic_preview_html = if polished_html.contains("/*TRANSCRIPT*/null") {
        polished_html.replace("/*TRANSCRIPT*/null", &safe_tr_json)
    } else if polished_html.contains("</head>") {
        polished_html.replace(
            "</head>",
            &format!("<script>window.__SYNKCUT_TRANSCRIPT__ = {safe_tr_json};</script>\n</head>"),
        )
    } else {
        polished_html.clone()
    };

    let _ = app.emit(
        "generation-progress",
        "Tahap 2/2: Menginspeksi 3 frame asli & memoles visual (Impeccable Vision Critic)...",
    );

    let sample_times = [
        (total_sec_f64 * 0.14).max(0.8),
        (total_sec_f64 * 0.50).max(2.0),
        (total_sec_f64 * 0.85).max(3.0),
    ];
    if let Ok(keyframes) =
        crate::hyperframes_export::capture_hyperframe_keyframes_internal(critic_preview_html, &sample_times)
            .await
    {
        if !keyframes.is_empty() {
            let critic_sys = format!(
                "Kamu adalah Art Director & Impeccable Visual Critic di Synkcut v3.1.\n\
                Tugasmu melihat 3 screenshot ASLI hasil render HTML HyperFrames (awal, tengah, akhir) dan memoles kode HTML-nya agar benar-benar sekelas studio editorial Apple / NYT / Vox!\n\
                AUDIT KETAT 5 HAL WAJIB:\n\
                1. KONTRAS SUBTITLE & TEKS: Jika subtitle berwarna putih/pudar di atas background terang (atau teks kurang terbaca), WAJIB ubah ke `color: var(--ink)` (`#11161D` pada tema terang, `#F1F5F9` pada tema gelap), `font-size: 40px; font-weight: 700`.\n\
                2. SKALA TIPOGRAFI MOBILE: Pastikan `h1` 64–70px, deck 28–30px, catatan/tabel bawah 24–26px. DILARANG teks mikro `14px–18px` yang susah dibaca di HP!\n\
                3. KUALITAS 3D MAQUETTE: Jika objek 3D terlihat seperti papan hijau flat / kotak abu-abu polos / terlalu kecil / tidak berubah antar Act, WAJIB ganti dengan `S3.buildPlinth` + objek skulptural dari `S3` Kit (`buildNeuralLattice`, `buildTokenBlocks`, `buildScaleBalance`, `buildGlassLens`, `buildDocumentStack`, `buildSmartphone`, `buildServerRack`, `buildGpuModule`, `buildCoolingTower`, `buildGlassBottle`, `buildGlobe`, `buildConduit`, `buildBarMonolith`) di X gallery rail berbeda per Act dengan kamera `camZ: 12.5..16.5` yang megah!\n\
                4. TATA LETAK & RUANG KOSONG: Tidak boleh ada teks/SVG menumpuk objek 3D atau area kosong hampa besar di bawah. Isi band bawah (`top: 1290px..1510px`) dengan catatan editorial / data rail yang rapi.\n\
                5. PERTAHANKAN `/*TRANSCRIPT*/null`, `./vendor/gsap.min.js`, `./vendor/s3-kit.js`, `window.render(t)`, dan 0% AI slop.\n\
                Balas HANYA JSON: {{\"needsPolish\": true|false, \"critique\": \"1 kalimat temuan\", \"html\": \"<!DOCTYPE html>...HTML lengkap yang sudah dipoles (isi hanya jika needsPolish=true)...</html>\"}}\n\n\
                {HYPERFRAMES_S3_SDK_REFERENCE}"
            );
            let critic_user = format!(
                "Proyek: \"{}\" (Tema: {})\n\
                3 gambar terlampir adalah hasil render asli di detik {:.1}s, {:.1}s, dan {:.1}s.\n\
                Inspeksi secara jujur dan poles HTML berikut jika ada kekurangan visual sekecil apa pun:\n\n{}",
                req.project_title.trim(),
                world_theme,
                sample_times[0],
                sample_times[1],
                sample_times[2],
                polished_html
            );
            if let Ok((cval, _)) =
                call_llm_json(&resolved, &critic_sys, &critic_user, &keyframes).await
            {
                let needs = cval["needsPolish"].as_bool().unwrap_or(false);
                if let Some(better_html) = cval["html"].as_str() {
                    if needs && better_html.trim().len() >= 400 && better_html.contains("window.render") {
                        let (re_polished, re_fixes) = lint_and_polish_hyperframe_html(better_html);
                        polished_html = re_polished;
                        lint_fixes.extend(re_fixes);
                        let note = cval["critique"]
                            .as_str()
                            .unwrap_or("Dipoles otomatis oleh Impeccable 3-Frame Vision Critic");
                        lint_fixes.push(format!("Vision Polish: {note}"));
                    }
                }
            }
        }
    }

    let now = Utc::now().to_rfc3339();
    let proj_id = format!("proj_{}", Utc::now().timestamp_millis());

    let scenes_json: Vec<Value> = synced_beats
        .iter()
        .enumerate()
        .map(|(idx, beat)| {
            let sfx_arr = if req.auto_sfx && !beat.sfx.is_empty() && beat.sfx != "none" {
                vec![json!({
                    "preset": beat.sfx,
                    "offsetMs": 0,
                    "volume": 0.55
                })]
            } else {
                Vec::new()
            };
            json!({
                "id": beat.id,
                "role": beat.role,
                "startMs": beat.start_ms,
                "endMs": beat.end_ms,
                "text": beat.text,
                "visualSource": "motion",
                "aiMotion": {
                    "engine": "hyperframe",
                    "theme": "paper",
                    "title": beat.title,
                    "subtitle": world_theme,
                    "takeaway": format!("Act {}", (idx * act_count) / synced_beats.len().max(1) + 1)
                },
                "media": { "path": null, "secondaryPath": null, "trimStartMs": 0, "fit": "cover" },
                "motion": { "preset": "static_clean", "intensity": 0.2 },
                "transitionIn": { "preset": "hard_cut", "durationMs": 0 },
                "sfx": sfx_arr,
                "overlays": []
            })
        })
        .collect();

    Ok(json!({
        "version": "3.0",
        "meta": {
            "id": proj_id,
            "name": req.project_title.trim(),
            "format": req.format,
            "aspectRatio": "9:16",
            "fps": 30,
            "createdAt": now,
            "updatedAt": now
        },
        "styleReference": req.style_reference,
        "footageLibrary": [],
        "hyperframe": {
            "html": polished_html,
            "summary": summary,
            "worldTheme": world_theme,
            "skillsUsed": skill_ids,
            "verified": false,
            "verificationNote": "Menunggu verifikasi 5-frame offscreen",
            "lintFixes": lint_fixes
        },
        "world3d": null,
        "globalStyle": {
            "captionPreset": req.caption_preset,
            "accentColor": req.accent_color,
            "showProgressBar": true,
            "customDesign": req.custom_design,
            "bgm": {
                "preset": if req.bgm_preset == "auto" { "lofi_education" } else { &req.bgm_preset },
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
pub async fn ai_repair_hyperframe_video(
    app: AppHandle,
    req: RepairHyperframeRequest,
) -> Result<RepairHyperframeResponse, String> {
    let resolved = byok::resolve_active_provider(&app)?;
    let system_prompt = format!(
        "Kamu adalah Debugging Engineer untuk Synkcut v3.0 HyperFrames (HTML5 + Three.js S3 Kit + GSAP 3 + SVG).\n\
        Perbaiki error runtime pada dokumen HTML berikut agar `window.render(t)` jalan 100% mulus di semua timestamp tanpa exception, tetap mempertahankan kualitas visual anti-AI-slop & local vendor `./vendor/gsap.min.js` + `./vendor/s3-kit.js`.\n\
        Balas HANYA JSON: {{\"html\": \"<!DOCTYPE html>...</html>\"}}\n\n\
        {HYPERFRAMES_S3_SDK_REFERENCE}"
    );
    let user_prompt = format!(
        "Proyek: \"{}\"\nError yang terjadi: {}\n\nHTML yang rusak:\n{}\n\nKembalikan HTML lengkap yang sudah diperbaiki dalam JSON `{{\"html\": \"...\"}}`.",
        req.project_title, req.error_message, req.broken_html
    );

    let (val, provider_used) = call_llm_json(&resolved, &system_prompt, &user_prompt, &[]).await?;
    let raw_html = val["html"].as_str().unwrap_or("");
    if raw_html.trim().len() < 200 {
        return Err("AI repair mengembalikan HTML kosong.".to_string());
    }
    let (html, lint_fixes) = lint_and_polish_hyperframe_html(raw_html);
    Ok(RepairHyperframeResponse {
        html,
        lint_fixes,
        provider_used,
    })
}

#[tauri::command]
pub async fn ai_patch_hyperframe_video(
    app: AppHandle,
    req: PatchHyperframeRequest,
) -> Result<PatchHyperframeResponse, String> {
    let resolved = byok::resolve_active_provider(&app)?;
    let focus_note = req
        .active_scene_index
        .map(|i| format!("User sedang fokus di Scene/Beat #{}.", i + 1))
        .unwrap_or_else(|| "Perubahan berlaku sesuai permintaan user pada komposisi.".to_string());

    let system_prompt = format!(
        "Kamu adalah AI Director & Creative Technologist untuk Synkcut v3.0 HyperFrames (HTML + Three.js S3 + GSAP 3 + SVG + Impeccable).\n\
        Terapkan permintaan revisi user secara presisi pada dokumen HTML HyperFrames saat ini.\n\
        Pertahankan `const TRANSCRIPT = /*TRANSCRIPT*/null`, local vendor `./vendor/gsap.min.js` & `./vendor/s3-kit.js`, kontrak `window.render(t)`, dan aturan anti-AI-slop.\n\
        Balas HANYA JSON valid: {{\"reply\": \"Penjelasan singkat 1 kalimat Bahasa Indonesia tentang apa yang diubah\", \"html\": \"<!DOCTYPE html>...</html>\"}}\n\n\
        {HYPERFRAMES_S3_SDK_REFERENCE}"
    );
    let user_prompt = format!(
        "Proyek: \"{}\"\n{focus_note}\nPermintaan User: \"{}\"\n\nHTML saat ini:\n{}\n\nKembalikan JSON `{{\"reply\": \"...\", \"html\": \"...\"}}`.",
        req.project_title, req.instruction, req.current_html
    );

    let (val, provider_used) = call_llm_json(&resolved, &system_prompt, &user_prompt, &[]).await?;
    let raw_html = val["html"].as_str().unwrap_or("");
    if raw_html.trim().len() < 200 {
        return Err("AI Director mengembalikan HTML HyperFrames tidak lengkap.".to_string());
    }
    let (html, lint_fixes) = lint_and_polish_hyperframe_html(raw_html);
    let reply = val["reply"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Komposisi HyperFrames berhasil diperbarui sesuai arahanmu.")
        .trim()
        .to_string();

    Ok(PatchHyperframeResponse {
        html,
        reply,
        lint_fixes,
        provider_used,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lint_and_polish_hyperframe_html_fixes_slop_and_cdns() {
        let raw = r#"```html
<!DOCTYPE html>
<html><head>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<style>
  body { font-family: 'Plus Jakarta Sans', sans-serif; }
  .dot { box-shadow: 0 0 18px #22D3EE; }
</style>
</head><body><script type="module">
import * as THREE from 'https://unpkg.com/three@0.180.0/build/three.module.js';
window.render = (t) => { fetch('https://evil.test'); };
</script></body></html>
```"#;
        let (polished, fixes) = lint_and_polish_hyperframe_html(raw);
        assert!(polished.starts_with("<!DOCTYPE html>"));
        assert!(polished.contains("./vendor/gsap.min.js"));
        assert!(polished.contains("./vendor/three.module.js"));
        assert!(!polished.contains("Plus Jakarta Sans"));
        assert!(!polished.contains("box-shadow: 0 0 18px #22D3EE"));
        assert!(!polished.contains("fetch("));
        assert!(fixes.len() >= 4);
    }
}
