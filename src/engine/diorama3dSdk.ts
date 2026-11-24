import * as THREE from "three";
import {
  clamp,
  ease,
  interpolate,
  lerp,
  seededRng,
  spring,
} from "./motionSdk";
import type { CustomDesignDirection, SceneRole, WordTimestamp } from "../types/scene";

export type Vec3Tuple = [number, number, number];

export type CharacterAction =
  | "idle"
  | "point"
  | "wave"
  | "handshake"
  | "walk"
  | "think"
  | "surprised"
  | "sit"
  | "sleep"
  | "talk"
  | "cheer";

export interface CharacterOptions {
  name?: string;
  pos?: Vec3Tuple;
  rotY?: number;
  scale?: number;
  skin?: string;
  outfitColor?: string;
  pantsColor?: string;
  accentColor?: string;
  shoeColor?: string;
  hat?: "none" | "hair" | "peci" | "cap" | "turban" | "helmet" | "hijab";
  hairColor?: string;
  glasses?: boolean;
  mustache?: boolean;
}

export interface CharacterPoseOptions {
  action?: CharacterAction | string;
  phase?: number;
  headTurn?: number;
  headNod?: number;
  rightArmRaise?: number;
  leftArmRaise?: number;
  bodyLean?: number;
}

export interface CharacterRig {
  group: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftBrow: THREE.Mesh;
  rightBrow: THREE.Mesh;
  mouth: THREE.Mesh;
}

export interface CameraKeyframe {
  t: number;
  pos: Vec3Tuple;
  lookAt: Vec3Tuple;
  fov?: number;
}

export interface HudDrawOp {
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}

export interface DioramaWorldHandle {
  scene: THREE.Scene;
  root: THREE.Group;
  camera: THREE.PerspectiveCamera;
  objects: Record<string, THREE.Object3D>;
  characters: Record<string, CharacterRig>;
  data: Record<string, unknown>;
  ownedTextures: THREE.Texture[];
  hudQueue: HudDrawOp[];
  skyColorTop: string;
  skyColorBottom: string;
  sunLight?: THREE.DirectionalLight;
  hemiLight?: THREE.HemisphereLight;
  waterMesh?: THREE.Mesh;
  cloudsGroup?: THREE.Group;
  width: number;
  height: number;
  add?: <T extends THREE.Object3D>(obj: T, name?: string) => T;
}

export interface DioramaFrameState {
  globalTimeMs: number;
  totalDurationMs: number;
  globalProgress: number;
  beatIndex: number;
  beatCount: number;
  beatProgress: number;
  beatTimeMs: number;
  beatDurationMs: number;
  frame: number;
  fps: number;
  width: number;
  height: number;
  u: number;
  title: string;
  text: string;
  role: SceneRole;
  words: WordTimestamp[];
  activeWordIndex: number;
  design: CustomDesignDirection;
}

const SANS_FONT =
  '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function toColor(c: string | number | undefined, fallback = 0xffffff): THREE.Color {
  try {
    if (typeof c === "number") return new THREE.Color(c);
    if (typeof c === "string" && c.trim()) return new THREE.Color(c.trim());
  } catch {
    // ignore bad color string
  }
  return new THREE.Color(fallback);
}

function makeMat(opts?: {
  color?: string | number;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  transparent?: boolean;
  emissive?: string | number;
  emissiveIntensity?: number;
  flatShading?: boolean;
  side?: THREE.Side;
}): THREE.MeshStandardMaterial {
  const opacity = opts?.opacity ?? 1;
  return new THREE.MeshStandardMaterial({
    color: toColor(opts?.color, 0xe5e7eb),
    roughness: clamp(opts?.roughness ?? 0.76, 0.05, 1),
    metalness: clamp(opts?.metalness ?? 0.06, 0, 1),
    opacity,
    transparent: opts?.transparent ?? opacity < 0.99,
    emissive: opts?.emissive ? toColor(opts.emissive, 0x000000) : new THREE.Color(0x000000),
    emissiveIntensity: opts?.emissiveIntensity ?? 0,
    flatShading: opts?.flatShading ?? false,
    side: opts?.side ?? THREE.FrontSide,
  });
}

function applyTransform(
  obj: THREE.Object3D,
  opts?: { pos?: Vec3Tuple; rot?: Vec3Tuple; scale?: Vec3Tuple | number; castShadow?: boolean; receiveShadow?: boolean }
) {
  if (!opts) return;
  if (Array.isArray(opts.pos) && opts.pos.length >= 3) {
    obj.position.set(
      Number(opts.pos[0]) || 0,
      Number(opts.pos[1]) || 0,
      Number(opts.pos[2]) || 0
    );
  }
  if (Array.isArray(opts.rot) && opts.rot.length >= 3) {
    obj.rotation.set(
      Number(opts.rot[0]) || 0,
      Number(opts.rot[1]) || 0,
      Number(opts.rot[2]) || 0
    );
  }
  if (typeof opts.scale === "number" && Number.isFinite(opts.scale)) {
    obj.scale.setScalar(opts.scale);
  } else if (Array.isArray(opts.scale) && opts.scale.length >= 3) {
    obj.scale.set(
      Number(opts.scale[0]) || 1,
      Number(opts.scale[1]) || 1,
      Number(opts.scale[2]) || 1
    );
  }
  const cast = opts.castShadow ?? true;
  const recv = opts.receiveShadow ?? true;
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = cast;
      child.receiveShadow = recv;
    }
  });
}

function createSkyTexture(topHex: string, midHex: string, bottomHex: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 512;
  const x = c.getContext("2d");
  if (x) {
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, topHex);
    g.addColorStop(0.58, midHex);
    g.addColorStop(1, bottomHex);
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 512);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createWaterSurfaceTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const x = c.getContext("2d");
  if (x) {
    x.fillStyle = "#3498c5";
    x.fillRect(0, 0, 256, 256);
    const rng = seededRng(42);
    for (let i = 0; i < 42; i++) {
      const rx = rng() * 256;
      const ry = rng() * 256;
      const rw = 20 + rng() * 64;
      const rh = 4 + rng() * 10;
      x.fillStyle = `rgba(186, 236, 255, ${(0.1 + rng() * 0.16).toFixed(3)})`;
      x.beginPath();
      x.ellipse(rx, ry, rw, rh, 0, 0, Math.PI * 2);
      x.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

type ParentTarget = DioramaWorldHandle | CharacterRig | THREE.Object3D;

let activeWorldRef: DioramaWorldHandle | null = null;

/**
 * Sets the currently executing DioramaWorldHandle so D3 builders can gracefully recover
 * if LLM-generated code omits `world`, passes `undefined`, or passes a `CharacterRig`.
 */
export function setActiveDioramaWorld(world: DioramaWorldHandle | null) {
  activeWorldRef = world;
}

function isWorldHandle(v: unknown): v is DioramaWorldHandle {
  return Boolean(
    v &&
      typeof v === "object" &&
      "root" in v &&
      "scene" in v &&
      (v as DioramaWorldHandle).root &&
      typeof (v as DioramaWorldHandle).root.add === "function"
  );
}

function isCharacterRig(v: unknown): v is CharacterRig {
  return Boolean(
    v &&
      typeof v === "object" &&
      "group" in v &&
      "head" in v &&
      (v as CharacterRig).group &&
      typeof (v as CharacterRig).group.add === "function"
  );
}

function isObject3D(v: unknown): v is THREE.Object3D {
  return Boolean(
    v &&
      typeof v === "object" &&
      typeof (v as THREE.Object3D).add === "function" &&
      "position" in v
  );
}

function isParentTarget(v: unknown): v is ParentTarget {
  return isWorldHandle(v) || isCharacterRig(v) || isObject3D(v);
}

function resolveWorld(maybeWorld?: unknown): DioramaWorldHandle | null {
  if (isWorldHandle(maybeWorld)) return maybeWorld;
  return activeWorldRef;
}

function resolveWorldAndOpts<T extends object>(
  worldOrOpts?: unknown,
  maybeOpts?: T
): { world: DioramaWorldHandle | null; opts: T } {
  if (isWorldHandle(worldOrOpts)) {
    return { world: worldOrOpts, opts: (maybeOpts ?? {}) as T };
  }
  if (
    worldOrOpts &&
    typeof worldOrOpts === "object" &&
    !Array.isArray(worldOrOpts) &&
    maybeOpts === undefined
  ) {
    return { world: activeWorldRef, opts: worldOrOpts as T };
  }
  return { world: activeWorldRef, opts: (maybeOpts ?? {}) as T };
}

function resolveParentAndOpts<T extends object>(
  parentOrOpts?: unknown,
  maybeOpts?: T
): { parent: ParentTarget | null; opts: T } {
  if (isParentTarget(parentOrOpts)) {
    return { parent: parentOrOpts, opts: (maybeOpts ?? {}) as T };
  }
  if (
    parentOrOpts &&
    typeof parentOrOpts === "object" &&
    !Array.isArray(parentOrOpts) &&
    maybeOpts === undefined
  ) {
    return { parent: activeWorldRef, opts: parentOrOpts as T };
  }
  return { parent: activeWorldRef, opts: (maybeOpts ?? {}) as T };
}

function attach3D<T extends THREE.Object3D>(
  parent: ParentTarget | null | undefined,
  obj: T,
  name?: string
): T {
  const w = isWorldHandle(parent) ? parent : activeWorldRef;
  if (isWorldHandle(parent)) {
    parent.root.add(obj);
  } else if (isCharacterRig(parent)) {
    parent.group.add(obj);
  } else if (isObject3D(parent)) {
    parent.add(obj);
  } else if (activeWorldRef) {
    activeWorldRef.root.add(obj);
  }
  if (w && name && typeof name === "string") {
    w.objects[name] = obj;
  }
  return obj;
}

function registerObj<T extends THREE.Object3D>(
  world: DioramaWorldHandle | null | undefined,
  obj: T,
  name?: string
): T {
  const w = resolveWorld(world);
  if (w) {
    w.root.add(obj);
    if (name && typeof name === "string") {
      w.objects[name] = obj;
    }
  }
  return obj;
}

function projectWorldPoint(
  world: DioramaWorldHandle,
  pos3d: Vec3Tuple
): { x: number; y: number; visible: boolean } {
  const v = new THREE.Vector3(
    Number(pos3d[0]) || 0,
    Number(pos3d[1]) || 0,
    Number(pos3d[2]) || 0
  );
  world.camera.updateMatrixWorld();
  v.project(world.camera);
  const x = (v.x * 0.5 + 0.5) * world.width;
  const y = (-v.y * 0.5 + 0.5) * world.height;
  return { x, y, visible: v.z > -1 && v.z < 1 };
}

export function createDiorama3DSdk() {
  return {
    THREE,
    clamp,
    lerp,
    ease,
    spring,
    interpolate,
    rng: seededRng,

    /**
     * Universal 3D Atmosphere & Lighting Builder: works for ANY mood requested by the user's prompt
     * (daylight, night, neon cyberpunk, outer space with stars, warm cafe/sunset, clean dark/light studio).
     */
    setupAtmosphere(
      worldOrOpts?: DioramaWorldHandle | Record<string, unknown>,
      maybeOpts?: {
        bgTop?: string;
        bgMid?: string;
        bgBottom?: string;
        isDark?: boolean;
        ambientColor?: string;
        ambientIntensity?: number;
        keyColor?: string;
        keyIntensity?: number;
        keyPos?: Vec3Tuple;
        fillColor?: string;
        fillIntensity?: number;
        fogColor?: string;
        fogNear?: number;
        fogFar?: number;
        stars?: boolean;
      }
    ) {
      const { world, opts } = resolveWorldAndOpts(worldOrOpts, maybeOpts);
      if (!world) return;
      const isDark = opts?.isDark ?? false;
      const top = opts?.bgTop || (isDark ? "#070B18" : "#5AAEE8");
      const mid = opts?.bgMid || (isDark ? "#101932" : "#A3D7F5");
      const bottom = opts?.bgBottom || (isDark ? "#182442" : "#E6F3FC");
      world.skyColorTop = top;
      world.skyColorBottom = bottom;

      const skyTex = createSkyTexture(top, mid, bottom);
      world.ownedTextures.push(skyTex);
      world.scene.background = skyTex;
      world.scene.fog = new THREE.Fog(
        toColor(opts?.fogColor || bottom, isDark ? 0x101932 : 0xd8eefc),
        opts?.fogNear ?? 36,
        opts?.fogFar ?? 135
      );

      if (world.hemiLight) world.scene.remove(world.hemiLight);
      if (world.sunLight) {
        world.scene.remove(world.sunLight);
        world.scene.remove(world.sunLight.target);
      }

      const hemi = new THREE.HemisphereLight(
        toColor(opts?.ambientColor || (isDark ? "#7AA2F7" : "#DDF1FF"), 0xddf1ff),
        toColor(isDark ? "#1A1B26" : "#9C8A78", 0x9c8a78),
        opts?.ambientIntensity ?? (isDark ? 0.85 : 1.15)
      );
      world.scene.add(hemi);
      world.hemiLight = hemi;

      const key = new THREE.DirectionalLight(
        toColor(opts?.keyColor || (isDark ? "#E0F2FE" : "#FFF6E5"), 0xfff6e5),
        opts?.keyIntensity ?? (isDark ? 2.1 : 2.35)
      );
      const sp = opts?.keyPos ?? [18, 28, 16];
      key.position.set(sp[0], sp[1], sp[2]);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 2;
      key.shadow.camera.far = 110;
      const d = 24;
      key.shadow.camera.left = -d;
      key.shadow.camera.right = d;
      key.shadow.camera.top = d;
      key.shadow.camera.bottom = -d;
      key.shadow.bias = -0.0008;
      key.shadow.normalBias = 0.04;
      world.scene.add(key);
      world.scene.add(key.target);
      world.sunLight = key;

      const fill = new THREE.DirectionalLight(
        toColor(opts?.fillColor || (isDark ? "#A855F7" : "#AAD4FF"), 0xaad4ff),
        opts?.fillIntensity ?? (isDark ? 0.95 : 0.55)
      );
      fill.position.set(-16, 10, -14);
      world.root.add(fill);

      if (opts?.stars) {
        const rand = seededRng(509);
        const starGrp = new THREE.Group();
        const starGeo = new THREE.SphereGeometry(0.11, 6, 6);
        const starMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        for (let i = 0; i < 65; i++) {
          const s = new THREE.Mesh(starGeo, starMat);
          const theta = rand() * Math.PI * 2;
          const phi = Math.acos(2 * rand() - 1);
          const r = 34 + rand() * 24;
          s.position.set(
            r * Math.sin(phi) * Math.cos(theta),
            Math.abs(r * Math.cos(phi)) * 0.8 + 2,
            r * Math.sin(phi) * Math.sin(theta)
          );
          starGrp.add(s);
        }
        registerObj(world, starGrp, "__stars");
      }
    },

    /** Bright daylight PBR sky helper (shorthand for `setupAtmosphere` with warm sun) */
    setupDaylight(
      worldOrOpts?: DioramaWorldHandle | Record<string, unknown>,
      maybeOpts?: {
        skyTop?: string;
        skyMid?: string;
        skyBottom?: string;
        sunColor?: string;
        sunIntensity?: number;
        sunPos?: Vec3Tuple;
        fogColor?: string;
        fogNear?: number;
        fogFar?: number;
      }
    ) {
      const { world, opts } = resolveWorldAndOpts(worldOrOpts, maybeOpts);
      if (!world) return;
      this.setupAtmosphere(world, {
        bgTop: opts?.skyTop || "#5AAEE8",
        bgMid: opts?.skyMid || "#A3D7F5",
        bgBottom: opts?.skyBottom || "#E6F3FC",
        isDark: false,
        keyColor: opts?.sunColor || "#FFF6E5",
        keyIntensity: opts?.sunIntensity ?? 2.35,
        keyPos: opts?.sunPos ?? [18, 28, 16],
        fogColor: opts?.fogColor,
        fogNear: opts?.fogNear,
        fogFar: opts?.fogFar,
      });
    },

    /** Soft Blender-style puffy 3D clouds drifting gently in the upper sky */
    addClouds(
      worldOrOpts?: DioramaWorldHandle | Record<string, unknown>,
      maybeOpts?: { count?: number; y?: number; spreadX?: number; zMin?: number; zMax?: number; seed?: number }
    ) {
      const { world, opts } = resolveWorldAndOpts(worldOrOpts, maybeOpts);
      const count = clamp(opts?.count ?? 6, 1, 14);
      const baseY = opts?.y ?? 11;
      const spreadX = opts?.spreadX ?? 26;
      const zMin = opts?.zMin ?? -28;
      const zMax = opts?.zMax ?? -10;
      const rand = seededRng(opts?.seed ?? 71);

      const group = new THREE.Group();
      const cloudMat = makeMat({ color: "#FFFFFF", roughness: 0.95, metalness: 0.0, opacity: 0.96 });

      for (let i = 0; i < count; i++) {
        const cloud = new THREE.Group();
        const puffs = 3 + Math.floor(rand() * 3);
        for (let p = 0; p < puffs; p++) {
          const r = 1.1 + rand() * 1.1;
          const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), cloudMat);
          mesh.position.set((p - (puffs - 1) / 2) * 1.15, (rand() - 0.35) * 0.45, (rand() - 0.5) * 0.55);
          mesh.scale.set(1.25, 0.72, 0.85);
          cloud.add(mesh);
        }
        cloud.position.set(
          (rand() - 0.5) * spreadX * 2,
          baseY + (rand() - 0.5) * 3.5,
          lerp(zMin, zMax, rand())
        );
        const s = 0.75 + rand() * 0.75;
        cloud.scale.setScalar(s);
        cloud.userData.baseX = cloud.position.x;
        cloud.userData.speed = 0.35 + rand() * 0.45;
        group.add(cloud);
      }

      if (world) world.cloudsGroup = group;
      return registerObj(world, group, "__clouds");
    },

    /** Animate previously created clouds smoothly with time */
    animateClouds(worldOrTime?: DioramaWorldHandle | number, maybeTSec?: number) {
      const world = resolveWorld(worldOrTime);
      const tSec = typeof worldOrTime === "number" ? worldOrTime : Number(maybeTSec ?? 0);
      if (!world || !world.cloudsGroup) return;
      for (const child of world.cloudsGroup.children) {
        const bx = Number(child.userData.baseX ?? 0);
        const spd = Number(child.userData.speed ?? 0.4);
        child.position.x = bx + Math.sin(tSec * 0.25 * spd) * 2.2;
      }
    },

    /** Ocean Cross-Section Diorama (AkuTahu style: bright sky + turquoise water slice + sandy seabed + optional fish) */
    buildOceanCutaway(
      worldOrOpts?: DioramaWorldHandle | Record<string, unknown>,
      maybeOpts?: {
        width?: number;
        depth?: number;
        waterHeight?: number;
        surfaceColor?: string;
        deepColor?: string;
        seabedColor?: string;
        fishCount?: number;
      }
    ) {
      const { world, opts } = resolveWorldAndOpts(worldOrOpts, maybeOpts);
      if (!world) return new THREE.Group();
      this.setupDaylight(world, {
        skyTop: "#4EA8E5",
        skyMid: "#9FD8F7",
        skyBottom: "#E2F4FF",
      });
      this.addClouds(world, { count: 6, y: 9.5 });

      const w = opts?.width ?? 22;
      const d = opts?.depth ?? 16;
      const wh = opts?.waterHeight ?? 11;
      const grp = new THREE.Group();

      // Translucent front-cutaway ocean volume
      const bodyGeo = new THREE.BoxGeometry(w, wh, d);
      const bodyMat = makeMat({
        color: opts?.deepColor || "#116699",
        roughness: 0.22,
        metalness: 0.08,
        opacity: 0.72,
        transparent: true,
      });
      const waterBody = new THREE.Mesh(bodyGeo, bodyMat);
      waterBody.position.set(0, -wh / 2, 0);
      waterBody.receiveShadow = true;
      grp.add(waterBody);

      // Animated rippled surface top plane
      const surfTex = createWaterSurfaceTexture();
      world.ownedTextures.push(surfTex);
      const surfGeo = new THREE.PlaneGeometry(w, d, 24, 24);
      surfGeo.rotateX(-Math.PI / 2);
      const surfMat = new THREE.MeshStandardMaterial({
        map: surfTex,
        color: toColor(opts?.surfaceColor || "#38B6E8", 0x38b6e8),
        roughness: 0.18,
        metalness: 0.12,
        transparent: true,
        opacity: 0.88,
      });
      const surface = new THREE.Mesh(surfGeo, surfMat);
      surface.position.set(0, 0.02, 0);
      surface.receiveShadow = true;
      grp.add(surface);
      world.waterMesh = surface;

      // Sandy seabed + cutaway earth rim
      const bed = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.15, 2.2, d + 0.15),
        makeMat({ color: opts?.seabedColor || "#D6B787", roughness: 0.92 })
      );
      bed.position.set(0, -wh - 1.05, 0);
      bed.receiveShadow = true;
      grp.add(bed);

      // Decorative seabed rocks & coral mounds
      const rand = seededRng(109);
      for (let i = 0; i < 10; i++) {
        const r = 0.35 + rand() * 0.75;
        const rock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(r, 0),
          makeMat({
            color: i % 3 === 0 ? "#A99374" : "#8F7D63",
            roughness: 0.95,
            flatShading: true,
          })
        );
        rock.position.set(
          (rand() - 0.5) * (w * 0.78),
          -wh + r * 0.35,
          (rand() - 0.5) * (d * 0.68)
        );
        rock.scale.set(1.2, 0.65, 1.0);
        grp.add(rock);
      }

      // Swimming mini 3D fish school inside the cross-section
      const fishCount = clamp(opts?.fishCount ?? 7, 0, 18);
      const fishGroup = new THREE.Group();
      for (let i = 0; i < fishCount; i++) {
        const f = this.fish({
          color: i % 2 === 0 ? "#F59E0B" : "#38BDF8",
          scale: 0.32 + rand() * 0.25,
        });
        f.position.set(
          (rand() - 0.5) * (w * 0.62),
          -1.8 - rand() * (wh * 0.62),
          (rand() - 0.5) * (d * 0.55)
        );
        f.userData.baseX = f.position.x;
        f.userData.baseY = f.position.y;
        f.userData.phase = rand() * Math.PI * 2;
        f.userData.dir = i % 2 === 0 ? 1 : -1;
        if (f.userData.dir < 0) f.rotation.y = Math.PI;
        fishGroup.add(f);
      }
      grp.add(fishGroup);
      world.objects["__fishSchool"] = fishGroup;

      return registerObj(world, grp, "__oceanWorld");
    },

    /** Gently animate ocean ripples & swimming fish */
    animateOcean(worldOrTime?: DioramaWorldHandle | number, maybeTSec?: number) {
      const world = resolveWorld(worldOrTime);
      const tSec = typeof worldOrTime === "number" ? worldOrTime : Number(maybeTSec ?? 0);
      if (!world) return;
      if (world.waterMesh) {
        const mat = world.waterMesh.material as THREE.MeshStandardMaterial;
        if (mat.map) {
          mat.map.offset.x = (tSec * 0.06) % 1;
          mat.map.offset.y = Math.sin(tSec * 0.4) * 0.08;
        }
        world.waterMesh.position.y = Math.sin(tSec * 1.8) * 0.06;
      }
      const fishGroup = world.objects["__fishSchool"];
      if (fishGroup) {
        for (const f of fishGroup.children) {
          const bx = Number(f.userData.baseX ?? 0);
          const by = Number(f.userData.baseY ?? -3);
          const ph = Number(f.userData.phase ?? 0);
          const dir = Number(f.userData.dir ?? 1);
          f.position.x = bx + Math.sin(tSec * 0.7 + ph) * 2.2 * dir;
          f.position.y = by + Math.sin(tSec * 1.5 + ph) * 0.24;
          f.rotation.y = (Math.cos(tSec * 0.7 + ph) * dir >= 0 ? 0 : Math.PI) + Math.sin(tSec * 6 + ph) * 0.14;
        }
      }
    },

    /** Ground / Desert / Farm Cutaway World (How Come? & Outdoor Explainer style) */
    buildGroundCutaway(
      worldOrOpts?: DioramaWorldHandle | Record<string, unknown>,
      maybeOpts?: {
        style?: "desert" | "grass" | "farm" | "urban";
        width?: number;
        depth?: number;
        thickness?: number;
        withPit?: boolean;
        pitRadius?: number;
        withPond?: boolean;
        treeCount?: number;
      }
    ) {
      const { world, opts } = resolveWorldAndOpts(worldOrOpts, maybeOpts);
      if (!world) return new THREE.Group();
      const style = opts?.style || "grass";
      const isDesert = style === "desert";
      this.setupDaylight(world, {
        skyTop: isDesert ? "#4FA7E8" : "#56B0EC",
        skyMid: isDesert ? "#A8D8F5" : "#A7DCF8",
        skyBottom: isDesert ? "#F7E9CF" : "#E8F5FE",
        sunColor: isDesert ? "#FFF1D0" : "#FFF8E8",
      });
      this.addClouds(world, { count: isDesert ? 4 : 6, y: 11.5 });

      const w = opts?.width ?? 22;
      const d = opts?.depth ?? 22;
      const thick = opts?.thickness ?? 4.5;
      const grp = new THREE.Group();

      const topColor = isDesert
        ? "#E4BF8A"
        : style === "urban"
          ? "#CBD5E1"
          : "#68B55B";
      const midColor = isDesert ? "#C28A54" : "#8B5E3C";
      const botColor = isDesert ? "#8C5832" : "#5C4033";

      // Main topsoil slab
      const topSlab = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.7, d),
        makeMat({ color: topColor, roughness: 0.92 })
      );
      topSlab.position.set(0, -0.35, 0);
      topSlab.receiveShadow = true;
      grp.add(topSlab);

      // Subsoil cutaway layer
      const midSlab = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.04, thick * 0.55, d - 0.04),
        makeMat({ color: midColor, roughness: 0.95 })
      );
      midSlab.position.set(0, -0.7 - (thick * 0.55) / 2, 0);
      midSlab.receiveShadow = true;
      grp.add(midSlab);

      // Bedrock layer
      const botSlab = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.08, thick * 0.45, d - 0.08),
        makeMat({ color: botColor, roughness: 0.96 })
      );
      botSlab.position.set(0, -0.7 - thick * 0.55 - (thick * 0.45) / 2, 0);
      grp.add(botSlab);

      // Optional recessed circular pit/courtyard (e.g. Tunisia underground house!)
      if (opts?.withPit) {
        const pr = opts.pitRadius ?? 3.6;
        const pitWall = new THREE.Mesh(
          new THREE.CylinderGeometry(pr, pr * 0.92, 3.2, 32, 1, true),
          makeMat({ color: "#B87E4B", roughness: 0.9, side: THREE.DoubleSide })
        );
        pitWall.position.set(0, -1.55, 0);
        grp.add(pitWall);

        const pitFloor = new THREE.Mesh(
          new THREE.CylinderGeometry(pr * 0.93, pr * 0.93, 0.25, 32),
          makeMat({ color: "#DFB887", roughness: 0.92 })
        );
        pitFloor.position.set(0, -3.1, 0);
        pitFloor.receiveShadow = true;
        grp.add(pitFloor);

        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(pr + 0.15, 0.24, 10, 36),
          makeMat({ color: topColor, roughness: 0.9 })
        );
        rim.rotation.x = Math.PI / 2;
        rim.position.set(0, 0.05, 0);
        grp.add(rim);
      }

      // Optional aquaculture/catfish/farm pond
      if (opts?.withPond) {
        const pondRim = new THREE.Mesh(
          new THREE.BoxGeometry(8.4, 0.55, 5.8),
          makeMat({ color: "#94A3B8", roughness: 0.85 })
        );
        pondRim.position.set(0, 0.22, 0);
        pondRim.receiveShadow = true;
        pondRim.castShadow = true;
        grp.add(pondRim);

        const pondWater = new THREE.Mesh(
          new THREE.BoxGeometry(7.6, 0.42, 5.0),
          makeMat({ color: "#2596BE", roughness: 0.16, opacity: 0.88, transparent: true })
        );
        pondWater.position.set(0, 0.34, 0);
        pondWater.receiveShadow = true;
        grp.add(pondWater);
        world.waterMesh = pondWater;
      }

      // Stylized trees around the perimeter
      const treeCount = clamp(opts?.treeCount ?? (style === "urban" ? 2 : 5), 0, 12);
      const rand = seededRng(217);
      for (let i = 0; i < treeCount; i++) {
        const angle = (i / Math.max(1, treeCount)) * Math.PI * 2 + 0.4;
        const rad = Math.min(w, d) * 0.37 + rand() * 1.6;
        const tr = this.tree({
          style: isDesert ? "palm" : i % 2 === 0 ? "round" : "pine",
          scale: 0.85 + rand() * 0.45,
        });
        tr.position.set(Math.cos(angle) * rad, 0, Math.sin(angle) * rad);
        grp.add(tr);
      }

      return registerObj(world, grp, "__groundWorld");
    },

    /** Isometric / Perspective Cutaway Room (Kenapa Yaaa? / Indoor Cafe / Office / Studio style) */
    buildRoomCutaway(
      worldOrOpts?: DioramaWorldHandle | Record<string, unknown>,
      maybeOpts?: {
        width?: number;
        depth?: number;
        height?: number;
        wallColor?: string;
        floorColor?: string;
        trimColor?: string;
      }
    ) {
      const { world, opts } = resolveWorldAndOpts(worldOrOpts, maybeOpts);
      if (!world) return new THREE.Group();
      this.setupDaylight(world, {
        skyTop: "#7AB8E8",
        skyMid: "#C3E2F7",
        skyBottom: "#F1F5F9",
        sunPos: [14, 22, 18],
        sunIntensity: 2.2,
      });

      const w = opts?.width ?? 13;
      const d = opts?.depth ?? 11;
      const h = opts?.height ?? 6.8;
      const grp = new THREE.Group();

      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.5, d),
        makeMat({ color: opts?.floorColor || "#C99A6B", roughness: 0.82 })
      );
      floor.position.set(0, -0.25, 0);
      floor.receiveShadow = true;
      grp.add(floor);

      const wallMat = makeMat({ color: opts?.wallColor || "#F3EFE6", roughness: 0.88 });
      const backWall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.45), wallMat);
      backWall.position.set(0, h / 2, -d / 2);
      backWall.receiveShadow = true;
      backWall.castShadow = true;
      grp.add(backWall);

      const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.45, h, d), wallMat);
      leftWall.position.set(-w / 2, h / 2, 0);
      leftWall.receiveShadow = true;
      leftWall.castShadow = true;
      grp.add(leftWall);

      // Baseboard trim
      const trimMat = makeMat({ color: opts?.trimColor || "#7C5A3C", roughness: 0.78 });
      const trimBack = new THREE.Mesh(new THREE.BoxGeometry(w, 0.35, 0.52), trimMat);
      trimBack.position.set(0, 0.17, -d / 2 + 0.04);
      grp.add(trimBack);

      const trimLeft = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.35, d), trimMat);
      trimLeft.position.set(-w / 2 + 0.04, 0.17, 0);
      grp.add(trimLeft);

      // Bright sunlit window frame on back wall
      const winFrame = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 2.4, 0.56),
        makeMat({ color: "#FFFFFF", roughness: 0.6 })
      );
      winFrame.position.set(2.2, h * 0.58, -d / 2 + 0.02);
      grp.add(winFrame);

      const winGlass = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 2.0, 0.6),
        makeMat({
          color: "#BCE5FF",
          emissive: "#9BD8FF",
          emissiveIntensity: 0.45,
          roughness: 0.15,
        })
      );
      winGlass.position.set(2.2, h * 0.58, -d / 2 + 0.04);
      grp.add(winGlass);

      return registerObj(world, grp, "__roomWorld");
    },

    /** Clean Bright Daylight Pedestal Stage (Architecture / Product / Concept Diorama) */
    buildStudioStage(
      worldOrOpts?: DioramaWorldHandle | Record<string, unknown>,
      maybeOpts?: {
        bgTop?: string;
        bgBottom?: string;
        stageColor?: string;
        radius?: number;
      }
    ) {
      const { world, opts } = resolveWorldAndOpts(worldOrOpts, maybeOpts);
      if (!world) return new THREE.Group();
      this.setupDaylight(world, {
        skyTop: opts?.bgTop || "#CFE6FA",
        skyMid: "#E6F1FC",
        skyBottom: opts?.bgBottom || "#F8FAFC",
      });

      const r = opts?.radius ?? 8.5;
      const grp = new THREE.Group();

      const plinth = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 1.06, 1.1, 48),
        makeMat({ color: opts?.stageColor || "#F1F5F9", roughness: 0.85 })
      );
      plinth.position.set(0, -0.55, 0);
      plinth.receiveShadow = true;
      grp.add(plinth);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r * 0.99, 0.09, 10, 48),
        makeMat({ color: "#CBD5E1", roughness: 0.5, metalness: 0.2 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 0.02, 0);
      grp.add(ring);

      return registerObj(world, grp, "__studioStage");
    },

    /**
     * Stylized Articulated 3D Human Character (Blender clay/explainer look, inspired by Kenapa Yaaa? / How Come?).
     * Supports expressive real-time acting via `D3.poseCharacter(char, { action, phase })`.
     */
    createCharacter(
      worldOrOpts?: DioramaWorldHandle | ParentTarget | CharacterOptions,
      maybeOpts?: CharacterOptions
    ): CharacterRig {
      const { parent, opts } = resolveParentAndOpts<CharacterOptions>(
        worldOrOpts,
        maybeOpts
      );
      const world = isWorldHandle(parent) ? parent : activeWorldRef;
      const group = new THREE.Group();
      const body = new THREE.Group();
      group.add(body);

      const skinMat = makeMat({ color: opts?.skin || "#F2C39B", roughness: 0.72 });
      const outfitMat = makeMat({ color: opts?.outfitColor || "#2B6CB0", roughness: 0.8 });
      const pantsMat = makeMat({ color: opts?.pantsColor || "#2D3748", roughness: 0.85 });
      const shoeMat = makeMat({ color: opts?.shoeColor || "#1A202C", roughness: 0.7 });
      const darkMat = makeMat({ color: "#111827", roughness: 0.4 });
      const whiteMat = makeMat({ color: "#FFFFFF", roughness: 0.35 });
      const hairMat = makeMat({ color: opts?.hairColor || "#1F2937", roughness: 0.85 });

      // Legs (hip pivot at y = 1.02)
      const makeLeg = (xOff: number) => {
        const legPivot = new THREE.Group();
        legPivot.position.set(xOff, 1.02, 0);
        const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.58, 6, 12), pantsMat);
        thigh.position.set(0, -0.42, 0);
        legPivot.add(thigh);
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.42), shoeMat);
        shoe.position.set(0, -0.92, 0.08);
        legPivot.add(shoe);
        return legPivot;
      };
      const leftLeg = makeLeg(-0.21);
      const rightLeg = makeLeg(0.21);
      body.add(leftLeg, rightLeg);

      // Torso
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.62, 8, 16), outfitMat);
      torso.position.set(0, 1.56, 0);
      torso.scale.set(1.05, 1, 0.76);
      body.add(torso);

      // Collar / tie accent
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.22, 0.16, 14),
        makeMat({ color: opts?.accentColor || "#FFFFFF", roughness: 0.7 })
      );
      collar.position.set(0, 2.08, 0.02);
      body.add(collar);

      // Arms (shoulder pivot at y = 1.94)
      const makeArm = (xOff: number) => {
        const armPivot = new THREE.Group();
        armPivot.position.set(xOff, 1.94, 0);
        const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.125, 0.56, 6, 12), outfitMat);
        sleeve.position.set(0, -0.34, 0);
        armPivot.add(sleeve);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skinMat);
        hand.position.set(0, -0.74, 0);
        armPivot.add(hand);
        return armPivot;
      };
      const leftArm = makeArm(-0.48);
      const rightArm = makeArm(0.48);
      body.add(leftArm, rightArm);

      // Head (neck pivot at y = 2.18)
      const head = new THREE.Group();
      head.position.set(0, 2.18, 0);
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 16), skinMat);
      skull.position.set(0, 0.36, 0);
      skull.scale.set(0.95, 1.04, 0.96);
      head.add(skull);

      // Ears
      for (const sx of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), skinMat);
        ear.position.set(sx * 0.39, 0.34, -0.02);
        head.add(ear);
      }

      // Expressive eyes + eyebrows
      for (const sx of [-1, 1]) {
        const eyeW = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), whiteMat);
        eyeW.position.set(sx * 0.145, 0.4, 0.35);
        eyeW.scale.set(1, 1.1, 0.55);
        head.add(eyeW);

        const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), darkMat);
        pupil.position.set(sx * 0.145, 0.4, 0.385);
        head.add(pupil);
      }

      const browGeo = new THREE.BoxGeometry(0.14, 0.036, 0.04);
      const leftBrow = new THREE.Mesh(browGeo, hairMat);
      leftBrow.position.set(-0.145, 0.52, 0.36);
      const rightBrow = new THREE.Mesh(browGeo, hairMat);
      rightBrow.position.set(0.145, 0.52, 0.36);
      head.add(leftBrow, rightBrow);

      // Nose + mouth
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skinMat);
      nose.position.set(0, 0.31, 0.41);
      head.add(nose);

      const mouth = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.03, 0.11, 4, 8),
        makeMat({ color: "#8B3A3A", roughness: 0.6 })
      );
      mouth.rotation.z = Math.PI / 2;
      mouth.position.set(0, 0.19, 0.37);
      head.add(mouth);

      if (opts?.mustache) {
        const stache = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.055, 0.07), hairMat);
        stache.position.set(0, 0.24, 0.39);
        head.add(stache);
      }

      if (opts?.glasses) {
        const gMat = makeMat({ color: "#1E293B", roughness: 0.3, metalness: 0.5 });
        for (const sx of [-1, 1]) {
          const rim = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 18), gMat);
          rim.position.set(sx * 0.15, 0.4, 0.41);
          head.add(rim);
        }
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), gMat);
        bridge.position.set(0, 0.4, 0.41);
        head.add(bridge);
      }

      // Headwear / hair style
      const hat = opts?.hat ?? "hair";
      if (hat === "hair") {
        const cap = new THREE.Mesh(
          new THREE.SphereGeometry(0.435, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
          hairMat
        );
        cap.position.set(0, 0.4, -0.02);
        head.add(cap);
      } else if (hat === "peci") {
        const peci = new THREE.Mesh(
          new THREE.CylinderGeometry(0.36, 0.39, 0.34, 20),
          makeMat({ color: "#111827", roughness: 0.88 })
        );
        peci.position.set(0, 0.72, -0.02);
        head.add(peci);
      } else if (hat === "cap") {
        const crown = new THREE.Mesh(
          new THREE.SphereGeometry(0.43, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
          outfitMat
        );
        crown.position.set(0, 0.44, 0);
        head.add(crown);
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.44, 0.04, 18, 1, false, -0.9, 1.8), outfitMat);
        brim.position.set(0, 0.54, 0.24);
        head.add(brim);
      } else if (hat === "helmet") {
        const helm = new THREE.Mesh(
          new THREE.SphereGeometry(0.46, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
          makeMat({ color: "#FACC15", roughness: 0.32, metalness: 0.1 })
        );
        helm.position.set(0, 0.45, 0);
        head.add(helm);
      } else if (hat === "turban") {
        const wrap = new THREE.Mesh(
          new THREE.TorusGeometry(0.34, 0.15, 10, 22),
          makeMat({ color: "#F8FAFC", roughness: 0.9 })
        );
        wrap.rotation.x = Math.PI / 2;
        wrap.position.set(0, 0.68, 0);
        head.add(wrap);
      }

      body.add(head);

      applyTransform(group, {
        pos: opts?.pos,
        rot: [0, opts?.rotY ?? 0, 0],
        scale: opts?.scale ?? 1,
      });

      const rig: CharacterRig = {
        group,
        body,
        head,
        leftArm,
        rightArm,
        leftLeg,
        rightLeg,
        leftBrow,
        rightBrow,
        mouth,
      };

      attach3D(parent, group, opts?.name);
      if (world && opts?.name) {
        world.objects[opts.name] = group;
        world.characters[opts.name] = rig;
      }
      return rig;
    },

    /** Drive expressive acting poses on a CharacterRig (or character name string) deterministically */
    poseCharacter(
      rigOrName: CharacterRig | string | undefined,
      opts?: CharacterPoseOptions
    ) {
      const rig =
        typeof rigOrName === "string"
          ? activeWorldRef?.characters?.[rigOrName]
          : rigOrName;
      if (!rig || !rig.group) return;
      const action = String(opts?.action || "idle").toLowerCase();
      const ph = Number(opts?.phase ?? 0);

      // Reset to clean neutral
      rig.body.position.set(0, 0, 0);
      rig.body.rotation.set(opts?.bodyLean ?? 0, 0, 0);
      rig.head.rotation.set(opts?.headNod ?? 0, opts?.headTurn ?? 0, 0);
      rig.leftArm.rotation.set(0, 0, 0.12);
      rig.rightArm.rotation.set(0, 0, -0.12);
      rig.leftLeg.rotation.set(0, 0, 0);
      rig.rightLeg.rotation.set(0, 0, 0);
      rig.leftBrow.position.y = 0.52;
      rig.rightBrow.position.y = 0.52;
      rig.leftBrow.rotation.z = 0;
      rig.rightBrow.rotation.z = 0;
      rig.mouth.scale.set(1, 1, 1);

      const breathe = Math.sin(ph * 2.4) * 0.03;
      rig.body.position.y = breathe;

      if (action === "talk") {
        rig.rightArm.rotation.x = -0.75 + Math.sin(ph * 6.5) * 0.28;
        rig.leftArm.rotation.x = -0.35 + Math.cos(ph * 5.2) * 0.2;
        rig.head.rotation.x += Math.sin(ph * 4.5) * 0.09;
        rig.mouth.scale.set(1, 1 + Math.abs(Math.sin(ph * 12)) * 1.4, 1);
      } else if (action === "point") {
        rig.rightArm.rotation.x = -1.45;
        rig.rightArm.rotation.z = -0.2;
        rig.leftArm.rotation.x = -0.25;
        rig.head.rotation.y += 0.12;
        rig.mouth.scale.set(1, 1.4 + Math.abs(Math.sin(ph * 10)) * 0.8, 1);
      } else if (action === "wave") {
        rig.rightArm.rotation.z = -2.4 + Math.sin(ph * 9) * 0.35;
        rig.rightArm.rotation.x = -0.3;
        rig.head.rotation.z = Math.sin(ph * 4.5) * 0.08;
      } else if (action === "cheer") {
        rig.leftArm.rotation.z = 2.55 + Math.sin(ph * 8) * 0.18;
        rig.rightArm.rotation.z = -2.55 - Math.sin(ph * 8) * 0.18;
        rig.body.position.y = Math.abs(Math.sin(ph * 6)) * 0.32;
        rig.mouth.scale.set(1.3, 1.8, 1);
      } else if (action === "handshake") {
        rig.rightArm.rotation.x = -1.05 + Math.sin(ph * 7) * 0.16;
        rig.rightArm.rotation.y = 0.25;
        rig.body.rotation.x += 0.08;
      } else if (action === "walk") {
        const swing = Math.sin(ph * 7.5);
        rig.leftLeg.rotation.x = swing * 0.55;
        rig.rightLeg.rotation.x = -swing * 0.55;
        rig.leftArm.rotation.x = -swing * 0.45;
        rig.rightArm.rotation.x = swing * 0.45;
        rig.body.position.y = Math.abs(swing) * 0.12;
      } else if (action === "think") {
        rig.rightArm.rotation.x = -1.85;
        rig.rightArm.rotation.z = 0.45;
        rig.head.rotation.x += 0.14;
        rig.head.rotation.z = -0.1;
        rig.leftBrow.rotation.z = 0.14;
        rig.rightBrow.position.y = 0.56;
      } else if (action === "surprised") {
        rig.leftArm.rotation.x = -1.1;
        rig.leftArm.rotation.z = 0.65;
        rig.rightArm.rotation.x = -1.1;
        rig.rightArm.rotation.z = -0.65;
        rig.leftBrow.position.y = 0.59;
        rig.rightBrow.position.y = 0.59;
        rig.mouth.scale.set(0.8, 2.2, 1);
      } else if (action === "sit") {
        rig.body.position.y = -0.45;
        rig.leftLeg.rotation.x = -1.45;
        rig.rightLeg.rotation.x = -1.45;
        rig.leftArm.rotation.x = -0.5;
        rig.rightArm.rotation.x = -0.5;
      } else if (action === "sleep") {
        rig.body.rotation.x = -Math.PI / 2;
        rig.body.position.y = 0.35;
        rig.leftArm.rotation.x = -0.2;
        rig.rightArm.rotation.x = -0.2;
      } else {
        // idle subtle alive motion
        rig.leftArm.rotation.x = Math.sin(ph * 1.8) * 0.07;
        rig.rightArm.rotation.x = -Math.sin(ph * 1.8) * 0.07;
        rig.head.rotation.y += Math.sin(ph * 1.1) * 0.08;
      }

      if (typeof opts?.rightArmRaise === "number") {
        rig.rightArm.rotation.x = -opts.rightArmRaise;
      }
      if (typeof opts?.leftArmRaise === "number") {
        rig.leftArm.rotation.x = -opts.leftArmRaise;
      }
    },

    /* ==================== PROCEDURAL 3D PROP BUILDERS ==================== */

    /** Attach any custom THREE.Object3D to world/parent (accepts `(parent, obj, name?)` OR `(obj, name?)`) */
    add<T extends THREE.Object3D>(
      parentOrObj: ParentTarget | T | null | undefined,
      maybeObjOrName?: T | string,
      maybeName?: string
    ): T | null {
      if (isParentTarget(parentOrObj) && maybeObjOrName && typeof maybeObjOrName === "object" && isObject3D(maybeObjOrName)) {
        return attach3D(parentOrObj, maybeObjOrName as T, maybeName);
      }
      if (isObject3D(parentOrObj)) {
        const name = typeof maybeObjOrName === "string" ? maybeObjOrName : maybeName;
        return attach3D(activeWorldRef, parentOrObj as T, name);
      }
      if (maybeObjOrName && typeof maybeObjOrName === "object" && isObject3D(maybeObjOrName)) {
        return attach3D(activeWorldRef, maybeObjOrName as T, maybeName);
      }
      return null;
    },

    group(
      parentOrOpts?: ParentTarget | { name?: string; pos?: Vec3Tuple; rot?: Vec3Tuple; scale?: Vec3Tuple | number } | null,
      maybeOpts?: { name?: string; pos?: Vec3Tuple; rot?: Vec3Tuple; scale?: Vec3Tuple | number }
    ) {
      const { parent, opts } = resolveParentAndOpts(parentOrOpts, maybeOpts);
      const g = new THREE.Group();
      applyTransform(g, opts);
      return attach3D(parent, g, opts?.name);
    },

    box(
      parentOrOpts?: ParentTarget | Record<string, unknown> | null,
      maybeOpts?: {
        name?: string;
        size?: Vec3Tuple;
        color?: string | number;
        roughness?: number;
        metalness?: number;
        opacity?: number;
        emissive?: string | number;
        emissiveIntensity?: number;
        pos?: Vec3Tuple;
        rot?: Vec3Tuple;
        scale?: Vec3Tuple | number;
      }
    ) {
      const { parent, opts } = resolveParentAndOpts(parentOrOpts, maybeOpts);
      const s = Array.isArray(opts?.size) ? opts.size : [1, 1, 1];
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(Number(s[0]) || 1, Number(s[1]) || 1, Number(s[2]) || 1),
        makeMat(opts)
      );
      applyTransform(mesh, opts);
      return attach3D(parent, mesh, opts?.name);
    },

    /** Rounded/chamfer-friendly box alias (never fails if LLM calls `D3.roundedBox`) */
    roundedBox(
      parentOrOpts?: ParentTarget | Record<string, unknown> | null,
      maybeOpts?: {
        name?: string;
        size?: Vec3Tuple;
        radius?: number;
        color?: string | number;
        roughness?: number;
        metalness?: number;
        opacity?: number;
        emissive?: string | number;
        emissiveIntensity?: number;
        pos?: Vec3Tuple;
        rot?: Vec3Tuple;
        scale?: Vec3Tuple | number;
      }
    ) {
      return this.box(parentOrOpts, maybeOpts);
    },

    /** Flat 3D plane (ground patches, screens, signs, water surfaces) */
    plane(
      parentOrOpts?: ParentTarget | Record<string, unknown> | null,
      maybeOpts?: {
        name?: string;
        size?: [number, number] | Vec3Tuple;
        width?: number;
        height?: number;
        color?: string | number;
        roughness?: number;
        metalness?: number;
        opacity?: number;
        emissive?: string | number;
        emissiveIntensity?: number;
        pos?: Vec3Tuple;
        rot?: Vec3Tuple;
        scale?: Vec3Tuple | number;
      }
    ) {
      const { parent, opts } = resolveParentAndOpts(parentOrOpts, maybeOpts);
      const w = opts?.width ?? (Array.isArray(opts?.size) ? Number(opts.size[0]) : 2) ?? 2;
      const h = opts?.height ?? (Array.isArray(opts?.size) ? Number(opts.size[1]) : 2) ?? 2;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w || 2, h || 2),
        makeMat({ ...opts, side: THREE.DoubleSide })
      );
      applyTransform(mesh, opts);
      return attach3D(parent, mesh, opts?.name);
    },

    /** Smooth 3D capsule (submarines, server pods, pills, limbs) */
    capsule(
      parentOrOpts?: ParentTarget | Record<string, unknown> | null,
      maybeOpts?: {
        name?: string;
        radius?: number;
        length?: number;
        height?: number;
        color?: string | number;
        roughness?: number;
        metalness?: number;
        opacity?: number;
        emissive?: string | number;
        emissiveIntensity?: number;
        pos?: Vec3Tuple;
        rot?: Vec3Tuple;
        scale?: Vec3Tuple | number;
      }
    ) {
      const { parent, opts } = resolveParentAndOpts(parentOrOpts, maybeOpts);
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(opts?.radius ?? 0.45, opts?.length ?? opts?.height ?? 1.2, 8, 16),
        makeMat(opts)
      );
      applyTransform(mesh, opts);
      return attach3D(parent, mesh, opts?.name);
    },

    cylinder(
      parentOrOpts?: ParentTarget | Record<string, unknown> | null,
      maybeOpts?: {
        name?: string;
        rTop?: number;
        rBottom?: number;
        radius?: number;
        height?: number;
        segments?: number;
        color?: string | number;
        roughness?: number;
        metalness?: number;
        opacity?: number;
        emissive?: string | number;
        emissiveIntensity?: number;
        pos?: Vec3Tuple;
        rot?: Vec3Tuple;
        scale?: Vec3Tuple | number;
      }
    ) {
      const { parent, opts } = resolveParentAndOpts(parentOrOpts, maybeOpts);
      const rt = opts?.rTop ?? opts?.radius ?? 0.5;
      const rb = opts?.rBottom ?? opts?.radius ?? rt;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(rt, rb, opts?.height ?? 1.5, opts?.segments ?? 20),
        makeMat(opts)
      );
      applyTransform(mesh, opts);
      return attach3D(parent, mesh, opts?.name);
    },

    sphere(
      parentOrOpts?: ParentTarget | Record<string, unknown> | null,
      maybeOpts?: {
        name?: string;
        radius?: number;
        color?: string | number;
        roughness?: number;
        metalness?: number;
        opacity?: number;
        emissive?: string | number;
        emissiveIntensity?: number;
        pos?: Vec3Tuple;
        rot?: Vec3Tuple;
        scale?: Vec3Tuple | number;
      }
    ) {
      const { parent, opts } = resolveParentAndOpts(parentOrOpts, maybeOpts);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(opts?.radius ?? 0.6, 20, 16),
        makeMat(opts)
      );
      applyTransform(mesh, opts);
      return attach3D(parent, mesh, opts?.name);
    },

    cone(
      parentOrOpts?: ParentTarget | Record<string, unknown> | null,
      maybeOpts?: {
        name?: string;
        radius?: number;
        height?: number;
        segments?: number;
        color?: string | number;
        roughness?: number;
        metalness?: number;
        opacity?: number;
        emissive?: string | number;
        emissiveIntensity?: number;
        pos?: Vec3Tuple;
        rot?: Vec3Tuple;
        scale?: Vec3Tuple | number;
      }
    ) {
      const { parent, opts } = resolveParentAndOpts(parentOrOpts, maybeOpts);
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(opts?.radius ?? 0.7, opts?.height ?? 1.6, opts?.segments ?? 18),
        makeMat(opts)
      );
      applyTransform(mesh, opts);
      return attach3D(parent, mesh, opts?.name);
    },

    torus(
      parentOrOpts?: ParentTarget | Record<string, unknown> | null,
      maybeOpts?: {
        name?: string;
        radius?: number;
        tube?: number;
        color?: string | number;
        roughness?: number;
        metalness?: number;
        opacity?: number;
        emissive?: string | number;
        emissiveIntensity?: number;
        pos?: Vec3Tuple;
        rot?: Vec3Tuple;
        scale?: Vec3Tuple | number;
      }
    ) {
      const { parent, opts } = resolveParentAndOpts(parentOrOpts, maybeOpts);
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(opts?.radius ?? 1.2, opts?.tube ?? 0.22, 12, 32),
        makeMat(opts)
      );
      applyTransform(mesh, opts);
      return attach3D(parent, mesh, opts?.name);
    },

    /** Smooth curved pipe/cable/mooring line/arch along 3D control points (accepts `(parent, pts, opts)` OR `(pts, opts)`) */
    tube(
      parentOrPoints?: ParentTarget | Vec3Tuple[] | null,
      pointsOrOpts?: Vec3Tuple[] | Record<string, unknown>,
      maybeOpts?: {
        name?: string;
        radius?: number;
        segments?: number;
        color?: string | number;
        roughness?: number;
        metalness?: number;
        opacity?: number;
        emissive?: string | number;
        emissiveIntensity?: number;
      }
    ) {
      const firstIsPoints = Array.isArray(parentOrPoints);
      const parent = firstIsPoints
        ? activeWorldRef
        : isParentTarget(parentOrPoints)
          ? parentOrPoints
          : activeWorldRef;
      const points = firstIsPoints
        ? (parentOrPoints as Vec3Tuple[])
        : Array.isArray(pointsOrOpts)
          ? (pointsOrOpts as Vec3Tuple[])
          : [];
      const opts = (firstIsPoints ? pointsOrOpts : maybeOpts) as
        | {
            name?: string;
            radius?: number;
            segments?: number;
            color?: string | number;
            roughness?: number;
            metalness?: number;
            opacity?: number;
            emissive?: string | number;
            emissiveIntensity?: number;
          }
        | undefined;
      const vecs = (Array.isArray(points) && points.length >= 2 ? points : [[0, 0, 0], [0, 2, 0]]).map(
        (p) => new THREE.Vector3(Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0)
      );
      const curve = new THREE.CatmullRomCurve3(vecs);
      const mesh = new THREE.Mesh(
        new THREE.TubeGeometry(curve, opts?.segments ?? 28, opts?.radius ?? 0.12, 10, false),
        makeMat(opts)
      );
      applyTransform(mesh, {});
      return attach3D(parent, mesh, opts?.name);
    },

    /** Industrial lattice truss / derrick tower (oil rig, crane, radio tower, stadium mast) */
    truss(
      parentOrOpts?: ParentTarget | Record<string, unknown> | null,
      maybeOpts?: {
        name?: string;
        height?: number;
        baseWidth?: number;
        topWidth?: number;
        levels?: number;
        color?: string | number;
        pos?: Vec3Tuple;
        rot?: Vec3Tuple;
        scale?: Vec3Tuple | number;
      }
    ) {
      const { parent, opts } = resolveParentAndOpts(parentOrOpts, maybeOpts);
      const h = opts?.height ?? 4.5;
      const bw = opts?.baseWidth ?? 1.4;
      const tw = opts?.topWidth ?? 0.55;
      const levels = clamp(opts?.levels ?? 4, 2, 8);
      const mat = makeMat({ color: opts?.color || "#CBD5E1", roughness: 0.45, metalness: 0.55 });
      const grp = new THREE.Group();

      const corners: Array<[number, number]> = [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ];

      for (const [cx, cz] of corners) {
        const p0 = new THREE.Vector3(cx * bw, 0, cz * bw);
        const p1 = new THREE.Vector3(cx * tw, h, cz * tw);
        const dir = p1.clone().sub(p0);
        const len = dir.length();
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 8), mat);
        beam.position.copy(p0).add(p1).multiplyScalar(0.5);
        beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        grp.add(beam);
      }

      for (let lv = 0; lv <= levels; lv++) {
        const q = lv / levels;
        const w = lerp(bw, tw, q);
        const y = q * h;
        for (let i = 0; i < 4; i++) {
          const [x0, z0] = corners[i];
          const [x1, z1] = corners[(i + 1) % 4];
          const a = new THREE.Vector3(x0 * w, y, z0 * w);
          const b = new THREE.Vector3(x1 * w, y, z1 * w);
          const d = b.clone().sub(a);
          const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, d.length(), 6), mat);
          bar.position.copy(a).add(b).multiplyScalar(0.5);
          bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
          grp.add(bar);
        }
      }

      applyTransform(grp, { pos: opts?.pos, rot: opts?.rot, scale: opts?.scale });
      return attach3D(parent, grp, opts?.name);
    },

    /** Stylized 3D tree (palm / round / pine) — accepts `(world/parent, opts)` OR `(opts)` */
    tree(
      parentOrOpts?: ParentTarget | { name?: string; style?: "palm" | "round" | "pine"; scale?: number; pos?: Vec3Tuple } | null,
      maybeOpts?: { name?: string; style?: "palm" | "round" | "pine"; scale?: number; pos?: Vec3Tuple }
    ): THREE.Group {
      const hasExplicitParent = isParentTarget(parentOrOpts) || maybeOpts !== undefined;
      const { parent, opts } = resolveParentAndOpts(parentOrOpts, maybeOpts);
      const style = opts?.style ?? "round";
      const grp = new THREE.Group();
      const trunkMat = makeMat({ color: "#7C4D2B", roughness: 0.92 });
      const leafMat = makeMat({ color: style === "palm" ? "#4CAF50" : "#3E9B4F", roughness: 0.85 });

      if (style === "palm") {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 3.2, 10), trunkMat);
        trunk.position.set(0, 1.6, 0);
        trunk.rotation.z = 0.08;
        grp.add(trunk);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const frond = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 1.65), leafMat);
          frond.position.set(Math.sin(a) * 0.72, 3.15, Math.cos(a) * 0.72);
          frond.rotation.y = a;
          frond.rotation.x = 0.38;
          grp.add(frond);
        }
      } else if (style === "pine") {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.4, 10), trunkMat);
        trunk.position.set(0, 0.7, 0);
        grp.add(trunk);
        for (let lv = 0; lv < 3; lv++) {
          const c = new THREE.Mesh(
            new THREE.ConeGeometry(1.1 - lv * 0.24, 1.45, 10),
            leafMat
          );
          c.position.set(0, 1.6 + lv * 0.75, 0);
          grp.add(c);
        }
      } else {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.6, 10), trunkMat);
        trunk.position.set(0, 0.8, 0);
        grp.add(trunk);
        const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05, 1), leafMat);
        crown.position.set(0, 2.25, 0);
        grp.add(crown);
      }

      applyTransform(grp, { pos: opts?.pos, scale: opts?.scale ?? 1 });
      if (hasExplicitParent) {
        return attach3D(parent, grp, opts?.name);
      }
      return grp;
    },

    /** Simple 3D wooden table/desk prop */
    table(
      parentOrOpts?: ParentTarget | Record<string, unknown> | null,
      maybeOpts?: { name?: string; size?: Vec3Tuple; color?: string; pos?: Vec3Tuple; rotY?: number }
    ) {
      const { parent, opts } = resolveParentAndOpts(parentOrOpts, maybeOpts);
      const [w, h, d] = Array.isArray(opts?.size) ? opts.size : [2.8, 1.2, 1.5];
      const mat = makeMat({ color: opts?.color || "#9C6B3B", roughness: 0.78 });
      const grp = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d), mat);
      top.position.set(0, h, 0);
      grp.add(top);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, h, 0.14), mat);
          leg.position.set(sx * (w / 2 - 0.18), h / 2, sz * (d / 2 - 0.18));
          grp.add(leg);
        }
      }
      applyTransform(grp, { pos: opts?.pos, rot: [0, opts?.rotY ?? 0, 0] });
      return attach3D(parent, grp, opts?.name);
    },

    /** Cute low-poly 3D fish for ocean / pond dioramas — accepts `(world/parent, opts)` OR `(opts)` */
    fish(
      parentOrOpts?: ParentTarget | { name?: string; color?: string; scale?: number; pos?: Vec3Tuple } | null,
      maybeOpts?: { name?: string; color?: string; scale?: number; pos?: Vec3Tuple }
    ): THREE.Group {
      const hasExplicitParent = isParentTarget(parentOrOpts) || maybeOpts !== undefined;
      const { parent, opts } = resolveParentAndOpts(parentOrOpts, maybeOpts);
      const grp = new THREE.Group();
      const mat = makeMat({ color: opts?.color || "#F59E0B", roughness: 0.5 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), mat);
      body.scale.set(1.55, 0.78, 0.58);
      grp.add(body);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.5, 4), mat);
      tail.rotation.z = -Math.PI / 2;
      tail.position.set(-0.78, 0, 0);
      grp.add(tail);
      applyTransform(grp, { pos: opts?.pos, scale: opts?.scale ?? 1 });
      if (hasExplicitParent) {
        return attach3D(parent, grp, opts?.name);
      }
      return grp;
    },

    /** Floating 3D bubble/sparkle/steam particle cluster */
    particles3D(
      parentOrOpts?: ParentTarget | Record<string, unknown> | null,
      maybeOpts?: { name?: string; count?: number; area?: Vec3Tuple; center?: Vec3Tuple; color?: string; radius?: number; seed?: number }
    ) {
      const { parent, opts } = resolveParentAndOpts(parentOrOpts, maybeOpts);
      const count = clamp(opts?.count ?? 24, 4, 80);
      const area = Array.isArray(opts?.area) ? opts.area : [6, 5, 6];
      const center = Array.isArray(opts?.center) ? opts.center : [0, 2, 0];
      const rand = seededRng(opts?.seed ?? 303);
      const mat = makeMat({
        color: opts?.color || "#FFFFFF",
        roughness: 0.3,
        opacity: 0.72,
        transparent: true,
      });
      const geo = new THREE.SphereGeometry(opts?.radius ?? 0.09, 8, 8);
      const grp = new THREE.Group();
      for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(
          center[0] + (rand() - 0.5) * area[0],
          center[1] + (rand() - 0.5) * area[1],
          center[2] + (rand() - 0.5) * area[2]
        );
        m.userData.baseY = m.position.y;
        m.userData.phase = rand() * Math.PI * 2;
        grp.add(m);
      }
      return attach3D(parent, grp, opts?.name || "__particles");
    },

    /* ==================== CONTINUOUS 3D CAMERA CHOREOGRAPHY ==================== */

    setCamera(
      worldOrPos: DioramaWorldHandle | Vec3Tuple | null | undefined,
      posOrLookAt?: Vec3Tuple,
      lookAtOrFov?: Vec3Tuple | number,
      maybeFov = 38
    ) {
      const firstIsPos = Array.isArray(worldOrPos);
      const world = firstIsPos ? activeWorldRef : resolveWorld(worldOrPos);
      if (!world) return;
      const pos = firstIsPos ? (worldOrPos as Vec3Tuple) : posOrLookAt;
      const lookAt = firstIsPos
        ? posOrLookAt
        : Array.isArray(lookAtOrFov)
          ? (lookAtOrFov as Vec3Tuple)
          : undefined;
      const fov = firstIsPos
        ? typeof lookAtOrFov === "number"
          ? lookAtOrFov
          : 38
        : typeof lookAtOrFov === "number"
          ? lookAtOrFov
          : maybeFov;
      const safePos = Array.isArray(pos) ? pos : [0, 4, 14];
      const safeLook = Array.isArray(lookAt) ? lookAt : [0, 0, 0];
      world.camera.position.set(
        Number(safePos[0]) || 0,
        Number(safePos[1]) || 4,
        Number(safePos[2]) || 14
      );
      world.camera.lookAt(
        Number(safeLook[0]) || 0,
        Number(safeLook[1]) || 0,
        Number(safeLook[2]) || 0
      );
      const safeFov = clamp(Number(fov) || 38, 18, 72);
      if (Math.abs(world.camera.fov - safeFov) > 0.05) {
        world.camera.fov = safeFov;
        world.camera.updateProjectionMatrix();
      }
    },

    lerpCamera(
      worldOrKeyframes: DioramaWorldHandle | CameraKeyframe[] | null | undefined,
      keyframesOrProgress?: CameraKeyframe[] | number,
      maybeProgress?: number
    ) {
      const firstIsKf = Array.isArray(worldOrKeyframes);
      const world = firstIsKf ? activeWorldRef : resolveWorld(worldOrKeyframes);
      const keyframes = firstIsKf
        ? (worldOrKeyframes as CameraKeyframe[])
        : Array.isArray(keyframesOrProgress)
          ? (keyframesOrProgress as CameraKeyframe[])
          : [];
      const progress = firstIsKf
        ? Number(keyframesOrProgress ?? 0)
        : Number(maybeProgress ?? 0);
      if (!world || !Array.isArray(keyframes) || keyframes.length === 0) return;
      const sorted = [...keyframes].sort((a, b) => a.t - b.t);
      const p = clamp(progress, 0, 1);
      if (p <= sorted[0].t || sorted.length === 1) {
        this.setCamera(world, sorted[0].pos, sorted[0].lookAt, sorted[0].fov ?? 38);
        return;
      }
      const last = sorted[sorted.length - 1];
      if (p >= last.t) {
        this.setCamera(world, last.pos, last.lookAt, last.fov ?? 38);
        return;
      }
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (p >= a.t && p <= b.t) {
          const span = Math.max(1e-5, b.t - a.t);
          const local = ease.inOutCubic((p - a.t) / span);
          const pos: Vec3Tuple = [
            lerp(a.pos[0], b.pos[0], local),
            lerp(a.pos[1], b.pos[1], local),
            lerp(a.pos[2], b.pos[2], local),
          ];
          const lookAt: Vec3Tuple = [
            lerp(a.lookAt[0], b.lookAt[0], local),
            lerp(a.lookAt[1], b.lookAt[1], local),
            lerp(a.lookAt[2], b.lookAt[2], local),
          ];
          const fov = lerp(a.fov ?? 38, b.fov ?? 38, local);
          this.setCamera(world, pos, lookAt, fov);
          return;
        }
      }
    },

    /* ==================== 3D-TRACKED 2D HUD OVERLAYS ==================== */

    projectTo2D(worldOrPos: DioramaWorldHandle | Vec3Tuple | null | undefined, maybePos3d?: Vec3Tuple) {
      const firstIsPos = Array.isArray(worldOrPos);
      const world = firstIsPos ? activeWorldRef : resolveWorld(worldOrPos);
      const pos3d = firstIsPos ? (worldOrPos as Vec3Tuple) : (maybePos3d ?? [0, 0, 0]);
      if (!world) return { x: 0, y: 0, visible: false };
      return projectWorldPoint(world, pos3d);
    },

    /** AkuTahu-style vertical left-margin depth/height ruler with animated indicator dot */
    drawRuler(
      worldOrOpts?: DioramaWorldHandle | Record<string, unknown> | null,
      maybeOpts?: { minLabel?: string; maxLabel?: string; progress?: number; accent?: string }
    ) {
      const { world, opts } = resolveWorldAndOpts(worldOrOpts, maybeOpts);
      if (!world) return;
      const minLabel = opts?.minLabel || "0 m";
      const maxLabel = opts?.maxLabel || "1500 m";
      const prog = clamp(opts?.progress ?? 0.5);
      const accent = opts?.accent || "#FACC15";

      world.hudQueue.push({
        draw: (ctx, width, height) => {
          const u = width / 1080;
          const x = width * 0.085;
          const yTop = height * 0.22;
          const yBot = height * 0.72;
          const span = yBot - yTop;

          ctx.save();
          // Vertical ruler spine
          ctx.strokeStyle = "rgba(255,255,255,0.88)";
          ctx.lineWidth = 4 * u;
          ctx.beginPath();
          ctx.moveTo(x, yTop);
          ctx.lineTo(x, yBot);
          ctx.stroke();

          // Tick marks
          for (let i = 0; i <= 10; i++) {
            const ty = yTop + (span * i) / 10;
            const len = i % 5 === 0 ? 22 * u : 12 * u;
            ctx.beginPath();
            ctx.moveTo(x, ty);
            ctx.lineTo(x + len, ty);
            ctx.stroke();
          }

          // Labels with dark backing shadow
          ctx.font = `800 ${Math.round(28 * u)}px ${SANS_FONT}`;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.lineWidth = 6 * u;
          ctx.strokeStyle = "rgba(10,14,22,0.82)";
          ctx.fillStyle = "#FFFFFF";
          ctx.strokeText(minLabel, x + 30 * u, yTop);
          ctx.fillText(minLabel, x + 30 * u, yTop);
          ctx.strokeText(maxLabel, x + 30 * u, yBot);
          ctx.fillText(maxLabel, x + 30 * u, yBot);

          // Moving depth indicator dot
          const dotY = yTop + span * prog;
          ctx.beginPath();
          ctx.arc(x, dotY, 13 * u, 0, Math.PI * 2);
          ctx.fillStyle = accent;
          ctx.fill();
          ctx.lineWidth = 4 * u;
          ctx.strokeStyle = "#111827";
          ctx.stroke();
          ctx.restore();
        },
      });
    },

    /** Floating badge anchored directly to a 3D world point (e.g. yellow '?' or 'TVRI' or '1200m') */
    drawBadgeAt3D(
      worldOrPos: DioramaWorldHandle | Vec3Tuple | null | undefined,
      posOrOpts?: Vec3Tuple | { text?: string; bg?: string; textColor?: string; scale?: number; pulse?: number },
      maybeOpts?: { text?: string; bg?: string; textColor?: string; scale?: number; pulse?: number }
    ) {
      const firstIsPos = Array.isArray(worldOrPos);
      const world = firstIsPos ? activeWorldRef : resolveWorld(worldOrPos);
      const pos3d = firstIsPos
        ? (worldOrPos as Vec3Tuple)
        : Array.isArray(posOrOpts)
          ? (posOrOpts as Vec3Tuple)
          : ([0, 0, 0] as Vec3Tuple);
      const opts = (firstIsPos ? posOrOpts : maybeOpts) as
        | { text?: string; bg?: string; textColor?: string; scale?: number; pulse?: number }
        | undefined;
      if (!world) return;
      const pt = projectWorldPoint(world, pos3d);
      if (!pt.visible) return;
      const text = String(opts?.text ?? "?");
      const bg = opts?.bg || "#FACC15";
      const textColor = opts?.textColor || "#111827";
      const sc = clamp(opts?.scale ?? 1, 0.1, 2.2) * (1 + (opts?.pulse ?? 0) * 0.08);

      world.hudQueue.push({
        draw: (ctx, width) => {
          const u = (width / 1080) * sc;
          ctx.save();
          ctx.translate(pt.x, pt.y);
          const isSingle = text.length <= 2;
          ctx.font = `900 ${Math.round((isSingle ? 52 : 34) * u)}px ${SANS_FONT}`;
          const tw = ctx.measureText(text).width;
          const bw = isSingle ? 88 * u : tw + 46 * u;
          const bh = isSingle ? 88 * u : 64 * u;

          ctx.shadowColor = "rgba(0,0,0,0.38)";
          ctx.shadowBlur = 18 * u;
          ctx.shadowOffsetY = 6 * u;

          ctx.fillStyle = bg;
          if (isSingle) {
            ctx.beginPath();
            ctx.arc(0, 0, bw / 2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            roundRectPath(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2);
            ctx.fill();
          }

          ctx.shadowColor = "transparent";
          ctx.lineWidth = 4 * u;
          ctx.strokeStyle = "rgba(255,255,255,0.9)";
          ctx.stroke();

          ctx.fillStyle = textColor;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(text, 0, 2 * u);
          ctx.restore();
        },
      });
    },

    /** Viral Shorts Bold Opening Title (yellow + white highlight with crisp black outline) */
    drawPopupTitle(
      worldOrText: DioramaWorldHandle | string | null | undefined,
      textOrOpts?:
        | string
        | {
            yRatio?: number;
            accentWord?: string;
            color?: string;
            accentColor?: string;
            progress?: number;
          },
      maybeOpts?: {
        yRatio?: number;
        accentWord?: string;
        color?: string;
        accentColor?: string;
        progress?: number;
      }
    ) {
      const firstIsText = typeof worldOrText === "string";
      const world = firstIsText ? activeWorldRef : resolveWorld(worldOrText);
      const text = firstIsText
        ? (worldOrText as string)
        : typeof textOrOpts === "string"
          ? textOrOpts
          : "";
      const opts = (firstIsText ? textOrOpts : maybeOpts) as
        | {
            yRatio?: number;
            accentWord?: string;
            color?: string;
            accentColor?: string;
            progress?: number;
          }
        | undefined;
      if (!world) return;
      const clean = String(text || "").trim();
      if (!clean) return;
      const yRatio = clamp(opts?.yRatio ?? 0.19, 0.1, 0.44);
      const color = opts?.color || "#FFFFFF";
      const accentColor = opts?.accentColor || "#FACC15";
      const accentWord = (opts?.accentWord || "").trim().toLowerCase();
      const pop = ease.backOut(clamp(opts?.progress ?? 1));

      world.hudQueue.push({
        draw: (ctx, width, height) => {
          const u = width / 1080;
          const words = clean.split(/\s+/).filter(Boolean);
          if (words.length === 0) return;

          // Wrap cleanly into at most 2 bold lines
          const mid = Math.ceil(words.length / 2);
          const lines =
            words.length <= 3
              ? [words]
              : [words.slice(0, mid), words.slice(mid)];

          ctx.save();
          ctx.translate(width / 2, height * yRatio);
          ctx.scale(0.84 + 0.16 * pop, 0.84 + 0.16 * pop);
          ctx.globalAlpha = clamp((opts?.progress ?? 1) * 3, 0, 1);

          const baseSize = Math.round(64 * u);
          ctx.font = `900 ${baseSize}px ${SANS_FONT}`;
          ctx.textBaseline = "middle";

          lines.forEach((lineWords, li) => {
            const lineY = (li - (lines.length - 1) / 2) * (baseSize * 1.18);
            const spW = ctx.measureText(" ").width * 1.15;
            const widths = lineWords.map((w) => ctx.measureText(w).width);
            const totalW =
              widths.reduce((a, b) => a + b, 0) + spW * Math.max(0, lineWords.length - 1);
            const fitScale = totalW > width * 0.84 ? (width * 0.84) / totalW : 1;

            ctx.save();
            ctx.translate(0, lineY);
            ctx.scale(fitScale, fitScale);
            let cx = -totalW / 2;
            lineWords.forEach((word, wi) => {
              const ww = widths[wi];
              const isAccent =
                accentWord
                  ? word.toLowerCase().includes(accentWord)
                  : li === 0 && wi === lineWords.length - 1;
              ctx.textAlign = "left";
              ctx.lineWidth = 14 * u;
              ctx.lineJoin = "round";
              ctx.strokeStyle = "rgba(10,14,22,0.92)";
              ctx.strokeText(word, cx, 0);
              ctx.fillStyle = isAccent ? accentColor : color;
              ctx.fillText(word, cx, 0);
              cx += ww + spW;
            });
            ctx.restore();
          });

          ctx.restore();
        },
      });
    },

    /** Clean pointer callout line + crisp label attached to a 3D world point */
    drawCalloutAt3D(
      worldOrPos: DioramaWorldHandle | Vec3Tuple | null | undefined,
      posOrLabel?: Vec3Tuple | string,
      labelOrOpts?: string | { color?: string; side?: "left" | "right"; progress?: number },
      maybeOpts?: { color?: string; side?: "left" | "right"; progress?: number }
    ) {
      const firstIsPos = Array.isArray(worldOrPos);
      const world = firstIsPos ? activeWorldRef : resolveWorld(worldOrPos);
      const pos3d = firstIsPos
        ? (worldOrPos as Vec3Tuple)
        : Array.isArray(posOrLabel)
          ? (posOrLabel as Vec3Tuple)
          : ([0, 0, 0] as Vec3Tuple);
      const label = firstIsPos
        ? typeof posOrLabel === "string"
          ? posOrLabel
          : ""
        : typeof labelOrOpts === "string"
          ? labelOrOpts
          : "";
      const opts = (firstIsPos ? labelOrOpts : maybeOpts) as
        | { color?: string; side?: "left" | "right"; progress?: number }
        | undefined;
      if (!world) return;
      const pt = projectWorldPoint(world, pos3d);
      if (!pt.visible || !label) return;
      const color = opts?.color || "#FACC15";
      const side = opts?.side ?? (pt.x > world.width * 0.5 ? "left" : "right");
      const alpha = clamp(opts?.progress ?? 1);

      world.hudQueue.push({
        draw: (ctx, width) => {
          const u = width / 1080;
          const dx = (side === "right" ? 1 : -1) * 110 * u;
          const dy = -56 * u;
          const ex = clamp(pt.x + dx, 140 * u, width - 140 * u);
          const ey = pt.y + dy;

          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = color;
          ctx.lineWidth = 4 * u;
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y);
          ctx.lineTo(ex, ey);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 8 * u, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();

          ctx.font = `800 ${Math.round(28 * u)}px ${SANS_FONT}`;
          const tw = ctx.measureText(label).width;
          const bw = tw + 34 * u;
          const bh = 48 * u;
          const bx = side === "right" ? ex - 8 * u : ex - bw + 8 * u;
          const by = ey - bh / 2;

          ctx.fillStyle = "rgba(12,16,24,0.88)";
          roundRectPath(ctx, bx, by, bw, bh, 14 * u);
          ctx.fill();
          ctx.lineWidth = 2.5 * u;
          ctx.strokeStyle = color;
          ctx.stroke();

          ctx.fillStyle = "#FFFFFF";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(label, bx + bw / 2, ey + 1 * u);
          ctx.restore();
        },
      });
    },
  };
}

export type Diorama3DSdk = ReturnType<typeof createDiorama3DSdk>;
