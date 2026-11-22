import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { AiMotionSpec, Breakdown3DConfig, Breakdown3DPart } from "../types/scene";

export interface Breakdown3DPalette {
  ink: string;
  muted: string;
  accent: string;
  cardBg: string;
  cardBorder: string;
  isLight: boolean;
}

const SANS = '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, q: number) => a + (b - a) * q;
const prog = (t: number, t0: number, t1: number) => clamp((t - t0) / Math.max(1e-6, t1 - t0));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = (x: number) => {
  const t = clamp(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function splitLines(text?: string): string[] {
  return String(text ?? "")
    .split(/\n|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rad = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

interface BuiltPart {
  part: Breakdown3DPart;
  holder: THREE.Group;
  base: THREE.Vector3;
  level: number;
}

class Breakdown3DEngine {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private root: THREE.Group;
  private camera: THREE.PerspectiveCamera;
  private keyLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private warmLight: THREE.PointLight;
  private ambientLight: THREE.AmbientLight;

  private width = 1080;
  private height = 1920;
  private lastSpecKey = "";
  private builtParts: BuiltPart[] = [];
  private ownedTextures: THREE.Texture[] = [];
  private axis = new THREE.Vector3(0, 1, 0);
  private gap = 18;
  private b0 = new THREE.Box3();
  private b1 = new THREE.Box3();
  private c1 = new THREE.Vector3();
  private r1 = 80;
  private labelOrder = new Map<BuiltPart, number>();

  private tmpBox = new THREE.Box3();
  private tmpMat = new THREE.Matrix4();
  private tmpVec = new THREE.Vector3();

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.root = new THREE.Group();
    this.scene.add(this.root);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(30, this.width / this.height, 1, 20000);

    // 3-point industrial studio lighting
    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.bias = -0.0012;
    this.keyLight.shadow.normalBias = 0.6;
    this.keyLight.shadow.radius = 2.5;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.rimLight = new THREE.DirectionalLight(0x9fc4ff, 1.5);
    this.scene.add(this.rimLight);

    this.warmLight = new THREE.PointLight(0xffcfa8, 1800, 0, 1.6);
    this.scene.add(this.warmLight);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(this.ambientLight);
  }

  private resizeIfNeeded(w: number, h: number) {
    if (this.width === w && this.height === h) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private makeCanvasTex(
    w: number,
    h: number,
    draw: (x: CanvasRenderingContext2D, w: number, h: number) => void,
    repeat?: [number, number]
  ): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d");
    if (x) draw(x, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    if (repeat) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
    }
    this.ownedTextures.push(tex);
    return tex;
  }

  private createPcbTex(): THREE.CanvasTexture {
    return this.makeCanvasTex(512, 512, (x, w, h) => {
      x.fillStyle = "#0f3d2e";
      x.fillRect(0, 0, w, h);
      const r = seededRng(17);
      x.strokeStyle = "rgba(218, 178, 80, 0.62)";
      x.lineWidth = 2.5;
      for (let i = 0; i < 95; i++) {
        let px = r() * w;
        let py = r() * h;
        x.beginPath();
        x.moveTo(px, py);
        for (let k = 0; k < 4; k++) {
          if (r() < 0.5) px += (r() - 0.5) * 160;
          else py += (r() - 0.5) * 160;
          x.lineTo(px, py);
        }
        x.stroke();
      }
      // Gold via pads + dark SoC silicon die in center
      x.fillStyle = "rgba(235, 198, 98, 0.92)";
      for (let i = 0; i < 160; i++) {
        x.fillRect(r() * w, r() * h, 4.5, 4.5);
      }
      x.fillStyle = "#17191f";
      x.fillRect(w * 0.34, h * 0.34, w * 0.32, h * 0.32);
      x.strokeStyle = "rgba(218, 178, 80, 0.85)";
      x.lineWidth = 3;
      x.strokeRect(w * 0.34, h * 0.34, w * 0.32, h * 0.32);
    });
  }

  private createBatteryTex(text?: string): THREE.CanvasTexture {
    return this.makeCanvasTex(512, 700, (x, w, h) => {
      const gr = x.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, "#2c3038");
      gr.addColorStop(1, "#16181e");
      x.fillStyle = gr;
      x.fillRect(0, 0, w, h);
      const lines = splitLines(text || "5000 mAh|Li-ion Polymer");
      x.fillStyle = "rgba(255,255,255,0.92)";
      x.font = `700 58px ${SANS}`;
      x.textAlign = "left";
      x.fillText(lines[0] || "", 48, 210);
      x.font = `500 32px ${SANS}`;
      x.fillStyle = "rgba(255,255,255,0.68)";
      lines.slice(1, 4).forEach((l, i) => x.fillText(l, 48, 265 + i * 44));
      x.strokeStyle = "rgba(56,229,157,0.45)";
      x.lineWidth = 3;
      x.strokeRect(32, 130, w - 64, 210 + Math.max(0, lines.length - 2) * 44);
    });
  }

  private createCoilTex(): THREE.CanvasTexture {
    return this.makeCanvasTex(512, 512, (x, w, h) => {
      x.fillStyle = "#111216";
      x.fillRect(0, 0, w, h);
      for (let k = 0; k < 22; k++) {
        const rr = 234 - k * 8.5;
        if (rr <= 38) break;
        x.beginPath();
        x.arc(w / 2, h / 2, rr, 0, Math.PI * 2);
        x.strokeStyle = k % 2 === 0 ? "#e69a5c" : "#b8622d";
        x.lineWidth = 6.2;
        x.stroke();
      }
      x.fillStyle = "#111216";
      x.beginPath();
      x.arc(w / 2, h / 2, 42, 0, Math.PI * 2);
      x.fill();
    });
  }

  private createScreenTex(): THREE.CanvasTexture {
    return this.makeCanvasTex(512, 960, (x, w, h) => {
      x.fillStyle = "#090c18";
      x.fillRect(0, 0, w, h);
      const blob = (cx: number, cy: number, r: number, col: string) => {
        const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, col);
        gr.addColorStop(1, "rgba(0,0,0,0)");
        x.fillStyle = gr;
        x.fillRect(0, 0, w, h);
      };
      blob(w * 0.25, h * 0.24, w * 0.9, "rgba(16, 185, 129, 0.92)");
      blob(w * 0.82, h * 0.48, w * 0.85, "rgba(56, 189, 248, 0.88)");
      blob(w * 0.32, h * 0.78, w * 0.85, "rgba(99, 102, 241, 0.88)");
      blob(w * 0.72, h * 0.82, w * 0.55, "rgba(245, 158, 11, 0.55)");
    });
  }

  private createWoodTex(col?: string): THREE.CanvasTexture {
    return this.makeCanvasTex(512, 512, (x, w, h) => {
      x.fillStyle = col || "#a8743f";
      x.fillRect(0, 0, w, h);
      const r = seededRng(5);
      for (let i = 0; i < 65; i++) {
        x.strokeStyle = `rgba(60,30,10,${0.09 + r() * 0.14})`;
        x.lineWidth = 1 + r() * 3;
        x.beginPath();
        const y0 = r() * h;
        x.moveTo(0, y0);
        for (let k = 0; k <= 8; k++) {
          x.lineTo((k * w) / 8, y0 + Math.sin(k + i) * 6 * r());
        }
        x.stroke();
      }
    });
  }

  private buildMaterial(p: Breakdown3DPart): THREE.Material {
    const c = p.color ? new THREE.Color(p.color) : null;
    const m = String(p.material || "plastic").toLowerCase();
    switch (m) {
      case "glass":
        return new THREE.MeshPhysicalMaterial({
          color: c || 0xe2f1ff,
          metalness: 0.05,
          roughness: 0.04,
          transparent: true,
          opacity: 0.34,
          clearcoat: 1,
          clearcoatRoughness: 0.02,
          envMapIntensity: 2.4,
          side: THREE.DoubleSide,
        });
      case "aluminum":
      case "aluminium":
      case "metal":
      case "silver":
        return new THREE.MeshPhysicalMaterial({
          color: c || 0x9aa0a8,
          metalness: 0.96,
          roughness: 0.28,
          clearcoat: 0.3,
        });
      case "steel":
        return new THREE.MeshStandardMaterial({
          color: c || 0x626872,
          metalness: 0.95,
          roughness: 0.35,
        });
      case "gold":
        return new THREE.MeshStandardMaterial({
          color: c || 0xd6a84c,
          metalness: 0.98,
          roughness: 0.28,
        });
      case "copper":
        return new THREE.MeshStandardMaterial({
          color: c || 0xc67c46,
          metalness: 0.92,
          roughness: 0.32,
        });
      case "black":
        return new THREE.MeshStandardMaterial({
          color: c || 0x111318,
          roughness: 0.34,
          metalness: 0.22,
        });
      case "white":
        return new THREE.MeshPhysicalMaterial({
          color: c || 0xf3f4f6,
          roughness: 0.32,
          clearcoat: 0.45,
        });
      case "ceramic":
        return new THREE.MeshPhysicalMaterial({
          color: c || 0xf5f4f0,
          roughness: 0.14,
          clearcoat: 1,
        });
      case "rubber":
        return new THREE.MeshStandardMaterial({
          color: c || 0x25282e,
          roughness: 0.88,
          metalness: 0.02,
        });
      case "wood":
        return new THREE.MeshStandardMaterial({
          map: this.createWoodTex(p.color),
          roughness: 0.68,
        });
      case "pcb":
        return new THREE.MeshStandardMaterial({
          map: this.createPcbTex(),
          roughness: 0.5,
          metalness: 0.18,
        });
      case "chip":
        return new THREE.MeshStandardMaterial({
          color: c || 0x1b1d24,
          roughness: 0.36,
          metalness: 0.35,
        });
      case "battery":
        return new THREE.MeshStandardMaterial({
          color: c || 0x1e2027,
          roughness: 0.45,
          metalness: 0.22,
        });
      case "coil":
        return new THREE.MeshStandardMaterial({
          color: 0x141519,
          roughness: 0.38,
          metalness: 0.52,
        });
      case "lens":
        return new THREE.MeshPhysicalMaterial({
          color: c || 0x0c1e3a,
          roughness: 0.05,
          metalness: 0.25,
          clearcoat: 1,
          envMapIntensity: 2.5,
        });
      case "screen":
        return new THREE.MeshStandardMaterial({
          color: c || 0x1c1e26,
          roughness: 0.35,
          metalness: 0.3,
        });
      case "emissive":
      case "light":
        return new THREE.MeshStandardMaterial({
          color: c || 0x38e59d,
          emissive: c || 0x38e59d,
          emissiveIntensity: 1.15,
        });
      default:
        return new THREE.MeshPhysicalMaterial({
          color: c || 0xd4d8e0,
          roughness: 0.38,
          metalness: 0.06,
          clearcoat: 0.35,
        });
    }
  }

  private topFaceOpts(p: Breakdown3DPart): THREE.MeshStandardMaterialParameters | null {
    const m = String(p.material || "").toLowerCase();
    if (m === "battery") {
      return { map: this.createBatteryTex(p.text || p.name), roughness: 0.5 };
    }
    if (m === "coil") {
      return { map: this.createCoilTex(), roughness: 0.3, metalness: 0.78 };
    }
    if (m === "screen") {
      return {
        map: this.createScreenTex(),
        roughness: 0.2,
        emissive: new THREE.Color(0x141c24),
      };
    }
    return null;
  }

  private rrShape(w: number, l: number, rIn: number): THREE.Shape {
    const s = new THREE.Shape();
    const x0 = -w / 2;
    const z0 = -l / 2;
    const r = Math.max(0.05, Math.min(rIn, w / 2 - 0.05, l / 2 - 0.05));
    s.moveTo(x0 + r, z0);
    s.lineTo(x0 + w - r, z0);
    s.quadraticCurveTo(x0 + w, z0, x0 + w, z0 + r);
    s.lineTo(x0 + w, z0 + l - r);
    s.quadraticCurveTo(x0 + w, z0 + l, x0 + w - r, z0 + l);
    s.lineTo(x0 + r, z0 + l);
    s.quadraticCurveTo(x0, z0 + l, x0, z0 + l - r);
    s.lineTo(x0, z0 + r);
    s.quadraticCurveTo(x0, z0, x0 + r, z0);
    return s;
  }

  private extrudeShape(shape: THREE.Shape, h: number, bevel: number): THREE.ExtrudeGeometry {
    const b = Math.min(bevel, h * 0.42);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.05, h - 2 * b),
      bevelEnabled: b > 0.02,
      bevelThickness: b,
      bevelSize: b,
      bevelSegments: 3,
      curveSegments: 22,
    });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, h - b, 0);
    return geo;
  }

  private topPlane(
    w: number,
    l: number,
    r: number,
    y: number,
    opts: THREE.MeshStandardMaterialParameters
  ): THREE.Mesh {
    const geo = new THREE.ShapeGeometry(this.rrShape(w, l, r), 22);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv;
    const ps = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (ps.getX(i) + w / 2) / w, 1 - (ps.getZ(i) + l / 2) / l);
    }
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ roughness: 0.45, ...opts })
    );
    mesh.position.y = y + 0.04;
    mesh.receiveShadow = true;
    return mesh;
  }

  private circlePlane(
    r: number,
    y: number,
    opts: THREE.MeshStandardMaterialParameters
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(r, 64),
      new THREE.MeshStandardMaterial({ roughness: 0.45, ...opts })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y + 0.04;
    return mesh;
  }

  private buildPartGroup(p: Breakdown3DPart): THREE.Group {
    const [w, h, d] = (p.size && p.size.length === 3 ? p.size : [66, 3.2, 128]).map(
      (n) => Math.max(0.4, Number(n) || 4)
    );
    const r = p.radius != null ? Number(p.radius) : Math.min(w, d) * 0.14;
    const mat = this.buildMaterial(p);
    const grp = new THREE.Group();
    const shp = String(p.shape || "slab").toLowerCase();
    const tf = this.topFaceOpts(p);

    const add = (geo: THREE.BufferGeometry, m: THREE.Material = mat) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = String(p.material || "").toLowerCase() !== "glass";
      mesh.receiveShadow = true;
      grp.add(mesh);
      return mesh;
    };

    if (shp === "slab" || shp === "plate" || shp === "board") {
      add(this.extrudeShape(this.rrShape(w, d, r), h, Math.min(0.6, h * 0.24)));
      if (tf) grp.add(this.topPlane(w * 0.992, d * 0.992, r, h, tf));
    } else if (shp === "frame") {
      const s = this.rrShape(w, d, r);
      const wall = Math.min(
        Math.min(w, d) * 0.35,
        Number(p.wall || Math.min(w, d) * 0.06)
      );
      s.holes.push(this.rrShape(w - 2 * wall, d - 2 * wall, Math.max(0.5, r - wall)));
      add(this.extrudeShape(s, h, Math.min(0.55, wall * 0.28)));
    } else if (shp === "box") {
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(0, h / 2, 0);
      add(geo);
      if (tf) {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(w, d),
          new THREE.MeshStandardMaterial({ roughness: 0.45, ...tf })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.y = h + 0.04;
        grp.add(m);
      }
    } else if (shp === "cylinder" || shp === "disc" || shp === "puck") {
      const rr = p.radius != null ? Number(p.radius) : w / 2;
      const geo = new THREE.CylinderGeometry(rr, rr, h, 56);
      geo.translate(0, h / 2, 0);
      add(geo);
      if (tf) grp.add(this.circlePlane(rr * 0.992, h, tf));
    } else if (shp === "ring") {
      const ro = p.radius != null ? Number(p.radius) : w / 2;
      const ri = Math.min(ro * 0.92, Number(p.inner != null ? p.inner : ro * 0.65));
      const s = new THREE.Shape();
      s.absarc(0, 0, ro, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(0, 0, ri, 0, Math.PI * 2, true);
      s.holes.push(hole);
      add(this.extrudeShape(s, h, Math.min(0.45, (ro - ri) * 0.2)));
    } else if (shp === "lens") {
      const rr = p.radius != null ? Number(p.radius) : w / 2;
      const bezel = new THREE.CylinderGeometry(rr * 1.18, rr * 1.18, h * 0.88, 48);
      bezel.translate(0, h * 0.44, 0);
      add(bezel, this.buildMaterial({ ...p, material: "aluminum", color: "#94a3b8" }));
      const glass = new THREE.CylinderGeometry(rr, rr, h, 48);
      glass.translate(0, h / 2 + 0.05, 0);
      add(glass, this.buildMaterial({ ...p, material: "lens" }));
    } else if (shp === "sphere" || shp === "ball") {
      const geo = new THREE.SphereGeometry(0.5, 48, 32);
      geo.scale(w, h, d);
      geo.translate(0, h / 2, 0);
      add(geo);
    } else if (shp === "capsule") {
      const rr = Math.min(w, d) / 2;
      const geo = new THREE.CapsuleGeometry(rr, Math.max(0.2, h - 2 * rr), 10, 36);
      geo.translate(0, h / 2, 0);
      add(geo);
    } else if (shp === "cone") {
      const geo = new THREE.CylinderGeometry(0.5, w / 2, h, 48);
      geo.translate(0, h / 2, 0);
      add(geo);
    } else if (shp === "torus" || shp === "cushion") {
      const tube = Math.max(1, h / 2);
      const rr = Math.max(tube + 1, (p.radius != null ? Number(p.radius) : w / 2) - tube);
      const geo = new THREE.TorusGeometry(rr, tube, 24, 72);
      geo.rotateX(Math.PI / 2);
      geo.translate(0, tube, 0);
      add(geo);
    } else {
      add(this.extrudeShape(this.rrShape(w, d, r), h, 0.4));
    }

    if (p.rot && p.rot.length === 3) {
      grp.rotation.set(
        (Number(p.rot[0]) * Math.PI) / 180,
        (Number(p.rot[1]) * Math.PI) / 180,
        (Number(p.rot[2]) * Math.PI) / 180
      );
    }

    return grp;
  }

  private disposeSceneParts() {
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    while (this.root.children.length > 0) {
      this.root.remove(this.root.children[0]);
    }
    this.ownedTextures.forEach((t) => t.dispose());
    this.ownedTextures = [];
    this.builtParts = [];
    this.labelOrder.clear();
  }

  private place(explodeQ: number) {
    for (const bp of this.builtParts) {
      bp.holder.position
        .copy(bp.base)
        .addScaledVector(this.axis, bp.level * this.gap * explodeQ);
    }
  }

  private computeBounds(explodeQ: number): THREE.Box3 {
    this.place(explodeQ);
    this.root.rotation.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    const out = new THREE.Box3();
    for (const bp of this.builtParts) {
      this.tmpBox.setFromObject(bp.holder);
      out.union(this.tmpBox);
    }
    if (out.isEmpty()) {
      out.set(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 20, 20));
    }
    return out;
  }

  private syncConfig(cfg: Breakdown3DConfig) {
    const key = JSON.stringify({
      parts: cfg.parts,
      axis: cfg.axis ?? "y",
      gap: cfg.gap ?? null,
    });
    if (key === this.lastSpecKey && this.builtParts.length > 0) return;

    this.disposeSceneParts();
    this.lastSpecKey = key;

    const rawParts: Breakdown3DPart[] =
      cfg.parts && cfg.parts.length > 0
        ? cfg.parts
        : [
            { name: "Cover Glass", shape: "slab", material: "glass", level: 2, size: [70, 2, 140], pos: [0, 6, 0] },
            { name: "Logic Board", shape: "slab", material: "pcb", level: 1, size: [64, 2, 130], pos: [0, 3, 0] },
            { name: "Chassis", shape: "frame", material: "aluminum", level: 0, size: [72, 5, 144], pos: [0, 0, 0] },
          ];

    this.axis =
      cfg.axis === "x"
        ? new THREE.Vector3(1, 0, 0)
        : cfg.axis === "z"
          ? new THREE.Vector3(0, 0, 1)
          : new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < rawParts.length; i++) {
      const p = rawParts[i];
      const holder = this.buildPartGroup(p);
      const basePos: [number, number, number] =
        p.pos && p.pos.length === 3 ? p.pos : [0, i * 2.5, 0];
      const base = new THREE.Vector3(
        Number(basePos[0]) || 0,
        Number(basePos[1]) || 0,
        Number(basePos[2]) || 0
      );
      holder.position.copy(base);
      this.root.add(holder);
      this.builtParts.push({
        part: p,
        holder,
        base,
        level: Number.isFinite(p.level) ? Number(p.level) : i,
      });
    }

    const b0 = this.computeBounds(0);
    const sz = b0.getSize(new THREE.Vector3());
    this.gap =
      cfg.gap && cfg.gap > 0
        ? Number(cfg.gap)
        : Math.max(10, 0.165 * Math.max(sz.x, sz.z, sz.y));

    this.b0 = b0;
    this.b1 = this.computeBounds(1);
    this.c1 = this.b1.getCenter(new THREE.Vector3());
    this.r1 = Math.max(10, this.b1.getBoundingSphere(new THREE.Sphere()).radius);
    this.place(0);

    // Position lights relative to exploded assembly scale
    const sc = this.r1;
    this.keyLight.position.set(-1.15 * sc, 1.85 * sc, 1.05 * sc);
    this.keyLight.target.position.copy(this.c1);
    this.keyLight.shadow.camera.left = -sc * 1.4;
    this.keyLight.shadow.camera.right = sc * 1.4;
    this.keyLight.shadow.camera.top = sc * 1.4;
    this.keyLight.shadow.camera.bottom = -sc * 1.4;
    this.keyLight.shadow.camera.near = sc * 0.05;
    this.keyLight.shadow.camera.far = sc * 6;
    this.keyLight.shadow.camera.updateProjectionMatrix();

    this.rimLight.position.set(1.5 * sc, 0.85 * sc, -1.45 * sc);
    this.warmLight.position.set(1.0 * sc, 0.45 * sc, 1.15 * sc);
    this.warmLight.intensity = 2000 * Math.pow(sc / 90, 1.6);
    this.camera.near = Math.max(0.5, sc * 0.04);
    this.camera.far = sc * 40;
    this.camera.updateProjectionMatrix();
  }

  private frameCamera(
    bmin: THREE.Vector3,
    bmax: THREE.Vector3,
    elevationRad: number,
    shareX: number,
    shareY: number,
    centerFracX: number,
    centerFracY: number
  ) {
    const corners: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      corners.push(
        new THREE.Vector3(
          i & 1 ? bmax.x : bmin.x,
          i & 2 ? bmax.y : bmin.y,
          i & 4 ? bmax.z : bmin.z
        ).applyMatrix4(this.tmpMat)
      );
    }
    const c = corners
      .reduce((acc, v) => acc.add(v), new THREE.Vector3())
      .multiplyScalar(1 / 8);

    let d = Math.max(300, this.r1 * 5);
    for (let it = 0; it < 3; it++) {
      this.camera.clearViewOffset();
      this.camera.position.set(
        c.x,
        c.y + d * Math.sin(elevationRad),
        c.z + d * Math.cos(elevationRad)
      );
      this.camera.lookAt(c);
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();

      let x0 = 1e9;
      let x1 = -1e9;
      let y0 = 1e9;
      let y1 = -1e9;
      for (const v of corners) {
        this.tmpVec.copy(v).project(this.camera);
        const px = ((this.tmpVec.x + 1) / 2) * this.width;
        const py = ((1 - this.tmpVec.y) / 2) * this.height;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
      const k = Math.max(
        (x1 - x0) / Math.max(10, this.width * shareX),
        (y1 - y0) / Math.max(10, this.height * shareY)
      );
      if (it < 2) {
        d *= k;
        continue;
      }
      this.camera.setViewOffset(
        this.width,
        this.height,
        (x0 + x1) / 2 - this.width * centerFracX,
        (y0 + y1) / 2 - this.height * centerFracY,
        this.width,
        this.height
      );
    }
  }

  private projectPoint(v: THREE.Vector3): [number, number] {
    this.tmpVec.copy(v).project(this.camera);
    return [
      ((this.tmpVec.x + 1) / 2) * this.width,
      ((1 - this.tmpVec.y) / 2) * this.height,
    ];
  }

  private anchorOf(bp: BuiltPart): [number, number] | null {
    let best: [number, number] | null = null;
    bp.holder.updateMatrixWorld(true);
    bp.holder.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      const bb = obj.geometry.boundingBox;
      if (!bb) return;
      const cx = (bb.min.x + bb.max.x) / 2;
      const cz = (bb.min.z + bb.max.z) / 2;
      const rx = ((bb.max.x - bb.min.x) / 2) * 0.9;
      const rz = ((bb.max.z - bb.min.z) / 2) * 0.9;
      const midY = new THREE.Vector3(cx, (bb.min.y + bb.max.y) / 2, cz)
        .applyMatrix4(obj.matrixWorld).y;

      for (const yy of [bb.max.y, bb.min.y]) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const pt = new THREE.Vector3(
            cx + rx * Math.cos(a),
            yy,
            cz + rz * Math.sin(a)
          ).applyMatrix4(obj.matrixWorld);
          if (pt.y < midY - 1e-4) continue;
          const scr = this.projectPoint(pt);
          if (!best || scr[0] > best[0]) best = scr;
        }
      }
    });
    return best;
  }

  public renderToContext(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    stageTop: number,
    stageBottom: number,
    spec: AiMotionSpec,
    pal: Breakdown3DPalette,
    p: number,
    durationSec: number
  ) {
    this.resizeIfNeeded(width, height);
    const cfg = spec.breakdown3d || { parts: [] };
    this.syncConfig(cfg);

    this.ambientLight.intensity = pal.isLight ? 0.42 : 0.2;

    const topFrac = stageTop / height;
    const bottomFrac = stageBottom / height;
    const stageFracH = Math.max(0.24, bottomFrac - topFrac);
    const centerFracY = (topFrac + bottomFrac) / 2;

    const explodeQ = easeInOut(prog(p, 0.18, 0.48));
    const camPanO = easeInOut(prog(p, 0.14, 0.52));
    const spin0 = cfg.spin != null ? Number(cfg.spin) : 0.72;
    const spinSpeed = cfg.spinSpeed != null ? Number(cfg.spinSpeed) : 0.14;
    const zoom = cfg.zoom && cfg.zoom > 0 ? Number(cfg.zoom) : 1;

    // Precompute final top-to-bottom label ordering once per spec
    if (this.labelOrder.size !== this.builtParts.length) {
      this.place(1);
      this.root.rotation.y = spin0 - spinSpeed * durationSec;
      this.tmpMat.makeRotationY(this.root.rotation.y);
      const elFinal = THREE.MathUtils.degToRad(cfg.elevation1 ?? 22);
      this.frameCamera(
        this.b1.min,
        this.b1.max,
        elFinal,
        0.44 * zoom,
        stageFracH * 0.9 * zoom,
        0.29,
        centerFracY
      );
      this.root.updateMatrixWorld(true);
      const anchors = this.builtParts.map((bp) => ({
        bp,
        y: this.anchorOf(bp)?.[1] ?? 0,
      }));
      anchors.sort((a, b) => a.y - b.y);
      this.labelOrder.clear();
      anchors.forEach((a, idx) => this.labelOrder.set(a.bp, idx));
    }

    // Current deterministic frame pose
    this.place(explodeQ);
    const tSec = p * Math.max(1, durationSec);
    this.root.rotation.y = spin0 - spinSpeed * tSec;
    this.tmpMat.makeRotationY(this.root.rotation.y);

    const elRad = THREE.MathUtils.degToRad(
      lerp(cfg.elevation0 ?? 36, cfg.elevation1 ?? 22, camPanO)
    );
    const bmin = this.b0.min.clone().lerp(this.b1.min, explodeQ);
    const bmax = this.b0.max.clone().lerp(this.b1.max, explodeQ);

    const shareX = lerp(0.6, 0.44, camPanO) * zoom;
    const shareY = stageFracH * lerp(0.84, 0.9, camPanO) * zoom;
    const centerFracX = lerp(0.47, 0.29, camPanO);

    this.frameCamera(bmin, bmax, elRad, shareX, shareY, centerFracX, centerFracY);
    this.root.updateMatrixWorld(true);
    this.renderer.render(this.scene, this.camera);

    // 1. Composite transparent PBR 3D canvas cleanly onto the 2D studio backdrop
    ctx.save();
    ctx.drawImage(this.canvas, 0, 0, width, height);

    // 2. Draw staggered leader lines & part callouts strictly inside Safe-Stage
    //    (Right edge stays <= 86% to stay completely clear of TikTok/Reels right UI!)
    if (p >= 0.42) {
      const u = width / 1080;
      const items = this.builtParts
        .map((bp) => ({
          bp,
          name: bp.part.name || "Part",
          anchor: this.anchorOf(bp),
        }))
        .filter((it): it is { bp: BuiltPart; name: string; anchor: [number, number] } =>
          Boolean(it.anchor && it.name.trim())
        );

      items.sort(
        (a, b) => (this.labelOrder.get(a.bp) ?? 0) - (this.labelOrder.get(b.bp) ?? 0)
      );

      const topBound = stageTop + 26 * u;
      const botBound = stageBottom - 24 * u;
      const availH = Math.max(120 * u, botBound - topBound);
      const sp = Math.min(82 * u, availH / Math.max(1, items.length));

      // Assign non-overlapping vertical label coordinates
      const rows = items.map((it) => ({ ...it, ly: it.anchor[1] }));
      let prevY = -1e9;
      for (const r of rows) {
        r.ly = Math.max(r.ly, prevY + sp);
        prevY = r.ly;
      }
      if (rows.length > 0) {
        const over = Math.max(0, rows[rows.length - 1].ly - botBound);
        rows.forEach((r) => (r.ly -= over));
        const under = Math.max(0, topBound - rows[0].ly);
        rows.forEach((r) => (r.ly += under));
      }

      const labelX = width * 0.545;
      const safeRightX = width * 0.865;
      const maxTextW = Math.max(120 * u, safeRightX - labelX - 24 * u);
      const baseFs = 29 * u;

      rows.forEach((row, i) => {
        const startP = 0.44 + i * 0.045;
        const a = easeOut(prog(p, startP, startP + 0.12));
        if (a <= 0.01) return;

        const [ax, ay] = row.anchor;
        const lineQ = easeOut(clamp(a * 1.25));
        const ex = labelX - 18 * u;
        const ey = row.ly;

        ctx.save();
        ctx.globalAlpha = a;

        // Crisp elbow leader line
        const elbowX = lerp(ax, ex, 0.52);
        const lineCol = pal.isLight ? "rgba(18, 22, 28, 0.65)" : "rgba(255, 255, 255, 0.72)";
        ctx.strokeStyle = lineCol;
        ctx.lineWidth = 2.4 * u;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        if (lineQ < 0.5) {
          const q1 = lineQ * 2;
          ctx.lineTo(lerp(ax, elbowX, q1), lerp(ay, ey, q1));
        } else {
          const q2 = (lineQ - 0.5) * 2;
          ctx.lineTo(elbowX, ey);
          ctx.lineTo(lerp(elbowX, ex, q2), ey);
        }
        ctx.stroke();

        // Anchor dot on 3D surface
        ctx.fillStyle = pal.accent;
        ctx.beginPath();
        ctx.arc(ax, ay, 6.2 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = pal.isLight ? "#ffffff" : "#0b0d12";
        ctx.lineWidth = 2 * u;
        ctx.stroke();

        // Fit label text inside safe width
        let fs = baseFs;
        ctx.font = `700 ${Math.round(fs)}px ${SANS}`;
        while (fs > 18 * u && ctx.measureText(row.name).width > maxTextW) {
          fs -= 1 * u;
          ctx.font = `700 ${Math.round(fs)}px ${SANS}`;
        }
        const tw = ctx.measureText(row.name).width;
        const pillW = Math.min(safeRightX - labelX + 10 * u, tw + 26 * u);
        const pillH = Math.max(42 * u, fs + 18 * u);
        const slideX = (1 - a) * 16 * u;

        ctx.fillStyle = pal.isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(12, 15, 22, 0.82)";
        ctx.strokeStyle = pal.cardBorder;
        ctx.lineWidth = 1.6 * u;
        roundRect(ctx, labelX - 10 * u + slideX, ey - pillH / 2, pillW, pillH, 10 * u);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = pal.ink;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(row.name, labelX + 3 * u + slideX, ey + 1 * u);

        // Layer index micro-marker on right edge of pill for tech clarity
        if (rows.length <= 6 && tw + 50 * u < pillW) {
          ctx.font = `600 ${Math.round(18 * u)}px ${MONO}`;
          ctx.fillStyle = pal.muted;
          ctx.textAlign = "right";
          ctx.fillText(`0${i + 1}`, labelX - 10 * u + slideX + pillW - 10 * u, ey + 1 * u);
        }

        ctx.restore();
      });
    }

    ctx.restore();
  }
}

let sharedEngine: Breakdown3DEngine | null = null;
let webglUnavailable = false;

export function renderBreakdown3DScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  stageTop: number,
  stageBottom: number,
  spec: AiMotionSpec,
  pal: Breakdown3DPalette,
  p: number,
  durationSec: number
): boolean {
  if (webglUnavailable) return false;
  try {
    if (!sharedEngine) {
      sharedEngine = new Breakdown3DEngine();
    }
    sharedEngine.renderToContext(
      ctx,
      width,
      height,
      stageTop,
      stageBottom,
      spec,
      pal,
      p,
      durationSec
    );
    return true;
  } catch (err) {
    console.warn("WebGL 3D Breakdown tidak tersedia, fallback ke preview 2D:", err);
    webglUnavailable = true;
    return false;
  }
}
