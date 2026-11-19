# Synkcut — Design System (`DESIGN.md`)

## Visual World & Surface Mode
- **Mode:** `Operate` (Precision Native Desktop Video Studio)
- **Color Direction ("Obsidian Pine & Emerald-Mint"):** Inspired by deep atmospheric emerald-black studio aesthetics—replacing cold generic blue-gray/purple AI palettes with rich pine-tinted obsidian surfaces and a crisp emerald-mint primary accent.
- **Layout Architecture:** True desktop application shell — **not** a centered marketing/SaaS web page.
  - **Beranda (`My Projects` & `Sample Bawaan`):** Persistent Left Workspace Sidebar (`228px`) + sticky `56px` contextual toolbar + visual **9:16 Poster Grid** (default) or collision-free precision list.
  - **Studio Editor (Modular Rounded Bento-Studio — Inspired by CutCut & Reelio):**
    - Floating rounded panels (`12px` radius) separated by crisp `10px` studio gaps on `--bg-app`.
    - **Slim Far-Left Icon Rail (`60px`):** `Scenes`, `Footage`, `Caption`, `Motion`, `Audio` — keeps the adjacent **Left Contextual Inspector (`276px`)** clean and uncluttered.
    - **Center Stage + Simplified 2-Row Visual Scene Strip:** 9:16 Canvas preview over subtle dot-grid matte surface, paired directly below with a **2-Row Visual Scene Strip** (Row 1: proportional `Hook / Body / CTA` blocks + scrubbable playhead; Row 2: `Voiceover Auto-Sync` waveform bar) — retaining pro editor ergonomics without 5-track NLE complexity.
    - **Right Panel (`310px`) — `AI Video Director`:** Segmented tabs **`AI Director`** *(1-click `Apply` suggestion cards, Quick Action Chips, prompt composer)* & **`AI Footage`** *(Google Flow / Seedance — `Coming Soon`)*, while final rendering lives cleanly in the top-right **`Export MP4`** modal.
  - **Visual-First Identity:** Every saved project and sample renders a **real 9:16 miniature Canvas poster** via `renderProjectFrame()` so typography style, overlays, and color accents are immediately visible.
- **Dual Theme Parity:**
  - **Dark Studio (Default — Obsidian Pine):** Deep forest-black surfaces (`#060b09` canvas well, `#0a120f` app shell, `#0f1a16` panels, `#15241e` controls) paired with crisp sage-white ink (`#eef7f3`) and signature **Emerald-Mint (`#38e59d`)** accent. Calm behind 9:16 video footage while unmistakably distinctive.
  - **Light Studio (First-Class Alternative — Sage Mist):** Harmonized daylight counterpart (`#f3f7f5` backdrop, `#ffffff` panels, `#e8f0ec` controls) paired with deep pine ink (`#0b1712`) and calibrated **Deep Emerald (`#0e9466`)** accent for ≥4.5:1 contrast.

## Color System (Semantic Tokens)
Accent is reserved strictly for primary actions, active selections, AI prompt toggles, and state indicators — never loud background decoration. All neutrals carry a subtle emerald-pine undertone so surfaces harmonize effortlessly.

| Token | Dark Studio *(Obsidian Pine)* | Light Studio *(Sage Mist)* | Role |
| :--- | :--- | :--- | :--- |
| `--bg-app` | `#0a120f` | `#f3f7f5` | Application window backdrop |
| `--bg-panel` | `#0f1a16` | `#ffffff` | Sidebar, top toolbars, structural panels |
| `--bg-elevated` | `#15241e` | `#e8f0ec` | Controls, hoverable rows, inputs, subtle pills |
| `--bg-hover` | `#1c3028` | `#dce8e2` | Hover state on rows and secondary buttons |
| `--bg-canvas-well` | `#060b09` | `#e4ece8` | Recessed viewport well behind 9:16 canvas |
| `--border-subtle` | `#1e332b` | `#d1dfd8` | Structural hairlines (applied explicitly, never raw Tailwind `divide-*` defaults) |
| `--border-strong` | `#2c4a3e` | `#b6cbc1` | Focused or emphasized borders |
| `--text-primary` | `#eef7f3` | `#0b1712` | Primary UI copy & headings |
| `--text-secondary` | `#9ab5aa` | `#435c52` | Supporting metadata & labels (tinted sage, never dead gray) |
| `--text-muted` | `#6b877c` | `#5d786d` | Tertiary hints |
| `--accent` | `#38e59d` | `#0e9466` | Primary CTA, active selection, brand mark |
| `--accent-hover` | `#2cd18d` | `#0b7d55` | Primary CTA hover |
| `--accent-fg` | `#06140e` | `#ffffff` | Foreground on accent fill |
| `--accent-soft` | `rgba(56, 229, 157, 0.12)` | `rgba(14, 148, 102, 0.10)` | Subtle active tint |
| `--ambient-wash` | `rgba(34, 154, 114, 0.16)` | `rgba(14, 148, 102, 0.08)` | Restrained atmospheric gradient on Onboarding / Empty State / AI Prompt container only |
| `--role-hook` | `#f59e0b` | `#d97706` | Scene role indicator: Hook |
| `--role-body` | `#38bdf8` | `#0284c7` | Scene role indicator: Body |
| `--role-cta` | `#38e59d` | `#0e9466` | Scene role indicator: CTA / Payoff |
| `--success` | `#38e59d` | `#059669` | Valid connections, saved states |
| `--danger` | `#f87171` | `#dc2626` | Destructive actions & error states |

### Atmospheric Restraint Rule (Desktop `Operate` Adaptation)
- The reference's soft emerald mist (`--ambient-wash`) is permitted **only** as a restrained top radial wash on focused welcome/empty surfaces (Onboarding BYOK, Empty Workspace) or around the active AI Copilot prompt box.
- Editing panels, `My Projects` grids, and the 9:16 Canvas viewport well stay **solid, crisp, and matte** so footage color accuracy is never distorted by glowing backgrounds.

## Typography
- **UI Sans:** `IBM Plex Sans` (400, 500, 600, 700) — crisp neo-grotesk precision with industrial clarity at 12–14px desktop density.
- **Data / Timecode Mono:** `JetBrains Mono` with `font-variant-numeric: tabular-nums` — strictly for timecodes (`00:03.2`), resolutions (`1080×1920`), file sizes, API latency, and JSON inspection. Never used as decorative costume.
- **Scale:** Fixed `rem` scale with tight ratio (11px badges/timecode, 12px metadata, 13px dense controls, 14px body, 16px section heading, 20px view title).

## Craft Rules & Refusals
- **No kickers/eyebrows** above headings. Headings carry their own weight.
- **No nested cards**, no duplicate text-box shelves, and no abstract colored bars standing in for real video previews.
- **No gradient text, decorative heavy glassmorphism over editing panels, or neon bloom halos.**
- **No emoji icons** in UI labels — exclusively `lucide-react` icons at consistent stroke width (`1.75`) plus bespoke SVG brand mark.
- **Strict Table Spacing:** List/table views use explicit CSS Grid track widths (`minmax(...)` + fixed `px` data tracks + `whitespace-nowrap`) to prevent numeric/date collisions at every window width.
- **Complete interactive states:** Every button, input, and row defines default, hover, focus-visible ring, active, disabled, loading, error, and constructive empty states.
- **Browser surfaces themed:** `::selection`, `caret-color`, `:focus-visible`, `text-underline-offset`, and scrollbars derive from the Obsidian Pine / Sage Mist palette tokens.
- **Purposeful motion only:** 150–200ms state transitions; no page-load choreography.
