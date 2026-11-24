use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

use crate::ai::{call_llm_json, parse_llm_json};
use crate::byok;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesignPalette {
    pub bg_top: String,
    pub bg_bottom: String,
    pub surface_bg: String,
    pub surface_border: String,
    pub text_primary: String,
    pub text_secondary: String,
    pub accent_primary: String,
    pub accent_secondary: String,
    pub accent_ink: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesignTypography {
    pub heading_font: String,
    pub body_font: String,
    pub caption_font: String,
    pub caption_uppercase: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesignVisualStyle {
    pub background_pattern: String,
    pub card_style: String,
    pub corner_style: String,
    pub caption_look: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomDesignDirection {
    pub name: String,
    pub summary: String,
    pub art_direction_notes: String,
    pub is_light: bool,
    pub palette: DesignPalette,
    pub typography: DesignTypography,
    pub visual_style: DesignVisualStyle,
    pub pacing: String,
    pub preferred_motion: String,
    pub preferred_transition: String,
    pub preferred_engines: Vec<String>,
    #[serde(default = "default_render_medium")]
    pub render_medium: String,
    #[serde(default = "default_world_preset")]
    pub world_preset: String,
    #[serde(default = "default_caption_placement")]
    pub caption_placement: String,
    #[serde(default)]
    pub hud_elements: Vec<String>,
    #[serde(default = "default_recommended_bgm")]
    pub recommended_bgm: String,
}

fn default_render_medium() -> String {
    "2d_freeform".to_string()
}

fn default_world_preset() -> String {
    "auto".to_string()
}

fn default_caption_placement() -> String {
    "bottom_safe".to_string()
}

fn default_recommended_bgm() -> String {
    "upbeat_promo".to_string()
}

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
    #[serde(default)]
    pub logo_data_url: Option<String>,
    #[serde(default)]
    pub brand_headings: Vec<String>,
    #[serde(default)]
    pub brand_colors: Vec<String>,
    pub custom_design: CustomDesignDirection,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeStyleRequest {
    pub source_type: String,
    pub title: Option<String>,
    pub url: Option<String>,
    pub thumbnails: Vec<String>,
    #[serde(default)]
    pub design_prompt: Option<String>,
    #[serde(default)]
    pub sampled_colors: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeDesignRequest {
    pub source_type: String, // "images" | "url" | "youtube" | "local_video" | "prompt"
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub design_prompt: Option<String>,
    #[serde(default)]
    pub thumbnails: Vec<String>,
    #[serde(default)]
    pub sampled_colors: Vec<String>,
}

/* ==================== COLOR CONTRAST & SANITIZATION ==================== */

fn parse_hex_rgb(hex: &str) -> Option<(u8, u8, u8)> {
    let clean = hex.trim().strip_prefix('#')?;
    if clean.len() == 3 {
        let mut chars = clean.chars();
        let r = u8::from_str_radix(&format!("{0}{0}", chars.next()?), 16).ok()?;
        let g = u8::from_str_radix(&format!("{0}{0}", chars.next()?), 16).ok()?;
        let b = u8::from_str_radix(&format!("{0}{0}", chars.next()?), 16).ok()?;
        return Some((r, g, b));
    }
    if clean.len() >= 6 {
        let r = u8::from_str_radix(&clean[0..2], 16).ok()?;
        let g = u8::from_str_radix(&clean[2..4], 16).ok()?;
        let b = u8::from_str_radix(&clean[4..6], 16).ok()?;
        return Some((r, g, b));
    }
    None
}

fn normalize_hex(val: Option<&str>, fallback: &str) -> String {
    if let Some(s) = val {
        let trimmed = s.trim();
        if let Some((r, g, b)) = parse_hex_rgb(trimmed) {
            return format!("#{r:02X}{g:02X}{b:02X}");
        }
    }
    fallback.to_string()
}

fn normalize_css_color(val: Option<&str>, fallback: &str) -> String {
    if let Some(s) = val {
        let t = s.trim();
        if parse_hex_rgb(t).is_some() {
            return normalize_hex(Some(t), fallback);
        }
        if (t.starts_with("rgba(") || t.starts_with("rgb(")) && t.ends_with(')') && t.len() <= 40 {
            return t.to_string();
        }
    }
    fallback.to_string()
}

fn relative_luminance(rgb: (u8, u8, u8)) -> f64 {
    let channel = |c: u8| {
        let s = f64::from(c) / 255.0;
        if s <= 0.03928 {
            s / 12.92
        } else {
            ((s + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(rgb.0) + 0.7152 * channel(rgb.1) + 0.0722 * channel(rgb.2)
}

fn contrast_ratio(a: (u8, u8, u8), b: (u8, u8, u8)) -> f64 {
    let la = relative_luminance(a);
    let lb = relative_luminance(b);
    let (hi, lo) = if la > lb { (la, lb) } else { (lb, la) };
    (hi + 0.05) / (lo + 0.05)
}

fn shift_rgb(rgb: (u8, u8, u8), delta: i16) -> String {
    let clamp = |v: i16| v.clamp(0, 255) as u8;
    format!(
        "#{:02X}{:02X}{:02X}",
        clamp(i16::from(rgb.0) + delta),
        clamp(i16::from(rgb.1) + delta),
        clamp(i16::from(rgb.2) + delta)
    )
}

fn sanitize_theme(val: Option<&str>, is_light: bool) -> String {
    match val.unwrap_or("") {
        valid @ ("carbon" | "paper" | "coral" | "mint" | "blue") => valid.to_string(),
        _ => if is_light { "paper" } else { "carbon" }.to_string(),
    }
}

fn sanitize_caption(val: Option<&str>) -> String {
    match val.unwrap_or("bold_pop") {
        valid @ ("bold_pop" | "clean_minimal" | "kinetic_punch" | "luxury_editorial" | "neon_tech") => {
            valid.to_string()
        }
        _ => "bold_pop".to_string(),
    }
}

fn sanitize_engines(arr: Option<&Vec<Value>>) -> Vec<String> {
    let valid = [
        "diorama_3d",
        "custom_code",
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
        out = vec!["custom_code".to_string()];
    }
    out
}

pub fn detect_3d_diorama_cues(lower: &str) -> bool {
    let cues = [
        "diorama",
        "akutahu",
        "aku tahu",
        "kenapa yaaa",
        "kenapa ya",
        "how come",
        "zack d",
        "zackdfilms",
        "blender",
        "cutaway",
        "karakter 3d",
        "animasi 3d",
        "3d explainer",
        "3d character",
        "3d storytelling",
        "anjungan",
        "laut",
        "lubang tanah",
        "stadion",
        "bangunan",
        "gedung",
        "arsitek",
        "bawah tanah",
        "dasar laut",
        "miniatur",
        "3d model",
        "3d shorts",
    ];
    cues.iter().any(|c| lower.contains(c))
}

pub fn infer_world_preset(lower: &str) -> &'static str {
    if lower.contains("laut")
        || lower.contains("samudra")
        || lower.contains("ocean")
        || lower.contains("kapal")
        || lower.contains("anjungan")
        || lower.contains("minyak")
        || lower.contains("ikan")
        || lower.contains("selam")
        || lower.contains("sea")
        || lower.contains("lele")
        || lower.contains("kolam")
    {
        "ocean_cross_section"
    } else if lower.contains("gurun")
        || lower.contains("desert")
        || lower.contains("pasir")
        || lower.contains("tunisia")
        || lower.contains("lubang")
        || lower.contains("bawah tanah")
        || lower.contains("underground")
        || lower.contains("gua")
    {
        "desert_cutaway"
    } else if lower.contains("kamar")
        || lower.contains("ruang")
        || lower.contains("kantor")
        || lower.contains("kafe")
        || lower.contains("kopi")
        || lower.contains("dapur")
        || lower.contains("rumah")
        || lower.contains("stadion")
        || lower.contains("room")
        || lower.contains("studio")
        || lower.contains("pabrik")
    {
        "room_cutaway"
    } else if lower.contains("ternak")
        || lower.contains("kebun")
        || lower.contains("sawah")
        || lower.contains("desa")
        || lower.contains("farm")
        || lower.contains("taman")
        || lower.contains("hutan")
    {
        "outdoor_farm"
    } else {
        "ground_cutaway"
    }
}

fn sanitize_render_medium(val: Option<&str>, fallback: &str) -> String {
    match val.unwrap_or(fallback) {
        valid @ ("3d_diorama" | "2d_freeform" | "footage_montage") => valid.to_string(),
        _ => fallback.to_string(),
    }
}

fn sanitize_world_preset(val: Option<&str>, fallback: &str) -> String {
    match val.unwrap_or(fallback) {
        valid
        @ ("ocean_cross_section"
        | "ground_cutaway"
        | "desert_cutaway"
        | "room_cutaway"
        | "outdoor_farm"
        | "studio_stage"
        | "auto") => valid.to_string(),
        _ => fallback.to_string(),
    }
}

fn sanitize_caption_placement(val: Option<&str>, fallback: &str) -> String {
    match val.unwrap_or(fallback) {
        valid @ ("center_middle" | "bottom_safe") => valid.to_string(),
        _ => fallback.to_string(),
    }
}

fn sanitize_recommended_bgm(val: Option<&str>, fallback: &str) -> String {
    match val.unwrap_or(fallback) {
        valid @ ("upbeat_promo" | "lofi_chill" | "cinematic_pulse" | "minimal_tech" | "none") => {
            valid.to_string()
        }
        _ => fallback.to_string(),
    }
}

fn build_fallback_custom_design(
    context: &str,
    sampled_colors: &[String],
) -> CustomDesignDirection {
    let lower = context.to_lowercase();

    // Use real sampled colors from uploaded reference image when available!
    let valid_sampled: Vec<(String, (u8, u8, u8))> = sampled_colors
        .iter()
        .filter_map(|c| parse_hex_rgb(c).map(|rgb| (normalize_hex(Some(c), "#0D1117"), rgb)))
        .collect();

    if !valid_sampled.is_empty() {
        let (bg_hex, bg_rgb) = valid_sampled[0].clone();
        let is_light = relative_luminance(bg_rgb) > 0.44;
        let bg_bottom = if valid_sampled.len() >= 2
            && (relative_luminance(valid_sampled[1].1) - relative_luminance(bg_rgb)).abs() < 0.25
        {
            valid_sampled[1].0.clone()
        } else {
            shift_rgb(bg_rgb, if is_light { -16 } else { 14 })
        };

        // Pick highest-saturation or contrasting sampled color for accent
        let accent_primary = valid_sampled
            .iter()
            .skip(1)
            .max_by(|a, b| {
                let sat = |rgb: (u8, u8, u8)| {
                    let max_c = rgb.0.max(rgb.1).max(rgb.2) as i32;
                    let min_c = rgb.0.min(rgb.1).min(rgb.2) as i32;
                    max_c - min_c
                };
                sat(a.1).cmp(&sat(b.1))
            })
            .map(|(h, _)| h.clone())
            .unwrap_or_else(|| if is_light { "#EA580C".to_string() } else { "#38E59D".to_string() });

        let accent_rgb = parse_hex_rgb(&accent_primary).unwrap_or((56, 229, 157));
        let accent_ink = if relative_luminance(accent_rgb) > 0.45 {
            "#0A0D12".to_string()
        } else {
            "#FFFFFF".to_string()
        };
        let accent_secondary = valid_sampled
            .get(2)
            .map(|(h, _)| h.clone())
            .unwrap_or_else(|| if is_light { "#0F766E".to_string() } else { "#F59E0B".to_string() });

        return CustomDesignDirection {
            name: "Custom Palet Referensi".to_string(),
            summary: format!(
                "Desain kustom diekstrak langsung dari palet warna referensi ({bg_hex} & aksen {accent_primary}) dengan kontras tinggi."
            ),
            art_direction_notes: format!(
                "Gunakan latar {bg_hex}→{bg_bottom}, aksen utama {accent_primary}, tipografi bersih dan tata letak lega."
            ),
            is_light,
            palette: DesignPalette {
                bg_top: bg_hex,
                bg_bottom,
                surface_bg: if is_light {
                    "rgba(255,255,255,0.88)".to_string()
                } else {
                    "rgba(20,24,34,0.84)".to_string()
                },
                surface_border: if is_light {
                    "rgba(18,22,28,0.16)".to_string()
                } else {
                    "rgba(255,255,255,0.16)".to_string()
                },
                text_primary: if is_light { "#13161C".to_string() } else { "#F5F7FA".to_string() },
                text_secondary: if is_light { "#4B5563".to_string() } else { "#9BA6BA".to_string() },
                accent_primary,
                accent_secondary,
                accent_ink,
            },
            typography: DesignTypography {
                heading_font: if lower.contains("editorial") || lower.contains("serif") || lower.contains("mewah") || lower.contains("luxury") {
                    "serif".to_string()
                } else if lower.contains("tech") || lower.contains("kode") || lower.contains("terminal") {
                    "mono".to_string()
                } else {
                    "sans".to_string()
                },
                body_font: "sans".to_string(),
                caption_font: "sans".to_string(),
                caption_uppercase: !is_light,
            },
            visual_style: DesignVisualStyle {
                background_pattern: if is_light { "paper_grain".to_string() } else { "aurora".to_string() },
                card_style: if lower.contains("brutalist") { "brutalist".to_string() } else { "glass".to_string() },
                corner_style: if lower.contains("brutalist") || lower.contains("tajam") { "sharp".to_string() } else { "rounded".to_string() },
                caption_look: if is_light { "custom_pill".to_string() } else { "bold_outline".to_string() },
            },
            pacing: "balanced".to_string(),
            preferred_motion: "zoom_punch".to_string(),
            preferred_transition: "pop_zoom".to_string(),
            preferred_engines: if detect_3d_diorama_cues(&lower) {
                vec!["diorama_3d".to_string()]
            } else {
                vec!["custom_code".to_string()]
            },
            render_medium: if detect_3d_diorama_cues(&lower) {
                "3d_diorama".to_string()
            } else {
                "2d_freeform".to_string()
            },
            world_preset: infer_world_preset(&lower).to_string(),
            caption_placement: if detect_3d_diorama_cues(&lower) {
                "center_middle".to_string()
            } else {
                "bottom_safe".to_string()
            },
            hud_elements: if detect_3d_diorama_cues(&lower) {
                vec!["popup_title".to_string(), "badge_3d".to_string()]
            } else {
                Vec::new()
            },
            recommended_bgm: if is_light {
                "lofi_chill".to_string()
            } else {
                "upbeat_promo".to_string()
            },
        };
    }

    // 3D Explainer / Diorama Shorts style (AkuTahu, Kenapa Yaaa?, How Come?, Zack D. Films)
    if detect_3d_diorama_cues(&lower) {
        let wp = infer_world_preset(&lower);
        let is_ocean = wp == "ocean_cross_section";
        return CustomDesignDirection {
            name: "3D Explainer Diorama".to_string(),
            summary: "Gaya edukasi 3D diorama ala Shorts viral dengan pencahayaan siang lembut, potongan cutaway, kamera 3D mulus, dan subtitle tengah yang tegas.".to_string(),
            art_direction_notes: "Bangun dunia 3D PBR siang hari dengan karakter 3D berpose ekspresif, kamera dolly sinematik antar beat, badge penunjuk 3D, dan caption di tengah layar.".to_string(),
            is_light: true,
            palette: DesignPalette {
                bg_top: if is_ocean { "#7EC8E3".to_string() } else { "#9AD4F5".to_string() },
                bg_bottom: if is_ocean { "#166996".to_string() } else { "#E6D5B8".to_string() },
                surface_bg: "rgba(12, 16, 24, 0.88)".to_string(),
                surface_border: "rgba(255, 255, 255, 0.22)".to_string(),
                text_primary: "#FFFFFF".to_string(),
                text_secondary: "#E2E8F0".to_string(),
                accent_primary: "#FACC15".to_string(),
                accent_secondary: "#38BDF8".to_string(),
                accent_ink: "#111827".to_string(),
            },
            typography: DesignTypography {
                heading_font: "sans".to_string(),
                body_font: "sans".to_string(),
                caption_font: "sans".to_string(),
                caption_uppercase: false,
            },
            visual_style: DesignVisualStyle {
                background_pattern: "minimal".to_string(),
                card_style: "solid".to_string(),
                corner_style: "rounded".to_string(),
                caption_look: if is_ocean {
                    "black_pill".to_string()
                } else {
                    "outline_bold".to_string()
                },
            },
            pacing: "snappy".to_string(),
            preferred_motion: "static_clean".to_string(),
            preferred_transition: "smooth_crossfade".to_string(),
            preferred_engines: vec!["diorama_3d".to_string()],
            render_medium: "3d_diorama".to_string(),
            world_preset: wp.to_string(),
            caption_placement: "center_middle".to_string(),
            hud_elements: if is_ocean {
                vec!["depth_ruler".to_string(), "question_badge".to_string(), "popup_title".to_string()]
            } else {
                vec!["popup_title".to_string(), "badge_3d".to_string()]
            },
            recommended_bgm: "cinematic_pulse".to_string(),
        };
    }

    // Rich keyword-tailored bespoke directions (never generic 1-size-fits-all!)
    if lower.contains("brutalist") || lower.contains("kuning") || lower.contains("poster") || lower.contains("zine") {
        CustomDesignDirection {
            name: "Neo-Brutalist Editorial".to_string(),
            summary: "Gaya neo-brutalist kontras ekstrem dengan latar krem hangat, border hitam tebal, bayangan offset tegas, dan aksen kuning-oranye.".to_string(),
            art_direction_notes: "Sudut tajam, kartu berbayangan solid offset, tipografi tebal uppercase, ritme cut cepat dan ekspresif.".to_string(),
            is_light: true,
            palette: DesignPalette {
                bg_top: "#F8F3E6".to_string(),
                bg_bottom: "#EFE5CE".to_string(),
                surface_bg: "#FFFFFF".to_string(),
                surface_border: "#111216".to_string(),
                text_primary: "#111216".to_string(),
                text_secondary: "#3D414C".to_string(),
                accent_primary: "#F59E0B".to_string(),
                accent_secondary: "#EF4444".to_string(),
                accent_ink: "#111216".to_string(),
            },
            typography: DesignTypography {
                heading_font: "display".to_string(),
                body_font: "mono".to_string(),
                caption_font: "display".to_string(),
                caption_uppercase: true,
            },
            visual_style: DesignVisualStyle {
                background_pattern: "dots".to_string(),
                card_style: "brutalist".to_string(),
                corner_style: "sharp".to_string(),
                caption_look: "editorial_bar".to_string(),
            },
            pacing: "snappy".to_string(),
            preferred_motion: "shake_impact".to_string(),
            preferred_transition: "whip_pan".to_string(),
            preferred_engines: vec!["custom_code".to_string()],
            render_medium: "2d_freeform".to_string(),
            world_preset: "auto".to_string(),
            caption_placement: "bottom_safe".to_string(),
            hud_elements: Vec::new(),
            recommended_bgm: "upbeat_promo".to_string(),
        }
    } else if lower.contains("luxury") || lower.contains("editorial") || lower.contains("mewah") || lower.contains("vogue") || lower.contains("elegan") || lower.contains("serif") {
        CustomDesignDirection {
            name: "Luxury Dark Editorial".to_string(),
            summary: "Arahan editorial sinematik gelap dengan nuansa espresso-obsidian, tipografi serif halus, garis hairline emas hangat, dan pacing tenang.".to_string(),
            art_direction_notes: "Komposisi simetris lega, bingkai garis tipis emas, animasi halus Ken Burns dan crossfade.".to_string(),
            is_light: false,
            palette: DesignPalette {
                bg_top: "#141010".to_string(),
                bg_bottom: "#231917".to_string(),
                surface_bg: "rgba(32,24,22,0.88)".to_string(),
                surface_border: "rgba(217,178,108,0.34)".to_string(),
                text_primary: "#FBF7F0".to_string(),
                text_secondary: "#CBBCA8".to_string(),
                accent_primary: "#D9B26C".to_string(),
                accent_secondary: "#A66A46".to_string(),
                accent_ink: "#141010".to_string(),
            },
            typography: DesignTypography {
                heading_font: "serif".to_string(),
                body_font: "sans".to_string(),
                caption_font: "serif".to_string(),
                caption_uppercase: false,
            },
            visual_style: DesignVisualStyle {
                background_pattern: "minimal".to_string(),
                card_style: "hairline".to_string(),
                corner_style: "sharp".to_string(),
                caption_look: "editorial_bar".to_string(),
            },
            pacing: "cinematic".to_string(),
            preferred_motion: "smooth_ken_burns".to_string(),
            preferred_transition: "smooth_crossfade".to_string(),
            preferred_engines: vec!["custom_code".to_string()],
            render_medium: "2d_freeform".to_string(),
            world_preset: "auto".to_string(),
            caption_placement: "bottom_safe".to_string(),
            hud_elements: Vec::new(),
            recommended_bgm: "cinematic_pulse".to_string(),
        }
    } else if lower.contains("pastel") || lower.contains("korea") || lower.contains("estetik") || lower.contains("aesthetic") || lower.contains("minimalis") || lower.contains("apple") || lower.contains("clean") || lower.contains("terang") {
        CustomDesignDirection {
            name: "Clean Studio Minimal".to_string(),
            summary: "Gaya terang minimalis dengan permukaan bersih bergradasi lembut, tipografi tegas rapi, dan aksen kontras yang ramah di mata.".to_string(),
            art_direction_notes: "Whitespace luas, sudut membulat lembut, kartu putih bersih, dan subtitle kapsul rapi.".to_string(),
            is_light: true,
            palette: DesignPalette {
                bg_top: "#F7F8FA".to_string(),
                bg_bottom: "#E9EEF5".to_string(),
                surface_bg: "rgba(255,255,255,0.92)".to_string(),
                surface_border: "rgba(15,23,42,0.12)".to_string(),
                text_primary: "#0F172A".to_string(),
                text_secondary: "#475569".to_string(),
                accent_primary: "#2563EB".to_string(),
                accent_secondary: "#0EA5E9".to_string(),
                accent_ink: "#FFFFFF".to_string(),
            },
            typography: DesignTypography {
                heading_font: "sans".to_string(),
                body_font: "sans".to_string(),
                caption_font: "sans".to_string(),
                caption_uppercase: false,
            },
            visual_style: DesignVisualStyle {
                background_pattern: "paper_grain".to_string(),
                card_style: "solid".to_string(),
                corner_style: "pill".to_string(),
                caption_look: "custom_pill".to_string(),
            },
            pacing: "balanced".to_string(),
            preferred_motion: "smooth_ken_burns".to_string(),
            preferred_transition: "smooth_crossfade".to_string(),
            preferred_engines: vec!["custom_code".to_string()],
            render_medium: "2d_freeform".to_string(),
            world_preset: "auto".to_string(),
            caption_placement: "bottom_safe".to_string(),
            hud_elements: Vec::new(),
            recommended_bgm: "lofi_chill".to_string(),
        }
    } else if lower.contains("cyber") || lower.contains("neon") || lower.contains("gaming") || lower.contains("3d") || lower.contains("iphone") || lower.contains("tech") || lower.contains("ai") {
        CustomDesignDirection {
            name: "Cyber Precision Tech".to_string(),
            summary: "Arahan futuristik gelap dengan aura gradien indigo-cyan, garis diagonal teknis, sorotan neon tajam, dan pacing cepat.".to_string(),
            art_direction_notes: "Gunakan permukaan gelap berkilau neon, angka monospace, dan transisi cepat glitch/pop.".to_string(),
            is_light: false,
            palette: DesignPalette {
                bg_top: "#070B18".to_string(),
                bg_bottom: "#111936".to_string(),
                surface_bg: "rgba(15,23,48,0.86)".to_string(),
                surface_border: "rgba(56,189,248,0.34)".to_string(),
                text_primary: "#F1F5FF".to_string(),
                text_secondary: "#94A9D4".to_string(),
                accent_primary: "#22D3EE".to_string(),
                accent_secondary: "#A855F7".to_string(),
                accent_ink: "#06101D".to_string(),
            },
            typography: DesignTypography {
                heading_font: "sans".to_string(),
                body_font: "mono".to_string(),
                caption_font: "sans".to_string(),
                caption_uppercase: true,
            },
            visual_style: DesignVisualStyle {
                background_pattern: "aurora".to_string(),
                card_style: "neon".to_string(),
                corner_style: "rounded".to_string(),
                caption_look: "bold_outline".to_string(),
            },
            pacing: "snappy".to_string(),
            preferred_motion: "zoom_punch".to_string(),
            preferred_transition: "glitch_flash".to_string(),
            preferred_engines: vec!["custom_code".to_string()],
            render_medium: "2d_freeform".to_string(),
            world_preset: "auto".to_string(),
            caption_placement: "bottom_safe".to_string(),
            hud_elements: Vec::new(),
            recommended_bgm: "minimal_tech".to_string(),
        }
    } else {
        CustomDesignDirection {
            name: "Modern Creator Studio".to_string(),
            summary: "Arahan visual modern kontras tinggi dengan gradien gelap bersih, aksen hijau-amber segar, dan tipografi tajam untuk layar vertikal 9:16.".to_string(),
            art_direction_notes: "Jaga fokus di tengah layar 9:16 dengan kartu kaca bersih dan transisi responsif.".to_string(),
            is_light: false,
            palette: DesignPalette {
                bg_top: "#0B0F17".to_string(),
                bg_bottom: "#151D2B".to_string(),
                surface_bg: "rgba(22,29,42,0.88)".to_string(),
                surface_border: "rgba(255,255,255,0.16)".to_string(),
                text_primary: "#F4F6FA".to_string(),
                text_secondary: "#9BA7BC".to_string(),
                accent_primary: "#38E59D".to_string(),
                accent_secondary: "#F59E0B".to_string(),
                accent_ink: "#07140E".to_string(),
            },
            typography: DesignTypography {
                heading_font: "sans".to_string(),
                body_font: "sans".to_string(),
                caption_font: "sans".to_string(),
                caption_uppercase: true,
            },
            visual_style: DesignVisualStyle {
                background_pattern: "grid".to_string(),
                card_style: "glass".to_string(),
                corner_style: "rounded".to_string(),
                caption_look: "bold_outline".to_string(),
            },
            pacing: "balanced".to_string(),
            preferred_motion: "zoom_punch".to_string(),
            preferred_transition: "pop_zoom".to_string(),
            preferred_engines: vec!["custom_code".to_string()],
            render_medium: "2d_freeform".to_string(),
            world_preset: "auto".to_string(),
            caption_placement: "bottom_safe".to_string(),
            hud_elements: Vec::new(),
            recommended_bgm: "upbeat_promo".to_string(),
        }
    }
}

pub fn sanitize_custom_design_value(
    val: &Value,
    context_hint: &str,
    sampled_colors: &[String],
) -> CustomDesignDirection {
    let fb = build_fallback_custom_design(context_hint, sampled_colors);
    let cd = val.get("customDesign").filter(|v| v.is_object()).unwrap_or(val);
    let pal = cd.get("palette").filter(|v| v.is_object());
    let typo = cd.get("typography").filter(|v| v.is_object());
    let vis = cd.get("visualStyle").filter(|v| v.is_object());

    let bg_top = normalize_hex(
        pal.and_then(|p| p["bgTop"].as_str()),
        &fb.palette.bg_top,
    );
    let bg_rgb = parse_hex_rgb(&bg_top).unwrap_or((11, 15, 23));
    let computed_is_light = relative_luminance(bg_rgb) > 0.44;
    let is_light = cd["isLight"].as_bool().unwrap_or(computed_is_light);
    // Trust actual background luminance so text contrast never breaks!
    let effective_light = computed_is_light;

    let bg_bottom = normalize_hex(
        pal.and_then(|p| p["bgBottom"].as_str()),
        &shift_rgb(bg_rgb, if effective_light { -16 } else { 14 }),
    );

    let mut text_primary = normalize_hex(
        pal.and_then(|p| p["textPrimary"].as_str()),
        if effective_light { "#12151C" } else { "#F5F7FA" },
    );
    if let Some(tp_rgb) = parse_hex_rgb(&text_primary) {
        if contrast_ratio(bg_rgb, tp_rgb) < 4.5 {
            text_primary = if effective_light {
                "#12151C".to_string()
            } else {
                "#F5F7FA".to_string()
            };
        }
    }

    let text_secondary = normalize_hex(
        pal.and_then(|p| p["textSecondary"].as_str()),
        if effective_light { "#4B5563" } else { "#9BA6BA" },
    );

    let accent_primary = normalize_hex(
        pal.and_then(|p| p["accentPrimary"].as_str())
            .or_else(|| val["suggestedAccent"].as_str()),
        &fb.palette.accent_primary,
    );
    let accent_rgb = parse_hex_rgb(&accent_primary).unwrap_or((56, 229, 157));
    let accent_ink = if relative_luminance(accent_rgb) > 0.45 {
        "#0B0E14".to_string()
    } else {
        "#FFFFFF".to_string()
    };

    let accent_secondary = normalize_hex(
        pal.and_then(|p| p["accentSecondary"].as_str()),
        &fb.palette.accent_secondary,
    );

    let surface_bg = normalize_css_color(
        pal.and_then(|p| p["surfaceBg"].as_str()),
        if effective_light {
            "rgba(255,255,255,0.90)"
        } else {
            "rgba(22,27,38,0.86)"
        },
    );
    let surface_border = normalize_css_color(
        pal.and_then(|p| p["surfaceBorder"].as_str()),
        if effective_light {
            "rgba(18,22,28,0.16)"
        } else {
            "rgba(255,255,255,0.16)"
        },
    );

    let pick_font = |v: Option<&str>, def: &str| match v.unwrap_or(def) {
        valid @ ("sans" | "serif" | "mono" | "display") => valid.to_string(),
        _ => def.to_string(),
    };

    let bg_pattern = match vis.and_then(|v| v["backgroundPattern"].as_str()).unwrap_or(&fb.visual_style.background_pattern) {
        "grid" | "dots" | "diagonal" | "aurora" | "paper_grain" | "minimal" => {
            vis.and_then(|v| v["backgroundPattern"].as_str())
                .unwrap_or(&fb.visual_style.background_pattern)
                .to_string()
        }
        _ => fb.visual_style.background_pattern.clone(),
    };

    let card_style = match vis.and_then(|v| v["cardStyle"].as_str()).unwrap_or(&fb.visual_style.card_style) {
        "glass" | "solid" | "brutalist" | "hairline" | "neon" => {
            vis.and_then(|v| v["cardStyle"].as_str())
                .unwrap_or(&fb.visual_style.card_style)
                .to_string()
        }
        _ => fb.visual_style.card_style.clone(),
    };

    let corner_style = match vis.and_then(|v| v["cornerStyle"].as_str()).unwrap_or(&fb.visual_style.corner_style) {
        "sharp" | "rounded" | "pill" => {
            vis.and_then(|v| v["cornerStyle"].as_str())
                .unwrap_or(&fb.visual_style.corner_style)
                .to_string()
        }
        _ => fb.visual_style.corner_style.clone(),
    };

    let caption_look = match vis.and_then(|v| v["captionLook"].as_str()).unwrap_or(&fb.visual_style.caption_look) {
        valid
        @ ("bold_outline"
        | "black_pill"
        | "outline_bold"
        | "clean_shadow"
        | "custom_pill"
        | "editorial_bar"
        | "glass_tag"
        | "minimal_clean") => valid.to_string(),
        _ => fb.visual_style.caption_look.clone(),
    };

    let pacing = match cd["pacing"].as_str().unwrap_or(&fb.pacing) {
        "snappy" | "balanced" | "cinematic" => cd["pacing"].as_str().unwrap_or(&fb.pacing).to_string(),
        _ => fb.pacing.clone(),
    };

    let preferred_motion = match cd["preferredMotion"].as_str().unwrap_or(&fb.preferred_motion) {
        "zoom_punch" | "smooth_ken_burns" | "shake_impact" | "slide_reveal" | "static_clean" => {
            cd["preferredMotion"].as_str().unwrap_or(&fb.preferred_motion).to_string()
        }
        _ => fb.preferred_motion.clone(),
    };

    let preferred_transition = match cd["preferredTransition"].as_str().unwrap_or(&fb.preferred_transition) {
        "hard_cut" | "whip_pan" | "pop_zoom" | "glitch_flash" | "smooth_crossfade" => {
            cd["preferredTransition"].as_str().unwrap_or(&fb.preferred_transition).to_string()
        }
        _ => fb.preferred_transition.clone(),
    };

    let name = cd["name"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .unwrap_or(fb.name);

    let summary = cd["summary"]
        .as_str()
        .or_else(|| val["styleDnaSummary"].as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .unwrap_or(fb.summary);

    let art_direction_notes = cd["artDirectionNotes"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| summary.clone());

    let preferred_engines = sanitize_engines(
        cd["preferredEngines"]
            .as_array()
            .or_else(|| val["suggestedEngines"].as_array()),
    );

    let render_medium = sanitize_render_medium(
        cd["renderMedium"]
            .as_str()
            .or_else(|| val["renderMedium"].as_str()),
        &fb.render_medium,
    );
    let world_preset = sanitize_world_preset(
        cd["worldPreset"]
            .as_str()
            .or_else(|| val["worldPreset"].as_str()),
        &fb.world_preset,
    );
    let caption_placement = sanitize_caption_placement(
        cd["captionPlacement"]
            .as_str()
            .or_else(|| val["captionPlacement"].as_str()),
        if render_medium == "3d_diorama" {
            "center_middle"
        } else {
            &fb.caption_placement
        },
    );
    let hud_elements: Vec<String> = cd["hudElements"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .take(6)
                .collect()
        })
        .unwrap_or_else(|| fb.hud_elements.clone());
    let recommended_bgm = sanitize_recommended_bgm(
        cd["recommendedBgm"]
            .as_str()
            .or_else(|| val["recommendedBgm"].as_str()),
        &fb.recommended_bgm,
    );

    let _ = is_light; // luminance check is authoritative for readability

    CustomDesignDirection {
        name,
        summary,
        art_direction_notes,
        is_light: effective_light,
        palette: DesignPalette {
            bg_top,
            bg_bottom,
            surface_bg,
            surface_border,
            text_primary,
            text_secondary,
            accent_primary,
            accent_secondary,
            accent_ink,
        },
        typography: DesignTypography {
            heading_font: pick_font(typo.and_then(|t| t["headingFont"].as_str()), &fb.typography.heading_font),
            body_font: pick_font(typo.and_then(|t| t["bodyFont"].as_str()), &fb.typography.body_font),
            caption_font: pick_font(typo.and_then(|t| t["captionFont"].as_str()), &fb.typography.caption_font),
            caption_uppercase: typo
                .and_then(|t| t["captionUppercase"].as_bool())
                .unwrap_or(fb.typography.caption_uppercase),
        },
        visual_style: DesignVisualStyle {
            background_pattern: bg_pattern,
            card_style,
            corner_style,
            caption_look,
        },
        pacing,
        preferred_motion,
        preferred_transition,
        preferred_engines,
        render_medium,
        world_preset,
        caption_placement,
        hud_elements,
        recommended_bgm,
    }
}

/* ==================== URL & OPENGRAPH EXTRACTION ==================== */

fn normalize_url_input(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
}

fn percent_encode_url_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    for b in input.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
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

    let without_frag = trimmed.split('#').next().unwrap_or(trimmed);
    let (path_part, query_part) = match without_frag.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (without_frag, None),
    };

    if let Some(q) = query_part {
        for pair in q.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                if k == "v" && is_valid_yt_id(v) {
                    return Some(v.to_string());
                }
            }
        }
    }

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

pub fn safe_utf8_prefix(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

pub fn resolve_relative_url(page_url: &str, raw_target: &str) -> Option<String> {
    let target = raw_target.trim();
    if target.is_empty() || target.starts_with("data:") || target.starts_with("javascript:") {
        return None;
    }
    if target.starts_with("http://") || target.starts_with("https://") {
        return Some(target.to_string());
    }
    if target.starts_with("//") {
        return Some(format!("https:{target}"));
    }

    let scheme_end = page_url.find("://")?;
    let scheme = &page_url[..scheme_end];
    let after_scheme = &page_url[scheme_end + 3..];
    let host_end = after_scheme
        .find(|c| c == '/' || c == '?' || c == '#')
        .unwrap_or(after_scheme.len());
    let origin = format!("{scheme}://{}", &after_scheme[..host_end]);

    if target.starts_with('/') {
        return Some(format!("{origin}{target}"));
    }

    let path_and_more = &after_scheme[host_end..];
    let path_only = path_and_more
        .split(['?', '#'])
        .next()
        .unwrap_or("/");
    let base_dir = match path_only.rfind('/') {
        Some(idx) => &path_only[..=idx],
        None => "/",
    };
    let clean_rel = target.trim_start_matches("./");
    Some(format!("{origin}{base_dir}{clean_rel}"))
}

pub fn extract_html_brand_colors(html: &str) -> Vec<String> {
    use std::collections::HashMap;

    let slice = safe_utf8_prefix(html, 120_000);
    let bytes = slice.as_bytes();
    let mut counts: HashMap<String, usize> = HashMap::new();

    let mut i = 0;
    while i + 7 <= bytes.len() {
        if bytes[i] == b'#' {
            let prev_ok = i == 0
                || !bytes[i - 1].is_ascii_alphanumeric()
                    && bytes[i - 1] != b'_'
                    && bytes[i - 1] != b'&';
            let hex_slice = &bytes[i + 1..i + 7];
            let next_ok = i + 7 >= bytes.len() || !bytes[i + 7].is_ascii_hexdigit();
            if prev_ok && next_ok && hex_slice.iter().all(|b| b.is_ascii_hexdigit()) {
                if let Ok(hex_str) = std::str::from_utf8(&bytes[i..i + 7]) {
                    let norm = hex_str.to_ascii_uppercase();
                    *counts.entry(norm).or_insert(0) += 1;
                }
                i += 7;
                continue;
            }
        }
        i += 1;
    }

    let mut scored: Vec<(String, f64, i32, bool)> = counts
        .into_iter()
        .filter_map(|(hex, count)| {
            let rgb = parse_hex_rgb(&hex)?;
            let max_c = rgb.0.max(rgb.1).max(rgb.2) as i32;
            let min_c = rgb.0.min(rgb.1).min(rgb.2) as i32;
            let chroma = max_c - min_c;
            let is_neutral = chroma < 24;
            let score = (count as f64).sqrt() * (f64::from(chroma) + 18.0);
            Some((hex, score, chroma, is_neutral))
        })
        .collect();

    scored.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.2.cmp(&a.2))
    });

    let mut result: Vec<String> = Vec::new();
    // Prefer saturated brand colors first
    for (hex, _, _, is_neutral) in &scored {
        if !is_neutral && !result.contains(hex) {
            result.push(hex.clone());
            if result.len() >= 4 {
                break;
            }
        }
    }
    // Add up to 1 non-extreme background/surface color if found
    for (hex, _, _, is_neutral) in &scored {
        if *is_neutral && hex != "#FFFFFF" && hex != "#000000" && !result.contains(hex) {
            result.push(hex.clone());
            break;
        }
    }
    result
}

fn extract_html_meta_content(html: &str, key: &str) -> Option<String> {
    // ASCII lowercasing preserves 1-to-1 byte offsets with `html` (zero UTF-8 slicing panic!)
    let lower = html.to_ascii_lowercase();
    let needle = key.to_ascii_lowercase();
    let mut search_from = 0;

    while let Some(pos) = lower[search_from..].find("<meta") {
        let abs_start = search_from + pos;
        let Some(end_rel) = lower[abs_start..].find('>') else {
            break;
        };
        let tag = &html[abs_start..abs_start + end_rel + 1];
        let tag_lower = &lower[abs_start..abs_start + end_rel + 1];
        search_from = abs_start + end_rel + 1;

        if !tag_lower.contains(&needle) {
            continue;
        }
        if let Some(c_pos) = tag_lower.find("content=") {
            let after = tag[c_pos + 8..].trim_start();
            let quote = after.chars().next()?;
            if quote == '"' || quote == '\'' {
                let inner = &after[1..];
                if let Some(close) = inner.find(quote) {
                    let val = inner[..close]
                        .replace("&amp;", "&")
                        .replace("&quot;", "\"")
                        .replace("&#39;", "'")
                        .trim()
                        .to_string();
                    if !val.is_empty() {
                        return Some(val);
                    }
                }
            }
        }
    }
    None
}

fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let after_open = lower[start..].find('>')? + start + 1;
    let end = lower[after_open..].find("</title>")? + after_open;
    let title = html[after_open..end]
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .trim()
        .to_string();
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

fn extract_tag_attr(tag: &str, attr_name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let needle = format!("{}=", attr_name.to_ascii_lowercase());
    let pos = lower.find(&needle)?;
    let after = tag[pos + needle.len()..].trim_start();
    let quote = after.chars().next()?;
    if quote == '"' || quote == '\'' {
        let inner = &after[1..];
        let close = inner.find(quote)?;
        let val = inner[..close]
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .trim()
            .to_string();
        if !val.is_empty() {
            return Some(val);
        }
    }
    None
}

pub fn extract_stylesheet_urls(html: &str, page_url: &str) -> Vec<String> {
    let head = safe_utf8_prefix(html, 64_000);
    let lower = head.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(pos) = lower[from..].find("<link") {
        let start = from + pos;
        let Some(end_rel) = lower[start..].find('>') else {
            break;
        };
        let tag = &head[start..start + end_rel + 1];
        let tag_lower = &lower[start..start + end_rel + 1];
        from = start + end_rel + 1;
        if !tag_lower.contains("stylesheet") {
            continue;
        }
        if let Some(href) = extract_tag_attr(tag, "href") {
            let hl = href.to_ascii_lowercase();
            // Skip Google Fonts / icon CDNs that don't carry brand palette
            if hl.contains("fonts.googleapis.com") || hl.contains("fontawesome") {
                continue;
            }
            if let Some(resolved) = resolve_relative_url(page_url, &href) {
                if !out.contains(&resolved) {
                    out.push(resolved);
                }
                if out.len() >= 2 {
                    break;
                }
            }
        }
    }
    out
}

fn extract_brand_logo_url(html: &str, page_url: &str) -> Option<String> {
    let slice = safe_utf8_prefix(html, 64_000);
    let lower = slice.to_ascii_lowercase();
    // 1. Prefer <img> with "logo" in src, alt, or class
    let mut from = 0;
    while let Some(pos) = lower[from..].find("<img") {
        let start = from + pos;
        let Some(end_rel) = lower[start..].find('>') else {
            break;
        };
        let tag = &slice[start..start + end_rel + 1];
        let tag_lower = &lower[start..start + end_rel + 1];
        from = start + end_rel + 1;
        if tag_lower.contains("logo") {
            if let Some(src) = extract_tag_attr(tag, "src") {
                if !src.starts_with("data:image/svg") && !src.to_ascii_lowercase().ends_with(".svg") {
                    if let Some(resolved) = resolve_relative_url(page_url, &src) {
                        return Some(resolved);
                    }
                }
            }
        }
    }
    // 2. Fallback: apple-touch-icon or PNG icon
    from = 0;
    while let Some(pos) = lower[from..].find("<link") {
        let start = from + pos;
        let Some(end_rel) = lower[start..].find('>') else {
            break;
        };
        let tag = &slice[start..start + end_rel + 1];
        let tag_lower = &lower[start..start + end_rel + 1];
        from = start + end_rel + 1;
        if tag_lower.contains("apple-touch-icon")
            || (tag_lower.contains("icon") && tag_lower.contains(".png"))
        {
            if let Some(href) = extract_tag_attr(tag, "href") {
                if let Some(resolved) = resolve_relative_url(page_url, &href) {
                    return Some(resolved);
                }
            }
        }
    }
    None
}

pub fn extract_html_headings(html: &str) -> Vec<String> {
    let slice = safe_utf8_prefix(html, 80_000);
    let lower = slice.to_ascii_lowercase();
    let mut headings = Vec::new();
    for tag_name in ["h1", "h2"] {
        let open_pat = format!("<{tag_name}");
        let close_pat = format!("</{tag_name}>");
        let mut from = 0;
        while let Some(pos) = lower[from..].find(&open_pat) {
            let abs = from + pos;
            let Some(gt_rel) = lower[abs..].find('>') else {
                break;
            };
            let content_start = abs + gt_rel + 1;
            let Some(close_rel) = lower[content_start..].find(&close_pat) else {
                break;
            };
            let inner = &slice[content_start..content_start + close_rel];
            from = content_start + close_rel + close_pat.len();

            // Strip inner HTML tags cleanly
            let mut clean = String::new();
            let mut in_tag = false;
            for ch in inner.chars() {
                if ch == '<' {
                    in_tag = true;
                } else if ch == '>' {
                    in_tag = false;
                    clean.push(' ');
                } else if !in_tag {
                    clean.push(ch);
                }
            }
            let normalized = clean
                .replace("&amp;", "&")
                .replace("&nbsp;", " ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            if normalized.len() >= 4 && normalized.len() <= 110 && !headings.contains(&normalized) {
                headings.push(normalized);
                if headings.len() >= 4 {
                    return headings;
                }
            }
        }
    }
    headings
}

struct WebpageBrandContext {
    title: String,
    desc: String,
    og_thumb: Option<String>,
    logo_data_url: Option<String>,
    colors: Vec<String>,
    headings: Vec<String>,
}

async fn fetch_webpage_design_context(url: &str) -> WebpageBrandContext {
    let fallback_title = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("Referensi Desain Web")
        .to_string();

    let empty = |title: String| WebpageBrandContext {
        title,
        desc: String::new(),
        og_thumb: None,
        logo_data_url: None,
        colors: Vec::new(),
        headings: Vec::new(),
    };

    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(14))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
    else {
        return empty(fallback_title);
    };

    let Ok(res) = client.get(url).send().await else {
        return empty(fallback_title);
    };

    if !res.status().is_success() {
        return empty(fallback_title);
    }

    let final_url = res.url().as_str().to_string();

    // If URL points directly to an image (e.g. .png, .jpg, .webp)
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    if content_type.starts_with("image/") {
        if let Ok(bytes) = res.bytes().await {
            if !bytes.is_empty() && bytes.len() <= 5 * 1024 * 1024 {
                let mime = content_type.split(';').next().unwrap_or("image/jpeg");
                let data_url = format!("data:{mime};base64,{}", BASE64.encode(bytes));
                return WebpageBrandContext {
                    title: format!("Gambar Referensi ({fallback_title})"),
                    desc: "Gambar referensi langsung dari URL.".to_string(),
                    og_thumb: Some(data_url),
                    logo_data_url: None,
                    colors: Vec::new(),
                    headings: Vec::new(),
                };
            }
        }
        return empty(fallback_title);
    }

    let html = res.text().await.unwrap_or_default();
    let head_slice = safe_utf8_prefix(&html, 48_000);

    let title = extract_html_meta_content(head_slice, "og:title")
        .or_else(|| extract_html_meta_content(head_slice, "twitter:title"))
        .or_else(|| extract_html_title(head_slice))
        .unwrap_or(fallback_title);

    let desc = extract_html_meta_content(head_slice, "og:description")
        .or_else(|| extract_html_meta_content(head_slice, "description"))
        .unwrap_or_default();

    let headings = extract_html_headings(&html);

    let mut colors = Vec::new();
    if let Some(theme_col) = extract_html_meta_content(head_slice, "theme-color") {
        if parse_hex_rgb(&theme_col).is_some() {
            colors.push(normalize_hex(Some(&theme_col), "#0D1117"));
        }
    }
    for hex in extract_html_brand_colors(&html) {
        if !colors.contains(&hex) {
            colors.push(hex);
        }
        if colors.len() >= 5 {
            break;
        }
    }

    // Also fetch up to 2 external CSS stylesheets to uncover true Tailwind / brand CSS colors
    if colors.len() < 4 {
        let css_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(6))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            .build()
            .ok();
        if let Some(ref c) = css_client {
            for css_url in extract_stylesheet_urls(&html, &final_url) {
                if let Ok(css_res) = c.get(&css_url).send().await {
                    if css_res.status().is_success() {
                        if let Ok(css_txt) = css_res.text().await {
                            for hex in extract_html_brand_colors(&css_txt) {
                                if !colors.contains(&hex) {
                                    colors.push(hex);
                                }
                                if colors.len() >= 6 {
                                    break;
                                }
                            }
                        }
                    }
                }
                if colors.len() >= 6 {
                    break;
                }
            }
        }
    }

    let og_img_url = extract_html_meta_content(head_slice, "og:image")
        .or_else(|| extract_html_meta_content(head_slice, "twitter:image"));

    let mut thumb_data_url = None;
    if let Some(raw_img) = og_img_url {
        if let Some(resolved_img) = resolve_relative_url(&final_url, &raw_img) {
            if let Ok(img_res) = client.get(&resolved_img).send().await {
                if img_res.status().is_success() {
                    let mime = img_res
                        .headers()
                        .get(reqwest::header::CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("image/jpeg")
                        .split(';')
                        .next()
                        .unwrap_or("image/jpeg")
                        .to_string();
                    if mime.starts_with("image/") {
                        if let Ok(bytes) = img_res.bytes().await {
                            if !bytes.is_empty() && bytes.len() <= 4 * 1024 * 1024 {
                                thumb_data_url =
                                    Some(format!("data:{mime};base64,{}", BASE64.encode(bytes)));
                            }
                        }
                    }
                }
            }
        }
    }

    let mut logo_data_url = None;
    if let Some(logo_url) = extract_brand_logo_url(&html, &final_url) {
        if let Ok(logo_res) = client.get(&logo_url).send().await {
            if logo_res.status().is_success() {
                let mime = logo_res
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("image/png")
                    .split(';')
                    .next()
                    .unwrap_or("image/png")
                    .to_string();
                if mime.starts_with("image/") && !mime.contains("svg") && !mime.contains("icon") {
                    if let Ok(bytes) = logo_res.bytes().await {
                        if !bytes.is_empty() && bytes.len() <= 1_500_000 {
                            logo_data_url =
                                Some(format!("data:{mime};base64,{}", BASE64.encode(bytes)));
                        }
                    }
                }
            }
        }
    }

    WebpageBrandContext {
        title,
        desc,
        og_thumb: thumb_data_url,
        logo_data_url,
        colors,
        headings,
    }
}

/* ==================== AI CUSTOM DESIGN GENERATOR ==================== */

fn design_system_prompt() -> &'static str {
    "Kamu adalah Art Director & Motion Systems Designer kelas dunia untuk Synkcut. \
    Tugasmu menghasilkan ARAHAN DESAIN CUSTOM (Custom Design System) yang UNIK dan AKURAT meniru medium + gaya referensi gambar, YouTube Shorts, URL, atau brief user — BUKAN mengikuti template kaku! \
    DETEKSI MEDIUM VISUAL DENGAN TELITI: \
    - Jika gambar referensi menampilkan animasi 3D diorama, cutaway laut/tanah/ruangan, karakter 3D bergaya Blender/Clay/Zack D. Films/AkuTahu/Kenapa Yaaa?/How Come?, SET `renderMedium: \"3d_diorama\"`, pilih `worldPreset` yang cocok, dan set `captionPlacement: \"center_middle\"` bila subtitle berada di tengah layar! \
    - Jika referensi menampilkan desain grafis 2D, website UI, tipografi kinetik, poster, atau ilustrasi datar, SET `renderMedium: \"2d_freeform\"`. \
    - Deteksi gaya subtitle asli referensi secara tepat: \"black_pill\" (kotak hitam bundar teks putih ala AkuTahu), \"outline_bold\" (teks putih tebal + garis tepi hitam + kata sorotan kuning ala Kenapa Yaaa?), \"clean_shadow\" (teks putih bersih bershadow halus ala How Come?), atau gaya lain. \
    Pastikan textPrimary kontras jelas terhadap bgTop/bgBottom agar selalu mudah dibaca. \
    Balas HANYA dalam JSON valid tanpa teks luar."
}

fn design_user_prompt(context_desc: &str, sampled_colors: &[String], img_count: usize) -> String {
    let color_hint = if sampled_colors.is_empty() {
        String::new()
    } else {
        format!(
            "\nWarna dominan yang terdeteksi dari gambar referensi: {:?} (gunakan & harmonisasikan sebagai basis palet custom!).",
            sampled_colors
        )
    };

    format!(
        "Konteks referensi desain:\n{context_desc}\nJumlah gambar referensi terlampir: {img_count}.{color_hint}\n\n\
        Buat Arahan Desain Custom dalam JSON persis seperti ini:\n\
        {{\n\
          \"styleDnaSummary\": \"Ringkasan 1-2 kalimat Bahasa Indonesia tentang medium visual (3D Diorama atau 2D Motion), palet warna, gaya karakter/objek, gaya subtitle, dan pacing desain ini\",\n\
          \"suggestedTheme\": \"carbon|paper|coral|mint|blue\",\n\
          \"suggestedCaption\": \"bold_pop|clean_minimal|kinetic_punch|luxury_editorial|neon_tech\",\n\
          \"suggestedAccent\": \"#HEX warna aksen utama\",\n\
          \"suggestedEngines\": [\"diorama_3d\", \"custom_code\"],\n\
          \"customDesign\": {{\n\
            \"name\": \"Nama gaya desain custom 2-4 kata (mis. 3D Ocean Diorama / 3D Story Character / Neo-Brutalist Zine)\",\n\
            \"summary\": \"Penjelasan singkat karakter desain custom ini\",\n\
            \"artDirectionNotes\": \"Instruksi konkret untuk AI Director (medium 3D/2D, sudut kamera, pencahayaan, HUD/badge, gaya subtitle, ritme cut)\",\n\
            \"renderMedium\": \"3d_diorama|2d_freeform|footage_montage\",\n\
            \"worldPreset\": \"ocean_cross_section|ground_cutaway|desert_cutaway|room_cutaway|outdoor_farm|studio_stage|auto\",\n\
            \"captionPlacement\": \"center_middle|bottom_safe\",\n\
            \"hudElements\": [\"depth_ruler\", \"question_badge\", \"popup_title\"],\n\
            \"recommendedBgm\": \"upbeat_promo|lofi_chill|cinematic_pulse|minimal_tech|none\",\n\
            \"isLight\": false,\n\
            \"palette\": {{\n\
              \"bgTop\": \"#HEX\",\n\
              \"bgBottom\": \"#HEX\",\n\
              \"surfaceBg\": \"rgba(r,g,b,0.88) atau #HEX\",\n\
              \"surfaceBorder\": \"rgba(r,g,b,0.22) atau #HEX\",\n\
              \"textPrimary\": \"#HEX kontras tinggi terhadap bg\",\n\
              \"textSecondary\": \"#HEX\",\n\
              \"accentPrimary\": \"#HEX warna aksen utama dari referensi\",\n\
              \"accentSecondary\": \"#HEX warna aksen pendukung\",\n\
              \"accentInk\": \"#HEX kontras terhadap accentPrimary\"\n\
            }},\n\
            \"typography\": {{\n\
              \"headingFont\": \"sans|serif|mono|display\",\n\
              \"bodyFont\": \"sans|serif|mono\",\n\
              \"captionFont\": \"sans|serif|mono|display\",\n\
              \"captionUppercase\": false\n\
            }},\n\
            \"visualStyle\": {{\n\
              \"backgroundPattern\": \"grid|dots|diagonal|aurora|paper_grain|minimal\",\n\
              \"cardStyle\": \"glass|solid|brutalist|hairline|neon\",\n\
              \"cornerStyle\": \"sharp|rounded|pill\",\n\
              \"captionLook\": \"black_pill|outline_bold|clean_shadow|bold_outline|custom_pill|editorial_bar|glass_tag|minimal_clean\"\n\
            }},\n\
            \"pacing\": \"snappy|balanced|cinematic\",\n\
            \"preferredMotion\": \"zoom_punch|smooth_ken_burns|shake_impact|slide_reveal|static_clean\",\n\
            \"preferredTransition\": \"hard_cut|whip_pan|pop_zoom|glitch_flash|smooth_crossfade\",\n\
            \"preferredEngines\": [\"diorama_3d\", \"custom_code\"]\n\
          }}\n\
        }}"
    )
}

async fn analyze_with_byok(
    app: &AppHandle,
    context_desc: &str,
    thumbnails: &[String],
    sampled_colors: &[String],
) -> Option<Value> {
    let resolved = byok::resolve_active_provider(app).ok()?;
    let user_prompt = design_user_prompt(context_desc, sampled_colors, thumbnails.len());

    call_llm_json(&resolved, design_system_prompt(), &user_prompt, thumbnails)
        .await
        .ok()
        .map(|(val, _)| val)
}

/// Layer 2: Ask Gemini Flash directly with YouTube URL via fileData when yt-dlp is unavailable
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
        .timeout(Duration::from_secs(24))
        .build()
        .ok()?;

    let user_prompt = design_user_prompt(
        &format!("Video YouTube referensi: \"{title}\" ({canonical_url}). Tonton sekilas 25 detik awal untuk membaca warna, gaya tipografi, dan pacing."),
        &[],
        0,
    );

    let payload = json!({
        "systemInstruction": { "parts": [{ "text": design_system_prompt() }] },
        "contents": [{
            "role": "user",
            "parts": [
                { "fileData": { "mimeType": "video/mp4", "fileUri": canonical_url } },
                { "text": user_prompt }
            ]
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.45
        }
    });

    let mut candidates = vec![byok::get_gemini_model_for_app(app)];
    for fb in byok::GEMINI_FALLBACK_MODELS {
        if !candidates.iter().any(|c| c == fb) {
            candidates.push(fb.to_string());
        }
    }

    for candidate in candidates {
        let endpoint = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{candidate}:generateContent?key={gemini_key}"
        );
        let Ok(res) = client.post(endpoint).json(&payload).send().await else {
            continue;
        };
        if res.status().is_success() {
            let val: Value = crate::ai::decode_llm_http_body(res).await.ok()?;
            let raw_txt = crate::ai::extract_gemini_text(&val)?;
            return parse_llm_json(&raw_txt).ok();
        }
        if !matches!(res.status().as_u16(), 404 | 503 | 429) {
            return None;
        }
    }
    None
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

    let downloaded_ok = match tokio::time::timeout(Duration::from_secs(24), download_fut).await {
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

    let _ = tokio::fs::remove_dir_all(&temp_dir).await;

    if frames.is_empty() {
        None
    } else {
        Some(frames)
    }
}

async fn fetch_yt_image_data_url(client: &reqwest::Client, url: &str) -> Option<String> {
    let res = client.get(url).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    let bytes = res.bytes().await.ok()?;
    // Skip tiny placeholder/error stubs (< 1.5KB)
    if bytes.len() < 1500 {
        return None;
    }
    Some(format!("data:image/jpeg;base64,{}", BASE64.encode(bytes)))
}

async fn fetch_youtube_oembed_and_frames(
    canonical_url: &str,
    video_id: &str,
) -> (String, String, Vec<String>) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
    {
        Ok(c) => c,
        Err(_) => return (format!("YouTube ({video_id})"), String::new(), Vec::new()),
    };

    let encoded_url = percent_encode_url_component(canonical_url);
    let oembed_url = format!("https://www.youtube.com/oembed?url={encoded_url}&format=json");

    // Fetch oEmbed + 4 distinct moments of the YouTube/Shorts video concurrently via tokio::spawn (zero yt-dlp required!)
    let c0 = client.clone();
    let oembed_handle = tokio::spawn(async move {
        let mut title = format!("YouTube ({})", oembed_url.len());
        let mut author = String::new();
        if let Ok(res) = c0.get(&oembed_url).send().await {
            if res.status().is_success() {
                if let Ok(val) = crate::ai::decode_llm_http_body(res).await {
                    if let Some(t) = val["title"].as_str().filter(|s| !s.trim().is_empty()) {
                        title = t.trim().to_string();
                    }
                    if let Some(a) = val["author_name"].as_str().filter(|s| !s.trim().is_empty()) {
                        author = a.trim().to_string();
                    }
                }
            }
        }
        (title, author)
    });

    let c1 = client.clone();
    let vid_cover = video_id.to_string();
    let cover_handle = tokio::spawn(async move {
        let primary = format!("https://i.ytimg.com/vi/{vid_cover}/maxresdefault.jpg");
        if let Some(img) = fetch_yt_image_data_url(&c1, &primary).await {
            return Some(img);
        }
        let fallback = format!("https://i.ytimg.com/vi/{vid_cover}/hqdefault.jpg");
        fetch_yt_image_data_url(&c1, &fallback).await
    });

    let c2 = client.clone();
    let u1 = format!("https://i.ytimg.com/vi/{video_id}/1.jpg");
    let f1_handle = tokio::spawn(async move { fetch_yt_image_data_url(&c2, &u1).await });

    let c3 = client.clone();
    let u2 = format!("https://i.ytimg.com/vi/{video_id}/2.jpg");
    let f2_handle = tokio::spawn(async move { fetch_yt_image_data_url(&c3, &u2).await });

    let c4 = client.clone();
    let u3 = format!("https://i.ytimg.com/vi/{video_id}/3.jpg");
    let f3_handle = tokio::spawn(async move { fetch_yt_image_data_url(&c4, &u3).await });

    let (mut title, author) = oembed_handle
        .await
        .unwrap_or_else(|_| (format!("YouTube ({video_id})"), String::new()));
    if title.starts_with("YouTube (") && !title.contains(video_id) {
        title = format!("YouTube ({video_id})");
    }
    let cover = cover_handle.await.ok().flatten();
    let f1 = f1_handle.await.ok().flatten();
    let f2 = f2_handle.await.ok().flatten();
    let f3 = f3_handle.await.ok().flatten();

    let mut frames = Vec::new();
    for item in [cover, f1, f2, f3].into_iter().flatten() {
        frames.push(item);
    }

    (title, author, frames)
}

fn build_style_result(
    source_type: &str,
    url: Option<String>,
    title: String,
    thumbnails: Vec<String>,
    ai_dna: Option<Value>,
    layer_used: &str,
    context_hint: &str,
    sampled_colors: &[String],
) -> StyleReferenceResult {
    let custom_design = match ai_dna.as_ref() {
        Some(val) => sanitize_custom_design_value(val, context_hint, sampled_colors),
        None => build_fallback_custom_design(context_hint, sampled_colors),
    };

    let suggested_theme = sanitize_theme(
        ai_dna.as_ref().and_then(|v| v["suggestedTheme"].as_str()),
        custom_design.is_light,
    );
    let suggested_caption = sanitize_caption(
        ai_dna.as_ref().and_then(|v| v["suggestedCaption"].as_str()),
    );
    let suggested_accent = custom_design.palette.accent_primary.clone();
    let suggested_engines = custom_design.preferred_engines.clone();

    let style_dna_summary = ai_dna
        .as_ref()
        .and_then(|v| v["styleDnaSummary"].as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| custom_design.summary.clone());

    StyleReferenceResult {
        source_type: source_type.to_string(),
        url,
        title,
        thumbnails,
        style_dna_summary,
        suggested_theme,
        suggested_caption,
        suggested_accent,
        suggested_engines,
        layer_used: layer_used.to_string(),
        logo_data_url: None,
        brand_headings: Vec::new(),
        brand_colors: sampled_colors.to_vec(),
        custom_design,
    }
}

/* ==================== TAURI COMMANDS ==================== */

/// Universal design reference analyzer: supports YouTube/Shorts, ANY Web/Design URL,
/// uploaded/pasted screenshots, local reference clips, OR free-text custom design prompts.
#[tauri::command]
pub async fn analyze_design_reference(
    app: AppHandle,
    req: AnalyzeDesignRequest,
) -> Result<StyleReferenceResult, String> {
    let src_type = req.source_type.trim().to_lowercase();
    let notes = req.design_prompt.clone().unwrap_or_default();

    // 1. Free-text custom design prompt
    if src_type == "prompt" {
        let prompt_txt = notes.trim();
        if prompt_txt.is_empty() {
            return Err("Tulis arahan desain yang lo inginkan (mis. warna, mood, font, atau gaya visual).".to_string());
        }
        let title = req
            .title
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                let short: String = prompt_txt.chars().take(36).collect();
                format!("Desain Custom: {short}")
            });
        let context = format!("Arahan desain custom langsung dari user:\n\"{prompt_txt}\"");
        let ai_dna = analyze_with_byok(&app, &context, &[], &req.sampled_colors).await;
        let layer = if ai_dna.is_some() {
            "custom_ai"
        } else {
            "local_fallback"
        };
        return Ok(build_style_result(
            "prompt",
            None,
            title,
            Vec::new(),
            ai_dna,
            layer,
            prompt_txt,
            &req.sampled_colors,
        ));
    }

    // 2. URL (YouTube / Shorts OR any general web/design URL)
    if src_type == "url" || src_type == "youtube" {
        let raw_url = req.url.as_deref().unwrap_or("").trim();
        if raw_url.is_empty() {
            return Err("Tempel link referensi (YouTube, Shorts, Dribbble, Behance, atau web) terlebih dahulu.".to_string());
        }
        let normalized = normalize_url_input(raw_url);

        // 2A. YouTube / Shorts path (instant 4-frame visual extraction!)
        if let Some(video_id) = extract_youtube_video_id(&normalized) {
            let canonical_url = format!("https://www.youtube.com/watch?v={video_id}");
            let (title, author, yt_frames) =
                fetch_youtube_oembed_and_frames(&canonical_url, &video_id).await;
            let author_note = if author.is_empty() {
                String::new()
            } else {
                format!(" oleh channel \"{author}\"")
            };
            let ctx_desc = format!(
                "Video YouTube Shorts/Referensi: \"{title}\"{author_note}. URL: {normalized}. Catatan user: {notes}"
            );

            if let Some(frames) = try_yt_dlp_frame_sampler(&app, &canonical_url).await {
                let ai_dna = analyze_with_byok(&app, &ctx_desc, &frames, &req.sampled_colors).await;
                return Ok(build_style_result(
                    "youtube",
                    Some(canonical_url),
                    title,
                    frames,
                    ai_dna,
                    "yt_dlp",
                    &ctx_desc,
                    &req.sampled_colors,
                ));
            }

            if !yt_frames.is_empty() {
                let ai_dna =
                    analyze_with_byok(&app, &ctx_desc, &yt_frames, &req.sampled_colors).await;
                let layer = if ai_dna.is_some() {
                    if yt_frames.len() >= 2 {
                        "yt_4frames"
                    } else {
                        "oembed_thumbnail"
                    }
                } else {
                    "local_fallback"
                };
                return Ok(build_style_result(
                    "youtube",
                    Some(canonical_url),
                    title,
                    yt_frames,
                    ai_dna,
                    layer,
                    &ctx_desc,
                    &req.sampled_colors,
                ));
            }

            if let Some(ai_dna) = analyze_youtube_via_gemini_direct(&app, &canonical_url, &title).await {
                return Ok(build_style_result(
                    "youtube",
                    Some(canonical_url),
                    title,
                    yt_frames,
                    Some(ai_dna),
                    "gemini_direct",
                    &ctx_desc,
                    &req.sampled_colors,
                ));
            }

            let ai_dna = analyze_with_byok(&app, &ctx_desc, &yt_frames, &req.sampled_colors).await;
            return Ok(build_style_result(
                "youtube",
                Some(canonical_url),
                title,
                yt_frames,
                ai_dna,
                "oembed_thumbnail",
                &ctx_desc,
                &req.sampled_colors,
            ));
        }

        // 2B. General Web / Design URL (Dribbble, Behance, Pinterest, Figma, Canva, Website, etc.)
        if !normalized.contains('.') {
            return Err("Format link tidak valid. Masukkan URL lengkap (mis. https://...) atau gunakan tab Screenshot (Ctrl+V).".to_string());
        }

        let web_ctx = fetch_webpage_design_context(&normalized).await;
        let mut combined_colors = req.sampled_colors.clone();
        for c in web_ctx.colors {
            if !combined_colors.contains(&c) {
                combined_colors.push(c);
            }
        }
        let thumbs: Vec<String> = web_ctx.og_thumb.into_iter().collect();
        let headings_hint = if web_ctx.headings.is_empty() {
            String::new()
        } else {
            format!(" Heading utama website: [{}].", web_ctx.headings.join(" | "))
        };
        let ctx_desc = format!(
            "Halaman referensi desain: \"{}\" ({normalized}). Deskripsi: {}.{} Catatan tambahan user: {notes}",
            web_ctx.title, web_ctx.desc, headings_hint
        );
        let ai_dna = analyze_with_byok(&app, &ctx_desc, &thumbs, &combined_colors).await;
        let layer = if !thumbs.is_empty() && ai_dna.is_some() {
            "url_vision"
        } else if ai_dna.is_some() {
            "url_context"
        } else {
            "local_fallback"
        };

        let mut res = build_style_result(
            "url",
            Some(normalized),
            web_ctx.title,
            thumbs,
            ai_dna,
            layer,
            &ctx_desc,
            &combined_colors,
        );
        res.logo_data_url = web_ctx.logo_data_url;
        res.brand_headings = web_ctx.headings;
        res.brand_colors = combined_colors;
        return Ok(res);
    }

    // 3. Images / Screenshots / Local Video Clip Frames
    if req.thumbnails.is_empty() {
        return Err("Tambahkan minimal 1 gambar screenshot atau klip referensi terlebih dahulu.".to_string());
    }

    let safe_thumbs: Vec<String> = req.thumbnails.into_iter().take(4).collect();
    let title = req
        .title
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            if src_type == "local_video" {
                "Klip Referensi Lokal".to_string()
            } else {
                "Screenshot Referensi Desain".to_string()
            }
        });

    let ctx_desc = if notes.trim().is_empty() {
        format!("Referensi visual: \"{title}\" ({} gambar).", safe_thumbs.len())
    } else {
        format!(
            "Referensi visual: \"{title}\" ({} gambar). Catatan user: {}",
            safe_thumbs.len(),
            notes.trim()
        )
    };

    let ai_dna = analyze_with_byok(&app, &ctx_desc, &safe_thumbs, &req.sampled_colors).await;
    let layer = if ai_dna.is_some() {
        "vision_ai"
    } else {
        "local_fallback"
    };

    Ok(build_style_result(
        if src_type == "local_video" { "local_video" } else { "images" },
        req.url,
        title,
        safe_thumbs,
        ai_dna,
        layer,
        &ctx_desc,
        &req.sampled_colors,
    ))
}

#[tauri::command]
pub async fn extract_youtube_style_reference(
    app: AppHandle,
    url: String,
) -> Result<StyleReferenceResult, String> {
    analyze_design_reference(
        app,
        AnalyzeDesignRequest {
            source_type: "url".to_string(),
            title: None,
            url: Some(url),
            design_prompt: None,
            thumbnails: Vec::new(),
            sampled_colors: Vec::new(),
        },
    )
    .await
}

#[tauri::command]
pub async fn analyze_style_reference(
    app: AppHandle,
    req: AnalyzeStyleRequest,
) -> Result<StyleReferenceResult, String> {
    analyze_design_reference(
        app,
        AnalyzeDesignRequest {
            source_type: req.source_type,
            title: req.title,
            url: req.url,
            design_prompt: req.design_prompt,
            thumbnails: req.thumbnails,
            sampled_colors: req.sampled_colors,
        },
    )
    .await
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
        assert_eq!(
            extract_youtube_video_id("https://www.instagram.com/reel/Cxyz12345/"),
            None
        );
        assert_eq!(extract_youtube_video_id("not a url"), None);
    }

    #[test]
    fn test_html_meta_extraction() {
        let sample = r##"<html><head><title>Brand System | Behance</title>
        <meta property="og:title" content="Swiss Editorial Poster" />
        <meta property="og:image" content="https://cdn.example.com/ref.jpg" />
        <meta name="theme-color" content="#F4EFE6" /></head></html>"##;
        assert_eq!(
            extract_html_meta_content(sample, "og:title").as_deref(),
            Some("Swiss Editorial Poster")
        );
        assert_eq!(
            extract_html_meta_content(sample, "og:image").as_deref(),
            Some("https://cdn.example.com/ref.jpg")
        );
        assert_eq!(
            extract_html_meta_content(sample, "theme-color").as_deref(),
            Some("#F4EFE6")
        );
    }

    #[test]
    fn test_custom_design_enforces_wcag_contrast_and_preserves_custom_palette() {
        // Bad low-contrast AI output: white text on bright cream background
        let raw = json!({
            "customDesign": {
                "name": "Warm Cream Zine",
                "isLight": true,
                "palette": {
                    "bgTop": "#F8F4EC",
                    "bgBottom": "#EFE6D5",
                    "textPrimary": "#FAFAFA",
                    "accentPrimary": "#D946EF"
                },
                "visualStyle": {
                    "backgroundPattern": "dots",
                    "cardStyle": "brutalist",
                    "cornerStyle": "sharp",
                    "captionLook": "editorial_bar"
                }
            }
        });
        let sanitized = sanitize_custom_design_value(&raw, "Cream Zine", &[]);
        assert_eq!(sanitized.name, "Warm Cream Zine");
        assert!(sanitized.is_light);
        assert_eq!(sanitized.palette.bg_top, "#F8F4EC");
        assert_eq!(sanitized.palette.accent_primary, "#D946EF");
        // Low-contrast #FAFAFA on #F8F4EC must be automatically corrected to dark ink!
        assert_eq!(sanitized.palette.text_primary, "#12151C");
        assert_eq!(sanitized.visual_style.card_style, "brutalist");
        assert_eq!(sanitized.visual_style.background_pattern, "dots");
    }

    #[test]
    fn test_sampled_colors_create_true_custom_palette_offline() {
        let design = build_fallback_custom_design(
            "Poster Referensi",
            &["#1A0F2E".to_string(), "#FF4D8D".to_string(), "#00E5FF".to_string()],
        );
        assert!(!design.is_light);
        assert_eq!(design.palette.bg_top, "#1A0F2E");
        // Most vibrant sampled color (#00E5FF, chroma 255) is selected as accentPrimary
        assert_eq!(design.palette.accent_primary, "#00E5FF");
    }

    #[test]
    fn test_safe_utf8_prefix_never_panics_on_multibyte_boundaries() {
        let text = "Belajar coding untuk anak — seru banget! 🚀✨";
        for max_bytes in 0..=text.len() + 5 {
            let sliced = safe_utf8_prefix(text, max_bytes);
            assert!(sliced.len() <= max_bytes);
            assert!(text.starts_with(sliced));
        }
    }

    #[test]
    fn test_resolve_relative_url_handles_root_and_relative_paths() {
        assert_eq!(
            resolve_relative_url("https://junior.codepolitan.com/", "/assets/og-banner.png").as_deref(),
            Some("https://junior.codepolitan.com/assets/og-banner.png")
        );
        assert_eq!(
            resolve_relative_url("https://junior.codepolitan.com/promo/index.html", "./hero.jpg").as_deref(),
            Some("https://junior.codepolitan.com/promo/hero.jpg")
        );
        assert_eq!(
            resolve_relative_url("https://junior.codepolitan.com/", "//cdn.codepolitan.com/og.webp").as_deref(),
            Some("https://cdn.codepolitan.com/og.webp")
        );
    }

    #[test]
    fn test_extract_html_brand_colors_ranks_brand_palette() {
        let html = r##"
        <style>
            :root { --primary: #00B894; --accent: #FF9F1A; --bg: #0F172A; }
            .btn { background: #00B894; color: #FFFFFF; }
            .badge { background: #FF9F1A; border-color: #00B894; }
        </style>
        "##;
        let colors = extract_html_brand_colors(html);
        assert!(colors.contains(&"#00B894".to_string()));
        assert!(colors.contains(&"#FF9F1A".to_string()));
    }

    #[test]
    fn test_extract_stylesheet_urls_and_html_headings() {
        let html = r##"<html><head>
            <link rel="stylesheet" href="/assets/app.css" />
            <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />
        </head><body>
            <h1>Belajar Coding Anak <span>Seru</span></h1>
            <h2>Mulai dari Scratch hingga Game Sendiri</h2>
        </body></html>"##;
        let css = extract_stylesheet_urls(html, "https://junior.codepolitan.com/");
        assert_eq!(css, vec!["https://junior.codepolitan.com/assets/app.css"]);
        let headings = extract_html_headings(html);
        assert_eq!(headings[0], "Belajar Coding Anak Seru");
        assert_eq!(headings[1], "Mulai dari Scratch hingga Game Sendiri");
    }

    #[test]
    fn test_3d_diorama_detection_and_viral_shorts_caption_sanitization() {
        assert!(detect_3d_diorama_cues("anjungan minyak laut ternyata ngapung @akutahu_id"));
        assert_eq!(infer_world_preset("anjungan minyak di tengah laut"), "ocean_cross_section");
        assert_eq!(infer_world_preset("rumah di dalam lubang tanah gurun"), "desert_cutaway");
        assert_eq!(infer_world_preset("arsitek membangun atap stadion gbk"), "room_cutaway");

        let val = json!({
            "customDesign": {
                "name": "3D Ocean Explainer",
                "renderMedium": "3d_diorama",
                "worldPreset": "ocean_cross_section",
                "captionPlacement": "center_middle",
                "recommendedBgm": "cinematic_pulse",
                "hudElements": ["depth_ruler", "question_badge"],
                "visualStyle": {
                    "captionLook": "black_pill"
                }
            }
        });
        let sanitized = sanitize_custom_design_value(&val, "Anjungan minyak laut", &[]);
        assert_eq!(sanitized.render_medium, "3d_diorama");
        assert_eq!(sanitized.world_preset, "ocean_cross_section");
        assert_eq!(sanitized.caption_placement, "center_middle");
        assert_eq!(sanitized.visual_style.caption_look, "black_pill");
        assert_eq!(sanitized.recommended_bgm, "cinematic_pulse");
        assert_eq!(sanitized.hud_elements, vec!["depth_ruler", "question_badge"]);
    }
}
