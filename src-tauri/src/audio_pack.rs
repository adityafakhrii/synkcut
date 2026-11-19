use serde::Serialize;
use std::f64::consts::PI;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const SAMPLE_RATE: u32 = 44_100;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioPresetMeta {
    pub id: String,
    pub label: String,
    pub category: String,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPackCatalog {
    pub sfx: Vec<AudioPresetMeta>,
    pub bgm: Vec<AudioPresetMeta>,
}

pub fn sfx_catalog() -> Vec<AudioPresetMeta> {
    vec![
        AudioPresetMeta { id: "whoosh_fast".into(), label: "Whoosh Cepat".into(), category: "Transisi".into(), duration_ms: 420 },
        AudioPresetMeta { id: "whoosh_soft".into(), label: "Whoosh Halus".into(), category: "Transisi".into(), duration_ms: 580 },
        AudioPresetMeta { id: "pop_text".into(), label: "Pop Teks".into(), category: "Teks".into(), duration_ms: 190 },
        AudioPresetMeta { id: "ding_notif".into(), label: "Ding Notif".into(), category: "Overlay".into(), duration_ms: 520 },
        AudioPresetMeta { id: "impact_boom".into(), label: "Impact Boom".into(), category: "Hook".into(), duration_ms: 750 },
        AudioPresetMeta { id: "riser".into(), label: "Riser CTA".into(), category: "CTA".into(), duration_ms: 1100 },
        AudioPresetMeta { id: "camera_shutter".into(), label: "Camera Shutter".into(), category: "Aksi".into(), duration_ms: 240 },
        AudioPresetMeta { id: "keyboard_click".into(), label: "Keyboard Click".into(), category: "UI".into(), duration_ms: 160 },
        AudioPresetMeta { id: "cash_register".into(), label: "Cash Register".into(), category: "Promo".into(), duration_ms: 680 },
        AudioPresetMeta { id: "vinyl_scratch".into(), label: "Vinyl Scratch".into(), category: "Plot Twist".into(), duration_ms: 460 },
        AudioPresetMeta { id: "glitch_zap".into(), label: "Glitch Zap".into(), category: "Transisi".into(), duration_ms: 340 },
        AudioPresetMeta { id: "swoosh_reverse".into(), label: "Swoosh Reverse".into(), category: "Transisi".into(), duration_ms: 620 },
    ]
}

pub fn bgm_catalog() -> Vec<AudioPresetMeta> {
    vec![
        AudioPresetMeta { id: "upbeat_promo".into(), label: "Upbeat Promo".into(), category: "Iklan".into(), duration_ms: 8000 },
        AudioPresetMeta { id: "lofi_education".into(), label: "Lo-Fi Edukasi".into(), category: "Edukasi".into(), duration_ms: 8000 },
        AudioPresetMeta { id: "cinematic_story".into(), label: "Cinematic Story".into(), category: "Storytelling".into(), duration_ms: 8000 },
        AudioPresetMeta { id: "tech_modern".into(), label: "Tech Modern".into(), category: "Review".into(), duration_ms: 8000 },
        AudioPresetMeta { id: "trendy_funk".into(), label: "Trendy Funk".into(), category: "Reels".into(), duration_ms: 8000 },
        AudioPresetMeta { id: "chill_aesthetic".into(), label: "Chill Aesthetic".into(), category: "Lifestyle".into(), duration_ms: 8000 },
    ]
}

/// Deterministic fast PRNG for clean repeatable filtered-noise DSP
struct SimpleRng(u64);
impl SimpleRng {
    fn new(seed: u64) -> Self {
        Self(seed.max(1))
    }
    fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let bits = (self.0 >> 11) as f64 / ((1u64 << 53) as f64);
        bits * 2.0 - 1.0
    }
}

fn encode_stereo_wav_44k(left: &[f64], right: &[f64]) -> Vec<u8> {
    let n = left.len().min(right.len());
    let channels: u16 = 2;
    let bits_per_sample: u16 = 16;
    let byte_rate: u32 = SAMPLE_RATE * u32::from(channels) * u32::from(bits_per_sample) / 8;
    let block_align: u16 = channels * bits_per_sample / 8;
    let data_size: u32 = (n * 4) as u32;
    let riff_size: u32 = 36 + data_size;

    let mut out = Vec::with_capacity(44 + data_size as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&riff_size.to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_size.to_le_bytes());

    for i in 0..n {
        let l = (left[i].clamp(-0.98, 0.98) * 32767.0) as i16;
        let r = (right[i].clamp(-0.98, 0.98) * 32767.0) as i16;
        out.extend_from_slice(&l.to_le_bytes());
        out.extend_from_slice(&r.to_le_bytes());
    }
    out
}

pub fn synthesize_sfx_wav(preset_id: &str) -> Vec<u8> {
    let sr = SAMPLE_RATE as f64;
    let dur_sec = match preset_id {
        "whoosh_fast" => 0.42,
        "whoosh_soft" => 0.58,
        "pop_text" => 0.19,
        "ding_notif" => 0.52,
        "impact_boom" => 0.75,
        "riser" => 1.10,
        "camera_shutter" => 0.24,
        "keyboard_click" => 0.16,
        "cash_register" => 0.68,
        "vinyl_scratch" => 0.46,
        "glitch_zap" => 0.34,
        "swoosh_reverse" => 0.62,
        _ => 0.40,
    };

    let len = (dur_sec * sr) as usize;
    let mut left = vec![0.0f64; len];
    let mut right = vec![0.0f64; len];
    let mut rng = SimpleRng::new(0x5A17_C0DE);
    let mut lp_l = 0.0f64;
    let mut lp_r = 0.0f64;
    let mut phase = 0.0f64;

    for i in 0..len {
        let t = i as f64 / sr;
        let p = t / dur_sec;

        let (sl, sr_val) = match preset_id {
            "whoosh_fast" | "whoosh_soft" => {
                let env = (PI * p).sin().powf(1.6);
                let cutoff = if preset_id == "whoosh_fast" {
                    0.04 + 0.35 * (PI * p).sin()
                } else {
                    0.02 + 0.16 * (PI * p).sin()
                };
                lp_l += cutoff * (rng.next_f64() - lp_l);
                lp_r += cutoff * (rng.next_f64() - lp_r);
                let pan = 0.5 + 0.35 * (p * 2.0 - 1.0);
                let body = (2.0 * PI * (110.0 + 180.0 * env) * t).sin() * 0.15;
                ((lp_l * 0.85 + body) * env * (1.2 - pan), (lp_r * 0.85 + body) * env * (0.4 + pan))
            }
            "swoosh_reverse" => {
                let env = p.powf(2.4) * (1.0 - (p - 0.92).max(0.0) / 0.08).max(0.0);
                let cutoff = 0.02 + 0.42 * p * p;
                lp_l += cutoff * (rng.next_f64() - lp_l);
                lp_r += cutoff * (rng.next_f64() - lp_r);
                (lp_l * env * 0.9, lp_r * env * 0.9)
            }
            "pop_text" => {
                let env = (-t * 24.0).exp() * (t / 0.008).min(1.0);
                let freq = 260.0 + 520.0 * (-t * 36.0).exp();
                phase += 2.0 * PI * freq / sr;
                let s = phase.sin() * env * 0.78;
                (s, s)
            }
            "ding_notif" => {
                let env1 = (-t * 7.5).exp() * (t / 0.005).min(1.0);
                let env2 = if t > 0.09 {
                    (-(t - 0.09) * 6.5).exp() * ((t - 0.09) / 0.005).min(1.0)
                } else {
                    0.0
                };
                let n1 = (2.0 * PI * 880.0 * t).sin() * 0.45 + (2.0 * PI * 1760.0 * t).sin() * 0.2;
                let n2 = (2.0 * PI * 1318.5 * t).sin() * 0.5 + (2.0 * PI * 2637.0 * t).sin() * 0.18;
                let s = n1 * env1 + n2 * env2;
                (s * 0.85, s * 0.92)
            }
            "impact_boom" => {
                let env = (-t * 4.2).exp() * (t / 0.004).min(1.0);
                let freq = 42.0 + 130.0 * (-t * 14.0).exp();
                phase += 2.0 * PI * freq / sr;
                let punch = (phase.sin() * 1.4).tanh();
                let click_env = (-t * 45.0).exp();
                lp_l += 0.25 * (rng.next_f64() - lp_l);
                let s = (punch * 0.78 + lp_l * click_env * 0.45) * env;
                (s, s)
            }
            "riser" => {
                let env = p.powf(1.8) * (1.0 - (p - 0.94).max(0.0) / 0.06).max(0.0);
                let freq = 140.0 + 920.0 * p * p;
                phase += 2.0 * PI * freq / sr;
                let saw = (phase / PI).sin() + 0.35 * (2.0 * phase).sin();
                let cutoff = 0.04 + 0.36 * p;
                lp_l += cutoff * (rng.next_f64() - lp_l);
                let s = (saw * 0.32 + lp_l * 0.55) * env;
                (s, s * 0.96)
            }
            "camera_shutter" => {
                let click1 = if t < 0.04 { (-t * 95.0).exp() } else { 0.0 };
                let click2 = if t >= 0.08 && t < 0.16 {
                    (-(t - 0.08) * 75.0).exp()
                } else {
                    0.0
                };
                let n = rng.next_f64();
                let s = (n * 0.75 + (2.0 * PI * 1900.0 * t).sin() * 0.25) * (click1 + click2 * 0.85);
                (s, s)
            }
            "keyboard_click" => {
                let env = (-t * 68.0).exp();
                let n = rng.next_f64();
                let s = (n * 0.5 + (2.0 * PI * 2400.0 * t).sin() * 0.35) * env;
                (s, s)
            }
            "cash_register" => {
                let mech = if t < 0.11 {
                    rng.next_f64() * (-t * 28.0).exp() * 0.45
                } else {
                    0.0
                };
                let bell = if t >= 0.10 {
                    let bt = t - 0.10;
                    let be = (-bt * 6.0).exp();
                    ((2.0 * PI * 2093.0 * bt).sin() * 0.45
                        + (2.0 * PI * 2637.0 * bt).sin() * 0.38
                        + (2.0 * PI * 4186.0 * bt).sin() * 0.18)
                        * be
                } else {
                    0.0
                };
                let s = mech + bell;
                (s * 0.9, s * 0.95)
            }
            "vinyl_scratch" => {
                let env = (PI * p).sin().powf(0.8);
                let freq = 220.0 + 680.0 * (2.0 * PI * 5.2 * t).sin().abs();
                phase += 2.0 * PI * freq / sr;
                let grit = (phase.sin() * 2.2).tanh() * 0.55 + rng.next_f64() * 0.12;
                let s = grit * env;
                (s, s)
            }
            "glitch_zap" => {
                let env = (1.0 - p).powf(0.7);
                let step = (t * 38.0).floor();
                let freq = 180.0 + ((step * 317.0) % 1400.0);
                phase += 2.0 * PI * freq / sr;
                let sq = if phase.sin() >= 0.0 { 0.45 } else { -0.45 };
                let s = (sq + rng.next_f64() * 0.25) * env;
                (s, s * if (step as u64) % 2 == 0 { 0.95 } else { 0.65 })
            }
            _ => (0.0, 0.0),
        };

        left[i] = sl;
        right[i] = sr_val;
    }

    encode_stereo_wav_44k(&left, &right)
}

pub fn synthesize_bgm_wav(preset_id: &str) -> Vec<u8> {
    let sr = SAMPLE_RATE as f64;
    let dur_sec = 8.0f64; // Seamless 8-second loop
    let len = (dur_sec * sr) as usize;
    let mut left = vec![0.0f64; len];
    let mut right = vec![0.0f64; len];
    let mut rng = SimpleRng::new(0xB6A1_900D);

    // 4-bar harmonic chord progressions (Hz) tailored to each mood
    let (bpm, chords, has_kick, warmth): (f64, [[f64; 3]; 4], bool, f64) = match preset_id {
        "upbeat_promo" => (
            120.0,
            [
                [261.63, 329.63, 392.00], // C
                [196.00, 246.94, 293.66], // G
                [220.00, 261.63, 329.63], // Am
                [174.61, 220.00, 261.63], // F
            ],
            true,
            0.35,
        ),
        "lofi_education" => (
            90.0,
            [
                [220.00, 261.63, 329.63], // Am7 vibe
                [174.61, 220.00, 261.63], // Fmaj7
                [261.63, 329.63, 392.00], // Cmaj7
                [196.00, 246.94, 293.66], // G6
            ],
            true,
            0.16,
        ),
        "cinematic_story" => (
            60.0,
            [
                [146.83, 220.00, 261.63], // Dm
                [116.54, 174.61, 233.08], // Bb
                [130.81, 196.00, 261.63], // C
                [146.83, 220.00, 293.66], // Dm
            ],
            false,
            0.20,
        ),
        "tech_modern" => (
            120.0,
            [
                [164.81, 246.94, 329.63], // Em
                [130.81, 196.00, 246.94], // Cmaj7
                [146.83, 220.00, 293.66], // D
                [164.81, 246.94, 392.00], // Em7
            ],
            true,
            0.28,
        ),
        "trendy_funk" => (
            120.0,
            [
                [196.00, 246.94, 293.66], // G
                [220.00, 261.63, 329.63], // Am
                [246.94, 293.66, 369.99], // Bm
                [261.63, 329.63, 392.00], // C
            ],
            true,
            0.34,
        ),
        _ => (
            90.0, // chill_aesthetic
            [
                [174.61, 220.00, 261.63], // F
                [196.00, 246.94, 293.66], // G
                [164.81, 196.00, 246.94], // Em
                [220.00, 261.63, 329.63], // Am
            ],
            false,
            0.18,
        ),
    };

    let beat_sec = 60.0 / bpm;
    let mut lp_l = 0.0f64;
    let mut lp_r = 0.0f64;

    for i in 0..len {
        let t = i as f64 / sr;
        let bar_idx = ((t / 2.0).floor() as usize).min(3);
        let chord = chords[bar_idx];
        let bar_local = t % 2.0;

        // Warm stereo pad / electric piano chord
        let chord_env = (bar_local / 0.06).min(1.0) * (1.0 - (bar_local - 1.85).max(0.0) / 0.15).max(0.0);
        let pad_l = ((2.0 * PI * chord[0] * t).sin() * 0.24
            + (2.0 * PI * chord[1] * t).sin() * 0.18
            + (2.0 * PI * chord[2] * 1.002 * t).sin() * 0.14)
            * chord_env;
        let pad_r = ((2.0 * PI * chord[0] * t).sin() * 0.24
            + (2.0 * PI * chord[1] * 0.998 * t).sin() * 0.18
            + (2.0 * PI * chord[2] * t).sin() * 0.14)
            * chord_env;

        // Subtle rhythmic pluck arpeggio
        let step_sec = beat_sec * 0.5;
        let step_idx = (t / step_sec).floor() as usize;
        let step_local = t % step_sec;
        let arp_freq = chord[step_idx % 3] * 2.0;
        let arp_env = (-step_local * 9.5).exp() * (step_local / 0.006).min(1.0);
        let arp = (2.0 * PI * arp_freq * t).sin() * arp_env * 0.14;

        // Sub-bass root pulse
        let beat_local = t % beat_sec;
        let bass_freq = chord[0] * 0.5;
        let bass = (2.0 * PI * bass_freq * t).sin() * (-beat_local * 2.6).exp() * 0.22;

        // Soft kick & subtle hi-hat for rhythmic moods
        let mut perc = 0.0;
        if has_kick {
            let kick_env = (-beat_local * 26.0).exp();
            let kick_freq = 48.0 + 75.0 * (-beat_local * 38.0).exp();
            let kick = (2.0 * PI * kick_freq * beat_local).sin() * kick_env * 0.30;

            let hat_local = t % (beat_sec * 0.5);
            let hat = rng.next_f64() * (-hat_local * 70.0).exp() * 0.055;
            perc = kick + hat;
        }

        // Smooth master low-pass warmth so BGM never clashes with voiceover frequencies
        let raw_l = pad_l + arp * 0.8 + bass + perc;
        let raw_r = pad_r + arp * 1.1 + bass + perc;
        lp_l += warmth * (raw_l - lp_l);
        lp_r += warmth * (raw_r - lp_r);

        // Seamless loop micro-fade at edges (15ms)
        let edge_fade = (t / 0.015).min(1.0) * ((dur_sec - t) / 0.015).min(1.0);
        left[i] = lp_l * edge_fade * 0.85;
        right[i] = lp_r * edge_fade * 0.85;
    }

    encode_stereo_wav_44k(&left, &right)
}

pub fn ensure_asset_file(app: &AppHandle, kind: &str, preset_id: &str) -> Result<PathBuf, String> {
    let safe_id: String = preset_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();
    if safe_id.is_empty() {
        return Err("ID preset audio tidak valid.".to_string());
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Gagal mengakses AppData: {e}"))?
        .join("audio_pack")
        .join(if kind == "bgm" { "bgm" } else { "sfx" });
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Gagal membuat folder audio_pack: {e}"))?;

    let file_path = dir.join(format!("{safe_id}.wav"));
    if !file_path.exists() {
        let bytes = if kind == "bgm" {
            synthesize_bgm_wav(&safe_id)
        } else {
            synthesize_sfx_wav(&safe_id)
        };
        std::fs::write(&file_path, bytes)
            .map_err(|e| format!("Gagal menulis file audio pack: {e}"))?;
    }

    Ok(file_path)
}

#[tauri::command]
pub fn get_audio_pack_catalog() -> AudioPackCatalog {
    AudioPackCatalog {
        sfx: sfx_catalog(),
        bgm: bgm_catalog(),
    }
}

#[tauri::command]
pub fn ensure_audio_pack_asset(
    app: AppHandle,
    kind: String,
    preset_id: String,
) -> Result<String, String> {
    let path = ensure_asset_file(&app, &kind, &preset_id)?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_12_sfx_and_6_bgm_synthesize_valid_wav() {
        for item in sfx_catalog() {
            let wav = synthesize_sfx_wav(&item.id);
            assert!(wav.len() > 1000, "SFX {} too small", item.id);
            assert_eq!(&wav[0..4], b"RIFF");
            assert_eq!(&wav[8..12], b"WAVE");
        }
        assert_eq!(sfx_catalog().len(), 12);

        for item in bgm_catalog() {
            let wav = synthesize_bgm_wav(&item.id);
            assert!(wav.len() > 100_000, "BGM {} too small", item.id);
            assert_eq!(&wav[0..4], b"RIFF");
            assert_eq!(&wav[8..12], b"WAVE");
        }
        assert_eq!(bgm_catalog().len(), 6);
    }
}
