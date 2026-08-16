/**
 * Player-facing arena settings: look sensitivity, audio levels, performance
 * quality, match length and a fully customisable touch HUD (each control can be
 * moved, resized or hidden). Everything persists to localStorage so a loadout
 * of preferences survives reloads.
 */

export type Quality = "low" | "medium" | "high";

export type ControlId =
  | "stick"
  | "sprint"
  | "backpack"
  | "wall"
  | "medkits"
  | "scope"
  | "fire"
  | "jump"
  | "crouch"
  | "prone";

export type ControlLayout = {
  /** pixel offset from the control's default anchor */
  dx: number;
  dy: number;
  /** 0.6 – 1.8 size multiplier */
  scale: number;
  hidden: boolean;
};

export type ArenaSettings = {
  /** mouse look, radians per pixel of movement */
  mouseSensitivity: number;
  /** touch drag look, radians per pixel */
  touchSensitivity: number;
  /** sensitivity multiplier while aiming down sights */
  adsMultiplier: number;
  invertY: boolean;
  masterVolume: number;
  muted: boolean;
  hudOpacity: number;
  showTouchControls: boolean;
  /** performance preset — defaults to low on phones/tablets */
  quality: Quality;
  /** shorter matches for casual sessions */
  quickMatch: boolean;
  /** hold fire to shoot; when on, tapping the fire button keeps firing */
  autoFire: boolean;
  controls: Record<ControlId, ControlLayout>;
};

export const CONTROL_LABELS: Record<ControlId, string> = {
  stick: "Movement stick",
  sprint: "Sprint indicator",
  backpack: "Backpack",
  wall: "Shield wall",
  medkits: "Medkits",
  scope: "Aim / scope",
  fire: "Fire button",
  jump: "Jump",
  crouch: "Crouch",
  prone: "Prone",
};

export const QUALITY_LABELS: Record<Quality, string> = {
  low: "Low (performance)",
  medium: "Balanced",
  high: "High (quality)",
};

export const CONTROL_IDS = Object.keys(CONTROL_LABELS) as ControlId[];

const baseControl = (): ControlLayout => ({ dx: 0, dy: 0, scale: 1, hidden: false });

function isMobileLike() {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function defaultSettings(): ArenaSettings {
  const controls = {} as Record<ControlId, ControlLayout>;
  for (const id of CONTROL_IDS) controls[id] = baseControl();
  return {
    mouseSensitivity: 0.0022,
    touchSensitivity: 0.006,
    adsMultiplier: 0.6,
    invertY: false,
    masterVolume: 0.5,
    muted: false,
    hudOpacity: 1,
    showTouchControls: true,
    quality: isMobileLike() ? "low" : "medium",
    quickMatch: false,
    autoFire: false,
    controls,
  };
}

const KEY = "lonewolf.settings.v1";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function loadSettings(): ArenaSettings {
  const base = defaultSettings();
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<ArenaSettings>;
    const merged: ArenaSettings = {
      ...base,
      ...saved,
      controls: { ...base.controls },
    };
    for (const id of CONTROL_IDS) {
      const c = saved.controls?.[id];
      if (!c) continue;
      merged.controls[id] = {
        dx: Number.isFinite(c.dx) ? clamp(c.dx, -1200, 1200) : 0,
        dy: Number.isFinite(c.dy) ? clamp(c.dy, -1200, 1200) : 0,
        scale: Number.isFinite(c.scale) ? clamp(c.scale, 0.6, 1.8) : 1,
        hidden: !!c.hidden,
      };
    }
    merged.mouseSensitivity = clamp(merged.mouseSensitivity, 0.0004, 0.008);
    merged.touchSensitivity = clamp(merged.touchSensitivity, 0.0015, 0.02);
    merged.adsMultiplier = clamp(merged.adsMultiplier, 0.2, 1.2);
    merged.masterVolume = clamp(merged.masterVolume, 0, 1);
    merged.hudOpacity = clamp(merged.hudOpacity, 0.3, 1);
    merged.quality = ["low", "medium", "high"].includes(merged.quality) ? merged.quality : base.quality;
    merged.quickMatch = !!merged.quickMatch;
    merged.autoFire = !!merged.autoFire;
    return merged;
  } catch {
    return base;
  }
}

export function saveSettings(s: ArenaSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage can be unavailable (private mode) — settings just won't persist */
  }
}
