import type {
  AiMotionEngine,
  AiMotionSpec,
  AiMotionTheme,
  Breakdown3DPresetId,
  CaptionPreset,
  ContentFormat,
  CustomDesignDirection,
  DesignBackgroundPattern,
  DesignCaptionLook,
  DesignCardStyle,
  DesignCornerStyle,
  DesignFontFamily,
  FootageLibraryItem,
  MotionPreset,
  SceneItem,
  SceneOverlay,
  SceneRole,
  SceneSfx,
  StickFigureAction,
  SynkcutProject,
  TransitionPreset,
  WordTimestamp,
} from "../types/scene";
import { rebuildWordsFromScenes } from "./sampleProject";
import { createBreakdown3DPreset, createDefaultAiMotion } from "./aiMotionPresets";

const MIN_SCENE_DURATION_MS = 800;
const MAX_SCENE_DURATION_MS = 20000;

const VALID_FORMATS: ContentFormat[] = ["ad_promo", "education", "storytelling", "review"];
const VALID_CAPTIONS: CaptionPreset[] = [
  "bold_pop",
  "clean_minimal",
  "kinetic_punch",
  "luxury_editorial",
  "neon_tech",
];
const VALID_MOTIONS: MotionPreset[] = [
  "zoom_punch",
  "smooth_ken_burns",
  "shake_impact",
  "slide_reveal",
  "static_clean",
];
const VALID_TRANSITIONS: TransitionPreset[] = [
  "hard_cut",
  "whip_pan",
  "pop_zoom",
  "glitch_flash",
  "smooth_crossfade",
];
const VALID_ROLES: SceneRole[] = ["hook", "body", "cta"];
const VALID_ENGINES: AiMotionEngine[] = [
  "hyperframe",
  "diorama_3d",
  "custom_code",
  "flow_diagram",
  "motion_chart",
  "tech_cards",
  "stick_figure",
  "breakdown_3d",
];
const VALID_THEMES: AiMotionTheme[] = ["carbon", "paper", "coral", "mint", "blue"];
const VALID_OVERLAY_TYPES: SceneOverlay["type"][] = [
  "hook_headline",
  "notification_banner",
  "promo_badge",
  "doodle_highlight",
  "split_screen",
];
const VALID_STICK_ACTIONS: StickFigureAction[] = [
  "talk",
  "walk",
  "point",
  "think",
  "idea",
  "surprised",
  "laugh",
  "cheer",
  "wave",
  "shrug",
  "sad",
];
const VALID_PATTERNS: DesignBackgroundPattern[] = [
  "grid",
  "dots",
  "diagonal",
  "aurora",
  "paper_grain",
  "minimal",
];
const VALID_CARD_STYLES: DesignCardStyle[] = [
  "glass",
  "solid",
  "brutalist",
  "hairline",
  "neon",
];
const VALID_CORNERS: DesignCornerStyle[] = ["sharp", "rounded", "pill"];
const VALID_FONTS: DesignFontFamily[] = ["sans", "serif", "mono", "display"];
const VALID_CAPTION_LOOKS: DesignCaptionLook[] = [
  "bold_outline",
  "black_pill",
  "outline_bold",
  "clean_shadow",
  "custom_pill",
  "editorial_bar",
  "glass_tag",
  "minimal_clean",
];

function asStr(val: unknown, fallback = ""): string {
  if (typeof val === "string") return val;
  if (typeof val === "number" && Number.isFinite(val)) return String(val);
  return fallback;
}

function asNum(val: unknown, fallback: number): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[^0-9.\-]/g, "");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asHexColor(val: unknown, fallback: string): string {
  if (typeof val !== "string") return fallback;
  const trimmed = val.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return trimmed;
  }
  if (/^rgba?\(/i.test(trimmed)) return trimmed;
  return fallback;
}

function pickEnum<T extends string>(val: unknown, allowed: readonly T[], fallback: T): T {
  return typeof val === "string" && (allowed as readonly string[]).includes(val)
    ? (val as T)
    : fallback;
}

export function sanitizeCustomDesign(raw: unknown): CustomDesignDirection | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const pal = (obj.palette && typeof obj.palette === "object"
    ? obj.palette
    : {}) as Record<string, unknown>;
  const typo = (obj.typography && typeof obj.typography === "object"
    ? obj.typography
    : {}) as Record<string, unknown>;
  const vis = (obj.visualStyle && typeof obj.visualStyle === "object"
    ? obj.visualStyle
    : {}) as Record<string, unknown>;

  const isLight = Boolean(obj.isLight);
  const enginesRaw = Array.isArray(obj.preferredEngines) ? obj.preferredEngines : [];
  const preferredEngines = enginesRaw.filter((e): e is AiMotionEngine =>
    typeof e === "string" && (VALID_ENGINES as readonly string[]).includes(e)
  );

  return {
    name: asStr(obj.name, "Custom Art Direction").trim() || "Custom Art Direction",
    summary: asStr(obj.summary, "Arahan desain visual kustom sesuai referensi.").trim(),
    artDirectionNotes: asStr(obj.artDirectionNotes, "").trim(),
    isLight,
    palette: {
      bgTop: asHexColor(pal.bgTop, isLight ? "#F6F1E7" : "#0B0E14"),
      bgBottom: asHexColor(pal.bgBottom, isLight ? "#E8DFCF" : "#151B28"),
      surfaceBg: asHexColor(
        pal.surfaceBg,
        isLight ? "rgba(255,255,255,0.88)" : "rgba(24,29,40,0.86)"
      ),
      surfaceBorder: asHexColor(
        pal.surfaceBorder,
        isLight ? "rgba(20,22,28,0.16)" : "rgba(255,255,255,0.16)"
      ),
      textPrimary: asHexColor(pal.textPrimary, isLight ? "#14161C" : "#F5F7FA"),
      textSecondary: asHexColor(pal.textSecondary, isLight ? "#4E5566" : "#9BA6BA"),
      accentPrimary: asHexColor(pal.accentPrimary, "#38E59D"),
      accentSecondary: asHexColor(pal.accentSecondary, "#F59E0B"),
      accentInk: asHexColor(pal.accentInk, isLight ? "#FFFFFF" : "#07130E"),
    },
    typography: {
      headingFont: pickEnum(typo.headingFont, VALID_FONTS, "sans"),
      bodyFont: pickEnum(typo.bodyFont, VALID_FONTS, "sans"),
      captionFont: pickEnum(typo.captionFont, VALID_FONTS, "sans"),
      captionUppercase:
        typeof typo.captionUppercase === "boolean" ? typo.captionUppercase : true,
    },
    visualStyle: {
      backgroundPattern: pickEnum(vis.backgroundPattern, VALID_PATTERNS, "grid"),
      cardStyle: pickEnum(vis.cardStyle, VALID_CARD_STYLES, "glass"),
      cornerStyle: pickEnum(vis.cornerStyle, VALID_CORNERS, "rounded"),
      captionLook: pickEnum(vis.captionLook, VALID_CAPTION_LOOKS, "bold_outline"),
    },
    pacing: pickEnum(obj.pacing, ["snappy", "balanced", "cinematic"] as const, "balanced"),
    preferredMotion: pickEnum(obj.preferredMotion, VALID_MOTIONS, "zoom_punch"),
    preferredTransition: pickEnum(obj.preferredTransition, VALID_TRANSITIONS, "pop_zoom"),
    preferredEngines:
      preferredEngines.length > 0 ? preferredEngines : ["custom_code"],
    renderMedium: pickEnum(
      obj.renderMedium,
      ["hyperframe", "3d_diorama", "2d_freeform", "footage_montage"] as const,
      "hyperframe"
    ),
    worldPreset: typeof obj.worldPreset === "string" ? obj.worldPreset : "auto",
    captionPlacement: pickEnum(
      obj.captionPlacement,
      ["center_middle", "bottom_safe"] as const,
      "bottom_safe"
    ),
    hudElements: Array.isArray(obj.hudElements)
      ? obj.hudElements.map((x) => asStr(x, "").trim()).filter(Boolean)
      : [],
    recommendedBgm: typeof obj.recommendedBgm === "string" ? obj.recommendedBgm : "upbeat_promo",
  };
}

export function sanitizeAiMotionSpec(
  raw: unknown,
  fallbackText = "AI Motion"
): AiMotionSpec {
  if (!raw || typeof raw !== "object") {
    return createDefaultAiMotion("custom_code", "carbon", fallbackText);
  }
  const obj = raw as Record<string, unknown>;
  const engine = pickEnum(obj.engine, VALID_ENGINES, "custom_code");
  const theme = pickEnum(obj.theme, VALID_THEMES, "carbon");
  const base = createDefaultAiMotion(engine, theme, fallbackText);

  const title = asStr(obj.title, base.title).trim() || base.title;
  const subtitle = typeof obj.subtitle === "string" ? obj.subtitle : base.subtitle;
  const takeaway = typeof obj.takeaway === "string" ? obj.takeaway : base.takeaway;

  const spec: AiMotionSpec = {
    engine,
    theme,
    title,
    subtitle,
    takeaway,
  };

  if (engine === "hyperframe") {
    // HyperFrames v3 scenes render via project.hyperframe deterministic HTML composition
  } else if (engine === "diorama_3d") {
    const rawD3 = (obj.diorama3d && typeof obj.diorama3d === "object"
      ? obj.diorama3d
      : {}) as Record<string, unknown>;
    const skillsRaw = Array.isArray(rawD3.skillsUsed) ? rawD3.skillsUsed : [];
    const skillsUsed = skillsRaw
      .map((s) => asStr(s, "").trim())
      .filter(Boolean);
    spec.diorama3d = {
      setupCode: typeof rawD3.setupCode === "string" ? rawD3.setupCode : undefined,
      animateCode: typeof rawD3.animateCode === "string" ? rawD3.animateCode : undefined,
      visualConcept:
        asStr(rawD3.visualConcept, "").trim() ||
        `Visual 3D Diorama untuk: ${title}`,
      worldPreset: asStr(rawD3.worldPreset, "ground_cutaway"),
      cameraNote: typeof rawD3.cameraNote === "string" ? rawD3.cameraNote : undefined,
      skillsUsed: skillsUsed.length > 0 ? skillsUsed : ["3d-diorama-storytelling"],
      verified: typeof rawD3.verified === "boolean" ? rawD3.verified : false,
      verificationNote:
        typeof rawD3.verificationNote === "string" ? rawD3.verificationNote : undefined,
    };
  } else if (engine === "custom_code") {
    const rawCc = (obj.customCode && typeof obj.customCode === "object"
      ? obj.customCode
      : {}) as Record<string, unknown>;
    const skillsRaw = Array.isArray(rawCc.skillsUsed) ? rawCc.skillsUsed : [];
    const skillsUsed = skillsRaw
      .map((s) => asStr(s, "").trim())
      .filter(Boolean);
    spec.customCode = {
      code: asStr(rawCc.code, ""),
      visualConcept:
        asStr(rawCc.visualConcept, "").trim() ||
        `Visual motion kustom untuk: ${title}`,
      emotionalIntent: pickEnum(
        rawCc.emotionalIntent,
        ["playful", "bold", "calm", "urgent", "luxury", "editorial"] as const,
        "bold"
      ),
      skillsUsed:
        skillsUsed.length > 0
          ? skillsUsed
          : ["motion-craft-physics", "kinetic-typography"],
      verified: typeof rawCc.verified === "boolean" ? rawCc.verified : false,
      verificationNote:
        typeof rawCc.verificationNote === "string" ? rawCc.verificationNote : undefined,
    };
  } else if (engine === "flow_diagram") {
    const rawFlow = (obj.flow && typeof obj.flow === "object"
      ? obj.flow
      : {}) as Record<string, unknown>;
    const pattern = pickEnum(
      rawFlow.pattern,
      ["flow", "spread", "cycle", "converge", "compare"] as const,
      "flow"
    );
    const stepsRaw = Array.isArray(rawFlow.steps) ? rawFlow.steps : [];
    const steps = stepsRaw
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          return asStr(o.label ?? o.title ?? o.text ?? o.name, "").trim();
        }
        return "";
      })
      .filter(Boolean);

    const sourcesRaw = Array.isArray(rawFlow.sources) ? rawFlow.sources : [];
    const sources = sourcesRaw
      .map((s) => asStr(s, "").trim())
      .filter(Boolean);

    const groupsRaw = Array.isArray(rawFlow.groups) ? rawFlow.groups : [];
    const groups = groupsRaw
      .filter((g): g is Record<string, unknown> => Boolean(g && typeof g === "object"))
      .map((g, idx) => ({
        label: asStr(g.label ?? g.name ?? g.title, `Opsi ${idx + 1}`),
        value: asNum(g.value, 50),
        unit: typeof g.unit === "string" ? g.unit : undefined,
      }));

    spec.flow = {
      ...base.flow!,
      pattern,
      steps: steps.length > 0 ? steps : base.flow!.steps,
      branches: Math.max(2, Math.min(4, Math.round(asNum(rawFlow.branches, 3)))),
      depth: Math.max(2, Math.min(4, Math.round(asNum(rawFlow.depth, 3)))),
      sequence: Array.isArray(rawFlow.sequence)
        ? rawFlow.sequence.map((s) => asStr(s, "")).filter(Boolean)
        : base.flow!.sequence,
      center: asStr(rawFlow.center, base.flow!.center || "Hasil"),
      sources: sources.length > 0 ? sources : base.flow!.sources,
      direction: rawFlow.direction === "out" ? "out" : "in",
      groups: groups.length > 0 ? groups : base.flow!.groups,
      highlightIndex:
        typeof rawFlow.highlightIndex === "number" ? rawFlow.highlightIndex : undefined,
    };
  } else if (engine === "motion_chart") {
    const rawChart = (obj.chart && typeof obj.chart === "object"
      ? obj.chart
      : {}) as Record<string, unknown>;
    const chartType = pickEnum(
      rawChart.chartType,
      ["bar", "line", "stat_counter"] as const,
      "bar"
    );
    const dataRaw = Array.isArray(rawChart.data)
      ? rawChart.data
      : Array.isArray(rawChart.items)
        ? rawChart.items
        : [];
    const data = dataRaw
      .filter((d): d is Record<string, unknown> => Boolean(d && typeof d === "object"))
      .map((d, idx) => ({
        label: asStr(d.label ?? d.name ?? d.category ?? d.x, `Item ${idx + 1}`),
        value: asNum(d.value ?? d.y ?? d.amount, 50),
      }));

    spec.chart = {
      chartType,
      data: data.length > 0 ? data : base.chart!.data,
      prefix: typeof rawChart.prefix === "string" ? rawChart.prefix : "",
      suffix: typeof rawChart.suffix === "string" ? rawChart.suffix : "",
      callout:
        typeof rawChart.callout === "string"
          ? rawChart.callout
          : rawChart.callout === null
            ? ""
            : "auto",
      goodDirection: rawChart.goodDirection === "down" ? "down" : "up",
      highlightIndex:
        typeof rawChart.highlightIndex === "number" && Number.isFinite(rawChart.highlightIndex)
          ? rawChart.highlightIndex
          : undefined,
      sourceNote: typeof rawChart.sourceNote === "string" ? rawChart.sourceNote : undefined,
    };
  } else if (engine === "tech_cards") {
    const rawTech = (obj.techCards && typeof obj.techCards === "object"
      ? obj.techCards
      : {}) as Record<string, unknown>;
    const layout = pickEnum(
      rawTech.layout,
      ["staggered_steps", "terminal_code", "comparison_split"] as const,
      "staggered_steps"
    );
    const cardsRaw = Array.isArray(rawTech.cards) ? rawTech.cards : [];
    const cards = cardsRaw
      .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object"))
      .map((c, idx) => ({
        badge: asStr(c.badge, `0${idx + 1}`),
        title: asStr(c.title ?? c.label ?? c.name, `Poin ${idx + 1}`),
        detail: typeof c.detail === "string" ? c.detail : typeof c.description === "string" ? c.description : "",
      }));
    const codeLines = Array.isArray(rawTech.codeLines)
      ? rawTech.codeLines.map((l) => asStr(l, "")).filter(Boolean)
      : [];
    const leftItems = Array.isArray(rawTech.leftItems)
      ? rawTech.leftItems.map((l) => asStr(l, "")).filter(Boolean)
      : [];
    const rightItems = Array.isArray(rawTech.rightItems)
      ? rawTech.rightItems.map((l) => asStr(l, "")).filter(Boolean)
      : [];

    spec.techCards = {
      ...base.techCards!,
      layout,
      cards: cards.length > 0 ? cards : base.techCards!.cards,
      codeTitle: asStr(rawTech.codeTitle, base.techCards!.codeTitle || "app.ts"),
      codeLines: codeLines.length > 0 ? codeLines : base.techCards!.codeLines,
      highlightLine:
        typeof rawTech.highlightLine === "number" ? rawTech.highlightLine : base.techCards!.highlightLine,
      leftTitle: asStr(rawTech.leftTitle, base.techCards!.leftTitle || "Sebelum"),
      leftItems: leftItems.length > 0 ? leftItems : base.techCards!.leftItems,
      rightTitle: asStr(rawTech.rightTitle, base.techCards!.rightTitle || "Sesudah"),
      rightItems: rightItems.length > 0 ? rightItems : base.techCards!.rightItems,
    };
  } else if (engine === "stick_figure") {
    const rawStick = (obj.stickFigure && typeof obj.stickFigure === "object"
      ? obj.stickFigure
      : {}) as Record<string, unknown>;
    const setting = pickEnum(
      rawStick.setting,
      ["room", "office", "street", "classroom", "plain"] as const,
      "office"
    );
    const figsRaw = Array.isArray(rawStick.figures) ? rawStick.figures : [];
    const figures = figsRaw
      .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === "object"))
      .map((f, idx) => ({
        id: asStr(f.id, `fig_${idx + 1}`),
        kind: pickEnum(f.kind, ["person", "cat", "dog"] as const, "person"),
        x: Math.max(0.14, Math.min(0.86, asNum(f.x, idx === 0 ? 0.28 : 0.72))),
        label: asStr(f.label, `Karakter ${idx + 1}`),
        facing:
          f.facing === "left"
            ? ("left" as const)
            : f.facing === "right"
              ? ("right" as const)
              : undefined,
        color: typeof f.color === "string" ? f.color : undefined,
      }));
    const safeFigures = figures.length > 0 ? figures : base.stickFigure!.figures;

    const beatsRaw = Array.isArray(rawStick.beats) ? rawStick.beats : [];
    const beats = beatsRaw
      .filter((b): b is Record<string, unknown> => Boolean(b && typeof b === "object"))
      .map((b, idx) => ({
        who: asStr(b.who, safeFigures[0].id),
        action: pickEnum(b.action, VALID_STICK_ACTIONS, "talk"),
        atSec: Math.max(0, asNum(b.atSec, idx * 0.9)),
        durationSec: Math.max(0.4, asNum(b.durationSec, 1.4)),
        toX: typeof b.toX === "number" ? b.toX : undefined,
        say: typeof b.say === "string" ? b.say : undefined,
      }));

    const propsRaw = Array.isArray(rawStick.props) ? rawStick.props : [];
    const props = propsRaw
      .filter((pr): pr is Record<string, unknown> => Boolean(pr && typeof pr === "object"))
      .map((pr) => ({
        type: pickEnum(
          pr.type,
          ["desk", "table", "plant", "phone", "cup", "board"] as const,
          "desk"
        ),
        x: Math.max(0.08, Math.min(0.92, asNum(pr.x, 0.25))),
        text: typeof pr.text === "string" ? pr.text : undefined,
      }));

    const rawArrow = rawStick.arrow && typeof rawStick.arrow === "object"
      ? (rawStick.arrow as Record<string, unknown>)
      : null;

    spec.stickFigure = {
      setting,
      figures: safeFigures,
      props: props.length > 0 ? props : base.stickFigure!.props,
      beats: beats.length > 0 ? beats : base.stickFigure!.beats,
      arrow: rawArrow
        ? {
            fromId: asStr(rawArrow.fromId, safeFigures[0].id),
            toId: asStr(rawArrow.toId, safeFigures[safeFigures.length - 1].id),
            atSec: Math.max(0, asNum(rawArrow.atSec, 0.7)),
            label: typeof rawArrow.label === "string" ? rawArrow.label : undefined,
          }
        : null,
    };
  } else if (engine === "breakdown_3d") {
    const raw3d = (obj.breakdown3d && typeof obj.breakdown3d === "object"
      ? obj.breakdown3d
      : {}) as Record<string, unknown>;
    const presetId = pickEnum<Breakdown3DPresetId>(
      raw3d.presetId,
      ["smartphone", "laptop", "earbuds", "smartwatch", "custom"] as const,
      "smartphone"
    );
    const presetFallback = createBreakdown3DPreset(
      presetId === "custom" ? "smartphone" : presetId
    ).config;

    const partsRaw = Array.isArray(raw3d.parts) ? raw3d.parts : [];
    const parts = partsRaw
      .filter((pt): pt is Record<string, unknown> => Boolean(pt && typeof pt === "object"))
      .map((pt, idx) => {
        const sizeArr = Array.isArray(pt.size) && pt.size.length === 3
          ? ([asNum(pt.size[0], 60), asNum(pt.size[1], 3), asNum(pt.size[2], 120)] as [
              number,
              number,
              number,
            ])
          : undefined;
        const posArr = Array.isArray(pt.pos) && pt.pos.length === 3
          ? ([asNum(pt.pos[0], 0), asNum(pt.pos[1], idx * 3), asNum(pt.pos[2], 0)] as [
              number,
              number,
              number,
            ])
          : undefined;
        const rotArr = Array.isArray(pt.rot) && pt.rot.length === 3
          ? ([asNum(pt.rot[0], 0), asNum(pt.rot[1], 0), asNum(pt.rot[2], 0)] as [
              number,
              number,
              number,
            ])
          : undefined;
        return {
          name: asStr(pt.name, `Komponen ${idx + 1}`),
          shape: asStr(pt.shape, "slab"),
          color: typeof pt.color === "string" ? pt.color : undefined,
          material: asStr(pt.material, "plastic"),
          level: asNum(pt.level, idx),
          size: sizeArr,
          pos: posArr,
          rot: rotArr,
          radius: typeof pt.radius === "number" ? pt.radius : undefined,
          inner: typeof pt.inner === "number" ? pt.inner : undefined,
          wall: typeof pt.wall === "number" ? pt.wall : undefined,
          text: typeof pt.text === "string" ? pt.text : undefined,
        };
      });

    spec.breakdown3d = {
      ...presetFallback,
      presetId,
      axis: pickEnum(raw3d.axis, ["y", "x", "z"] as const, presetFallback.axis || "y"),
      spin: typeof raw3d.spin === "number" ? raw3d.spin : presetFallback.spin,
      spinSpeed: typeof raw3d.spinSpeed === "number" ? raw3d.spinSpeed : presetFallback.spinSpeed,
      gap: typeof raw3d.gap === "number" && raw3d.gap > 0 ? raw3d.gap : undefined,
      elevation0:
        typeof raw3d.elevation0 === "number" ? raw3d.elevation0 : presetFallback.elevation0,
      elevation1:
        typeof raw3d.elevation1 === "number" ? raw3d.elevation1 : presetFallback.elevation1,
      zoom: typeof raw3d.zoom === "number" && raw3d.zoom > 0 ? raw3d.zoom : 1,
      parts: parts.length > 0 ? parts : presetFallback.parts,
    };
  }

  return spec;
}

/**
 * Guarantee a valid, crash-proof SynkcutProject regardless of partial LLM JSON patches
 * or older v1.0 saved files.
 */
export function normalizeProject(
  raw: unknown,
  fallback?: SynkcutProject
): SynkcutProject {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawMeta = (obj.meta && typeof obj.meta === "object" ? obj.meta : {}) as Record<
    string,
    unknown
  >;
  const rawStyle = (obj.globalStyle && typeof obj.globalStyle === "object"
    ? obj.globalStyle
    : {}) as Record<string, unknown>;
  const rawBgm = (rawStyle.bgm && typeof rawStyle.bgm === "object"
    ? rawStyle.bgm
    : {}) as Record<string, unknown>;
  const rawVo = (obj.voiceover && typeof obj.voiceover === "object"
    ? obj.voiceover
    : {}) as Record<string, unknown>;

  const fbStyle = fallback?.globalStyle;
  const customDesign =
    rawStyle.customDesign === null
      ? null
      : sanitizeCustomDesign(rawStyle.customDesign) ?? fbStyle?.customDesign ?? null;

  const rawScenes = Array.isArray(obj.scenes) ? obj.scenes : [];
  const sourceScenes =
    rawScenes.length > 0
      ? rawScenes
      : fallback?.scenes && fallback.scenes.length > 0
        ? fallback.scenes
        : [
            {
              id: "scene_1",
              role: "hook",
              startMs: 0,
              endMs: 3000,
              text: "Tulis teks scene pertama di sini.",
              visualSource: "footage",
              media: { path: null, trimStartMs: 0, fit: "cover" },
              motion: { preset: "zoom_punch", intensity: 0.75 },
              transitionIn: { preset: "hard_cut", durationMs: 0 },
              sfx: [],
              overlays: [],
            },
          ];

  const seenIds = new Set<string>();
  const sanitizedScenes: SceneItem[] = sourceScenes.map((item, idx) => {
    const s = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    let id = asStr(s.id, `scene_${idx + 1}`).trim() || `scene_${idx + 1}`;
    if (seenIds.has(id)) {
      id = `${id}_${idx + 1}`;
    }
    seenIds.add(id);

    const origMatch =
      fallback?.scenes.find((os) => os.id === id) ?? fallback?.scenes[idx];

    const role = pickEnum(s.role, VALID_ROLES, origMatch?.role ?? (idx === 0 ? "hook" : "body"));
    const text = asStr(s.text, origMatch?.text ?? "");
    const visualSource =
      s.visualSource === "motion" || s.visualSource === "footage"
        ? s.visualSource
        : origMatch?.visualSource ?? (s.aiMotion ? "motion" : "footage");

    const rawMedia = (s.media && typeof s.media === "object" ? s.media : {}) as Record<
      string,
      unknown
    >;
    const mediaPath =
      typeof rawMedia.path === "string" && rawMedia.path.trim()
        ? rawMedia.path
        : rawMedia.path === null
          ? null
          : origMatch?.media?.path ?? null;
    const secondaryPath =
      typeof rawMedia.secondaryPath === "string" && rawMedia.secondaryPath.trim()
        ? rawMedia.secondaryPath
        : rawMedia.secondaryPath === null
          ? null
          : origMatch?.media?.secondaryPath ?? null;

    const rawMotion = (s.motion && typeof s.motion === "object" ? s.motion : {}) as Record<
      string,
      unknown
    >;
    const rawTrans = (s.transitionIn && typeof s.transitionIn === "object"
      ? s.transitionIn
      : {}) as Record<string, unknown>;

    const rawSfx = Array.isArray(s.sfx) ? s.sfx : origMatch?.sfx ?? [];
    const sfx: SceneSfx[] = rawSfx
      .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
      .map((x) => ({
        preset: asStr(x.preset, "none"),
        offsetMs: Math.max(0, Math.round(asNum(x.offsetMs, 0))),
        volume: Math.max(0.05, Math.min(1, asNum(x.volume, 0.65))),
      }))
      .filter((x) => x.preset && x.preset !== "none");

    const rawOverlays = Array.isArray(s.overlays) ? s.overlays : origMatch?.overlays ?? [];
    const overlays: SceneOverlay[] = rawOverlays
      .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
      .map((x, oi) => ({
        id: asStr(x.id, `ov_${idx}_${oi}`),
        type: pickEnum(x.type, VALID_OVERLAY_TYPES, "promo_badge"),
        title: typeof x.title === "string" ? x.title : undefined,
        text: asStr(x.text, ""),
        position: pickEnum(x.position, ["top", "center", "bottom"] as const, "top"),
      }));

    const startMs = Math.max(0, Math.round(asNum(s.startMs, origMatch?.startMs ?? idx * 2500)));
    const rawEnd = Math.round(asNum(s.endMs, origMatch?.endMs ?? startMs + 2500));
    const dur = Math.max(
      MIN_SCENE_DURATION_MS,
      Math.min(MAX_SCENE_DURATION_MS, rawEnd > startMs ? rawEnd - startMs : 2500)
    );

    const aiMotion =
      visualSource === "motion"
        ? sanitizeAiMotionSpec(s.aiMotion ?? origMatch?.aiMotion, text || "AI Motion")
        : s.aiMotion && typeof s.aiMotion === "object"
          ? sanitizeAiMotionSpec(s.aiMotion, text || "AI Motion")
          : null;

    return {
      id,
      role,
      startMs,
      endMs: startMs + dur,
      text,
      visualSource,
      aiMotion,
      media: {
        path: mediaPath,
        secondaryPath,
        trimStartMs: Math.max(0, Math.round(asNum(rawMedia.trimStartMs, origMatch?.media?.trimStartMs ?? 0))),
        fit: rawMedia.fit === "contain" ? "contain" : "cover",
      },
      motion: {
        preset: pickEnum(
          rawMotion.preset,
          VALID_MOTIONS,
          origMatch?.motion?.preset ?? (visualSource === "motion" ? "static_clean" : "zoom_punch")
        ),
        intensity: Math.max(0, Math.min(1, asNum(rawMotion.intensity, origMatch?.motion?.intensity ?? 0.75))),
      },
      transitionIn: {
        preset: pickEnum(
          rawTrans.preset,
          VALID_TRANSITIONS,
          origMatch?.transitionIn?.preset ?? (idx === 0 ? "hard_cut" : "pop_zoom")
        ),
        durationMs: Math.max(
          0,
          Math.min(800, Math.round(asNum(rawTrans.durationMs, origMatch?.transitionIn?.durationMs ?? (idx === 0 ? 0 : 240))))
        ),
      },
      sfx,
      overlays,
    };
  });

  const reflowedScenes = reflowSceneTimings(sanitizedScenes);

  const rawWords = Array.isArray(rawVo.words) ? rawVo.words : [];
  const words: WordTimestamp[] = rawWords
    .filter((w): w is Record<string, unknown> => Boolean(w && typeof w === "object"))
    .map((w) => ({
      word: asStr(w.word, "").trim(),
      startMs: Math.max(0, Math.round(asNum(w.startMs, 0))),
      endMs: Math.max(0, Math.round(asNum(w.endMs, 100))),
    }))
    .filter((w) => w.word.length > 0);

  const rawLib = Array.isArray(obj.footageLibrary)
    ? obj.footageLibrary
    : fallback?.footageLibrary ?? [];
  const footageLibrary: FootageLibraryItem[] = rawLib
    .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object"))
    .map((c) => ({
      path: asStr(c.path, ""),
      fileName: asStr(c.fileName, "clip.mp4"),
      durationMs: Math.max(0, Math.round(asNum(c.durationMs, 0))),
      width: typeof c.width === "number" ? c.width : undefined,
      height: typeof c.height === "number" ? c.height : undefined,
    }))
    .filter((c) => c.path.length > 0);

  const rawWorld3d =
    obj.world3d === null
      ? null
      : obj.world3d && typeof obj.world3d === "object"
        ? (obj.world3d as Record<string, unknown>)
        : null;
  const world3d = rawWorld3d
    ? {
        setupCode: asStr(rawWorld3d.setupCode, ""),
        animateCode: asStr(rawWorld3d.animateCode, ""),
        worldPreset: asStr(rawWorld3d.worldPreset, "ground_cutaway"),
        summary: asStr(rawWorld3d.summary, "3D Diorama World"),
        verified: typeof rawWorld3d.verified === "boolean" ? rawWorld3d.verified : false,
        verificationNote:
          typeof rawWorld3d.verificationNote === "string"
            ? rawWorld3d.verificationNote
            : undefined,
      }
    : fallback?.world3d ?? null;

  const rawHf =
    obj.hyperframe === null
      ? null
      : obj.hyperframe && typeof obj.hyperframe === "object"
        ? (obj.hyperframe as Record<string, unknown>)
        : null;
  const hyperframe = rawHf
    ? {
        html: asStr(rawHf.html, ""),
        summary: asStr(rawHf.summary, "HyperFrames v3 Editorial Motion Composition"),
        worldTheme: asStr(rawHf.worldTheme, "Architectural Mineral Mist"),
        skillsUsed: Array.isArray(rawHf.skillsUsed)
          ? rawHf.skillsUsed.map((s) => asStr(s, "").trim()).filter(Boolean)
          : [
              "hyperframes-engine",
              "threejs-skills-r187",
              "gsap-timeline-choreography",
              "design-dna-tokens",
              "motion-design-svg",
              "genjutsu-impeccable-unslop",
            ],
        lintFixes: Array.isArray(rawHf.lintFixes)
          ? rawHf.lintFixes.map((s) => asStr(s, "").trim()).filter(Boolean)
          : [],
        verified: typeof rawHf.verified === "boolean" ? rawHf.verified : false,
        verificationNote:
          typeof rawHf.verificationNote === "string" ? rawHf.verificationNote : undefined,
      }
    : fallback?.hyperframe ?? null;

  const hasHyperframe =
    Boolean(hyperframe && hyperframe.html.trim().length > 0) ||
    reflowedScenes.some((s) => s.aiMotion?.engine === "hyperframe");
  const hasDiorama =
    Boolean(world3d) || reflowedScenes.some((s) => s.aiMotion?.engine === "diorama_3d");
  const hasCustomCode = reflowedScenes.some((s) => s.aiMotion?.engine === "custom_code");
  const hasMotionOrCustom =
    reflowedScenes.some((s) => s.visualSource === "motion") || Boolean(customDesign);

  const normalized: SynkcutProject = {
    version:
      hasHyperframe || obj.version === "3.0"
        ? "3.0"
        : hasDiorama || obj.version === "2.1"
          ? "2.1"
          : hasCustomCode || obj.version === "2.0"
            ? "2.0"
            : hasMotionOrCustom || obj.version === "1.1"
              ? "1.1"
              : "1.0",
    meta: {
      id: asStr(rawMeta.id, fallback?.meta.id ?? `proj_${Date.now()}`),
      name: asStr(rawMeta.name, fallback?.meta.name ?? "Proyek Synkcut"),
      format: pickEnum(rawMeta.format, VALID_FORMATS, fallback?.meta.format ?? "ad_promo"),
      aspectRatio: "9:16",
      fps: rawMeta.fps === 60 ? 60 : 30,
      createdAt: typeof rawMeta.createdAt === "string" ? rawMeta.createdAt : fallback?.meta.createdAt,
      updatedAt: typeof rawMeta.updatedAt === "string" ? rawMeta.updatedAt : fallback?.meta.updatedAt,
      posterDataUrl:
        typeof rawMeta.posterDataUrl === "string" && rawMeta.posterDataUrl.trim().length > 0
          ? rawMeta.posterDataUrl
          : rawMeta.posterDataUrl === null
            ? null
            : fallback?.meta.posterDataUrl ?? null,
    },
    styleReference:
      obj.styleReference && typeof obj.styleReference === "object"
        ? (obj.styleReference as SynkcutProject["styleReference"])
        : fallback?.styleReference ?? null,
    footageLibrary,
    world3d,
    hyperframe,
    globalStyle: {
      captionPreset: pickEnum(
        rawStyle.captionPreset,
        VALID_CAPTIONS,
        fbStyle?.captionPreset ?? "bold_pop"
      ),
      accentColor: asHexColor(
        rawStyle.accentColor,
        customDesign?.palette.accentPrimary ?? fbStyle?.accentColor ?? "#38E59D"
      ),
      showProgressBar:
        typeof rawStyle.showProgressBar === "boolean"
          ? rawStyle.showProgressBar
          : fbStyle?.showProgressBar ?? true,
      customDesign,
      bgm: {
        preset: asStr(rawBgm.preset, fbStyle?.bgm?.preset ?? "none"),
        volume: Math.max(0.05, Math.min(0.85, asNum(rawBgm.volume, fbStyle?.bgm?.volume ?? 0.24))),
        autoDucking:
          typeof rawBgm.autoDucking === "boolean"
            ? rawBgm.autoDucking
            : fbStyle?.bgm?.autoDucking ?? true,
      },
      safeZone:
        rawStyle.safeZone === "none" || rawStyle.safeZone === "tiktok_reels"
          ? rawStyle.safeZone
          : fbStyle?.safeZone ?? "tiktok_reels",
    },
    voiceover: {
      source: pickEnum(
        rawVo.source,
        ["tts", "recorded", "demo"] as const,
        fallback?.voiceover?.source ?? "demo"
      ),
      audioPath:
        typeof rawVo.audioPath === "string" && rawVo.audioPath.trim()
          ? rawVo.audioPath
          : rawVo.audioPath === null
            ? null
            : fallback?.voiceover?.audioPath ?? null,
      trimSilence:
        typeof rawVo.trimSilence === "boolean"
          ? rawVo.trimSilence
          : fallback?.voiceover?.trimSilence ?? true,
      words,
    },
    scenes: reflowedScenes,
  };

  if (normalized.voiceover.words.length === 0) {
    normalized.voiceover.words = rebuildWordsFromScenes(normalized);
  }

  return normalized;
}

export function reflowSceneTimings(scenes: SceneItem[]): SceneItem[] {
  let cursor = 0;
  return scenes.map((scene) => {
    const rawSpan = Number.isFinite(scene.endMs - scene.startMs)
      ? Math.round(scene.endMs - scene.startMs)
      : 2500;
    const duration = Math.max(
      MIN_SCENE_DURATION_MS,
      Math.min(MAX_SCENE_DURATION_MS, rawSpan || 2500)
    );
    const next: SceneItem = {
      ...scene,
      startMs: cursor,
      endMs: cursor + duration,
    };
    cursor += duration;
    return next;
  });
}

export function syncProjectTimingsAndWords(
  project: SynkcutProject,
  nextScenes: SceneItem[]
): SynkcutProject {
  const reflowed = reflowSceneTimings(nextScenes);
  const updated: SynkcutProject = {
    ...project,
    scenes: reflowed,
  };
  return {
    ...updated,
    voiceover: {
      ...updated.voiceover,
      words: rebuildWordsFromScenes(updated),
    },
  };
}

export function reorderScenes(
  project: SynkcutProject,
  fromIndex: number,
  toIndex: number
): SynkcutProject {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= project.scenes.length ||
    toIndex >= project.scenes.length
  ) {
    return project;
  }
  const copy = [...project.scenes];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return syncProjectTimingsAndWords(project, copy);
}

export function addSceneAfter(
  project: SynkcutProject,
  afterSceneId?: string | null,
  role: SceneRole = "body"
): { project: SynkcutProject; newSceneId: string } {
  const newSceneId = `scene_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  const idx = afterSceneId
    ? project.scenes.findIndex((s) => s.id === afterSceneId)
    : project.scenes.length - 1;
  const insertIdx = idx >= 0 ? idx + 1 : project.scenes.length;
  const templateScene = project.scenes[Math.max(0, insertIdx - 1)];

  const defaultText: Record<SceneRole, string> = {
    hook: "Tunggu dulu, lihat perubahan ini di tiga detik pertama!",
    body: "Tunjukkan poin utama atau demo produk secara dekat dan jelas.",
    cta: "Klik link sekarang sebelum promo berakhir!",
  };

  const inheritMotion = templateScene?.visualSource === "motion";
  const newScene: SceneItem = {
    id: newSceneId,
    role,
    startMs: 0,
    endMs: 2800,
    text: defaultText[role],
    visualSource: inheritMotion ? "motion" : "footage",
    aiMotion: inheritMotion
      ? createDefaultAiMotion(
          templateScene?.aiMotion?.engine ?? "flow_diagram",
          templateScene?.aiMotion?.theme ?? "carbon",
          defaultText[role]
        )
      : null,
    media: {
      path: templateScene?.media?.path ?? null,
      secondaryPath: null,
      trimStartMs: 0,
      fit: "cover",
    },
    motion: {
      preset: templateScene?.motion?.preset ?? "zoom_punch",
      intensity: 0.75,
    },
    transitionIn: {
      preset: insertIdx === 0 ? "hard_cut" : "whip_pan",
      durationMs: insertIdx === 0 ? 0 : 220,
    },
    sfx: insertIdx === 0 ? [] : [{ preset: "whoosh_fast", offsetMs: 0, volume: 0.6 }],
    overlays: [],
  };

  const nextScenes = [...project.scenes];
  nextScenes.splice(insertIdx, 0, newScene);
  return {
    project: syncProjectTimingsAndWords(project, nextScenes),
    newSceneId,
  };
}

export function duplicateScene(
  project: SynkcutProject,
  sceneId: string
): { project: SynkcutProject; newSceneId: string } {
  const idx = project.scenes.findIndex((s) => s.id === sceneId);
  if (idx < 0) {
    return { project, newSceneId: sceneId };
  }
  const orig = project.scenes[idx];
  const newSceneId = `scene_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  const clone: SceneItem = {
    ...orig,
    id: newSceneId,
    aiMotion: orig.aiMotion ? JSON.parse(JSON.stringify(orig.aiMotion)) : null,
    media: { ...orig.media },
    motion: { ...orig.motion },
    transitionIn: { ...orig.transitionIn },
    sfx: (orig.sfx ?? []).map((s) => ({ ...s })),
    overlays: (orig.overlays ?? []).map((o, i) => ({ ...o, id: `ov_${Date.now()}_${i}` })),
  };
  const nextScenes = [...project.scenes];
  nextScenes.splice(idx + 1, 0, clone);
  return {
    project: syncProjectTimingsAndWords(project, nextScenes),
    newSceneId,
  };
}

export function deleteScene(project: SynkcutProject, sceneId: string): SynkcutProject {
  if (project.scenes.length <= 1) return project;
  const nextScenes = project.scenes.filter((s) => s.id !== sceneId);
  if (nextScenes.length === project.scenes.length) return project;
  return syncProjectTimingsAndWords(project, nextScenes);
}

export function updateSceneDuration(
  project: SynkcutProject,
  sceneId: string,
  newDurationMs: number
): SynkcutProject {
  const clamped = Math.max(
    MIN_SCENE_DURATION_MS,
    Math.min(MAX_SCENE_DURATION_MS, Math.round(newDurationMs))
  );
  const nextScenes = project.scenes.map((s) =>
    s.id === sceneId ? { ...s, endMs: s.startMs + clamped } : s
  );
  return syncProjectTimingsAndWords(project, nextScenes);
}

export function updateSceneRole(
  project: SynkcutProject,
  sceneId: string,
  role: SceneRole
): SynkcutProject {
  return {
    ...project,
    scenes: project.scenes.map((s) => (s.id === sceneId ? { ...s, role } : s)),
  };
}

const CAPTION_NAMES: Record<string, string> = {
  bold_pop: "Bold Pop",
  clean_minimal: "Clean Minimal",
  kinetic_punch: "Kinetic Punch",
  luxury_editorial: "Luxury Editorial",
  neon_tech: "Neon Tech",
};

const MOTION_NAMES: Record<string, string> = {
  zoom_punch: "Zoom Punch",
  smooth_ken_burns: "Smooth Ken Burns",
  shake_impact: "Shake Impact",
  slide_reveal: "Slide Reveal",
  static_clean: "Static Clean",
};

const OVERLAY_NAMES: Record<string, string> = {
  hook_headline: "Hook Headline",
  notification_banner: "Notif Banner",
  promo_badge: "Promo Badge",
  doodle_highlight: "Doodle Marker",
  split_screen: "Split-Screen",
};

export function summarizeProjectDiff(before: SynkcutProject, after: SynkcutProject): string[] {
  const changes: string[] = [];

  const bStyle = before?.globalStyle;
  const aStyle = after?.globalStyle;

  if (bStyle?.captionPreset !== aStyle?.captionPreset && aStyle?.captionPreset) {
    changes.push(
      `Caption → ${CAPTION_NAMES[aStyle.captionPreset] ?? aStyle.captionPreset}`
    );
  }
  const bAccent = (bStyle?.accentColor ?? "").toUpperCase();
  const aAccent = (aStyle?.accentColor ?? "").toUpperCase();
  if (bAccent !== aAccent && aAccent) {
    changes.push(`Warna Aksen → ${aStyle?.accentColor}`);
  }
  if (
    JSON.stringify(bStyle?.customDesign ?? null) !== JSON.stringify(aStyle?.customDesign ?? null)
  ) {
    changes.push(
      aStyle?.customDesign?.name
        ? `Desain Custom → ${aStyle.customDesign.name}`
        : "Desain Custom diperbarui"
    );
  }
  if (bStyle?.bgm?.preset !== aStyle?.bgm?.preset) {
    changes.push(
      `BGM → ${!aStyle?.bgm?.preset || aStyle.bgm.preset === "none" ? "Tanpa BGM" : aStyle.bgm.preset}`
    );
  }
  if (bStyle?.bgm?.autoDucking !== aStyle?.bgm?.autoDucking) {
    changes.push(`Auto-Ducking → ${aStyle?.bgm?.autoDucking ? "Aktif" : "Nonaktif"}`);
  }
  const bScenes = before?.scenes ?? [];
  const aScenes = after?.scenes ?? [];
  if (bScenes.length !== aScenes.length) {
    changes.push(`Jumlah Scene: ${bScenes.length} → ${aScenes.length}`);
  }

  const count = Math.min(bScenes.length, aScenes.length);
  for (let i = 0; i < count; i++) {
    const b = bScenes[i];
    const a = aScenes[i];
    if (!b || !a) continue;
    if ((b.text ?? "") !== (a.text ?? "")) {
      changes.push(`Scene ${i + 1}: teks diperbarui`);
    }
    const bSrc = b.visualSource ?? "footage";
    const aSrc = a.visualSource ?? "footage";
    if (bSrc !== aSrc || b.aiMotion?.engine !== a.aiMotion?.engine) {
      changes.push(
        aSrc === "motion"
          ? `Scene ${i + 1} Visual → AI Motion (${a.aiMotion?.engine ?? "flow"})`
          : `Scene ${i + 1} Visual → Footage Lokal`
      );
    }
    if (b.media?.path !== a.media?.path && a.media?.path) {
      const clipName = a.media.path.split(/[\\/]/).pop() || "klip";
      changes.push(`Scene ${i + 1} Klip → ${clipName}`);
    } else if (
      Math.abs((b.media?.trimStartMs ?? 0) - (a.media?.trimStartMs ?? 0)) >= 200
    ) {
      changes.push(
        `Scene ${i + 1} Cut → mulai ${((a.media?.trimStartMs ?? 0) / 1000).toFixed(1)}s`
      );
    }
    if (b.aiMotion?.theme !== a.aiMotion?.theme && a.aiMotion?.theme) {
      changes.push(`Scene ${i + 1} Tema Motion → ${a.aiMotion.theme}`);
    }
    if (b.motion?.preset !== a.motion?.preset && a.motion?.preset) {
      changes.push(`Scene ${i + 1} Motion → ${MOTION_NAMES[a.motion.preset] ?? a.motion.preset}`);
    }
    if (b.transitionIn?.preset !== a.transitionIn?.preset && a.transitionIn?.preset) {
      changes.push(`Scene ${i + 1} Transisi → ${a.transitionIn.preset}`);
    }
    const bOv: string = b.overlays?.[0]?.type ?? "none";
    const aOv: string = a.overlays?.[0]?.type ?? "none";
    if (bOv !== aOv) {
      changes.push(`Scene ${i + 1} Overlay → ${aOv === "none" ? "Dihapus" : OVERLAY_NAMES[aOv] ?? aOv}`);
    }
    const bSfx = b.sfx?.[0]?.preset ?? "none";
    const aSfx = a.sfx?.[0]?.preset ?? "none";
    if (bSfx !== aSfx) {
      changes.push(`Scene ${i + 1} SFX → ${aSfx === "none" ? "Dihapus" : aSfx}`);
    }
    const bDur = (b.endMs ?? 0) - (b.startMs ?? 0);
    const aDur = (a.endMs ?? 0) - (a.startMs ?? 0);
    if (Math.abs(bDur - aDur) >= 100) {
      changes.push(`Scene ${i + 1} Durasi → ${(aDur / 1000).toFixed(1)}s`);
    }
  }

  return changes.slice(0, 6);
}
