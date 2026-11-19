# Synkcut — Product Truth (`PRODUCT.md`)

## Product Identity
- **Name:** Synkcut *(Sync + Cut — pronounced "Sing-kat")*
- **Tagline:** *"Suara, footage, dan motion otomatis sinkron dalam hitungan menit."*
- **Category:** Desktop Hybrid AI Video & AI Motion Editor for Windows (Tauri v2 + Rust + Canvas2D/Three.js + WebCodecs + FFmpeg LGPL Sidecar)
- **Language:** Indonesian UI with standard English video-editing terminology (`Footage`, `AI Motion`, `Hook`, `CTA`, `Scene`, `Motion`, `Transition`, `SFX`, `Backsound`, `Voiceover`, `Safe Zone`, `Preset`, `Export`, `Render`).

## Target Users & Core Job
- **Who:** Solo content creators, faceless tech/business educators, UMKM business owners, and small marketing teams in Indonesia producing high-volume short-form vertical videos (9:16 Reels, TikTok, Shorts, Ads) on standard laptops (8–16 GB RAM).
- **Problem:** Manual NLE timelines are too slow; cloud AI video SaaS tools burn credits on failed renders; developer motion workflows (Remotion, Python/Playwright animation skills) require CLI setup and produce silent clips that must be manually synced with voiceover, captions, SFX, and BGM.
- **Core Promise:** Combine **Local Footage** and **5 Native AI Motion Engines** (`Flow & Diagram`, `Motion Chart`, `Tech & UI Cards`, `Stick-Figure Story`, `3D Product Breakdown`) inside one zero-setup desktop studio — guided by optional **Style References** (YouTube link, `Ctrl+V` screenshots, or local reference clip), zero-token micro-editing, and unlimited local MP4 export without watermarks or credit burn.

## Business & Technical Constraints (v1.0 → v1.1)
- **BYOK (Bring Your Own Key):** Users bring their own Gemini, OpenAI, or OpenRouter API key stored securely in Windows Credential Manager.
- **Hybrid Local Visuals:** Every scene can use either **Local Footage** or **Native AI Motion** (100% local Canvas2D / offline Three.js — no Python, no Playwright, no Remotion CLI; `Google Flow / Seedance` remains `Coming Soon` for Phase 3).
- **Style Reference (v1.1):** Optional YouTube/Shorts link (3-layer pipeline: ephemeral `yt-dlp` 30s `≤360p` frame sampler + Gemini direct URL + `oEmbed` fallback), `Ctrl+V` / uploaded screenshots (1–3 images), or local video clip — strictly no fragile Instagram scraping.
- **Audio:** BYOK TTS (Gemini/OpenAI) / Windows Offline TTS + user's own voice auto-sync with Auto Trim Silence + 12 SFX & 6 BGM Auto-Ducking (ElevenLabs and offline Whisper in Phase 2).
- **Content Formats:** Ad/Promo (`ad_promo`), Education/Tips (`education`), Storytelling (`storytelling`), and Review/Unboxing (`review`).
- **Future Moat (Phase 2):** Community Hub with "Use as Sample / Remix" powered by lightweight `project.synk.json` blueprints.

## Surface Mode
- **Primary Mode:** `Operate` (creative desktop tool — scanability, precision, familiarity, zero decorative fluff, tool recedes so the video canvas leads).
