# Synkcut

> **Suara, footage, dan motion otomatis sinkron dalam hitungan menit.**

**Synkcut** adalah aplikasi desktop **AI Video Editor** untuk *Content Creator* dan UMKM yang ingin memproduksi video pendek (Reels, TikTok, Shorts, Ads) dengan cepat—tanpa ribet timeline rumit, tanpa setup terminal/dependency teknis, dan tanpa sistem kuota kredit (*anti credit-burn*).

---

## Kenapa Synkcut?

- **Zero Blank Canvas:** Tinggal klik-klik preset (Format Konten, Style Caption, Motion, Transisi, Overlay, SFX, BGM) dan tetap bebas revisi lewat AI Copilot Chat.
- **Edit Mikro = 0 Token AI:** Ganti teks, tukar footage, geser urutan scene, atau ubah preset langsung di Scene Cards secara instan tanpa memanggil API AI lagi.
- **Lokal, Ringan & Tanpa Watermark:** Dibangun dengan **Rust + Tauri v2** (bukan Electron) sehingga ringan di laptop standar RAM 8–16 GB, dengan render MP4 lokal unlimited.
- **BYOK (Bring Your Own Key):** Bawa API key sendiri (Gemini, OpenAI, atau OpenRouter)—privasi terjaga di komputer lokal tanpa biaya langganan bulanan.

---

## Fitur Utama (v1 — Windows)

- **4 Format Konten Terpandu:** Iklan/Promo Produk, Edukasi/Tips, Storytelling/Opini, dan Review/Unboxing.
- **AI Script & 3 Opsi Hook:** Generate variasi Hook, Body, dan CTA otomatis sesuai gaya bahasa & durasi.
- **Footage Lokal + AI Multimodal Director:** AI melihat thumbnail klip lokal untuk memasangkan footage ke segmen yang paling cocok *(integrasi Google Flow / Seedance direncanakan pada fase berikutnya — Coming Soon)*.
- **TTS & Suara Sendiri Auto-Sync:** Pilih TTS (BYOK / Edge TTS) atau rekam/upload suara sendiri dengan potong jeda otomatis (*Auto Trim Silence*) dan sinkronisasi kata (*word-level timestamps*).
- **Kurasi Preset & Visual Overlay:** 5 Style Kinetic Caption, 5 Motion, 5 Transisi, 6 Visual Overlay (termasuk Native Notification Banner, Doodle Marker, Split-Screen/PiP, Auto Safe Zone TikTok/Reels), 12 SFX, dan 6 BGM (*Auto-Ducking*).
- **Hybrid Studio (Dark & Light Mode):** Scene Cards + Live Canvas Preview 9:16 + AI Copilot Chat berbasis JSON Patch + Undo/Redo.
- **My Projects & Sample Bawaan:** Semua proyek tersimpan rapi secara lokal dengan fitur duplikat & sample siap remix.

---

## Arsitektur & Tech Stack

| Lapisan | Teknologi |
| :--- | :--- |
| **Desktop Shell & Backend** | Tauri v2 (Rust), Windows Credential Manager |
| **Frontend UI** | React, TypeScript, Tailwind CSS (Impeccable *Operate* Mode) |
| **Composition Engine** | Declarative JSON Scene Graph (`project.synk.json`) |
| **Preview & Video Encode** | HTML5 Canvas / OffscreenCanvas, WebCodecs (`VideoEncoder`), Mediabunny |
| **Audio Mixing & Muxing** | FFmpeg & FFprobe Sidecar (LGPL build) |

---

## Dokumentasi & Roadmap

Seluruh riset kompetitor, spesifikasi teknis, kurasi preset, arah desain UI, dan roadmap milestone tersimpan di:
- [Master Blueprint & PRD](.docs/PRD.md)

### Status Saat Ini
- [x] Riset pasar, kompetitor, arsitektur teknis, & finalisasi PRD
- [x] Inisialisasi repositori & dokumentasi inti
- [x] **Milestone 0:** Proof of Concept (PoC) Engine Render lokal (`Tauri v2 + Rust MSVC + Canvas/WebCodecs + Mediabunny + FFmpeg LGPL Sidecar`)
- [x] **Milestone 1:** Design System Impeccable (`PRODUCT.md` + `DESIGN.md`, Dark Machined Carbon & Light Sage Mist), Onboarding BYOK (Windows Credential Manager + Tes Koneksi), & `My Projects` + 4 Sample Bawaan
- [x] **Milestone 2:** Wizard Racik Konten (3 Langkah), AI Generate 3 Opsi Hook/Body/CTA, TTS (Gemini/OpenAI/Offline) & Rekam/Upload Suara Sendiri Auto-Sync + Auto Trim Silence, Multimodal AI Director (baca thumbnail footage lokal), & AI Copilot Chat JSON Patch
- [x] **Milestone 3:** Canvas Motion, Preset & Overlay Engine (penuh: 5 Transisi visual, 6 Visual Overlay termasuk Doodle Marker & Split-Screen/B-Roll, 12 SFX + 6 BGM Audio Pack & FFmpeg Auto-Ducking)
- [x] **Milestone 4:** Hybrid Studio 3 Kolom (Scene Cards drag-drop, tambah/duplikat/hapus scene, durasi stepper, trim start per scene, shortcut keyboard), AI Copilot JSON Patch (context scene aktif, path guard, diff pill, & 1-klik batalkan), serta 5 Sample Bawaan siap remix
- [x] **Milestone 5:** Export Modal lengkap (ringkasan spec, 3-tahap progress, estimasi ETA, & tombol Batalkan), uji beban 60 detik 1080×1920 + Auto-Ducking, audit Impeccable WCAG AA (Dark & Light Mode), ikon native Synkcut, & build Windows Installer (`.msi` / `.exe`)

---

## Menjalankan Secara Lokal (Windows)

### Prasyarat Windows (Resmi Tauri v2)
1. **Microsoft C++ Build Tools** (pilih workload *"Desktop development with C++"*):
   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```
2. **Rust Toolchain MSVC** *(direkomendasikan Tauri v2)*:
   ```powershell
   rustup toolchain install stable-x86_64-pc-windows-msvc
   rustup default stable-x86_64-pc-windows-msvc
   ```

### Setup, Development & Build Installer Windows
```powershell
# 1. Install dependencies frontend
npm install

# 2. Unduh binary FFmpeg & FFprobe LGPL untuk Tauri Sidecar
npm run setup:ffmpeg

# 3. Jalankan desktop app Synkcut (mode dev)
npm run tauri dev

# 4. Build Windows Installer (.msi & NSIS .exe)
npm run tauri build
```
