# Synkcut — Design System (`DESIGN.md`)

## Visual World & Surface Mode
- **Mode:** `Operate` (Precision Native Desktop Video & Motion Studio)
- **Color Direction ("Machined Carbon & Signature Emerald"):**
  - **Dark Studio (Default — Machined Carbon):** Achromatic, studio-grade neutral obsidian and carbon surfaces (`#09090b`, `#111114`, `#18181c`) with razor-thin `rgba(255,255,255,0.075)` borders and a subtle `inset 0 1px 0` top catchlight—zero muddy green tint, zero neon rainbow outlines. Primary CTAs use **crisp pure white (`#f4f4f6`) with obsidian ink (`#09090b`)** (ala Linear / Final Cut / Raycast), while **Signature Emerald (`#10b981`)** is rationed exclusively to brand mark, active indicators, valid status dots, and subtle Onboarding atmosphere.
  - **Light Studio (First-Class Alternative — Sage Mist):** Crisp neutral daylight surfaces (`#f3f7f5` backdrop, `#ffffff` panels, `#e8f0ec` controls) paired with deep pine ink (`#0b1712`) and dignified **Deep Emerald (`#097954`)** primary CTA (5.45:1 contrast, WCAG AA compliant).

## Layout Architecture
- **Beranda (`My Projects` & `Sample Bawaan`):** Persistent Left Workspace Sidebar (`228px`) + sticky `56px` contextual toolbar + visual **9:16 Poster Grid** (default) or collision-free precision list.
- **Studio Editor (Modular Rounded Bento-Studio):**
  - Floating rounded panels (`12px` radius) separated by `10px` gaps on `--bg-app`.
  - **Slim Far-Left Icon Rail (`62px`):** `Scenes`, `Visual` *(Footage Lokal ↔ AI Motion in v1.1)*, `Caption`, `Motion`, `Audio` controlling the adjacent `276px` Left Contextual Inspector.
  - **Center Stage + Simplified 2-Row Visual Scene Strip:** 9:16 Canvas over subtle matte dot-grid, paired with a monochrome 2-row Scene Strip (Row 1: neutral carbon `Hook / Body / CTA` blocks with subtle 6px role dots + crisp white playhead; Row 2: muted `Voiceover Auto-Sync` waveform).
  - **Right Panel (`310px`) — `AI Video Director`:** Segmented tabs **`AI Director`** *(neutral machined `Apply` cards, Quick Chips, active-scene focus badge, JSON Patch diff pills + 1-click revert)* & **`AI Footage`** *(Google Flow / Seedance — `Coming Soon`)*. Final export opens via top-right **`Export MP4`** modal.

## Color System (Semantic Tokens — Verified WCAG AA)

| Token | Dark Studio *(Machined Carbon)* | Light Studio *(Sage Mist)* | Role |
| :--- | :--- | :--- | :--- |
| `--bg-app` | `#09090b` | `#f3f7f5` | Application backdrop & studio gaps |
| `--bg-panel` | `#111114` | `#ffffff` | Floating studio panels, sidebar, toolbars |
| `--bg-elevated` | `#18181c` | `#e8f0ec` | Cards, inputs, secondary buttons, scene blocks |
| `--bg-hover` | `#222228` | `#dce8e2` | Hover state on interactive surfaces |
| `--bg-canvas-well` | `#050507` | `#e4ece8` | Recessed viewport well behind 9:16 video |
| `--border-subtle` | `rgba(255, 255, 255, 0.075)` | `#d1dfd8` | Structural hairlines |
| `--border-strong` | `rgba(255, 255, 255, 0.17)` | `#b6cbc1` | Selected or focused borders |
| `--text-primary` | `#f4f4f6` | `#0b1712` | Primary copy & headings |
| `--text-secondary` | `#a1a1aa` | `#435c52` | Supporting labels & metadata |
| `--text-muted` | `#8e8e98` | `#476258` | Tertiary hints (WCAG AA ≥ 4.5:1) |
| `--cta-bg` | `#f4f4f6` | `#097954` | Primary CTA (`Export MP4`, `+ Buat Konten Baru`, `Play`) |
| `--cta-hover` | `#e4e4e7` | `#076345` | Primary CTA hover |
| `--cta-fg` | `#09090b` | `#ffffff` | Foreground on primary CTA |
| `--accent` | `#10b981` | `#097954` | Signature Emerald brand mark, active dot, status indicator |
| `--accent-soft` | `rgba(16, 185, 129, 0.12)` | `rgba(9, 121, 84, 0.10)` | Restrained active tint |
| `--ambient-wash` | `rgba(16, 185, 129, 0.11)` | `rgba(9, 121, 84, 0.07)` | Subtle top wash on Onboarding only |
| `--role-hook` | `#f59e0b` | `#d97706` | Subtle 6px dot for Hook |
| `--role-body` | `#38bdf8` | `#0284c7` | Subtle 6px dot for Body |
| `--role-cta` | `#10b981` | `#097954` | Subtle 6px dot for CTA |
| `--danger` | `#f87171` | `#dc2626` | Destructive actions & errors |

## AI Motion Canvas Themes & Safe-Stage Contract (v1.1)
Inside the rendered 9:16 video canvas (separate from the neutral Studio chrome), `AI Motion` scenes support **5 curated visual canvas themes**:
- **`carbon`:** Deep studio graphite (`#0d1016`) + crisp white ink + emerald/amber highlights.
- **`paper`:** Warm editorial off-white (`#f6f3eb`) + deep ink (`#141518`) + coral/emerald highlights.
- **`coral`:** Deep slate/charcoal with warm coral accent (`#f97066`) for high-retention explainers.
- **`mint`:** Clean sage/obsidian studio pairing with crisp mint (`#34d399`).
- **`blue`:** Precision tech navy (`#0a1524`) with sky cyan (`#38bdf8`) for engineering/data explainers.

**Strict Safe-Stage Regions (1080×1920):**
- **`0%–7%`:** Top Safe Margin & Progress Bar.
- **`10%–59%`:** Dedicated `AI Motion` stage (diagram / chart / tech card / stick-figure / 3D model) — never overlaps captions.
- **`63%–74%`:** Word-level synced Kinetic Captions (always guaranteed high contrast against all 5 canvas themes, using dark scrim/pill on light `paper` theme).
- **`75%–100%`:** TikTok/Reels Bottom UI Safe Zone.

## Strict Anti-Slop Discipline
- **Zero tinted dark chrome:** Keep Dark Studio chrome pure neutral carbon so footage and `AI Motion` canvas colors stay 100% accurate.
- **One primary focal CTA per screen:** Secondary actions (`Apply`, `Buka`, quick chips, mode switches) stay neutral machined carbon (`--bg-elevated`).
- **Legibility floor:** All interactive and content-bearing UI text must stay `≥ 11px` with `≥ 4.5:1` WCAG AA contrast (including input placeholders at `opacity: 1`).
- **No kickers/eyebrows, gradient text, decorative glass blur, or emoji icons.**

## Typography
- **UI Sans:** `IBM Plex Sans` (400, 500, 600, 700).
- **Data / Timecode Mono:** `JetBrains Mono` with `font-variant-numeric: tabular-nums` strictly for timecodes, resolutions, file sizes, ETA, latency, and JSON.
