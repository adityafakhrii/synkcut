use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

use crate::byok;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WordTimestamp {
    pub word: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessedAudioResult {
    pub audio_path: String,
    pub duration_ms: u64,
    pub transcript: String,
    pub words: Vec<WordTimestamp>,
    pub provider_used: String,
    pub silence_trimmed: bool,
}

/// Wrap raw 16-bit mono PCM @ 24,000 Hz into a standard 44-byte RIFF/WAVE file
pub fn pcm24k_to_wav(pcm: &[u8]) -> Vec<u8> {
    let sample_rate: u32 = 24_000;
    let channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let byte_rate: u32 = sample_rate * u32::from(channels) * u32::from(bits_per_sample) / 8;
    let block_align: u16 = channels * bits_per_sample / 8;
    let data_size: u32 = pcm.len() as u32;
    let riff_size: u32 = 36 + data_size;

    let mut wav = Vec::with_capacity(44 + pcm.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&riff_size.to_le_bytes());
    wav.extend_from_slice(b"WAVE");
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    wav.extend_from_slice(&channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&bits_per_sample.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    wav.extend_from_slice(pcm);
    wav
}

/// Deterministic character-weighted fallback alignment so caption sync never fails
pub fn align_words_proportionally(text: &str, duration_ms: u64) -> Vec<WordTimestamp> {
    let tokens: Vec<&str> = text.split_whitespace().filter(|w| !w.is_empty()).collect();
    if tokens.is_empty() || duration_ms == 0 {
        return Vec::new();
    }

    let safe_dur = duration_ms.max(500);
    let weights: Vec<f64> = tokens
        .iter()
        .map(|w| {
            let clean_len = w.chars().filter(|c| c.is_alphanumeric()).count().max(2) as f64;
            let pause_bonus = if w.ends_with('.') || w.ends_with('?') || w.ends_with('!') {
                3.0
            } else if w.ends_with(',') {
                1.5
            } else {
                0.0
            };
            clean_len + pause_bonus
        })
        .collect();
    let total_weight: f64 = weights.iter().sum::<f64>().max(1.0);

    let mut cursor = 0.0f64;
    let mut out = Vec::with_capacity(tokens.len());

    for (i, token) in tokens.iter().enumerate() {
        let span = (weights[i] / total_weight) * (safe_dur as f64);
        let start_ms = cursor.round() as u64;
        cursor += span;
        let end_ms = if i == tokens.len() - 1 {
            safe_dur
        } else {
            (cursor.round() as u64).max(start_ms + 40).min(safe_dur)
        };
        out.push(WordTimestamp {
            word: (*token).to_string(),
            start_ms,
            end_ms,
        });
    }

    out
}

fn audio_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Gagal mengakses AppData: {e}"))?
        .join("audio_cache");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Gagal membuat folder audio_cache: {e}"))?;
    Ok(dir)
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub async fn probe_audio_duration_ms(app: &AppHandle, path: &str) -> Result<u64, String> {
    let output = app
        .shell()
        .sidecar("ffprobe")
        .map_err(|e| format!("Sidecar ffprobe tidak tersedia: {e}"))?
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            path,
        ])
        .output()
        .await
        .map_err(|e| format!("Gagal menjalankan ffprobe pada audio: {e}"))?;

    if !output.status.success() {
        return Err("ffprobe gagal membaca durasi file audio.".to_string());
    }

    let val: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Gagal parse durasi audio: {e}"))?;
    let sec = val["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    Ok((sec * 1000.0).round() as u64)
}

async fn synthesize_windows_offline_wav(text: &str, out_path: &PathBuf) -> Result<(), String> {
    let safe_text = text
        .replace('\'', "''")
        .replace('\r', " ")
        .replace('\n', ". ");
    let out_str = out_path.to_string_lossy().replace('\'', "''");
    // Prefer an Indonesian voice if installed on Windows (e.g. Andika/Gadis/Ardi), else best available voice
    let script = format!(
        "Add-Type -AssemblyName System.Speech; \
         $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
         $voices = $s.GetInstalledVoices() | Where-Object {{ $_.Enabled }}; \
         $idVoice = $voices | Where-Object {{ $_.VoiceInfo.Culture.Name -like 'id*' -or $_.VoiceInfo.Name -like '*Indones*' -or $_.VoiceInfo.Name -like '*Andika*' -or $_.VoiceInfo.Name -like '*Gadis*' -or $_.VoiceInfo.Name -like '*Ardi*' }} | Select-Object -First 1; \
         if ($idVoice) {{ $s.SelectVoice($idVoice.VoiceInfo.Name) }}; \
         $s.Rate = 1; \
         $s.Volume = 100; \
         $s.SetOutputToWaveFile('{out_str}'); \
         $s.Speak('{safe_text}'); \
         $s.Dispose();"
    );

    let output = tokio::process::Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .output()
        .await
        .map_err(|e| format!("Gagal menjalankan Windows Offline TTS: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Windows Offline TTS gagal: {stderr}"));
    }
    Ok(())
}

async fn transcribe_with_gemini(
    app: &AppHandle,
    api_key: &str,
    audio_bytes: &[u8],
    mime_type: &str,
    known_script: Option<&str>,
    duration_ms: u64,
) -> Result<(String, Vec<WordTimestamp>), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;

    let b64 = BASE64.encode(audio_bytes);
    let hint = known_script
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("Referensi naskah (gunakan ejaan yang benar jika sesuai): \"{s}\""))
        .unwrap_or_default();

    let prompt = format!(
        "Transkripsikan audio Bahasa Indonesia/Inggris ini secara akurat dan berikan timestamp milidetik per kata. \
         Total durasi audio adalah {duration_ms} ms. {hint}\n\
         Balas HANYA dalam JSON valid dengan struktur:\n\
         {{\"transcript\":\"teks lengkap\",\"words\":[{{\"word\":\"kata\",\"startMs\":0,\"endMs\":320}}]}}\n\
         Pastikan semua startMs dan endMs berada di antara 0 sampai {duration_ms} dan berurutan naik."
    );

    let body = json!({
        "contents": [{
            "role": "user",
            "parts": [
                { "inlineData": { "mimeType": mime_type, "data": b64 } },
                { "text": prompt }
            ]
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1
        }
    });

    let mut candidates = vec![byok::get_gemini_model_for_app(app)];
    for fb in byok::GEMINI_FALLBACK_MODELS {
        if !candidates.iter().any(|c| c == fb) {
            candidates.push(fb.to_string());
        }
    }

    let mut raw_text_opt: Option<String> = None;
    let mut last_status = 0u16;
    for candidate in candidates {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{candidate}:generateContent?key={api_key}"
        );
        let res = match client.post(url).json(&body).send().await {
            Ok(r) => r,
            Err(e) if e.is_timeout() => {
                last_status = 504;
                continue;
            }
            Err(e) => return Err(format!("Gagal menghubungi Gemini Audio API: {e}")),
        };

        if res.status().is_success() {
            let data: serde_json::Value = crate::ai::decode_llm_http_body(res).await?;
            if let Some(txt) = crate::ai::extract_gemini_text(&data) {
                raw_text_opt = Some(txt);
                break;
            }
            continue;
        }
        last_status = res.status().as_u16();
        if !matches!(last_status, 404 | 503 | 429) {
            return Err(format!("Gemini Audio API gagal (HTTP {last_status})."));
        }
    }

    let raw_text = raw_text_opt
        .ok_or_else(|| format!("Gemini Audio API gagal (HTTP {last_status})."))?;

    let parsed = crate::ai::parse_llm_json(&raw_text)
        .map_err(|e| format!("JSON transkrip Gemini tidak valid: {e}"))?;

    let transcript = parsed["transcript"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();

    let mut words = Vec::new();
    if let Some(arr) = parsed["words"].as_array() {
        for item in arr {
            let word = item["word"].as_str().unwrap_or("").trim();
            if word.is_empty() {
                continue;
            }
            let start = item["startMs"].as_u64().unwrap_or(0).min(duration_ms);
            let end = item["endMs"]
                .as_u64()
                .unwrap_or(start + 120)
                .max(start + 30)
                .min(duration_ms);
            words.push(WordTimestamp {
                word: word.to_string(),
                start_ms: start,
                end_ms: end,
            });
        }
    }

    Ok((transcript, words))
}

async fn transcribe_with_openai_whisper(
    api_key: &str,
    audio_bytes: Vec<u8>,
    file_name: &str,
    duration_ms: u64,
) -> Result<(String, Vec<WordTimestamp>), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;

    let file_part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name(file_name.to_string())
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model", "whisper-1")
        .text("language", "id")
        .text("response_format", "verbose_json")
        .text("timestamp_granularities[]", "word");

    let res = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Gagal menghubungi OpenAI Whisper API: {e}"))?;

    if !res.status().is_success() {
        let status = res.status().as_u16();
        return Err(format!("OpenAI Whisper gagal (HTTP {status})."));
    }

    let data: serde_json::Value = crate::ai::decode_llm_http_body(res).await?;
    let transcript = data["text"].as_str().unwrap_or("").trim().to_string();

    let mut words = Vec::new();
    if let Some(arr) = data["words"].as_array() {
        for item in arr {
            let word = item["word"].as_str().unwrap_or("").trim();
            if word.is_empty() {
                continue;
            }
            let start = ((item["start"].as_f64().unwrap_or(0.0) * 1000.0).round() as u64)
                .min(duration_ms);
            let end = ((item["end"].as_f64().unwrap_or(0.0) * 1000.0).round() as u64)
                .max(start + 30)
                .min(duration_ms);
            words.push(WordTimestamp {
                word: word.to_string(),
                start_ms: start,
                end_ms: end,
            });
        }
    }

    Ok((transcript, words))
}

/// Synthesize TTS with resilient fallback chain:
/// preferred engine -> secondary configured cloud TTS -> guaranteed Windows Offline TTS.
pub async fn synthesize_tts_with_fallback(
    app: &AppHandle,
    text: &str,
    voice_name: &str,
    tone: &str,
    preferred_engine: &str,
    allow_offline_fallback: bool,
) -> Result<ProcessedAudioResult, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Teks voiceover kosong. Isi script terlebih dahulu.".to_string());
    }

    let mut engines_to_try: Vec<&str> = Vec::new();
    match preferred_engine {
        "gemini" => {
            engines_to_try.push("gemini");
            if allow_offline_fallback {
                if byok::read_stored_key("openai").is_some() {
                    engines_to_try.push("openai");
                }
                engines_to_try.push("windows_offline");
            }
        }
        "openai" => {
            engines_to_try.push("openai");
            if allow_offline_fallback {
                if byok::read_stored_key("gemini").is_some() {
                    engines_to_try.push("gemini");
                }
                engines_to_try.push("windows_offline");
            }
        }
        "auto" => {
            if byok::read_stored_key("gemini").is_some() {
                engines_to_try.push("gemini");
            }
            if byok::read_stored_key("openai").is_some() {
                engines_to_try.push("openai");
            }
            engines_to_try.push("windows_offline");
        }
        _ => {
            engines_to_try.push("windows_offline");
        }
    }

    let mut last_err = String::from("Gagal membuat suara TTS.");
    for eng in engines_to_try {
        let voice_for_eng = if eng == "openai"
            && !matches!(
                voice_name,
                "nova" | "alloy" | "onyx" | "shimmer" | "echo" | "fable" | "ash" | "coral" | "sage"
            ) {
            "nova"
        } else if eng == "gemini" && voice_name.trim().is_empty() {
            "Kore"
        } else {
            voice_name
        };

        match generate_tts_single_engine(app, trimmed, voice_for_eng, tone, eng).await {
            Ok(mut res) => {
                if eng == "windows_offline" && preferred_engine != "windows_offline" && preferred_engine != "auto" {
                    res.provider_used = format!("{} (fallback otomatis)", res.provider_used);
                }
                return Ok(res);
            }
            Err(e) => {
                last_err = e;
            }
        }
    }

    Err(last_err)
}

#[tauri::command]
pub async fn generate_tts_audio(
    app: AppHandle,
    text: String,
    voice_name: String,
    tone: String,
    engine: String,
) -> Result<ProcessedAudioResult, String> {
    synthesize_tts_with_fallback(&app, &text, &voice_name, &tone, &engine, true).await
}

async fn generate_tts_single_engine(
    app: &AppHandle,
    trimmed: &str,
    voice_name: &str,
    tone: &str,
    engine: &str,
) -> Result<ProcessedAudioResult, String> {
    let cache_dir = audio_cache_dir(app)?;
    let stamp = now_millis();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;

    let (audio_path, provider_used): (PathBuf, String) = match engine {
        "gemini" => {
            let key = byok::read_stored_key("gemini").ok_or_else(|| {
                "API Key Google Gemini belum diatur. Buka Pengaturan AI (BYOK) terlebih dahulu."
                    .to_string()
            })?;

            let tone_prompt = match tone {
                "profesional" => "Bacakan secara profesional, jelas, dan meyakinkan dalam Bahasa Indonesia:",
                "persuasif" => "Bacakan secara energik, persuasif seperti iklan video pendek dalam Bahasa Indonesia:",
                "lucu" => "Bacakan secara ekspresif, santai, dan menghibur dalam Bahasa Indonesia:",
                _ => "Bacakan secara santai, natural seperti kreator konten Indonesia:",
            };

            let selected_voice = if voice_name.trim().is_empty() {
                "Kore"
            } else {
                voice_name.trim()
            };

            let payload = json!({
                "contents": [{
                    "role": "user",
                    "parts": [{ "text": format!("{tone_prompt}\n{trimmed}") }]
                }],
                "generationConfig": {
                    "responseModalities": ["AUDIO"],
                    "speechConfig": {
                        "voiceConfig": {
                            "prebuiltVoiceConfig": {
                                "voiceName": selected_voice
                            }
                        }
                    }
                }
            });

            let tts_models = [
                "gemini-2.5-flash-preview-tts",
                "gemini-3.8-flash-lite-tts",
                "gemini-3.8-flash-tts",
                "gemini-3.1-flash-tts-preview",
            ];
            let mut b64_audio: Option<String> = None;
            let mut last_err = String::from("Gemini TTS gagal.");

            for tts_model in tts_models {
                let url = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{tts_model}:generateContent?key={key}"
                );
                let res = match client.post(url).json(&payload).send().await {
                    Ok(r) => r,
                    Err(e) => {
                        last_err = format!("Gagal menghubungi Gemini TTS API: {e}");
                        continue;
                    }
                };

                if res.status().is_success() {
                    let data: serde_json::Value = crate::ai::decode_llm_http_body(res).await?;
                    if let Some(b64) = data["candidates"][0]["content"]["parts"][0]["inlineData"]["data"].as_str() {
                        b64_audio = Some(b64.to_string());
                        break;
                    }
                    last_err = format!("Gemini TTS ({tts_model}) tidak mengembalikan data audio.");
                    continue;
                }

                let status = res.status().as_u16();
                let err_body = res.text().await.unwrap_or_default();
                last_err = format!(
                    "Gemini TTS gagal (HTTP {status}). Detail: {}",
                    err_body.chars().take(180).collect::<String>()
                );
                if !matches!(status, 404 | 503 | 429 | 400) {
                    return Err(last_err);
                }
            }

            let b64 = b64_audio.ok_or(last_err)?;

            let pcm_bytes = BASE64
                .decode(&b64)
                .map_err(|e| format!("Gagal decode audio PCM dari Gemini: {e}"))?;
            let wav_bytes = pcm24k_to_wav(&pcm_bytes);

            let out_file = cache_dir.join(format!("tts_gemini_{stamp}.wav"));
            tokio::fs::write(&out_file, &wav_bytes)
                .await
                .map_err(|e| format!("Gagal menyimpan file TTS: {e}"))?;

            (out_file, format!("Gemini TTS ({selected_voice})"))
        }
        "openai" => {
            let key = byok::read_stored_key("openai").ok_or_else(|| {
                "API Key OpenAI belum diatur. Buka Pengaturan AI (BYOK) terlebih dahulu.".to_string()
            })?;
            let selected_voice = if voice_name.trim().is_empty() {
                "nova"
            } else {
                voice_name.trim()
            };

            let payload = json!({
                "model": "gpt-4o-mini-tts",
                "voice": selected_voice,
                "input": trimmed,
                "response_format": "mp3"
            });

            let res = client
                .post("https://api.openai.com/v1/audio/speech")
                .bearer_auth(&key)
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("Gagal menghubungi OpenAI TTS API: {e}"))?;

            if !res.status().is_success() {
                let status = res.status().as_u16();
                return Err(format!("OpenAI TTS gagal (HTTP {status})."));
            }

            let bytes = res.bytes().await.map_err(|e| e.to_string())?;
            let out_file = cache_dir.join(format!("tts_openai_{stamp}.mp3"));
            tokio::fs::write(&out_file, &bytes)
                .await
                .map_err(|e| format!("Gagal menyimpan file OpenAI TTS: {e}"))?;

            (out_file, format!("OpenAI TTS ({selected_voice})"))
        }
        _ => {
            let out_file = cache_dir.join(format!("tts_win_{stamp}.wav"));
            synthesize_windows_offline_wav(trimmed, &out_file).await?;
            (out_file, "Windows Offline TTS".to_string())
        }
    };

    let path_str = audio_path.to_string_lossy().to_string();
    let duration_ms = probe_audio_duration_ms(app, &path_str)
        .await
        .unwrap_or_else(|_| ((trimmed.split_whitespace().count() as u64) * 420).max(3000));

    let mut words = align_words_proportionally(trimmed, duration_ms);
    if engine == "gemini" {
        if let Some(key) = byok::read_stored_key("gemini") {
            if let Ok(bytes) = tokio::fs::read(&audio_path).await {
                if bytes.len() <= 8 * 1024 * 1024 {
                    if let Ok((_, aligned)) =
                        transcribe_with_gemini(app, &key, &bytes, "audio/wav", Some(trimmed), duration_ms)
                            .await
                    {
                        if aligned.len() >= (trimmed.split_whitespace().count() / 2).max(1) {
                            words = aligned;
                        }
                    }
                }
            }
        }
    }

    Ok(ProcessedAudioResult {
        audio_path: path_str,
        duration_ms,
        transcript: trimmed.to_string(),
        words,
        provider_used,
        silence_trimmed: false,
    })
}

#[tauri::command]
pub async fn process_user_audio(
    app: AppHandle,
    input_path: Option<String>,
    recorded_bytes: Option<Vec<u8>>,
    recorded_ext: Option<String>,
    trim_silence: bool,
    known_script: Option<String>,
) -> Result<ProcessedAudioResult, String> {
    let cache_dir = audio_cache_dir(&app)?;
    let stamp = now_millis();

    let raw_source_path: PathBuf = if let Some(bytes) = recorded_bytes {
        let ext = recorded_ext.unwrap_or_else(|| "webm".to_string());
        let p = cache_dir.join(format!("rec_raw_{stamp}.{ext}"));
        tokio::fs::write(&p, &bytes)
            .await
            .map_err(|e| format!("Gagal menyimpan rekaman mic: {e}"))?;
        p
    } else if let Some(p) = input_path {
        PathBuf::from(p)
    } else {
        return Err("Tidak ada file audio atau rekaman mic yang diberikan.".to_string());
    };

    let processed_wav = cache_dir.join(format!("voice_sync_{stamp}.wav"));
    let src_str = raw_source_path.to_string_lossy().to_string();
    let dst_str = processed_wav.to_string_lossy().to_string();

    // Normalize audio + optional Auto Trim Silence (> 0.4s) via bundled FFmpeg LGPL sidecar
    let mut ff_args = vec![
        "-y".to_string(),
        "-i".to_string(),
        src_str,
        "-ac".to_string(),
        "1".to_string(),
        "-ar".to_string(),
        "24000".to_string(),
    ];

    if trim_silence {
        ff_args.push("-af".to_string());
        ff_args.push(
            "silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB,areverse,silenceremove=stop_periods=-1:stop_duration=0.4:stop_threshold=-38dB".to_string(),
        );
    }

    ff_args.push(dst_str.clone());

    let ff_out = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("Sidecar ffmpeg tidak tersedia: {e}"))?
        .args(&ff_args)
        .output()
        .await
        .map_err(|e| format!("Gagal memproses audio dengan FFmpeg: {e}"))?;

    if !ff_out.status.success() {
        let stderr = String::from_utf8_lossy(&ff_out.stderr);
        return Err(format!("FFmpeg gagal memproses audio: {stderr}"));
    }

    let duration_ms = probe_audio_duration_ms(&app, &dst_str).await.unwrap_or(5000);
    let wav_bytes = tokio::fs::read(&processed_wav)
        .await
        .map_err(|e| format!("Gagal membaca audio hasil proses: {e}"))?;

    let mut transcript = known_script.clone().unwrap_or_default();
    let mut words = Vec::new();
    let mut provider_used = "Local Proportional Sync".to_string();

    // Prefer BYOK Gemini Audio or OpenAI Whisper for real word-level timestamps
    let status = byok::get_byok_status(app.clone());
    if status.active_provider == "openai" {
        if let Some(key) = byok::read_stored_key("openai") {
            if let Ok((t, w)) =
                transcribe_with_openai_whisper(&key, wav_bytes.clone(), "voice.wav", duration_ms)
                    .await
            {
                if !t.is_empty() {
                    transcript = t;
                }
                if !w.is_empty() {
                    words = w;
                    provider_used = "OpenAI Whisper Auto-Sync".to_string();
                }
            }
        }
    }

    if words.is_empty() {
        if let Some(key) = byok::read_stored_key("gemini") {
            if wav_bytes.len() <= 10 * 1024 * 1024 {
                if let Ok((t, w)) = transcribe_with_gemini(
                    &app,
                    &key,
                    &wav_bytes,
                    "audio/wav",
                    known_script.as_deref(),
                    duration_ms,
                )
                .await
                {
                    if !t.is_empty() {
                        transcript = t;
                    }
                    if !w.is_empty() {
                        words = w;
                        provider_used = "Gemini Audio Auto-Sync".to_string();
                    }
                }
            }
        }
    }

    if words.is_empty() {
        let fallback_text = if transcript.trim().is_empty() {
            "Rekaman suara sendiri siap disinkronkan di Studio".to_string()
        } else {
            transcript.clone()
        };
        transcript = fallback_text.clone();
        words = align_words_proportionally(&fallback_text, duration_ms);
    }

    Ok(ProcessedAudioResult {
        audio_path: dst_str,
        duration_ms,
        transcript,
        words,
        provider_used,
        silence_trimmed: trim_silence,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pcm24k_to_wav_header() {
        let pcm = vec![0u8; 4800];
        let wav = pcm24k_to_wav(&pcm);
        assert_eq!(wav.len(), 44 + 4800);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[36..40], b"data");
    }

    #[test]
    fn test_align_words_proportionally() {
        let words = align_words_proportionally("Halo dunia, ini Synkcut!", 4000);
        assert_eq!(words.len(), 4);
        assert_eq!(words[0].start_ms, 0);
        assert_eq!(words[3].end_ms, 4000);
        assert!(words[1].start_ms >= words[0].end_ms);
    }
}
