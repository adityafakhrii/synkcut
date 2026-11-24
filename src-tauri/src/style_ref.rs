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
            preferred_engines: vec!["flow_diagram".to_string(), "tech_cards".to_string(), "motion_chart".to_string()],
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
            preferred_engines: vec!["tech_cards".to_string(), "motion_chart".to_string(), "flow_diagram".to_string()],
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
            preferred_engines: vec!["tech_cards".to_string(), "flow_diagram".to_string(), "breakdown_3d".to_string()],
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
            preferred_engines: vec!["flow_diagram".to_string(), "motion_chart".to_string(), "stick_figure".to_string()],
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
            preferred_engines: vec!["breakdown_3d".to_string(), "motion_chart".to_string(), "tech_cards".to_string()],
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
            preferred_engines: vec!["flow_diagram".to_string(), "tech_cards".to_string(), "motion_chart".to_string()],
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
        "bold_outline" | "custom_pill" | "editorial_bar" | "glass_tag" | "minimal_clean" => {
            vis.and_then(|v| v["captionLook"].as_str())
                .unwrap_or(&fb.visual_style.caption_look)
                .to_string()
        }
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

async fn fetch_webpage_design_context(
    url: &str,
) -> (String, String, Option<String>, Vec<String>) {
    let fallback_title = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("Referensi Desain Web")
        .to_string();

    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(14))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
    else {
        return (fallback_title, String::new(), None, Vec::new());
    };

    let Ok(res) = client.get(url).send().await else {
        return (fallback_title, String::new(), None, Vec::new());
    };

    if !res.status().is_success() {
        return (fallback_title, String::new(), None, Vec::new());
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
                return (
                    format!("Gambar Referensi ({fallback_title})"),
                    "Gambar referensi langsung dari URL.".to_string(),
                    Some(data_url),
                    Vec::new(),
                );
            }
        }
        return (fallback_title, String::new(), None, Vec::new());
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

    (title, desc, thumb_data_url, colors)
}

/* ==================== AI CUSTOM DESIGN GENERATOR ==================== */

fn design_system_prompt() -> &'static str {
    "Kamu adalah Art Director & Motion Systems Designer kelas dunia untuk Synkcut. \
    Tugasmu menghasilkan ARAHAN DESAIN CUSTOM (Custom Design System) yang UNIK sesuai referensi gambar, URL, atau brief user — BUKAN mengikuti template kaku! \
    Ekstrak warna asli (kode hex akurat #RRGGBB), mood terang/gelap, karakter pola latar, bentuk kartu, sudut, tipografi, gaya subtitle, serta pacing yang paling otentik terhadap referensi. \
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
          \"styleDnaSummary\": \"Ringkasan 1-2 kalimat Bahasa Indonesia tentang karakter visual, palet warna, tipografi, dan pacing desain custom ini\",\n\
          \"suggestedTheme\": \"carbon|paper|coral|mint|blue\",\n\
          \"suggestedCaption\": \"bold_pop|clean_minimal|kinetic_punch|luxury_editorial|neon_tech\",\n\
          \"suggestedAccent\": \"#HEX warna aksen utama\",\n\
          \"suggestedEngines\": [\"flow_diagram\", \"motion_chart\", \"tech_cards\", \"stick_figure\", \"breakdown_3d\"],\n\
          \"customDesign\": {{\n\
            \"name\": \"Nama gaya desain custom 2-4 kata (mis. Brutalist Warm Zine / Neon Glass Tech / Editorial Espresso)\",\n\
            \"summary\": \"Penjelasan singkat karakter desain custom ini\",\n\
            \"artDirectionNotes\": \"Instruksi konkret untuk AI Director (komposisi, suasana, kontras, ritme cut)\",\n\
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
              \"captionUppercase\": true\n\
            }},\n\
            \"visualStyle\": {{\n\
              \"backgroundPattern\": \"grid|dots|diagonal|aurora|paper_grain|minimal\",\n\
              \"cardStyle\": \"glass|solid|brutalist|hairline|neon\",\n\
              \"cornerStyle\": \"sharp|rounded|pill\",\n\
              \"captionLook\": \"bold_outline|custom_pill|editorial_bar|glass_tag|minimal_clean\"\n\
            }},\n\
            \"pacing\": \"snappy|balanced|cinematic\",\n\
            \"preferredMotion\": \"zoom_punch|smooth_ken_burns|shake_impact|slide_reveal|static_clean\",\n\
            \"preferredTransition\": \"hard_cut|whip_pan|pop_zoom|glitch_flash|smooth_crossfade\",\n\
            \"preferredEngines\": [\"flow_diagram\", \"tech_cards\", \"motion_chart\"]\n\
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

    let encoded_url = percent_encode_url_component(canonical_url);
    let oembed_url = format!("https://www.youtube.com/oembed?url={encoded_url}&format=json");
    let mut title = format!("YouTube ({video_id})");
    if let Ok(res) = client.get(&oembed_url).send().await {
        if res.status().is_success() {
            if let Ok(val) = crate::ai::decode_llm_http_body(res).await {
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

        // 2A. YouTube / Shorts path
        if let Some(video_id) = extract_youtube_video_id(&normalized) {
            let canonical_url = format!("https://www.youtube.com/watch?v={video_id}");
            let (title, oembed_thumb) = fetch_youtube_oembed_and_thumb(&canonical_url, &video_id).await;
            let ctx_desc = format!("Video YouTube: \"{title}\". Catatan user: {notes}");

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

            let fallback_thumbs: Vec<String> = oembed_thumb.into_iter().collect();

            if let Some(ai_dna) = analyze_youtube_via_gemini_direct(&app, &canonical_url, &title).await {
                return Ok(build_style_result(
                    "youtube",
                    Some(canonical_url),
                    title,
                    fallback_thumbs,
                    Some(ai_dna),
                    "gemini_direct",
                    &ctx_desc,
                    &req.sampled_colors,
                ));
            }

            let ai_dna = analyze_with_byok(&app, &ctx_desc, &fallback_thumbs, &req.sampled_colors).await;
            return Ok(build_style_result(
                "youtube",
                Some(canonical_url),
                title,
                fallback_thumbs,
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

        let (page_title, page_desc, og_thumb, page_colors) =
            fetch_webpage_design_context(&normalized).await;
        let mut combined_colors = req.sampled_colors.clone();
        for c in page_colors {
            if !combined_colors.contains(&c) {
                combined_colors.push(c);
            }
        }
        let thumbs: Vec<String> = og_thumb.into_iter().collect();
        let ctx_desc = format!(
            "Halaman referensi desain: \"{page_title}\" ({normalized}). Deskripsi: {page_desc}. Catatan tambahan user: {notes}"
        );
        let ai_dna = analyze_with_byok(&app, &ctx_desc, &thumbs, &combined_colors).await;
        let layer = if !thumbs.is_empty() && ai_dna.is_some() {
            "url_vision"
        } else if ai_dna.is_some() {
            "url_context"
        } else {
            "local_fallback"
        };

        return Ok(build_style_result(
            "url",
            Some(normalized),
            page_title,
            thumbs,
            ai_dna,
            layer,
            &ctx_desc,
            &combined_colors,
        ));
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
}
