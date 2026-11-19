# Synkcut — Product Truth (`PRODUCT.md`)

## Product Identity
- **Name:** Synkcut *(Sync + Cut — pronounced "Sing-kat")*
- **Tagline:** *"Suara, footage, dan motion otomatis sinkron dalam hitungan menit."*
- **Category:** Desktop AI Video Editor for Windows (Tauri v2 + Rust + WebCodecs + FFmpeg LGPL Sidecar)
- **Language:** Indonesian UI with standard English video-editing terminology (`Footage`, `Hook`, `CTA`, `Scene`, `Motion`, `Transition`, `SFX`, `Backsound`, `Voiceover`, `Safe Zone`, `Preset`, `Export`, `Render`).

## Target Users & Core Job
- **Who:** Solo content creators, UMKM business owners, and small marketing teams in Indonesia producing high-volume short-form vertical videos (9:16 Reels, TikTok, Shorts, Ads) on standard laptops (8–16 GB RAM).
- **Problem:** Manual NLE timelines are too slow; cloud AI video SaaS tools burn credits on failed renders; developer tools like Remotion/HyperFrames require CLI/code setup.
- **Core Promise:** Guided click-to-style presets + conversational AI refinement + zero-token micro-editing on Scene Cards + unlimited local MP4 export without watermarks or credit burn.

## Business & Technical Constraints (v1)
- **BYOK (Bring Your Own Key):** Users bring their own Gemini, OpenAI, or OpenRouter API key stored securely in Windows Credential Manager.
- **Local-First Assets:** Local footage only in v1 (`Google Flow / Seedance` visibly represented as `Coming Soon`).
- **Audio v1:** BYOK TTS / Edge TTS + user's own voice auto-sync (ElevenLabs and offline Whisper in Phase 2).
- **Content Formats:** Ad/Promo (`ad_promo`), Education/Tips (`education`), Storytelling (`storytelling`), and Review/Unboxing (`review`).
- **Future Moat (Phase 2):** Community Hub with "Use as Sample / Remix" powered by lightweight `project.synk.json` blueprints.

## Surface Mode
- **Primary Mode:** `Operate` (creative desktop tool — scanability, precision, familiarity, zero decorative fluff, tool recedes so the video canvas leads).
