# Synkcut — Design System (`DESIGN.md`)

## Visual World & Surface Mode
- **Mode:** `Operate` (Precision Desktop Studio)
- **Dual Theme Parity:**
  - **Dark Studio (Default):** Low-glare charcoal obsidian surfaces (`#0d0f12` canvas, `#14171d` panels, `#1c2028` interactive controls) so the 9:16 video preview dominates visual hierarchy.
  - **Light Studio (First-Class Alternative):** Crisp neutral daylight surfaces (`#f5f6f8` app shell, `#ffffff` panels, `#eef0f4` controls) with calibrated deep teal accent (`#0f766e`) for ≥4.5:1 contrast.

## Color System (Semantic Tokens)
Accent is reserved strictly for primary actions, active selections, and state indicators — never decoration.

| Token | Dark Studio | Light Studio | Role |
| :--- | :--- | :--- | :--- |
| `--bg-app` | `#0d0f12` | `#f5f6f8` | Application window backdrop |
| `--bg-panel` | `#14171d` | `#ffffff` | Primary structural panels & bars |
| `--bg-elevated` | `#1c2028` | `#eef0f4` | Controls, rows, inputs, subtle pills |
| `--bg-canvas-well` | `#090b0e` | `#e6e9ef` | Recessed viewport well behind 9:16 canvas |
| `--border-subtle` | `#242934` | `#dcdfe6` | Structural hairlines |
| `--border-strong` | `#323948` | `#c5cad4` | Focused or emphasized borders |
| `--text-primary` | `#f1f3f7` | `#111318` | Primary UI copy & headings |
| `--text-secondary` | `#9aa3b2` | `#4b5362` | Supporting metadata & labels |
| `--text-muted` | `#747e90` | `#6b7384` | Tertiary hints (≥4.5:1 where readable) |
| `--accent` | `#bef264` | `#0f766e` | Primary CTA, active selection |
| `--accent-fg` | `#0d0f12` | `#ffffff` | Foreground on accent fill |
| `--role-hook` | `#f59e0b` | `#d97706` | Scene role indicator: Hook |
| `--role-body` | `#38bdf8` | `#0284c7` | Scene role indicator: Body |
| `--role-cta` | `#34d399` | `#059669` | Scene role indicator: CTA / Payoff |
| `--danger` | `#f87171` | `#dc2626` | Destructive actions & error states |

## Typography
- **UI Sans:** `IBM Plex Sans` (400, 500, 600, 700) — industrial precision, clean legibility at 12–14px desktop density.
- **Data / Timecode Mono:** `JetBrains Mono` with `font-variant-numeric: tabular-nums` — strictly for timecodes (`00:03.2`), resolutions (`1080×1920`), file sizes, API latency, and JSON inspection. Never used as decorative costume.
- **Scale:** Fixed `rem` scale with tight ratio (12px metadata, 13px dense controls, 14px body, 16px section heading, 20px view title, 24px welcome heading).

## Craft Rules & Refusals
- **No kickers/eyebrows** above headings. Headings carry their own weight.
- **No nested cards** and no uniform icon+title+paragraph card grids as page scaffolds. Use clean structural lists/rows with hairline dividers for `My Projects`.
- **No gradient text, decorative glass blur, or zero-offset colored glows.**
- **No emoji icons** in UI labels — exclusively `lucide-react` icons at consistent stroke width (`1.75`).
- **Complete interactive states:** Every button, input, and row defines default, hover, focus-visible ring, active, disabled, loading, error, and constructive empty states.
- **Browser surfaces themed:** `::selection`, `caret-color`, `:focus-visible`, `text-underline-offset`, and scrollbars derive from the palette tokens.
- **Purposeful motion only:** 150–200ms state transitions; no page-load choreography.
