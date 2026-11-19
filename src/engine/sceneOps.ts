import type { SceneItem, SceneRole, SynkcutProject } from "../types/scene";
import { rebuildWordsFromScenes } from "./sampleProject";

const MIN_SCENE_DURATION_MS = 800;
const MAX_SCENE_DURATION_MS = 20000;

export function reflowSceneTimings(scenes: SceneItem[]): SceneItem[] {
  let cursor = 0;
  return scenes.map((scene) => {
    const duration = Math.max(
      MIN_SCENE_DURATION_MS,
      Math.min(MAX_SCENE_DURATION_MS, Math.round(scene.endMs - scene.startMs) || 2500)
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

  const newScene: SceneItem = {
    id: newSceneId,
    role,
    startMs: 0,
    endMs: 2500,
    text: defaultText[role],
    media: {
      path: templateScene?.media.path ?? null,
      secondaryPath: null,
      trimStartMs: 0,
      fit: "cover",
    },
    motion: {
      preset: templateScene?.motion.preset ?? "zoom_punch",
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
    media: { ...orig.media },
    motion: { ...orig.motion },
    transitionIn: { ...orig.transitionIn },
    sfx: orig.sfx.map((s) => ({ ...s })),
    overlays: orig.overlays.map((o, i) => ({ ...o, id: `ov_${Date.now()}_${i}` })),
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

  if (before.globalStyle.captionPreset !== after.globalStyle.captionPreset) {
    changes.push(
      `Caption → ${CAPTION_NAMES[after.globalStyle.captionPreset] ?? after.globalStyle.captionPreset}`
    );
  }
  if (before.globalStyle.accentColor.toUpperCase() !== after.globalStyle.accentColor.toUpperCase()) {
    changes.push(`Warna Aksen → ${after.globalStyle.accentColor}`);
  }
  if (before.globalStyle.bgm.preset !== after.globalStyle.bgm.preset) {
    changes.push(
      `BGM → ${after.globalStyle.bgm.preset === "none" ? "Tanpa BGM" : after.globalStyle.bgm.preset}`
    );
  }
  if (before.globalStyle.bgm.autoDucking !== after.globalStyle.bgm.autoDucking) {
    changes.push(`Auto-Ducking → ${after.globalStyle.bgm.autoDucking ? "Aktif" : "Nonaktif"}`);
  }
  if (before.scenes.length !== after.scenes.length) {
    changes.push(`Jumlah Scene: ${before.scenes.length} → ${after.scenes.length}`);
  }

  const count = Math.min(before.scenes.length, after.scenes.length);
  for (let i = 0; i < count; i++) {
    const b = before.scenes[i];
    const a = after.scenes[i];
    if (b.text !== a.text) {
      changes.push(`Scene ${i + 1}: teks diperbarui`);
    }
    if (b.motion.preset !== a.motion.preset) {
      changes.push(`Scene ${i + 1} Motion → ${MOTION_NAMES[a.motion.preset] ?? a.motion.preset}`);
    }
    if (b.transitionIn.preset !== a.transitionIn.preset) {
      changes.push(`Scene ${i + 1} Transisi → ${a.transitionIn.preset}`);
    }
    const bOv: string = b.overlays[0]?.type ?? "none";
    const aOv: string = a.overlays[0]?.type ?? "none";
    if (bOv !== aOv) {
      changes.push(`Scene ${i + 1} Overlay → ${aOv === "none" ? "Dihapus" : OVERLAY_NAMES[aOv] ?? aOv}`);
    }
    const bSfx = b.sfx[0]?.preset ?? "none";
    const aSfx = a.sfx[0]?.preset ?? "none";
    if (bSfx !== aSfx) {
      changes.push(`Scene ${i + 1} SFX → ${aSfx === "none" ? "Dihapus" : aSfx}`);
    }
    const bDur = b.endMs - b.startMs;
    const aDur = a.endMs - a.startMs;
    if (Math.abs(bDur - aDur) >= 100) {
      changes.push(`Scene ${i + 1} Durasi → ${(aDur / 1000).toFixed(1)}s`);
    }
  }

  return changes.slice(0, 6);
}
