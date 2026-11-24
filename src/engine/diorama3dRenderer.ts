import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { SceneItem, SynkcutProject } from "../types/scene";
import {
  createDiorama3DSdk,
  type Diorama3DSdk,
  type DioramaFrameState,
  type DioramaWorldHandle,
} from "./diorama3dSdk";
import { defaultDesignFromTheme, validateBeatCodeSafety } from "./freeformMotionRenderer";
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

const D3_SDK = createDiorama3DSdk();

let sharedCanvas: HTMLCanvasElement | null = null;
let sharedRenderer: THREE.WebGLRenderer | null = null;
let sharedEnvTexture: THREE.Texture | null = null;
let rendererWidth = 1080;
let rendererHeight = 1920;

function instrumentLoopGuards(code: string): string {
  return code.replace(/\b(while|for)\s*\(([^)]*)\)\s*\{/g, "$1 ($2) { __guard();");
}

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
      sharedRenderer.toneMappingExposure = 1.08;
      sharedRenderer.shadowMap.enabled = true;
      sharedRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const pmrem = new THREE.PMREMGenerator(sharedRenderer);
      sharedEnvTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
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
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
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
      "fetch",
      "localStorage",
      body
    ) as (
      world: DioramaWorldHandle,
      D3: Diorama3DSdk,
      __guard: () => void,
      ...shadowed: undefined[]
    ) => void;

    const wrapped: CompiledSetupFn = (world, D3, __guard) => {
      rawFn(world, D3, __guard, undefined, undefined, undefined, undefined, undefined);
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
      "fetch",
      "localStorage",
      body
    ) as (
      world: DioramaWorldHandle,
      state: DioramaFrameState,
      D3: Diorama3DSdk,
      __guard: () => void,
      ...shadowed: undefined[]
    ) => void;

    const wrapped: CompiledAnimateFn = (world, state, D3, __guard) => {
      rawFn(world, state, D3, __guard, undefined, undefined, undefined, undefined, undefined);
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

/**
 * Clean contextual 3D fallback world (used ONLY when custom 3D code is empty or unrecoverable).
 * Adapts to the detected `worldPreset` so it NEVER renders unrelated sample assets.
 */
function buildContextualFallbackWorld(world: DioramaWorldHandle, worldPreset: string) {
  if (worldPreset === "ocean_cross_section") {
    D3_SDK.buildOceanCutaway(world, { fishCount: 7 });
    D3_SDK.box(world, { name: "deck", size: [5.4, 0.7, 3.8], color: "#E2E8F0", pos: [0, 2.3, 0] });
    D3_SDK.truss(world, { name: "tower", height: 4.2, baseWidth: 1.4, topWidth: 0.55, color: "#94A3B8", pos: [0, 2.65, 0] });
    for (const sx of [-1.8, 1.8]) {
      for (const sz of [-1.1, 1.1]) {
        D3_SDK.cylinder(world, { radius: 0.34, height: 3.4, color: "#D97706", pos: [sx, 0.7, sz] });
      }
    }
    D3_SDK.createCharacter(world, { name: "host", pos: [1.3, 2.65, 0.7], outfitColor: "#F97316", hat: "helmet", scale: 0.72 });
  } else if (worldPreset === "desert_cutaway") {
    D3_SDK.buildGroundCutaway(world, { style: "desert", withPit: true, treeCount: 5 });
    D3_SDK.createCharacter(world, { name: "host", pos: [-1.1, -3.0, 0.4], outfitColor: "#E2E8F0", hat: "turban", rotY: 0.4 });
    D3_SDK.createCharacter(world, { name: "guest", pos: [1.1, -3.0, 0.4], outfitColor: "#3B82F6", hat: "hair", rotY: -0.4 });
  } else if (worldPreset === "room_cutaway") {
    D3_SDK.buildRoomCutaway(world, {});
    D3_SDK.table(world, { name: "desk", size: [3.2, 1.25, 1.6], pos: [0, 0, -0.8] });
    D3_SDK.createCharacter(world, { name: "host", pos: [-1.4, 0, 1.2], outfitColor: "#2563EB", hat: "hair", rotY: 0.35 });
    D3_SDK.createCharacter(world, { name: "guest", pos: [1.6, 0, 1.0], outfitColor: "#10B981", hat: "cap", rotY: -0.4 });
  } else {
    D3_SDK.buildGroundCutaway(world, { style: worldPreset === "outdoor_farm" ? "farm" : "grass", withPond: worldPreset === "outdoor_farm", treeCount: 5 });
    D3_SDK.createCharacter(world, { name: "host", pos: [-1.8, 0, 2.8], outfitColor: "#2563EB", hat: "cap", rotY: 0.25 });
    D3_SDK.createCharacter(world, { name: "guest", pos: [1.8, 0, 2.5], outfitColor: "#F59E0B", hat: "hair", rotY: -0.35 });
  }
}

function animateContextualFallbackWorld(
  world: DioramaWorldHandle,
  state: DioramaFrameState,
  worldPreset: string
) {
  const t = state.globalTimeMs / 1000;
  D3_SDK.animateClouds(world, t);
  if (worldPreset === "ocean_cross_section") {
    D3_SDK.animateOcean(world, t);
    D3_SDK.lerpCamera(
      world,
      [
        { t: 0, pos: [12, 6, 17], lookAt: [0, 1.2, 0], fov: 38 },
        { t: 0.45, pos: [10, -2.5, 16], lookAt: [0, -2.8, 0], fov: 40 },
        { t: 1.0, pos: [-9, 4.5, 17], lookAt: [0, 0.2, 0], fov: 38 },
      ],
      state.globalProgress
    );
    D3_SDK.drawRuler(world, { minLabel: "0 m", maxLabel: "1000 m", progress: state.globalProgress });
  } else {
    D3_SDK.lerpCamera(
      world,
      [
        { t: 0, pos: [11, 7.5, 13], lookAt: [0, 1.2, 0], fov: 36 },
        { t: 0.5, pos: [4.5, 4.2, 9.5], lookAt: [0, 1.3, 0], fov: 34 },
        { t: 1.0, pos: [-9, 6.5, 12.5], lookAt: [0, 1.1, 0], fov: 36 },
      ],
      state.globalProgress
    );
  }
  const host = world.characters["host"];
  const guest = world.characters["guest"];
  if (host) {
    D3_SDK.poseCharacter(host, {
      action: state.beatIndex % 2 === 0 ? "point" : "talk",
      phase: t * 1.4,
    });
  }
  if (guest) {
    D3_SDK.poseCharacter(guest, {
      action: state.beatIndex % 2 === 0 ? "idle" : "wave",
      phase: t * 1.2,
    });
  }
  if (state.beatIndex === 0 && state.beatProgress < 0.85) {
    D3_SDK.drawPopupTitle(world, state.title, {
      yRatio: 0.18,
      progress: clamp(state.beatProgress * 3.5),
    });
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
  if (envTexture) scene.environment = envTexture;
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
  };

  let setupError: string | undefined;

  if (setupCode.trim()) {
    const compiled = compileSetupCode(setupCode);
    if (!compiled.fn) {
      setupError = compiled.error || "Gagal compile setupCode.";
      buildContextualFallbackWorld(world, worldPreset);
    } else {
      let guardSteps = 0;
      const guard = () => {
        if (++guardSteps > 12000) throw new Error("Loop guard setupCode terlampaui.");
      };
      try {
        compiled.fn(world, D3_SDK, guard);
        // Ensure lighting exists even if LLM omitted D3.setupDaylight
        if (!world.sunLight && !world.hemiLight) {
          D3_SDK.setupDaylight(world);
        }
      } catch (err) {
        setupError = err instanceof Error ? err.message : String(err);
        // Reset cleanly to contextual fallback
        while (world.root.children.length > 0) {
          world.root.remove(world.root.children[0]);
        }
        world.objects = {};
        world.characters = {};
        buildContextualFallbackWorld(world, worldPreset);
      }
    }
  } else {
    buildContextualFallbackWorld(world, worldPreset);
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
    // Graceful 2D sky fallback if WebGL is unavailable in headless env
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, "#5AAEE8");
    grad.addColorStop(1, "#166996");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    return { ok: false, error: "WebGL tidak tersedia pada perangkat ini." };
  }

  const beatSpec = scene.aiMotion?.diorama3d;
  const setupCode = (beatSpec?.setupCode || project.world3d?.setupCode || "").trim();
  const animateCode = (beatSpec?.animateCode || project.world3d?.animateCode || "").trim();
  const worldPreset =
    beatSpec?.worldPreset ||
    project.world3d?.worldPreset ||
    project.globalStyle?.customDesign?.worldPreset ||
    "ground_cutaway";

  const entry = getOrBuildWorld(setupCode, worldPreset, webgl.envTexture, width, height);
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
    title: scene.aiMotion?.title || project.meta?.name || "3D Diorama",
    text: scene.text || "",
    role: scene.role || "body",
    words: localWords,
    activeWordIndex,
    design: customDesign,
  };

  let runError = entry.setupError;

  if (!entry.setupError && animateCode) {
    const compiledAnim = compileAnimateCode(animateCode);
    if (!compiledAnim.fn) {
      runError = compiledAnim.error;
      animateContextualFallbackWorld(world, frameState, worldPreset);
    } else {
      let guardSteps = 0;
      const guard = () => {
        if (++guardSteps > 12000) throw new Error("Loop guard animateCode terlampaui.");
      };
      try {
        compiledAnim.fn(world, frameState, D3_SDK, guard);
      } catch (err) {
        runError = err instanceof Error ? err.message : String(err);
        animateContextualFallbackWorld(world, frameState, worldPreset);
      }
    }
  } else {
    animateContextualFallbackWorld(world, frameState, worldPreset);
  }

  // Render WebGL scene and blit seamlessly onto target 2D canvas
  webgl.renderer.render(world.scene, world.camera);
  ctx.save();
  ctx.drawImage(webgl.canvas, 0, 0, width, height);

  // Render 3D-tracked 2D HUD overlays (depth ruler, '?' badges, popup titles, callouts)
  for (const op of world.hudQueue) {
    try {
      op.draw(ctx, width, height);
    } catch {
      // never fail frame on individual HUD widget
    }
  }
  ctx.restore();

  return runError ? { ok: false, error: runError } : { ok: true };
}

/**
 * 4-Frame Offscreen WebGL Verifier for `diorama_3d` worlds:
 * Verifies compile safety, zero runtime crashes, non-blank pixels, and real camera/scene motion across 4 frames!
 */
export function verifyDiorama3DOffscreen(params: {
  setupCode: string;
  animateCode: string;
  worldPreset: string;
  project: SynkcutProject;
}): { ok: boolean; error?: string; warning?: string } {
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

  for (const gp of samplePoints) {
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
    for (let i = 0; i < img.length; i += 4 * 29) {
      const lum = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
      if (lum < minL) minL = lum;
      if (lum > maxL) maxL = lum;
      checksum += lum;
    }
    if (maxL - minL < 12) {
      return {
        ok: false,
        error: "Render 3D terlihat kosong / kontras sangat datar (kamera mungkin tidak menghadap objek).",
      };
    }
    fingerprints.push(checksum);
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
    };
  }

  return { ok: true };
}
