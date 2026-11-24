export type ContentFormat = "ad_promo" | "education" | "storytelling" | "review";

export type ByokProvider = "gemini" | "openai" | "openrouter" | "custom";

export type CaptionPreset =
  | "bold_pop"
  | "clean_minimal"
  | "kinetic_punch"
  | "luxury_editorial"
  | "neon_tech";

export type MotionPreset =
  | "zoom_punch"
  | "smooth_ken_burns"
  | "shake_impact"
  | "slide_reveal"
  | "static_clean";

export type TransitionPreset =
  | "hard_cut"
  | "whip_pan"
  | "pop_zoom"
  | "glitch_flash"
  | "smooth_crossfade";

export type SceneRole = "hook" | "body" | "cta";

export type SceneVisualSource = "footage" | "motion";

export type AiMotionEngine =
  | "custom_code"
  | "flow_diagram"
  | "motion_chart"
  | "tech_cards"
  | "stick_figure"
  | "breakdown_3d";

export type MotionEmotionalIntent =
  | "playful"
  | "bold"
  | "calm"
  | "urgent"
  | "luxury"
  | "editorial";

export interface CustomCodeMotionConfig {
  /** Deterministic JS function body executed as `renderBeat(ctx, state, M)` */
  code: string;
  /** Concrete visual concept authored by the AI Storyboard Director for this beat */
  visualConcept: string;
  /** Emotional intent governing spring physics, stagger, and pacing */
  emotionalIntent?: MotionEmotionalIntent;
  /** Motion skill IDs applied to generate this beat */
  skillsUsed?: string[];
  /** Whether the code passed the 4-frame offscreen sandbox verifier */
  verified?: boolean;
  /** Optional diagnostic note from verification / auto-repair */
  verificationNote?: string;
}

export interface StoryboardBeat {
  id: string;
  role: SceneRole;
  startMs: number;
  endMs: number;
  text: string;
  title: string;
  visualConcept: string;
  emotionalIntent: MotionEmotionalIntent;
  skillsUsed: string[];
  transitionIn: TransitionPreset;
  sfx: string;
}

export interface MotionSkillInfo {
  id: string;
  name: string;
  source: string;
  category: string;
  summary: string;
  enabled: boolean;
  builtIn: boolean;
  content: string;
}

export type AiMotionTheme = "carbon" | "paper" | "coral" | "mint" | "blue";

export interface FlowDiagramConfig {
  pattern: "flow" | "spread" | "cycle" | "converge" | "compare";
  steps?: string[];
  branches?: number;
  depth?: number;
  sequence?: string[];
  center?: string;
  sources?: string[];
  direction?: "in" | "out";
  groups?: Array<{ label: string; value: number; unit?: string }>;
  highlightIndex?: number;
}

export interface MotionChartConfig {
  chartType: "bar" | "line" | "stat_counter";
  data: Array<{ label: string; value: number }>;
  prefix?: string;
  suffix?: string;
  callout?: string;
  goodDirection?: "up" | "down";
  highlightIndex?: number;
  sourceNote?: string;
}

export interface TechCardsConfig {
  layout: "staggered_steps" | "terminal_code" | "comparison_split";
  cards?: Array<{ badge?: string; title: string; detail?: string }>;
  codeTitle?: string;
  codeLines?: string[];
  highlightLine?: number;
  leftTitle?: string;
  leftItems?: string[];
  rightTitle?: string;
  rightItems?: string[];
}

export type StickFigureAction =
  | "talk"
  | "walk"
  | "point"
  | "think"
  | "idea"
  | "surprised"
  | "laugh"
  | "cheer"
  | "wave"
  | "shrug"
  | "sad";

export interface StickFigureConfig {
  setting: "room" | "office" | "street" | "classroom" | "plain";
  figures: Array<{
    id: string;
    kind: "person" | "cat" | "dog";
    x: number;
    label?: string;
    facing?: "left" | "right";
    color?: string;
  }>;
  props?: Array<{
    type: "desk" | "table" | "plant" | "phone" | "cup" | "board";
    x: number;
    text?: string;
  }>;
  beats: Array<{
    who: string;
    action: StickFigureAction;
    atSec: number;
    durationSec: number;
    toX?: number;
    say?: string;
  }>;
  arrow?: {
    fromId: string;
    toId: string;
    atSec: number;
    label?: string;
  } | null;
}

export type Breakdown3DShape =
  | "slab"
  | "frame"
  | "box"
  | "cylinder"
  | "ring"
  | "lens"
  | "sphere"
  | "capsule"
  | "cone"
  | "torus";

export type Breakdown3DMaterial =
  | "glass"
  | "aluminum"
  | "steel"
  | "gold"
  | "copper"
  | "black"
  | "white"
  | "ceramic"
  | "rubber"
  | "pcb"
  | "chip"
  | "battery"
  | "coil"
  | "lens"
  | "screen"
  | "wood"
  | "plastic"
  | "emissive";

export type Breakdown3DPresetId =
  | "smartphone"
  | "laptop"
  | "earbuds"
  | "smartwatch"
  | "custom";

export interface Breakdown3DPart {
  name: string;
  shape: Breakdown3DShape | string;
  color?: string;
  material?: Breakdown3DMaterial | string;
  level: number;
  size?: [number, number, number];
  pos?: [number, number, number];
  rot?: [number, number, number];
  radius?: number;
  inner?: number;
  wall?: number;
  text?: string;
}

export interface Breakdown3DConfig {
  presetId?: Breakdown3DPresetId;
  parts: Breakdown3DPart[];
  axis?: "y" | "x" | "z";
  spin?: number;
  spinSpeed?: number;
  gap?: number;
  elevation0?: number;
  elevation1?: number;
  zoom?: number;
}

export interface AiMotionSpec {
  engine: AiMotionEngine;
  theme: AiMotionTheme;
  title: string;
  subtitle?: string;
  takeaway?: string;
  customCode?: CustomCodeMotionConfig;
  flow?: FlowDiagramConfig;
  chart?: MotionChartConfig;
  techCards?: TechCardsConfig;
  stickFigure?: StickFigureConfig;
  breakdown3d?: Breakdown3DConfig;
}

export type DesignBackgroundPattern =
  | "grid"
  | "dots"
  | "diagonal"
  | "aurora"
  | "paper_grain"
  | "minimal";

export type DesignCardStyle = "glass" | "solid" | "brutalist" | "hairline" | "neon";

export type DesignCornerStyle = "sharp" | "rounded" | "pill";

export type DesignFontFamily = "sans" | "serif" | "mono" | "display";

export type DesignCaptionLook =
  | "bold_outline"
  | "custom_pill"
  | "editorial_bar"
  | "glass_tag"
  | "minimal_clean";

export interface CustomDesignDirection {
  name: string;
  summary: string;
  artDirectionNotes: string;
  isLight: boolean;
  palette: {
    bgTop: string;
    bgBottom: string;
    surfaceBg: string;
    surfaceBorder: string;
    textPrimary: string;
    textSecondary: string;
    accentPrimary: string;
    accentSecondary: string;
    accentInk: string;
  };
  typography: {
    headingFont: DesignFontFamily;
    bodyFont: DesignFontFamily;
    captionFont: DesignFontFamily;
    captionUppercase: boolean;
  };
  visualStyle: {
    backgroundPattern: DesignBackgroundPattern;
    cardStyle: DesignCardStyle;
    cornerStyle: DesignCornerStyle;
    captionLook: DesignCaptionLook;
  };
  pacing: "snappy" | "balanced" | "cinematic";
  preferredMotion: MotionPreset;
  preferredTransition: TransitionPreset;
  preferredEngines: AiMotionEngine[];
}

export interface ProjectStyleReference {
  sourceType: "youtube" | "images" | "local_video" | "url" | "prompt";
  url?: string;
  title?: string;
  thumbnails: string[];
  styleDnaSummary: string;
  logoDataUrl?: string | null;
  brandHeadings?: string[];
  brandColors?: string[];
  customDesign?: CustomDesignDirection | null;
}

export interface FootageLibraryItem {
  path: string;
  fileName: string;
  durationMs: number;
  width?: number;
  height?: number;
}

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

export interface SceneOverlay {
  id: string;
  type:
    | "hook_headline"
    | "notification_banner"
    | "promo_badge"
    | "doodle_highlight"
    | "split_screen";
  title?: string;
  text: string;
  position: "top" | "center" | "bottom";
}

export interface SceneSfx {
  preset: string;
  offsetMs: number;
  volume: number;
}

export interface SceneItem {
  id: string;
  role: SceneRole;
  startMs: number;
  endMs: number;
  text: string;
  visualSource?: SceneVisualSource;
  aiMotion?: AiMotionSpec | null;
  media: {
    path: string | null;
    secondaryPath?: string | null;
    trimStartMs: number;
    fit: "cover" | "contain";
  };
  motion: {
    preset: MotionPreset;
    intensity: number;
  };
  transitionIn: {
    preset: TransitionPreset;
    durationMs: number;
  };
  sfx: SceneSfx[];
  overlays: SceneOverlay[];
}

export interface SynkcutProject {
  version: "1.0" | "1.1" | "2.0";
  meta: {
    id: string;
    name: string;
    format: ContentFormat;
    aspectRatio: "9:16";
    fps: 30 | 60;
    createdAt?: string;
    updatedAt?: string;
  };
  styleReference?: ProjectStyleReference | null;
  footageLibrary?: FootageLibraryItem[];
  globalStyle: {
    captionPreset: CaptionPreset;
    accentColor: string;
    showProgressBar: boolean;
    customDesign?: CustomDesignDirection | null;
    bgm: {
      preset: string;
      volume: number;
      autoDucking: boolean;
    };
    safeZone: "tiktok_reels" | "none";
  };
  voiceover: {
    source: "tts" | "recorded" | "demo";
    audioPath: string | null;
    trimSilence: boolean;
    words: WordTimestamp[];
  };
  scenes: SceneItem[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  format: ContentFormat;
  captionPreset: CaptionPreset;
  accentColor: string;
  hookText: string;
  firstOverlayType: string | null;
  firstOverlayTitle: string | null;
  firstOverlayText: string | null;
  sceneCount: number;
  durationMs: number;
  hasFootage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderKeyInfo {
  configured: boolean;
  maskedKey: string | null;
  model?: string;
  baseUrl?: string | null;
}

export interface ByokStatus {
  activeProvider: ByokProvider;
  onboardingCompleted: boolean;
  providers: Record<ByokProvider, ProviderKeyInfo>;
}

export interface ConnectionTestResult {
  ok: boolean;
  provider: ByokProvider;
  latencyMs: number;
  message: string;
  detail: string | null;
  resolvedModel?: string | null;
}

export const CONTENT_FORMAT_LABELS: Record<
  ContentFormat,
  { label: string; shortDesc: string; structure: string }
> = {
  ad_promo: {
    label: "Iklan / Promo",
    shortDesc: "Jualan produk, flash sale, atau penawaran jasa",
    structure: "Hook Masalah → Demo & Bukti → CTA",
  },
  education: {
    label: "Edukasi / Tips",
    shortDesc: "Tutorial singkat, poin 1-2-3, atau insight cepat",
    structure: "Hook Penasaran → Poin Inti → Save / Share",
  },
  storytelling: {
    label: "Storytelling",
    shortDesc: "Cerita pengalaman, opini tajam, atau studi kasus",
    structure: "Hook Relatable → Cerita → Payoff",
  },
  review: {
    label: "Review / Unboxing",
    shortDesc: "Kesan pertama, detail produk, dan rekomendasi jujur",
    structure: "Hook Kesan → Highlight → Verdict",
  },
};
