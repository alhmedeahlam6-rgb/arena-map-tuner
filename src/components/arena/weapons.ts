import ak47 from "@/assets/weapons/ak47.png";
import m4a1 from "@/assets/weapons/m4a1.png";
import scar from "@/assets/weapons/scar.png";
import mp40 from "@/assets/weapons/mp40.png";
import ump from "@/assets/weapons/ump.png";
import m1014 from "@/assets/weapons/m1014.png";
import spas12 from "@/assets/weapons/spas12.png";
import awm from "@/assets/weapons/awm.png";
import kar98k from "@/assets/weapons/kar98k.png";
import m249 from "@/assets/weapons/m249.png";
import deagle from "@/assets/weapons/deagle.png";
import knife from "@/assets/weapons/knife.png";
import fists from "@/assets/weapons/fists.png";

export type WeaponClass = "Assault" | "SMG" | "Shotgun" | "Sniper" | "Heavy" | "Pistol" | "Melee";

export type Weapon = {
  id: string;
  name: string;
  cls: WeaponClass;
  price: number;
  damage: number;
  fireRate: number;
  range: number;
  image: string;
  magazine: number;
};

export const STARTING_CREDITS = 6000;

export const HEAVY_CLASSES: WeaponClass[] = ["Assault", "SMG", "Shotgun", "Sniper", "Heavy"];

export const isHeavy = (w: Weapon) => HEAVY_CLASSES.includes(w.cls);

/** Loadout rule: up to 2 heavy weapons + exactly one sidearm (pistol or knife). */
export const MAX_HEAVY = 2;

export const WEAPONS: Weapon[] = [
  { id: "ak47", name: "AK47", cls: "Assault", price: 2500, damage: 61, fireRate: 61, range: 72, magazine: 30, image: ak47 },
  { id: "m4a1", name: "M4A1", cls: "Assault", price: 2400, damage: 54, fireRate: 66, range: 70, magazine: 30, image: m4a1 },
  { id: "scar", name: "SCAR", cls: "Assault", price: 2600, damage: 57, fireRate: 60, range: 68, magazine: 30, image: scar },
  { id: "mp40", name: "MP40", cls: "SMG", price: 1800, damage: 48, fireRate: 95, range: 42, magazine: 40, image: mp40 },
  { id: "ump", name: "UMP", cls: "SMG", price: 1700, damage: 45, fireRate: 80, range: 46, magazine: 30, image: ump },
  { id: "m1014", name: "M1014", cls: "Shotgun", price: 2100, damage: 88, fireRate: 34, range: 20, magazine: 7, image: m1014 },
  { id: "spas12", name: "SPAS12", cls: "Shotgun", price: 2200, damage: 95, fireRate: 28, range: 22, magazine: 6, image: spas12 },
  { id: "awm", name: "AWM", cls: "Sniper", price: 4500, damage: 100, fireRate: 18, range: 96, magazine: 5, image: awm },
  { id: "kar98k", name: "KAR98K", cls: "Sniper", price: 3200, damage: 90, fireRate: 22, range: 90, magazine: 5, image: kar98k },
  { id: "m249", name: "M249", cls: "Heavy", price: 3800, damage: 52, fireRate: 72, range: 64, magazine: 100, image: m249 },
  { id: "deagle", name: "DESERT EAGLE", cls: "Pistol", price: 1200, damage: 70, fireRate: 30, range: 38, magazine: 7, image: deagle },
  { id: "fists", name: "FISTS", cls: "Melee", price: 0, damage: 34, fireRate: 70, range: 2, magazine: 0, image: fists },
  { id: "knife", name: "COMBAT KNIFE", cls: "Melee", price: 300, damage: 100, fireRate: 55, range: 2, magazine: 0, image: knife },
];

export const getWeapon = (id: string | null) => WEAPONS.find((w) => w.id === id) ?? null;

/** Health pool every damage number below is balanced against. */
export const MAX_HEALTH = 200;

export type DamageProfile = {
  /** body damage [far, close] */
  body: [number, number];
  /** headshot damage [far, close] */
  head: [number, number];
  /** fraction of effective range where falloff begins */
  falloffStart: number;
};

/**
 * Range-based damage, balanced against a 200 HP pool.
 * Damage sits at the `close` value up to falloffStart, then interpolates down
 * to the `far` value at the weapon's maximum range.
 */
export const DAMAGE_PROFILES: Record<string, DamageProfile> = {
  ak47:   { body: [22, 45],   head: [62, 110],  falloffStart: 0.35 },
  m4a1:   { body: [20, 41],   head: [55, 100],  falloffStart: 0.38 },
  scar:   { body: [19, 39],   head: [52, 95],   falloffStart: 0.38 },
  mp40:   { body: [13, 33],   head: [37, 62],   falloffStart: 0.28 },
  ump:    { body: [12, 31],   head: [35, 58],   falloffStart: 0.28 },
  m1014:  { body: [10, 26],   head: [18, 44],   falloffStart: 0.22 },
  spas12: { body: [11, 30],   head: [20, 50],   falloffStart: 0.22 },
  awm:    { body: [120, 200], head: [300, 400], falloffStart: 0.75 },
  kar98k: { body: [95, 150],  head: [220, 300], falloffStart: 0.7 },
  m249:   { body: [17, 35],   head: [45, 80],   falloffStart: 0.32 },
  deagle: { body: [40, 72],   head: [100, 160], falloffStart: 0.3 },
  knife:  { body: [90, 110],  head: [150, 200], falloffStart: 1 },
  fists:  { body: [28, 34],   head: [48, 60],   falloffStart: 1 },
};

const DEFAULT_PROFILE: DamageProfile = { body: [15, 30], head: [40, 70], falloffStart: 0.35 };

export function getDamageProfile(id: string | null): DamageProfile {
  return (id ? DAMAGE_PROFILES[id] : null) ?? DEFAULT_PROFILE;
}

/** Damage for one bullet, interpolated by distance, doubled-ish on headshots. */
export function getWeaponDamageAt(w: Weapon, distance: number, headshot = false) {
  const p = getDamageProfile(w.id);
  const maxRange = getWeaponRange(w);
  const start = maxRange * p.falloffStart;
  const t = maxRange <= start ? 0 : Math.min(1, Math.max(0, (distance - start) / (maxRange - start)));
  const [far, close] = headshot ? p.head : p.body;
  return Math.max(1, Math.round(close + (far - close) * t));
}

/** Legacy point-blank body damage, kept for shop-style displays. */
export function getWeaponDamage(w: Weapon) {
  return getDamageProfile(w.id).body[1];
}

export function getWeaponRange(w: Weapon) {
  return 20 + (w.range / 100) * 180;
}

export function getWeaponFireInterval(w: Weapon) {
  const b = getWeaponBehavior(w.id);
  // interval is meaningful for auto/burst; for single-action weapons the cycle is the real delay.
  return b.interval || b.cycle || 0.3;
}

export type FireMode = "auto" | "burst" | "single" | "pump" | "bolt" | "melee";

export type WeaponBehavior = {
  /** how the trigger works */
  mode: FireMode;
  /** seconds between shots (or between burst shots) */
  interval: number;
  /** extra delay after a burst / pump / bolt cycle */
  cycle: number;
  /** bullets fired per trigger pull (shotgun pellets / burst length) */
  shots: number;
  /** cone of fire in radians */
  spread: number;
  /** recoil kick multiplier */
  recoil: number;
  /** ADS magnification applied to the camera FOV while holding right mouse */
  zoom: number;
  /** audio flavour */
  sound: "rifle" | "carbine" | "smg" | "shotgun" | "sniper" | "mg" | "pistol" | "deagle" | "knife";
};

const BEHAVIORS: Record<string, WeaponBehavior> = {
  // interval ≈ 60 / real-world RPM
  ak47:   { mode: "auto",   interval: 0.100, cycle: 0,    shots: 1, spread: 0.014, recoil: 1.15, zoom: 1.4, sound: "rifle" },   // 600 rpm
  m4a1:   { mode: "auto",   interval: 0.075, cycle: 0,    shots: 1, spread: 0.010, recoil: 0.85, zoom: 1.4, sound: "carbine" }, // 800 rpm
  scar:   { mode: "burst",  interval: 0.060, cycle: 0.30, shots: 3, spread: 0.011, recoil: 1.0,  zoom: 1.4, sound: "rifle" },   // 3-round burst
  mp40:   { mode: "auto",   interval: 0.055, cycle: 0,    shots: 1, spread: 0.022, recoil: 0.70, zoom: 1.25, sound: "smg" },    // fastest full-auto
  ump:    { mode: "auto",   interval: 0.070, cycle: 0,    shots: 1, spread: 0.018, recoil: 0.65, zoom: 1.25, sound: "smg" },    // 850 rpm
  m1014:  { mode: "single", interval: 0,     cycle: 0.30, shots: 5, spread: 0.050, recoil: 1.6,  zoom: 1.1, sound: "shotgun" }, // semi-auto, 5 pellets
  spas12: { mode: "pump",   interval: 0,     cycle: 0.85, shots: 5, spread: 0.062, recoil: 2.0,  zoom: 1.1, sound: "shotgun" }, // pump, 5 pellets
  awm:    { mode: "bolt",   interval: 0,     cycle: 1.55, shots: 1, spread: 0.0,   recoil: 2.4,  zoom: 6.5, sound: "sniper" },
  kar98k: { mode: "bolt",   interval: 0,     cycle: 1.25, shots: 1, spread: 0.001, recoil: 2.1,  zoom: 5.2, sound: "sniper" },
  m249:   { mode: "auto",   interval: 0.080, cycle: 0,    shots: 1, spread: 0.026, recoil: 1.05, zoom: 1.2, sound: "mg" },      // 750 rpm belt
  deagle: { mode: "single", interval: 0,     cycle: 0.42, shots: 1, spread: 0.003, recoil: 1.7,  zoom: 1.5, sound: "deagle" },
  knife:  { mode: "melee",  interval: 0,     cycle: 0.45, shots: 1, spread: 0.0,   recoil: 0.3,  zoom: 1, sound: "knife" },
  fists:  { mode: "melee",  interval: 0,     cycle: 0.38, shots: 1, spread: 0.0,   recoil: 0.2,  zoom: 1, sound: "knife" },
};


const DEFAULT_BEHAVIOR: WeaponBehavior = {
  mode: "single",
  interval: 0,
  cycle: 0.3,
  shots: 1,
  spread: 0.01,
  recoil: 1,
  zoom: 1.3,
  sound: "pistol",
};

export function getWeaponBehavior(id: string | null): WeaponBehavior {
  return (id ? BEHAVIORS[id] : null) ?? DEFAULT_BEHAVIOR;
}

export const MAGAZINES: Record<string, number> = {
  ak47: 30,
  m4a1: 30,
  scar: 30,
  mp40: 40,
  ump: 30,
  m1014: 7,
  spas12: 6,
  awm: 5,
  kar98k: 5,
  m249: 100,
  deagle: 7,
  knife: 0,
  fists: 0,
};

export function getMagazine(id: string | null) {
  return (id ? MAGAZINES[id] : null) ?? 30;
}

export const RESERVE_AMMO: Record<string, number> = {
  ak47: 90,
  m4a1: 90,
  scar: 90,
  mp40: 160,
  ump: 120,
  m1014: 35,
  spas12: 30,
  awm: 20,
  kar98k: 20,
  m249: 200,
  deagle: 21,
  knife: 0,
  fists: 0,
};

export function getReserveAmmo(id: string | null) {
  return (id ? RESERVE_AMMO[id] : null) ?? 90;
}

/** Snappy arcade reload: every weapon racks a fresh mag in half a second. */
export function getReloadTime(id: string | null) {
  const w = getWeapon(id);
  if (!w) return 0.5;
  if (w.cls === "Melee") return 0;
  return 0.5;
}
