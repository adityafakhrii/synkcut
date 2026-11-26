// Synkcut v3.0 — S3 Architectural 3D Maquette & Motion Kit (Three.js r187)
// Bundled locally offline for zero-latency preview & deterministic CDP export.
import * as THREE from './three.module.js';

export { THREE };

export function makeStoneTexture(baseHex = '#D6DDE6', grainRgba = 'rgba(17,22,29,0.055)') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = baseHex;
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 820; i++) {
    const px = (i * 73) % 256;
    const py = (i * 151) % 256;
    x.fillStyle = i % 2 === 0 ? grainRgba : 'rgba(255,255,255,0.08)';
    x.fillRect(px, py, 2.5, 2.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

export function makeConcreteRibTexture(baseHex = '#DCE2EA') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = baseHex;
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 640; i++) {
    const px = (i * 67) % 256;
    const py = (i * 139) % 256;
    x.fillStyle = i % 2 === 0 ? 'rgba(17,22,29,0.05)' : 'rgba(255,255,255,0.12)';
    x.fillRect(px, py, 2, 2);
  }
  x.strokeStyle = 'rgba(17,22,29,0.07)';
  x.lineWidth = 2;
  for (let y = 0; y < 256; y += 22) {
    x.beginPath();
    x.moveTo(0, y);
    x.lineTo(256, y);
    x.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

export function makeScreenTexture(opts = {}) {
  const {
    header = 'Aplikasi',
    lines = ['Sistem aktif dan berjalan stabil.'],
    highlight = 'Proses selesai',
    accent = '#0B63A6',
    dark = false,
  } = opts;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = dark ? '#11161D' : '#F8FAFC';
  x.fillRect(0, 0, 512, 1024);

  x.fillStyle = dark ? '#1B2330' : '#EAEFF5';
  x.fillRect(0, 0, 512, 118);
  x.fillStyle = dark ? '#F8FAFC' : '#11161D';
  x.font = '600 30px "DM Sans", sans-serif';
  x.fillText(String(header).slice(0, 22), 38, 74);

  x.fillStyle = dark ? '#1E293B' : '#E2E8F0';
  x.beginPath();
  x.roundRect(32, 166, 404, 210, 20);
  x.fill();
  x.fillStyle = dark ? '#E2E8F0' : '#11161D';
  x.font = '500 26px "DM Sans", sans-serif';
  (Array.isArray(lines) ? lines : [String(lines)]).slice(0, 4).forEach((ln, idx) => {
    x.fillText(String(ln).slice(0, 30), 56, 224 + idx * 42);
  });

  x.fillStyle = accent;
  x.beginPath();
  x.roundRect(92, 434, 388, 162, 22);
  x.fill();
  x.fillStyle = '#FFFFFF';
  x.font = '600 32px "DM Sans", sans-serif';
  const hl = String(highlight);
  const words = hl.split(/\s+/);
  const mid = Math.ceil(words.length / 2);
  if (words.length <= 3) {
    x.fillText(hl.slice(0, 22), 124, 526);
  } else {
    x.fillText(words.slice(0, mid).join(' ').slice(0, 22), 124, 502);
    x.fillText(words.slice(mid).join(' ').slice(0, 22), 124, 548);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStudioWorld(canvas, opts = {}) {
  const {
    width = 1080,
    height = 1920,
    fogHex = 0xe7ecf1,
    isDark = false,
    fov = 34,
  } = opts;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = isDark ? 1.0 : 1.04;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(fogHex, 28, 72);

  const camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 160);

  const hemi = new THREE.HemisphereLight(
    isDark ? 0x94a3b8 : 0xf8fafc,
    isDark ? 0x0f172a : 0xcbd5e1,
    isDark ? 0.85 : 1.18
  );
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, isDark ? 1.45 : 1.72);
  key.position.set(16, 26, 18);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 90;
  const sd = 30;
  key.shadow.camera.left = -sd;
  key.shadow.camera.right = sd;
  key.shadow.camera.top = sd;
  key.shadow.camera.bottom = -sd;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  scene.add(key);

  const fill = new THREE.DirectionalLight(isDark ? 0x64748b : 0xdbeafe, 0.65);
  fill.position.set(-18, 12, -10);
  scene.add(fill);

  const shadowFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 120),
    new THREE.ShadowMaterial({ opacity: isDark ? 0.32 : 0.15 })
  );
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = -1.31;
  shadowFloor.receiveShadow = true;
  scene.add(shadowFloor);

  return { renderer, scene, camera, hemi, key, fill };
}

export function buildPlinth(w = 7.4, d = 6.6, h = 1.3, opts = {}) {
  const topTex = opts.topTex || makeStoneTexture(opts.topColor || '#D6DDE6');
  const sideTex = opts.sideTex || makeStoneTexture(opts.sideColor || '#C4CEDB');
  const grp = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.96, h * 0.72, d * 0.96),
    new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.88, metalness: 0.02 })
  );
  base.position.y = -h * 0.64;
  base.castShadow = true;
  base.receiveShadow = true;
  grp.add(base);

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(w, h * 0.28, d),
    new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.8, metalness: 0.04 })
  );
  deck.position.y = -h * 0.14;
  deck.castShadow = true;
  deck.receiveShadow = true;
  grp.add(deck);
  return grp;
}

export function buildSmartphone(opts = {}) {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.15, 4.25, 0.2),
    new THREE.MeshStandardMaterial({ color: opts.bodyColor ?? 0x26292e, roughness: 0.34, metalness: 0.68 })
  );
  body.castShadow = true;
  body.receiveShadow = true;
  grp.add(body);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.94, 3.96),
    new THREE.MeshBasicMaterial({ map: makeScreenTexture(opts) })
  );
  screen.position.z = 0.106;
  grp.add(screen);
  return grp;
}

export function buildServerRack(opts = {}) {
  const grp = new THREE.Group();
  const leds = [];
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.42, 3.35, 1.15),
    new THREE.MeshStandardMaterial({ color: opts.bodyColor ?? 0x7b828e, roughness: 0.46, metalness: 0.36 })
  );
  body.position.y = 1.675;
  body.castShadow = true;
  body.receiveShadow = true;
  grp.add(body);

  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(1.48, 0.12, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.38, metalness: 0.48 })
  );
  cap.position.y = 3.38;
  cap.castShadow = true;
  grp.add(cap);

  const blades = opts.blades ?? 7;
  for (let b = 0; b < blades; b++) {
    const by = 0.42 + b * (2.85 / blades);
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(1.24, 0.24, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.54, metalness: 0.32 })
    );
    blade.position.set(0, by, 0.56);
    grp.add(blade);

    const ledMat = new THREE.MeshStandardMaterial({
      color: opts.ledColor ?? 0x0b63a6,
      emissive: opts.ledColor ?? 0x0b63a6,
      emissiveIntensity: 0.5,
      roughness: 0.35,
    });
    const dot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.055, 0.05), ledMat);
    dot.position.set(0.42, by, 0.6);
    grp.add(dot);
    leds.push({ mat: ledMat, phase: b * 0.55 });
  }
  grp.userData.leds = leds;
  return grp;
}

export function buildGpuModule(opts = {}) {
  const grp = new THREE.Group();
  const pcb = new THREE.Mesh(
    new THREE.BoxGeometry(2.85, 0.22, 2.25),
    new THREE.MeshStandardMaterial({ color: 0x244237, roughness: 0.56, metalness: 0.24 })
  );
  pcb.position.y = 0.18;
  pcb.castShadow = true;
  pcb.receiveShadow = true;
  grp.add(pcb);

  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x333942,
    emissive: opts.heatColor ?? 0xc2411d,
    emissiveIntensity: 0.06,
    roughness: 0.34,
    metalness: 0.72,
  });
  const die = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.34, 1.2), coreMat);
  die.position.y = 0.45;
  die.castShadow = true;
  grp.add(die);

  for (let f = -3; f <= 3; f++) {
    if (Math.abs(f) < 2) continue;
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.42, 1.85),
      new THREE.MeshStandardMaterial({ color: 0xb86b35, roughness: 0.36, metalness: 0.78 })
    );
    fin.position.set(f * 0.34, 0.45, 0);
    fin.castShadow = true;
    grp.add(fin);
  }
  grp.userData.coreMat = coreMat;
  return grp;
}

export function buildCoolingTower(opts = {}) {
  const scale = opts.scale ?? 1;
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const v = i / 20;
    const r = (1.56 - Math.sin(v * Math.PI * 0.78) * 0.58 + Math.pow(v, 2.2) * 0.22) * scale;
    pts.push(new THREE.Vector2(r, v * 4.55 * scale));
  }
  const grp = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.LatheGeometry(pts, 40),
    new THREE.MeshStandardMaterial({
      map: opts.tex || makeConcreteRibTexture(),
      color: 0xe6ebf0,
      roughness: 0.84,
      metalness: 0.04,
      side: THREE.DoubleSide,
    })
  );
  shell.castShadow = true;
  shell.receiveShadow = true;
  grp.add(shell);

  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(1.14 * scale, 0.045 * scale, 10, 44),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.48, metalness: 0.58 })
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 3.15 * scale;
  grp.add(collar);

  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(1.66 * scale, 1.72 * scale, 0.42 * scale, 36),
    new THREE.MeshPhysicalMaterial({
      color: opts.waterColor ?? 0x0b63a6,
      roughness: 0.16,
      metalness: 0.06,
      transparent: true,
      opacity: 0.88,
    })
  );
  basin.position.y = 0.21 * scale;
  basin.castShadow = true;
  grp.add(basin);
  return grp;
}

export function buildGlassBottle(opts = {}) {
  const grp = new THREE.Group();
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(1.0, 0.0),
    new THREE.Vector2(1.04, 0.24),
    new THREE.Vector2(1.04, 2.85),
    new THREE.Vector2(0.92, 3.45),
    new THREE.Vector2(0.4, 4.02),
    new THREE.Vector2(0.4, 4.44),
    new THREE.Vector2(0.44, 4.48),
  ];
  const glass = new THREE.Mesh(
    new THREE.LatheGeometry(pts, 44),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.08,
      metalness: 0.04,
      transparent: true,
      opacity: 0.36,
      side: THREE.DoubleSide,
    })
  );
  glass.castShadow = true;
  grp.add(glass);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.44, 0.44, 0.36, 32),
    new THREE.MeshStandardMaterial({ color: opts.capColor ?? 0x11161d, roughness: 0.4, metalness: 0.2 })
  );
  cap.position.y = 4.62;
  cap.castShadow = true;
  grp.add(cap);

  const liquid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 0.95, 2.95, 40),
    new THREE.MeshPhysicalMaterial({
      color: opts.liquidColor ?? 0x0b63a6,
      roughness: 0.12,
      metalness: 0.05,
      transparent: true,
      opacity: 0.84,
    })
  );
  liquid.position.y = 1.5;
  grp.add(liquid);

  const meniscus = new THREE.Mesh(
    new THREE.TorusGeometry(0.94, 0.032, 12, 44),
    new THREE.MeshBasicMaterial({ color: 0x6dbbe8 })
  );
  meniscus.rotation.x = Math.PI / 2;
  grp.add(meniscus);

  grp.userData.setFill = (ratio) => {
    const r = Math.max(0.05, Math.min(1, Number(ratio) || 0.05));
    const h = r * 2.95;
    liquid.scale.y = h / 2.95;
    liquid.position.y = 0.14 + h / 2;
    meniscus.position.y = 0.14 + h;
  };
  grp.userData.setFill(opts.initialFill ?? 0.5);
  return grp;
}

export function buildGlobe(opts = {}) {
  const radius = opts.radius ?? 1.75;
  const grp = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 3),
    new THREE.MeshStandardMaterial({ color: opts.color ?? 0x2b4c7e, roughness: 0.58, metalness: 0.12 })
  );
  sphere.castShadow = true;
  grp.add(sphere);

  const wire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius * 1.02, 2),
    new THREE.MeshBasicMaterial({ color: opts.wireColor ?? 0xdbeafe, wireframe: true, transparent: true, opacity: 0.35 })
  );
  grp.add(wire);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.32, 0.04, 12, 64),
    new THREE.MeshStandardMaterial({ color: opts.accentColor ?? 0x0b63a6, roughness: 0.3, metalness: 0.5 })
  );
  ring.rotation.x = Math.PI * 0.36;
  grp.add(ring);
  return grp;
}

export function buildConduit(points, opts = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const grp = new THREE.Group();
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 44, opts.radius ?? 0.16, 14, false),
    new THREE.MeshPhysicalMaterial({
      color: opts.color ?? 0x0b63a6,
      roughness: 0.16,
      metalness: 0.08,
      transparent: true,
      opacity: opts.opacity ?? 0.62,
    })
  );
  tube.castShadow = true;
  grp.add(tube);

  const beads = [];
  const count = opts.beadCount ?? 6;
  for (let i = 0; i < count; i++) {
    const b = new THREE.Mesh(
      new THREE.SphereGeometry((opts.radius ?? 0.16) * 0.72, 10, 10),
      new THREE.MeshStandardMaterial({ color: opts.beadColor ?? 0xf8fafc, roughness: 0.25 })
    );
    grp.add(b);
    beads.push({ mesh: b, offset: i / count });
  }
  grp.userData.updateBeads = (t, speed = 0.45) => {
    beads.forEach((b) => {
      const u = (t * speed + b.offset) % 1;
      b.mesh.position.copy(curve.getPoint(u));
    });
  };
  return grp;
}

export function buildBarMonolith(items = [], opts = {}) {
  const grp = new THREE.Group();
  const list = Array.isArray(items) && items.length > 0 ? items : [{ value: 1 }, { value: 3 }, { value: 5 }];
  const maxV = Math.max(1, ...list.map((i) => Number(i.value) || 0));
  const spacing = opts.spacing ?? 1.45;
  const startX = -((list.length - 1) * spacing) / 2;
  const meshes = [];
  list.forEach((it, idx) => {
    const targetH = Math.max(0.45, ((Number(it.value) || 1) / maxV) * (opts.maxHeight ?? 4.2));
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, targetH, 0.92),
      new THREE.MeshStandardMaterial({
        color: it.color ?? (it.accent ? 0x0b63a6 : 0x7b828e),
        roughness: 0.45,
        metalness: 0.25,
      })
    );
    mesh.position.set(startX + idx * spacing, targetH / 2, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    grp.add(mesh);
    meshes.push({ mesh, targetH });
  });
  grp.userData.setProgress = (p) => {
    const c = Math.max(0.05, Math.min(1, Number(p) || 0.05));
    meshes.forEach(({ mesh, targetH }) => {
      mesh.scale.y = c;
      mesh.position.y = (targetH * c) / 2;
    });
  };
  return grp;
}

export function project3D(vec3, camera, width = 1080, height = 1920) {
  const v = vec3.clone().project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * width,
    y: (-v.y * 0.5 + 0.5) * height,
    visible: v.z > -1 && v.z < 1,
  };
}
