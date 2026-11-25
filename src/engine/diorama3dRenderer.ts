import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { SceneItem, SynkcutProject } from "../types/scene";
import {
  createDiorama3DSdk,
  setActiveDioramaWorld,
  type Diorama3DSdk,
  type DioramaFrameState,
  type DioramaWorldHandle,
} from "./diorama3dSdk";
import {
  buildBeatRenderState,
  defaultDesignFromTheme,
  instrumentLoopGuards,
  renderFreeformBeat,
  validateBeatCodeSafety,
} from "./freeformMotionRenderer";
import { clamp } from "./motionSdk";

type CompiledSetupFn = (
  world: DioramaWorldHandle,
  D3: Diorama3DSdk,
  __guard: () => void
) => void;

type CompiledAnimateFn = (
  world: DioramaWorldHandle,
  state: DioramaFrameState,
  D3: Diorama3DSdk,
  __guard: () => void
) => void;

interface CachedWorldEntry {
  world: DioramaWorldHandle;
  setupError?: string;
}

const setupFnCache = new Map<string, { fn: CompiledSetupFn | null; error?: string }>();
const animateFnCache = new Map<string, { fn: CompiledAnimateFn | null; error?: string }>();
const builtWorldCache = new Map<string, CachedWorldEntry>();

const D3_SDK = Object.freeze(createDiorama3DSdk());

let sharedCanvas: HTMLCanvasElement | null = null;
let sharedRenderer: THREE.WebGLRenderer | null = null;
let sharedEnvTexture: THREE.Texture | null = null;
let rendererWidth = 1080;
let rendererHeight = 1920;

function getSharedWebGL(width: number, height: number): {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  envTexture: THREE.Texture | null;
} | null {
  if (typeof document === "undefined") return null;

  const w = Math.max(64, Math.round(width));
  const h = Math.max(64, Math.round(height));

  if (!sharedRenderer || !sharedCanvas) {
    try {
      sharedCanvas = document.createElement("canvas");
      sharedCanvas.width = w;
      sharedCanvas.height = h;
      sharedRenderer = new THREE.WebGLRenderer({
        canvas: sharedCanvas,
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      });
      sharedRenderer.setPixelRatio(1);
      sharedRenderer.setSize(w, h, false);
      sharedRenderer.outputColorSpace = THREE.SRGBColorSpace;
      sharedRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      sharedRenderer.toneMappingExposure = 0.94;
      sharedRenderer.shadowMap.enabled = true;
      sharedRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const pmrem = new THREE.PMREMGenerator(sharedRenderer);
      const roomEnv = new RoomEnvironment();
      sharedEnvTexture = pmrem.fromScene(roomEnv, 0.04).texture;
      roomEnv.dispose();
      pmrem.dispose();

      rendererWidth = w;
      rendererHeight = h;
    } catch {
      return null;
    }
  } else if (rendererWidth !== w || rendererHeight !== h) {
    rendererWidth = w;
    rendererHeight = h;
    sharedCanvas.width = w;
    sharedCanvas.height = h;
    sharedRenderer.setSize(w, h, false);
  }

  return {
    canvas: sharedCanvas,
    renderer: sharedRenderer,
    envTexture: sharedEnvTexture,
  };
}

function disposeWorld(world: DioramaWorldHandle) {
  world.scene.traverse((obj) => {
    const light = obj as THREE.Light & { shadow?: { map?: THREE.WebGLRenderTarget | null } };
    if (light.isLight) {
      if (light.shadow?.map) {
        light.shadow.map.dispose();
      }
      if (typeof light.dispose === "function") {
        light.dispose();
      }
    }
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        std.map?.dispose();
        std.emissiveMap?.dispose();
        std.roughnessMap?.dispose();
        std.metalnessMap?.dispose();
        m.dispose();
      }
    }
  });
  for (const tex of world.ownedTextures) {
    tex.dispose();
  }
  world.ownedTextures = [];
}

function compileSetupCode(code: string): { fn: CompiledSetupFn | null; error?: string } {
  const trimmed = String(code || "").trim();
  if (!trimmed) return { fn: null, error: "setupCode kosong." };

  const cached = setupFnCache.get(trimmed);
  if (cached) return cached;

  const safety = validateBeatCodeSafety(trimmed);
  if (!safety.ok) {
    const res = { fn: null, error: safety.error };
    setupFnCache.set(trimmed, res);
    return res;
  }

  try {
    const body = `"use strict";\n${instrumentLoopGuards(trimmed)}`;
    const rawFn = new Function(
      "world",
      "D3",
      "__guard",
      "window",
      "document",
      "globalThis",
      "self",
      "top",
      "parent",
      "frames",
      "location",
      "navigator",
      "fetch",
      "localStorage",
      "Reflect",
      "Proxy",
      "Function",
      body
    ) as (
      world: DioramaWorldHandle,
      D3: Diorama3DSdk,
      __guard: () => void,
      ...shadowed: undefined[]
    ) => void;

    const wrapped: CompiledSetupFn = (world, D3, __guard) => {
      rawFn(
        world,
        D3,
        __guard,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );
    };

    if (setupFnCache.size > 40) {
      const k = setupFnCache.keys().next().value;
      if (k) setupFnCache.delete(k);
    }
    const res = { fn: wrapped };
    setupFnCache.set(trimmed, res);
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const res = { fn: null, error: `setupCode syntax error: ${msg}` };
    setupFnCache.set(trimmed, res);
    return res;
  }
}

function compileAnimateCode(code: string): { fn: CompiledAnimateFn | null; error?: string } {
  const trimmed = String(code || "").trim();
  if (!trimmed) return { fn: null, error: "animateCode kosong." };

  const cached = animateFnCache.get(trimmed);
  if (cached) return cached;

  const safety = validateBeatCodeSafety(trimmed);
  if (!safety.ok) {
    const res = { fn: null, error: safety.error };
    animateFnCache.set(trimmed, res);
    return res;
  }

  try {
    const body = `"use strict";\n${instrumentLoopGuards(trimmed)}`;
    const rawFn = new Function(
      "world",
      "state",
      "D3",
      "__guard",
      "window",
      "document",
      "globalThis",
      "self",
      "top",
      "parent",
      "frames",
      "location",
      "navigator",
      "fetch",
      "localStorage",
      "Reflect",
      "Proxy",
      "Function",
      body
    ) as (
      world: DioramaWorldHandle,
      state: DioramaFrameState,
      D3: Diorama3DSdk,
      __guard: () => void,
      ...shadowed: undefined[]
    ) => void;

    const wrapped: CompiledAnimateFn = (world, state, D3, __guard) => {
      rawFn(
        world,
        state,
        D3,
        __guard,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );
    };

    if (animateFnCache.size > 60) {
      const k = animateFnCache.keys().next().value;
      if (k) animateFnCache.delete(k);
    }
    const res = { fn: wrapped };
    animateFnCache.set(trimmed, res);
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const res = { fn: null, error: `animateCode syntax error: ${msg}` };
    animateFnCache.set(trimmed, res);
    return res;
  }
}

function getOrBuildWorld(
  setupCode: string,
  worldPreset: string,
  envTexture: THREE.Texture | null,
  width: number,
  height: number
): CachedWorldEntry {
  const key = `${worldPreset}::${setupCode.trim()}`;
  const cached = builtWorldCache.get(key);
  if (cached) {
    cached.world.width = width;
    cached.world.height = height;
    cached.world.camera.aspect = width / height;
    cached.world.camera.updateProjectionMatrix();
    return cached;
  }

  const scene = new THREE.Scene();
  if (envTexture) {
    scene.environment = envTexture;
    scene.environmentIntensity = 0.45;
  }
  const root = new THREE.Group();
  scene.add(root);
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 400);
  camera.position.set(10, 6, 14);
  camera.lookAt(0, 1, 0);

  const world: DioramaWorldHandle = {
    scene,
    root,
    camera,
    objects: {},
    characters: {},
    data: {},
    ownedTextures: [],
    hudQueue: [],
    skyColorTop: "#6BB8EB",
    skyColorBottom: "#E2F2FD",
    width,
    height,
    add<T extends THREE.Object3D>(obj: T, name?: string): T {
      if (obj && typeof obj === "object" && "isObject3D" in obj) {
        root.add(obj);
        if (name && typeof name === "string") {
          world.objects[name] = obj;
        }
      }
      return obj;
    },
  };

  let setupError: string | undefined;

  if (!setupCode.trim()) {
    setupError = "setupCode 3D kosong.";
  } else {
    const compiled = compileSetupCode(setupCode);
    if (!compiled.fn) {
      setupError = compiled.error || "Gagal compile setupCode.";
    } else {
      let guardSteps = 0;
      const guard = () => {
        if (++guardSteps > 12000) throw new Error("Loop guard setupCode terlampaui.");
      };
      setActiveDioramaWorld(world, "setup");
      try {
        compiled.fn(world, D3_SDK, guard);
        // Ensure basic lighting exists if LLM omitted explicit lights
        if (!world.sunLight && !world.hemiLight) {
          D3_SDK.setupAtmosphere(world);
        }
      } catch (err) {
        setupError = err instanceof Error ? err.message : String(err);
      } finally {
        setActiveDioramaWorld(null, "setup");
      }
    }
  }

  if (builtWorldCache.size >= 6) {
    const oldestKey = builtWorldCache.keys().next().value;
    if (oldestKey) {
      const old = builtWorldCache.get(oldestKey);
      if (old) disposeWorld(old.world);
      builtWorldCache.delete(oldestKey);
    }
  }

  const entry: CachedWorldEntry = { world, setupError };
  builtWorldCache.set(key, entry);
  return entry;
}

/**
 * Zero-Sample-Asset Fallback: if 3D WebGL or LLM 3D code fails completely after auto-repair,
 * NEVER inject unrelated 3D sample objects (no oil rigs, no tables, no dummy characters).
 * Render clean brand-styled kinetic typography of the user's real beat text instead.
 */
function renderNeutralTypographyFallback(params: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  project: SynkcutProject;
  scene: SceneItem;
  sceneProgress: number;
}) {
  const { ctx, width, height, project, scene, sceneProgress } = params;
  const customDesign = project.globalStyle?.customDesign ?? null;
  const accentColor =
    customDesign?.palette.accentPrimary || project.globalStyle?.accentColor || "#38E59D";
  const beatState = buildBeatRenderState({
    width,
    height,
    scene,
    progress: sceneProgress,
    fps: project.meta?.fps || 30,
    allWords: project.voiceover?.words ?? [],
    accentColor,
    customDesign,
    brandLogoUrl: project.styleReference?.logoDataUrl ?? null,
  });
  renderFreeformBeat(ctx, beatState, "");
}

export function clearDiorama3DCache() {
  for (const entry of builtWorldCache.values()) {
    disposeWorld(entry.world);
  }
  builtWorldCache.clear();
}

export function renderDiorama3DFrame(params: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  project: SynkcutProject;
  scene: SceneItem;
  globalTimeMs: number;
  sceneProgress: number;
}): { ok: boolean; error?: string } {
  const { ctx, width, height, project, scene, globalTimeMs, sceneProgress } = params;
  const webgl = getSharedWebGL(width, height);
  if (!webgl) {
    renderNeutralTypographyFallback({ ctx, width, height, project, scene, sceneProgress });
    return { ok: false, error: "WebGL tidak tersedia pada perangkat ini." };
  }

  const beatSpec = scene.aiMotion?.diorama3d;
  const setupCode = (beatSpec?.setupCode || project.world3d?.setupCode || "").trim();
  const animateCode = (beatSpec?.animateCode || project.world3d?.animateCode || "").trim();
  const worldPreset =
    beatSpec?.worldPreset ||
    project.world3d?.worldPreset ||
    project.globalStyle?.customDesign?.worldPreset ||
    "custom";

  if (!setupCode || !animateCode) {
    renderNeutralTypographyFallback({ ctx, width, height, project, scene, sceneProgress });
    return { ok: false, error: "Kode 3D belum tersedia." };
  }

  const entry = getOrBuildWorld(setupCode, worldPreset, webgl.envTexture, width, height);
  if (entry.setupError) {
    renderNeutralTypographyFallback({ ctx, width, height, project, scene, sceneProgress });
    return { ok: false, error: entry.setupError };
  }

  const world = entry.world;
  world.hudQueue = [];

  const scenes = project.scenes || [];
  const totalDurationMs = Math.max(
    1000,
    scenes.reduce((m, s) => Math.max(m, s.endMs), 0)
  );
  const beatIndex = Math.max(
    0,
    scenes.findIndex((s) => s.id === scene.id)
  );
  const beatDurationMs = Math.max(600, scene.endMs - scene.startMs);
  const beatProgress = clamp(sceneProgress, 0, 1);
  const beatTimeMs = beatProgress * beatDurationMs;
  const globalProgress = clamp(globalTimeMs / totalDurationMs, 0, 1);
  const fps = project.meta?.fps || 30;

  const allWords = project.voiceover?.words ?? [];
  const localWords = allWords
    .filter((w) => w.endMs > scene.startMs && w.startMs < scene.endMs)
    .map((w) => ({
      word: w.word,
      startMs: Math.max(0, w.startMs - scene.startMs),
      endMs: Math.max(0, w.endMs - scene.startMs),
    }));
  let activeWordIndex = -1;
  for (let i = 0; i < localWords.length; i++) {
    if (beatTimeMs >= localWords[i].startMs && beatTimeMs <= localWords[i].endMs) {
      activeWordIndex = i;
      break;
    }
  }

  const customDesign =
    project.globalStyle?.customDesign ??
    defaultDesignFromTheme(scene.aiMotion?.theme, project.globalStyle?.accentColor || "#FACC15");

  const frameState: DioramaFrameState = {
    globalTimeMs,
    totalDurationMs,
    globalProgress,
    beatIndex,
    beatCount: Math.max(1, scenes.length),
    beatProgress,
    beatTimeMs,
    beatDurationMs,
    frame: (globalTimeMs / 1000) * fps,
    fps,
    width,
    height,
    u: width / 1080,
    title: scene.aiMotion?.title || project.meta?.name || "3D Scene",
    text: scene.text || "",
    role: scene.role || "body",
    words: localWords,
    activeWordIndex,
    design: customDesign,
  };

  const compiledAnim = compileAnimateCode(animateCode);
  if (!compiledAnim.fn) {
    renderNeutralTypographyFallback({ ctx, width, height, project, scene, sceneProgress });
    return { ok: false, error: compiledAnim.error };
  }

  let guardSteps = 0;
  const guard = () => {
    if (++guardSteps > 12000) throw new Error("Loop guard animateCode terlampaui.");
  };
  setActiveDioramaWorld(world, "animate");
  try {
    compiledAnim.fn(world, frameState, D3_SDK, guard);
  } catch (err) {
    renderNeutralTypographyFallback({ ctx, width, height, project, scene, sceneProgress });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    setActiveDioramaWorld(null, "setup");
  }

  // Render WebGL scene and blit seamlessly onto target 2D canvas
  webgl.renderer.render(world.scene, world.camera);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(webgl.canvas, 0, 0, width, height);

  // Render 3D-tracked 2D HUD overlays
  for (const op of world.hudQueue) {
    try {
      op.draw(ctx, width, height);
    } catch {
      // never fail frame on individual HUD widget
    }
  }
  ctx.restore();

  return { ok: true };
}

/**
 * 4-Frame Offscreen WebGL Verifier for `diorama_3d` worlds:
 * Verifies compile safety, zero runtime crashes, non-blank pixels, anti-washout contrast,
 * real camera/scene motion across 4 frames, AND captures 2 compact JPEG snapshots for Vision Self-Check!
 */
export function verifyDiorama3DOffscreen(params: {
  setupCode: string;
  animateCode: string;
  worldPreset: string;
  project: SynkcutProject;
}): { ok: boolean; error?: string; warning?: string; snapshots?: string[] } {
  const { setupCode, animateCode, worldPreset, project } = params;

  const sCheck = validateBeatCodeSafety(setupCode);
  if (!sCheck.ok) return { ok: false, error: `setupCode: ${sCheck.error}` };
  const aCheck = validateBeatCodeSafety(animateCode);
  if (!aCheck.ok) return { ok: false, error: `animateCode: ${aCheck.error}` };

  const compSetup = compileSetupCode(setupCode);
  if (!compSetup.fn) return { ok: false, error: compSetup.error };
  const compAnim = compileAnimateCode(animateCode);
  if (!compAnim.fn) return { ok: false, error: compAnim.error };

  if (typeof document === "undefined") {
    return { ok: true, warning: "Static compile OK (headless)" };
  }

  const testW = 270;
  const testH = 480;
  const canvas = document.createElement("canvas");
  canvas.width = testW;
  canvas.height = testH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ok: true };

  const tempProject: SynkcutProject = {
    ...project,
    world3d: {
      setupCode,
      animateCode,
      worldPreset,
      summary: project.world3d?.summary || "3D Diorama",
    },
  };

  const scenes = tempProject.scenes.length > 0 ? tempProject.scenes : [];
  if (scenes.length === 0) return { ok: true };
  const totalMs = Math.max(1000, scenes.reduce((m, s) => Math.max(m, s.endMs), 0));

  const samplePoints = [0.08, 0.35, 0.68, 0.92];
  const fingerprints: number[] = [];
  const snapshots: string[] = [];

  for (let sIdx = 0; sIdx < samplePoints.length; sIdx++) {
    const gp = samplePoints[sIdx];
    const tMs = gp * totalMs;
    const sc =
      scenes.find((s) => tMs >= s.startMs && tMs < s.endMs) ?? scenes[scenes.length - 1];
    const sp = clamp((tMs - sc.startMs) / Math.max(500, sc.endMs - sc.startMs));

    ctx.clearRect(0, 0, testW, testH);
    const res = renderDiorama3DFrame({
      ctx,
      width: testW,
      height: testH,
      project: tempProject,
      scene: sc,
      globalTimeMs: tMs,
      sceneProgress: sp,
    });
    if (!res.ok) {
      return { ok: false, error: res.error || "Gagal merender frame 3D." };
    }

    const img = ctx.getImageData(0, 0, testW, testH).data;
    let minL = 255;
    let maxL = 0;
    let checksum = 0;
    let sampledCount = 0;
    let washedOutCount = 0;
    for (let i = 0; i < img.length; i += 4 * 29) {
      const lum = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
      if (lum < minL) minL = lum;
      if (lum > maxL) maxL = lum;
      checksum += lum;
      sampledCount++;
      if (lum > 232) washedOutCount++;
    }
    if (maxL - minL < 18) {
      return {
        ok: false,
        error: "Render 3D terlihat kosong / kontras sangat datar (kamera mungkin terhalang papan/tembok atau tidak menghadap objek).",
      };
    }
    if (sampledCount > 0 && washedOutCount / sampledCount > 0.82) {
      return {
        ok: false,
        error: "Render 3D terlalu putih/silau (overexposed atau kamera terlalu dekat menatap papan putih). Gunakan warna kontras & pastikan tidak ada papan menghalangi kamera!",
      };
    }
    fingerprints.push(checksum);

    if (sIdx === 0 || sIdx === 2) {
      try {
        snapshots.push(canvas.toDataURL("image/jpeg", 0.78));
      } catch {
        // ignore export error
      }
    }
  }

  const maxDiff = Math.max(
    Math.abs(fingerprints[1] - fingerprints[0]),
    Math.abs(fingerprints[2] - fingerprints[1]),
    Math.abs(fingerprints[3] - fingerprints[2])
  );
  if (maxDiff < 15) {
    return {
      ok: true,
      warning: "Gerakan kamera/objek 3D terdeteksi halus.",
      snapshots,
    };
  }

  return { ok: true, snapshots };
}
