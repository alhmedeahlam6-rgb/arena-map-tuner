import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { Skull, Volume2, VolumeX, Maximize, Minimize, Settings, PawPrint, Wifi, Eye, Smile } from "lucide-react";
import { createSpawnFx, type SpawnFx } from "./spawnFx";
import { createImpactFx, type ImpactFx } from "./impactFx";
import { saveMatchResult, getLeaderboard } from "@/lib/arena.functions";
import { initSfx, playSfx, playSfxAt, warmSfx, suspendSfx, resumeSfx, setSfxMuted, setSfxVolume } from "./sfx";
import SettingsPanel from "./SettingsPanel";
import { defaultSettings, loadSettings, saveSettings, type ArenaSettings, type ControlId, type Quality } from "./settings";
import WeaponShop from "./WeaponShop";
import WeaponSlots from "./WeaponSlots";
import Minimap, { type MapGrid, type RadarState } from "./Minimap";
import TouchControls from "./TouchControls";
import {
  WEAPONS,
  STARTING_CREDITS,
  isHeavy,
  getWeapon,
  getWeaponDamageAt,
  getWeaponRange,
  getWeaponFireInterval,
  getWeaponBehavior,
  getMagazine,
  getReserveAmmo,
  getReloadTime,
  type Weapon,
} from "./weapons";



type Mode = "orbit" | "walk";
type Team = "blue" | "red";

type SpawnPoint = {
  name: string;
  team: Team;
  /** top-middle of the spawn pad — where a fighter stands */
  top: THREE.Vector3;
};

const TEAM_COLORS: Record<Team, number> = {
  blue: 0x3f8fff,
  red: 0xff3b1f,
};

const PLAYER_RADIUS = 0.7;
const EYE_HEIGHT = 1.7;
const STEP_UP = 0.55; // anything taller must be jumped
const GRAVITY = 24;
const JUMP_SPEED = 8.2;
const MAX_HP = 200;
const PLAYER_DAMAGE = 34;
const BOT_DAMAGE = 16;
const RESPAWN_SECONDS = 3;
const FIRE_COOLDOWN = 0.18;
const MUZZLE_FLASH_LIFE = 0.06;
const RECOIL_RECOVERY = 4.0;
const INTERMISSION_SECONDS = 5;
const MATCH_END_SECONDS = 5;
const COUNTDOWN_SECONDS = 10;
const SPAWN_BOX_HALF = 1.5; // 3m wide spawn cage
const SPAWN_BOX_HEIGHT = 5;

/** quick match shrinks the goal; standard is first to 10, best of 3 */
const MATCH_CONFIG = {
  quick: { killsToWinRound: 5, roundsToWinMatch: 1 },
  standard: { killsToWinRound: 10, roundsToWinMatch: 2 },
};


type Fighter = {
  id: string;
  team: Team;
  isHuman: boolean;
  group: THREE.Group | null;
  meshes: THREE.Mesh[];
  hp: number;
  alive: boolean;
  respawnIn: number;
  home: SpawnPoint;
  /** feet position */
  pos: THREE.Vector3;
  cooldown: number;
  tracer: { line: THREE.Line; mat: THREE.LineBasicMaterial; ttl: number } | null;
  /** personal spawn-in effect, played at this fighter's own spot */
  fx: SpawnFx | null;
  /** weapon id used for damage/fire-rate calculations */
  weapon: string;
};

type HudFighter = { id: string; team: Team; hp: number; alive: boolean; isHuman: boolean };

type MatchPhase = "warmup" | "countdown" | "round" | "intermission" | "matchEnd";

type KillFeedItem = {
  id: string;
  killer: string;
  killerTeam: Team;
  victim: string;
  victimTeam: Team;
  weapon: string;
  time: number;
};


type LeaderboardEntry = {
  winner: string;
  player_team: string;
  player_kills: number;
  player_deaths: number;
  blue_score: number;
  red_score: number;
};

type LeaderboardTotals = {
  recent: LeaderboardEntry[];
  totals: Record<string, { wins: number; losses: number; kills: number; deaths: number }>;
};



function buildBot(team: Team, label: string) {
  const g = new THREE.Group();
  const color = TEAM_COLORS[team];
  const meshes: THREE.Mesh[] = [];

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15 });
  const gearMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.8, metalness: 0.2 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc79a72, roughness: 0.9 });

  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 4, 12), gearMat);
  legs.position.y = 0.52;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 4, 14), bodyMat);
  torso.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 14), skinMat);
  head.position.y = 1.62;
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.215, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.5 }),
  );
  helmet.position.y = 1.63;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.85), gearMat);
  gun.position.set(0.26, 1.12, -0.42);

  for (const m of [legs, torso, head, helmet, gun]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData["hitZone"] = m === head || m === helmet ? "head" : "body";
    g.add(m);
    meshes.push(m);
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.62, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);

  g.name = label;
  return { group: g, meshes };
}

export default function LoneWolfArena() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<Mode>("walk");
  const [intro, setIntro] = useState(true);

  const [showDebug, setShowDebug] = useState(false);
  const [status, setStatus] = useState("Loading map…");
  const [showRoof, setShowRoof] = useState(true);
  const [hud, setHud] = useState<HudFighter[]>([]);
  const [score, setScore] = useState<Record<Team, number>>({ blue: 0, red: 0 });
  const [playerHp, setPlayerHp] = useState(MAX_HP);
  const [playerRespawn, setPlayerRespawn] = useState(0);
  const [match, setMatch] = useState({
    blue: 0,
    red: 0,
    phase: "warmup" as MatchPhase,
    round: 1,
    roundWinner: null as Team | null,
    matchWinner: null as Team | null,
    countdown: 0,
  });
  const [matchConfig, setMatchConfig] = useState(MATCH_CONFIG.standard);
  const matchConfigRef = useRef(matchConfig);
  matchConfigRef.current = matchConfig;
  const [killFeed, setKillFeed] = useState<KillFeedItem[]>([]);
  const [weaponReady, setWeaponReady] = useState(true);
  const [hitMarker, setHitMarker] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardTotals | null>(null);
  const [orbitLeaderboard, setOrbitLeaderboard] = useState<LeaderboardTotals | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [credits, setCredits] = useState(STARTING_CREDITS);
  const [owned, setOwned] = useState<string[]>(["deagle", "fists"]);
  // Loadout: [heavy 1, heavy 2, sidearm (pistol or knife), fists]
  const [slots, setSlots] = useState<(string | null)[]>([null, null, "deagle", "fists"]);
  const [activeSlot, setActiveSlot] = useState(2);
  const [ammo, setAmmo] = useState<Record<string, { mag: number; reserve: number }>>({
    deagle: { mag: 7, reserve: 21 },
  });
  const [isReloading, setIsReloading] = useState(false);
  const [reloadLeft, setReloadLeft] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [sfxReady, setSfxReady] = useState(false);
  const [playerStatsHud, setPlayerStatsHud] = useState({ kills: 0, deaths: 0 });
  const [damagePopups, setDamagePopups] = useState<
    { id: number; x: number; y: number; amount: number; head: boolean }[]
  >([]);
  const [scoped, setScoped] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [prone, setProne] = useState(false);
  const [kits, setKits] = useState(3);
  const [wallCharges, setWallCharges] = useState(3);
  const [touchUi, setTouchUi] = useState(false);
  const [settings, setSettings] = useState<ArenaSettings>(() => defaultSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingLayout, setEditingLayout] = useState(false);
  const settingsRef = useRef<ArenaSettings>(settings);
  settingsRef.current = settings;

  /** load persisted settings after hydration, then keep audio + storage in sync */
  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    setMuted(loaded.muted);
  }, []);

  useEffect(() => {
    saveSettings(settings);
    setSfxVolume(settings.masterVolume);
    setSfxMuted(settings.muted);
  }, [settings]);

  const moveControl = (id: ControlId, dx: number, dy: number) =>
    setSettings((s) => ({ ...s, controls: { ...s.controls, [id]: { ...s.controls[id], dx, dy } } }));
  /** shrinks the HUD on small / short (phone landscape) screens so it stops overlapping */
  const [hudScale, setHudScale] = useState(1);

  useEffect(() => {
    const fit = () => {
      const s = Math.min(window.innerHeight / 760, window.innerWidth / 1180, 1);
      setHudScale(Math.max(0.55, s));
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, []);



  const showRoofRef = useRef(true);
  const clipRef = useRef<{ renderer: THREE.WebGLRenderer; plane: THREE.Plane } | null>(null);
  const modeRef = useRef<Mode>("walk");
  const settingsOpenRef = useRef(false);
  const collidersRef = useRef<THREE.Mesh[]>([]);
  const startMatchRef = useRef<(() => void) | null>(null);
  const laserRef = useRef<{
    line: THREE.Line;
    material: THREE.LineBasicMaterial;
    spark: THREE.PointLight;
    sparkMesh: THREE.Mesh;
    ttl: number;
  } | null>(null);
  const muzzleRef = useRef<{
    light: THREE.PointLight;
    mesh: THREE.Mesh;
    ttl: number;
  } | null>(null);
  const recoilRef = useRef(0);
  const recoilYawRef = useRef(0);
  const weaponCooldownRef = useRef(0);
  const hitMarkerRef = useRef(0);
  const weaponRef = useRef<string>("deagle");
  const matchRef = useRef({
    blue: 0,
    red: 0,
    phase: "warmup" as MatchPhase,
    round: 1,
    roundWinner: null as Team | null,
    matchWinner: null as Team | null,
    countdown: 0,
  });
  const killFeedRef = useRef<KillFeedItem[]>([]);
  const intermissionRef = useRef(0);
  const countdownRef = useRef(0);
  const shakeRef = useRef(0);
  const spawnCageRef = useRef<{ mesh: THREE.Object3D; center: THREE.Vector3 } | null>(null);
  const saveSentRef = useRef(false);
  const introRef = useRef(0);
  const ammoRef = useRef<Record<string, { mag: number; reserve: number }>>({
    deagle: { mag: 7, reserve: 21 },
  });
  const isReloadingRef = useRef(false);
  const reloadTimerRef = useRef(0);
  const reloadingWeaponRef = useRef<string | null>(null);
  const startReloadRef = useRef<(id: string) => void>(() => {});
  const mouseHeldRef = useRef(false);
  const autoFireRef = useRef(settings.autoFire);
  autoFireRef.current = settings.autoFire;
  const burstQueueRef = useRef<{ shotsLeft: number; nextIn: number } | null>(null);
  const sfxInitializedRef = useRef(false);
  const crosshairRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const damageFlashRef = useRef(0);
  const radarRef = useRef<RadarState>({ fighters: [], player: null });
  const mapGridRef = useRef<MapGrid | null>(null);
  const mapImageRef = useRef<string | null>(null);
  const adsRef = useRef(false);
  const adsProgressRef = useRef(0);
  const scopedRef = useRef(false);
  const scopeRef = useRef<HTMLDivElement>(null);
  const centerDotRef = useRef<HTMLDivElement>(null);
  const popupIdRef = useRef(0);
  const popupTimersRef = useRef<number[]>([]);
  /** live movement keys, shared between the desktop loop and the touch HUD */
  const keysRef = useRef<Set<string>>(new Set());
  const proneRef = useRef(false);
  /** imperative hooks into the render loop, wired up once the scene exists */
  const actionsRef = useRef<{
    triggerDown: () => void;
    triggerUp: () => void;
    toggleAds: () => void;
    jump: () => void;
    heal: () => boolean;
    throwWall: () => boolean;
  } | null>(null);




  modeRef.current = mode;
  settingsOpenRef.current = settingsOpen || editingLayout;

  useEffect(() => {
    const nextWeapon = (slots[activeSlot] ?? "deagle") as string;
    if (weaponRef.current !== nextWeapon && isReloadingRef.current && reloadingWeaponRef.current !== nextWeapon) {
      // cancel reload when switching away from the weapon being reloaded
      isReloadingRef.current = false;
      reloadingWeaponRef.current = null;
      reloadTimerRef.current = 0;
      setIsReloading(false);
      setReloadLeft(0);
    }
    weaponRef.current = nextWeapon;
    if (sfxInitializedRef.current) playSfx("equip", 0.6);
    // dropping the scope when swapping to a weapon that has none
    const cls = getWeapon(nextWeapon)?.cls;
    if (cls === "Shotgun" || cls === "Melee") setScoped(false);
  }, [slots, activeSlot]);

  useEffect(() => {
    scopedRef.current = scoped;
  }, [scoped]);

  useEffect(() => {
    proneRef.current = prone;
  }, [prone]);

  useEffect(() => {
    // The HUD is designed as a mobile-style touch layout, so it is always shown.
    setTouchUi(true);
  }, []);


  useEffect(() => {
    ammoRef.current = ammo;
  }, [ammo]);

  useEffect(() => {
    isReloadingRef.current = isReloading;
  }, [isReloading]);




  useEffect(() => {
    getLeaderboard()
      .then((res) => setOrbitLeaderboard(res))
      .catch(() => {});

    const mount = mountRef.current;
    if (!mount) return;

    // read the persisted quality preset fresh so the renderer is configured
    // before the first frame, without waiting for the settings state effect.
    const initialQuality: Quality = (() => {
      try {
        const raw = window.localStorage.getItem("lonewolf.settings.v1");
        const parsed = raw ? (JSON.parse(raw) as Partial<ArenaSettings>) : null;
        const q = parsed?.quality;
        return q === "low" || q === "medium" || q === "high" ? q : "medium";
      } catch {
        return "medium";
      }
    })();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1117);
    scene.fog = new THREE.Fog(0x0d1117, initialQuality === "low" ? 120 : 160, initialQuality === "low" ? 360 : 520);

    const BASE_FOV = 70;
    const camera = new THREE.PerspectiveCamera(BASE_FOV, mount.clientWidth / mount.clientHeight, 0.1, 2000);

    const renderer = new THREE.WebGLRenderer({ antialias: initialQuality !== "low" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, initialQuality === "low" ? 1 : 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = initialQuality !== "low";
    renderer.shadowMap.type = initialQuality === "high" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.26; // +20% brighter overall
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.userSelect = "none";
    mount.appendChild(renderer.domElement);

    // ---- Lighting rig (all intensities +20%) ----
    scene.add(new THREE.HemisphereLight(0x9fc6ff, 0x7a8a9a, 1.62));

    const sun = new THREE.DirectionalLight(0xffd9a0, 2.52);
    sun.position.set(90, 120, 60);
    sun.castShadow = initialQuality !== "low";
    sun.shadow.mapSize.set(
      initialQuality === "high" ? 2048 : initialQuality === "medium" ? 1024 : 512,
      initialQuality === "high" ? 2048 : initialQuality === "medium" ? 1024 : 512,
    );
    const s = 110;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.far = 400;
    sun.shadow.bias = -0.0006;
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0x7fa8ff, 0.78);
    fill.position.set(-80, 60, -70);
    scene.add(fill);

    const groundFill = new THREE.PointLight(0xffc48a, 2.64, 260, 1.5);
    groundFill.position.set(0, 8, 0);
    scene.add(groundFill);

    scene.add(new THREE.AmbientLight(0xffffff, 0.66));

    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 20);
    renderer.localClippingEnabled = true;

    const root = new THREE.Group();
    scene.add(root);

    // ---- Player laser ----
    const laserGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const laserMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 });
    const laserLine = new THREE.Line(laserGeo, laserMat);
    laserLine.frustumCulled = false;
    root.add(laserLine);

    const sparkMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 }),
    );
    sparkMesh.visible = false;
    root.add(sparkMesh);

    const sparkLight = new THREE.PointLight(0xffa040, 0, 12, 2);
    sparkLight.position.set(0, -1000, 0);
    root.add(sparkLight);

    laserRef.current = { line: laserLine, material: laserMat, spark: sparkLight, sparkMesh, ttl: 0 };

    // ---- Muzzle flash ----
    const muzzleGeo = new THREE.SphereGeometry(0.07, 12, 12);
    const muzzleMat = new THREE.MeshBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 0 });
    const muzzleMesh = new THREE.Mesh(muzzleGeo, muzzleMat);
    muzzleMesh.visible = false;
    root.add(muzzleMesh);
    const muzzleLight = new THREE.PointLight(0xffa040, 0, 18, 2);
    muzzleLight.position.set(0, -1000, 0);
    root.add(muzzleLight);
    muzzleRef.current = { light: muzzleLight, mesh: muzzleMesh, ttl: 0 };

    // ---- impact spark pool ----
    const impactPool: ImpactFx[] = [];
    for (let i = 0; i < (initialQuality === "low" ? 2 : 4); i++) {
      const fx = createImpactFx(initialQuality);
      root.add(fx.group);
      impactPool.push(fx);
    }
    const spawnImpact = (at: THREE.Vector3, color?: THREE.Color) => {
      const fx = impactPool.find((f) => f.group.visible === false) ?? impactPool[0]!;
      fx.burst(at, color);
    };

    // ---- state ----

    let theta = Math.PI * 0.25;
    let phi = 0.85;
    let radius = 190;
    const target = new THREE.Vector3(0, 6, 0);

    const walkPos = new THREE.Vector3(-50, 0, -66); // FEET position
    let velY = 0;
    let grounded = false;
    // movement-audio bookkeeping
    const lastStepPos = new THREE.Vector3(-50, 0, -66);
    let stepDist = 0;
    let stepIndex = 0;
    let runStepIndex = 0;
    const STEP_KINDS = ["step1", "step2", "step3", "step4"] as const;
    const RUN_KINDS = ["steprun", "steprun2"] as const;
    let yaw = Math.PI * 0.75;
    let pitch = 0;
    const keys = keysRef.current;
    keys.clear();
    /** prone lowers the camera and the muzzle */
    const eyeHeight = () => (proneRef.current ? 0.85 : EYE_HEIGHT);

    const fighters: Fighter[] = [];
    const fxList: SpawnFx[] = [];
    let human: Fighter | null = null;
    let humanBody: { group: THREE.Group; meshes: THREE.Mesh[] } | null = null;

    const scoreState: Record<Team, number> = { blue: 0, red: 0 };
    const playerStats = { kills: 0, deaths: 0 };


    const syncHud = () => {
      setHud(
        fighters.map((f) => ({
          id: f.id,
          team: f.team,
          hp: Math.max(0, Math.round(f.hp)),
          alive: f.alive,
          isHuman: f.isHuman,
        })),
      );
      setScore({ ...scoreState });
      if (human) {
        setPlayerHp(Math.max(0, Math.round(human.hp)));
        setPlayerRespawn(human.alive ? 0 : Math.ceil(human.respawnIn));
      }
    };

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (modeRef.current !== "orbit") return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerUp = () => (dragging = false);

    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const scratch = new THREE.Vector3();

    const enemyMeshes = (team: Team) =>
      fighters.filter((f) => f.team !== team && f.alive && f.group).flatMap((f) => f.meshes);

    const fighterByMesh = (mesh: THREE.Object3D) => {
      for (const f of fighters) if (f.meshes.includes(mesh as THREE.Mesh)) return f;
      return null;
    };

    const groundAt = (x: number, z: number, fromY: number) => {
      const colliders = collidersRef.current;
      if (colliders.length === 0) return null;
      raycaster.set(scratch.set(x, fromY + 6, z), down);
      raycaster.far = 40;
      const hits = raycaster.intersectObjects(colliders, false);
      return hits.length > 0 && hits[0] ? hits[0].point.y : null;
    };

    const pushKillFeed = (killer: Fighter, victim: Fighter, weaponName = "Rifle") => {
      const item: KillFeedItem = {
        id: Math.random().toString(36).slice(2),
        killer: killer.isHuman ? "YOU" : killer.id,
        killerTeam: killer.team,
        victim: victim.isHuman ? "YOU" : victim.id,
        victimTeam: victim.team,
        weapon: weaponName,
        time: 5,
      };
      killFeedRef.current = [item, ...killFeedRef.current].slice(0, 6);
      setKillFeed(killFeedRef.current);
    };


    const endRound = (winner: Team) => {
      const m = matchRef.current;
      const cfg = matchConfigRef.current;
      m[winner] += 1;
      m.phase = m[winner] >= cfg.roundsToWinMatch ? "matchEnd" : "intermission";
      m.roundWinner = winner;
      m.matchWinner = m[winner] >= cfg.roundsToWinMatch ? winner : null;
      m.countdown = m.matchWinner ? MATCH_END_SECONDS : INTERMISSION_SECONDS;
      intermissionRef.current = m.countdown;
      setMatch({ ...m });
      syncHud();
      const playerTeam = human?.team ?? "blue";
      if (m.matchWinner === playerTeam) playSfx("victory", 0.9);
      if (m.matchWinner) {

        if (!saveSentRef.current) {
          saveSentRef.current = true;
          saveMatchResult({
            data: {
              blue_score: m.blue,
              red_score: m.red,
              winner: m.matchWinner,
              player_team: human?.team ?? "blue",
              player_kills: playerStats.kills,
              player_deaths: playerStats.deaths,
            },
          }).catch(() => {});
          getLeaderboard()
            .then((res) => setLeaderboard(res))
            .catch(() => {});

        }
        setTimeout(() => {
          saveSentRef.current = false;
          startMatch();
        }, MATCH_END_SECONDS * 1000);
      } else {
        setTimeout(() => startNewRound(), INTERMISSION_SECONDS * 1000);
      }
    };

    const startNewRound = () => {
      scoreState.blue = 0;
      scoreState.red = 0;
      matchRef.current.phase = "countdown";
      matchRef.current.roundWinner = null;
      matchRef.current.countdown = COUNTDOWN_SECONDS;
      matchRef.current.round += 1;
      countdownRef.current = COUNTDOWN_SECONDS;
      setMatch({ ...matchRef.current });
      for (const f of fighters) respawn(f, true);
      syncHud();
    };

    const kill = (victim: Fighter, killer: Fighter) => {
      victim.alive = false;
      victim.hp = 0;
      victim.respawnIn = RESPAWN_SECONDS;
      if (victim.group) victim.group.visible = false;
      scoreState[killer.team] += 1;
      if (killer.isHuman) playerStats.kills += 1;
      if (victim.isHuman) playerStats.deaths += 1;
      setPlayerStatsHud({ kills: playerStats.kills, deaths: playerStats.deaths });
      if (killer.isHuman || victim.isHuman) playSfx("kill", killer.isHuman ? 0.9 : 0.55);
      if (victim.isHuman) playSfx("death", 0.85);
      else playSfxAt("death", victim.pos.distanceTo(walkPos), 0.6, (Math.random() - 0.5) * 0.08);
      pushKillFeed(killer, victim);
      if (scoreState[killer.team] >= matchConfigRef.current.killsToWinRound) {
        endRound(killer.team);
      } else {
        syncHud();
      }
    };

    const damage = (victim: Fighter, amount: number, killer: Fighter) => {
      if (!victim.alive) return;
      victim.hp -= amount;
      if (victim.isHuman) {
        damageFlashRef.current = 0.7;
        playSfx(Math.random() < 0.5 ? "hurt" : "hurt2", 0.8, (Math.random() - 0.5) * 0.06);
      }
      if (victim.hp <= 0) kill(victim, killer);
      else {
        if (!victim.isHuman) {
          playSfxAt(Math.random() < 0.5 ? "hurt" : "hurt2", victim.pos.distanceTo(walkPos), 0.5, (Math.random() - 0.5) * 0.1);
        }
        if (killer.isHuman) {
          hitMarkerRef.current = 0.18;
          setHitMarker(0.18);
          playSfx("hit", 0.85, (Math.random() - 0.5) * 0.08);
        }
        syncHud();
      }
    };

    /** Floating damage number at the world-space hit point. */
    const spawnDamagePopup = (point: THREE.Vector3, amount: number, head: boolean) => {
      const el = renderer.domElement;
      const p = point.clone().project(camera);
      if (p.z > 1) return;
      const x = (p.x * 0.5 + 0.5) * el.clientWidth;
      const y = (-p.y * 0.5 + 0.5) * el.clientHeight;
      const id = ++popupIdRef.current;
      setDamagePopups((list) => [...list.slice(-11), { id, x, y, amount, head }]);
      const t = window.setTimeout(() => {
        setDamagePopups((list) => list.filter((d) => d.id !== id));
        popupTimersRef.current = popupTimersRef.current.filter((h) => h !== t);
      }, 900);
      popupTimersRef.current.push(t);
    };


    // the spawn animation is a one-time show at the start of the match
    let spawnFxPlayed = false;
    let introTime = 0;

    const respawn = (f: Fighter, withFx = false) => {
      f.alive = true;
      f.hp = MAX_HP;
      f.respawnIn = 0;
      f.cooldown = 0.8 + Math.random() * 1.2;
      f.pos.copy(f.home.top);
      const gy = groundAt(f.pos.x, f.pos.z, f.pos.y + 4);
      if (gy !== null) f.pos.y = gy;
      // each fighter gets its own effect, played exactly where it lands
      if (withFx) {
        f.fx?.burst(f.pos);
        if (f.isHuman) playSfx("spawn", 0.8);
      }
      if (f.group) {
        f.group.visible = true;
        f.group.position.copy(f.pos);
      }
      if (f.isHuman) {
        if (spawnCageRef.current) {
          spawnCageRef.current.center.copy(f.pos);
          spawnCageRef.current.mesh.position.copy(f.pos).add(new THREE.Vector3(0, SPAWN_BOX_HEIGHT / 2, 0));
        }
        walkPos.copy(f.pos);
        velY = 0;
        grounded = true;
        yaw = Math.atan2(f.pos.x, f.pos.z);
        pitch = 0;
      }
      syncHud();
    };

    const startMatch = () => {
      scoreState.blue = 0;
      scoreState.red = 0;
      matchRef.current = {
        blue: 0,
        red: 0,
        phase: "countdown",
        round: 1,
        roundWinner: null,
        matchWinner: null,
        countdown: COUNTDOWN_SECONDS,
      };
      countdownRef.current = COUNTDOWN_SECONDS;
      killFeedRef.current = [];
      playerStats.kills = 0;
      playerStats.deaths = 0;
      setPlayerStatsHud({ kills: 0, deaths: 0 });
      setMatch(matchRef.current);
      setKillFeed([]);
      saveSentRef.current = false;
      const firstTime = !spawnFxPlayed;
      for (const f of fighters) respawn(f, true);
      if (firstTime) {
        spawnFxPlayed = true;
        introTime = 5;
        introRef.current = 5;
        setIntro(true);
      }

      syncHud();
    };
    startMatchRef.current = startMatch;

    const startReload = (weaponId: string) => {
      if (isReloadingRef.current) return;
      const cur = ammoRef.current[weaponId];
      if (!cur || cur.mag >= getMagazine(weaponId) || cur.reserve <= 0) return;
      isReloadingRef.current = true;
      reloadingWeaponRef.current = weaponId;
      setIsReloading(true);
      reloadTimerRef.current = getReloadTime(weaponId);
      setReloadLeft(reloadTimerRef.current);
      const mode = getWeaponBehavior(weaponId).mode;
      playSfx(mode === "pump" || mode === "bolt" ? "pump" : "reload", 0.75);
    };
    startReloadRef.current = startReload;


    const finishReload = (weaponId: string) => {
      if (!isReloadingRef.current) return;
      const weaponBeingReloaded = reloadingWeaponRef.current ?? weaponId;
      const cur = ammoRef.current[weaponBeingReloaded];
      if (!cur) return;
      const mag = getMagazine(weaponBeingReloaded);
      const need = mag - cur.mag;
      const take = Math.min(need, cur.reserve);
      const next = { ...cur, mag: cur.mag + take, reserve: cur.reserve - take };
      ammoRef.current = { ...ammoRef.current, [weaponBeingReloaded]: next };
      setAmmo(ammoRef.current);
      isReloadingRef.current = false;
      reloadingWeaponRef.current = null;
      setIsReloading(false);
      setReloadLeft(0);
    };


    const RECOIL_PITCH = 0.045;


    // Proper cone spread: build an orthonormal basis around `dir` and offset
    // inside a disc, so the deviation is symmetric and never biased downward.
    const applySpread = (dir: THREE.Vector3, spread: number) => {
      if (spread <= 0) return dir.normalize();
      const ref = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(dir, ref).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      dir.add(right.multiplyScalar(Math.cos(theta) * r));
      dir.add(up.multiplyScalar(Math.sin(theta) * r));
      return dir.normalize();
    };


    /* ------------------------------------------------------------------
     * Breakable shield walls: thrown in front of the player, added to the
     * collider set with their own HP so bullets chip them down.
     * ---------------------------------------------------------------- */
    const WALL_HP = 350;
    const shieldWalls: { mesh: THREE.Mesh; hp: number }[] = [];

    const removeWall = (mesh: THREE.Mesh) => {
      const i = shieldWalls.findIndex((w) => w.mesh === mesh);
      if (i !== -1) shieldWalls.splice(i, 1);
      collidersRef.current = collidersRef.current.filter((m) => m !== mesh);
      root.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    };

    const damageWall = (mesh: THREE.Mesh, amount: number, at: THREE.Vector3) => {
      const entry = shieldWalls.find((w) => w.mesh === mesh);
      if (!entry) return;
      entry.hp -= amount;
      spawnImpact(at, new THREE.Color(0x6fc3ff));
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0.2, 0.75 * (entry.hp / WALL_HP));
      if (entry.hp <= 0) removeWall(mesh);
    };

    const throwWall = () => {
      if (!human || !human.alive) return false;
      const dirv = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const center = walkPos.clone().add(dirv.multiplyScalar(3.4));
      const gy = groundAt(center.x, center.z, walkPos.y + 2) ?? walkPos.y;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, 2.4, 0.35),
        new THREE.MeshStandardMaterial({
          color: 0x6fc3ff,
          emissive: 0x1b4b7a,
          transparent: true,
          opacity: 0.75,
          roughness: 0.25,
          metalness: 0.4,
        }),
      );
      mesh.position.set(center.x, gy + 1.2, center.z);
      mesh.rotation.y = yaw + Math.PI;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData["shieldWall"] = true;
      root.add(mesh);
      collidersRef.current = [...collidersRef.current, mesh];
      shieldWalls.push({ mesh, hp: WALL_HP });
      playSfx("equip", 0.7);
      return true;
    };

    const shoot = (fromAuto = false) => {
      const colliders = collidersRef.current;
      if (!laserRef.current || !human || !human.alive) return false;
      if (matchRef.current.phase === "countdown") return false;
      if (isReloadingRef.current) return false;
      if (weaponCooldownRef.current > 0) return false;

      const weaponId = weaponRef.current;
      const w = getWeapon(weaponId);
      if (!w) return false;
      const behavior = getWeaponBehavior(weaponId);
      const weaponName = w.name;
      const weaponRange = getWeaponRange(w);

      const currentAmmo = ammoRef.current[weaponId];
      if (currentAmmo && currentAmmo.mag <= 0) {
        // dry click, then auto-reload when empty
        playSfx("dryfire", 0.7);
        startReload(weaponId);
        return false;
      }

      // sound
      if (sfxInitializedRef.current) {
        playSfx(behavior.sound, 1, (Math.random() - 0.5) * 0.04);
        // pump / bolt weapons rack the action right after the shot
        if (behavior.mode === "pump" || behavior.mode === "bolt") {
          window.setTimeout(() => playSfx("pump", 0.65), behavior.cycle * 420);
        }
      }


      weaponCooldownRef.current = getWeaponFireInterval(w);
      setWeaponReady(false);

      // The ray is built from the player's own state, never from the camera:
      // the camera carries screen shake and is repositioned later in the frame.
      // IMPORTANT: the ray uses the aim the player currently sees (the recoil
      // already accumulated and rendered), and the *new* kick from this shot is
      // applied afterwards — so the bullet always leaves through the crosshair.
      const aimYaw = yaw + recoilYawRef.current;
      const aimPitch = pitch - recoilRef.current;
      const origin = new THREE.Vector3(walkPos.x, walkPos.y + eyeHeight(), walkPos.z);
      const dir = new THREE.Vector3(
        Math.sin(aimYaw) * Math.cos(aimPitch),
        Math.sin(aimPitch),
        Math.cos(aimYaw) * Math.cos(aimPitch),
      ).multiplyScalar(-1).normalize();
      applySpread(dir, behavior.spread * (adsRef.current ? 0.35 : 1));

      // now kick the view up for the *next* shot
      const recoilScale = Math.max(0.5, 1.1 - w.fireRate / 200) * behavior.recoil;
      recoilRef.current = Math.min(recoilRef.current + RECOIL_PITCH * recoilScale, 0.32);
      recoilYawRef.current += (Math.random() - 0.5) * 0.035 * recoilScale;
      shakeRef.current = 0.12;


      // tracers leave the gun, which sits down-right of the eye
      const rightVec = new THREE.Vector3(Math.cos(aimYaw), 0, -Math.sin(aimYaw));
      const muzzlePos = origin
        .clone()
        .add(rightVec.clone().multiplyScalar(0.3))
        .add(new THREE.Vector3(0, -0.25, 0))
        .add(dir.clone().multiplyScalar(0.6));

      const muzzle = muzzleRef.current;
      if (muzzle) {
        muzzle.mesh.position.copy(muzzlePos);
        muzzle.light.position.copy(muzzle.mesh.position);
        muzzle.mesh.visible = true;
        muzzle.light.intensity = 18;
        muzzle.ttl = 0.06;
      }

      const pellets = Math.max(1, behavior.shots);
      let anyHit = false;

      for (let p = 0; p < pellets; p++) {
        let pelletDir = dir.clone();
        if (pellets > 1) {
          // shotgun pellet spread
          pelletDir.add(new THREE.Vector3((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08));
          pelletDir.normalize();
        }
        raycaster.set(origin, pelletDir);
        raycaster.far = weaponRange;
        const worldHits = raycaster.intersectObjects(colliders, false);
        const botHits = raycaster.intersectObjects(enemyMeshes(human.team), false);

        const worldDist = worldHits[0]?.distance ?? Infinity;
        const botDist = botHits[0]?.distance ?? Infinity;

        const laser = laserRef.current;
        const posAttr = laser.line.geometry.attributes["position"];
        if (!posAttr) continue;
        const positions = posAttr.array as Float32Array;
        positions[0] = muzzlePos.x;
        positions[1] = muzzlePos.y;
        positions[2] = muzzlePos.z;

        let end: THREE.Vector3;
        let hitBot = false;
        const botHit = botHits[0];
        if (botDist < worldDist && botHit) {
          end = botHit.point.clone();
          const victim = fighterByMesh(botHit.object);
          if (victim) {
            const headshot = botHit.object.userData["hitZone"] === "head";
            const dmg = getWeaponDamageAt(w, botHit.distance, headshot);
            damage(victim, dmg, human);
            spawnDamagePopup(end, dmg, headshot);
            hitBot = true;
            anyHit = true;
          }
        } else if (worldHits[0]) {
          end = worldHits[0].point.clone();
          const obj = worldHits[0].object as THREE.Mesh;
          if (obj.userData["shieldWall"]) {
            damageWall(obj, getWeaponDamageAt(w, worldHits[0].distance, false), end);
          }
        } else {
          end = origin.clone().add(pelletDir.multiplyScalar(weaponRange));
        }

        positions[3] = end.x;
        positions[4] = end.y;
        positions[5] = end.z;
        posAttr.needsUpdate = true;

        laser.sparkMesh.position.copy(end);
        laser.sparkMesh.visible = true;
        laser.spark.position.copy(end);
        laser.spark.intensity = 5;
        laser.material.opacity = 1;
        laser.ttl = 0.12;

        spawnImpact(end, hitBot ? new THREE.Color(human.team === "blue" ? 0x3f8fff : 0xff3b1f) : undefined);
        // Kill feed is already pushed by damage()/kill(); don't duplicate it here.
      }


      // decrement ammo
      if (currentAmmo) {
        currentAmmo.mag = Math.max(0, currentAmmo.mag - 1);
        ammoRef.current = { ...ammoRef.current, [weaponId]: currentAmmo };
        setAmmo(ammoRef.current);
      }

      return anyHit;
    };



    /* ------------------------------------------------------------------
     * Scope aim assist
     * Right-clicking snaps the aim onto the closest visible enemy's nearest
     * body part. The head is only ever chosen when the crosshair is already
     * sitting near it, and even then only ~25% of the time — otherwise the
     * lock lands on the torso. Once locked, the aim keeps tracking the target
     * every frame, so it follows the enemy (and the player) while moving.
     * ---------------------------------------------------------------- */
    const HEAD_Y = 1.62;
    const BODY_Y = 1.15;
    const ASSIST_ACQUIRE_ANGLE = 0.22; // ~12.5° cone around the crosshair
    const ASSIST_HEAD_WINDOW = 0.022; // "near the head" tolerance
    const ASSIST_HEAD_CHANCE = 0.25;
    const ASSIST_BREAK_ANGLE = 0.45; // looking this far away drops the lock
    const ASSIST_MAX_RANGE = 160;
    let aimLock: { target: Fighter; zone: "head" | "body" } | null = null;

    const eyePos = () => new THREE.Vector3(walkPos.x, walkPos.y + eyeHeight(), walkPos.z);
    const aimPointOf = (f: Fighter, zone: "head" | "body") =>
      f.pos.clone().setY(f.pos.y + (zone === "head" ? HEAD_Y : BODY_Y));
    const currentAimDir = () =>
      new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
        .multiplyScalar(-1)
        .normalize();
    const visible = (from: THREE.Vector3, to: THREE.Vector3) => {
      const delta = to.clone().sub(from);
      const dist = delta.length();
      if (dist < 0.001) return true;
      raycaster.set(from, delta.normalize());
      raycaster.far = dist - 0.35;
      return raycaster.intersectObjects(collidersRef.current, false).length === 0;
    };

    const acquireAimLock = () => {
      aimLock = null;
      if (!human || !human.alive) return;
      const eye = eyePos();
      const aimDir = currentAimDir();
      let best: { target: Fighter; zone: "head" | "body"; ang: number } | null = null;
      for (const f of fighters) {
        if (f.team === human.team || !f.alive || !f.group) continue;
        const head = aimPointOf(f, "head");
        const body = aimPointOf(f, "body");
        if (eye.distanceTo(body) > ASSIST_MAX_RANGE) continue;
        const headSeen = visible(eye, head);
        const bodySeen = visible(eye, body);
        if (!headSeen && !bodySeen) continue;
        const aHead = headSeen ? aimDir.angleTo(head.clone().sub(eye).normalize()) : Infinity;
        const aBody = bodySeen ? aimDir.angleTo(body.clone().sub(eye).normalize()) : Infinity;
        const ang = Math.min(aHead, aBody);
        if (ang > ASSIST_ACQUIRE_ANGLE) continue;
        if (best && ang >= best.ang) continue;
        const nearHead = aHead <= aBody + ASSIST_HEAD_WINDOW;
        const zone: "head" | "body" =
          nearHead && headSeen && Math.random() < ASSIST_HEAD_CHANCE ? "head" : bodySeen ? "body" : "head";
        best = { target: f, zone, ang };
      }
      if (best) aimLock = { target: best.target, zone: best.zone };
    };

    const updateAimLock = (dt: number) => {
      if (!adsRef.current || !human || !human.alive) {
        aimLock = null;
        return;
      }
      const lock = aimLock;
      if (!lock) return;
      if (!lock.target.alive || !lock.target.group) {
        aimLock = null;
        return;
      }
      const eye = eyePos();
      const point = aimPointOf(lock.target, lock.zone);
      const delta = point.clone().sub(eye);
      if (delta.length() > ASSIST_MAX_RANGE) {
        aimLock = null;
        return;
      }
      const v = delta.clone().normalize();
      if (currentAimDir().angleTo(v) > ASSIST_BREAK_ANGLE) {
        aimLock = null;
        return;
      }
      const desiredPitch = Math.asin(THREE.MathUtils.clamp(-v.y, -1, 1));
      const desiredYaw = Math.atan2(-v.x, -v.z);
      let dYaw = desiredYaw - yaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      const k = 1 - Math.exp(-dt * 10);
      yaw += dYaw * k;
      pitch += (desiredPitch - pitch) * k;
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        if (modeRef.current === "walk" && document.pointerLockElement === renderer.domElement) {
          if (!adsRef.current) {
            adsRef.current = true;
            const cls = getWeapon(weaponRef.current)?.cls;
            // every weapon aims down sights except shotguns and melee
            if (cls !== "Shotgun" && cls !== "Melee") setScoped(true);
            playSfx("ads", 0.5);
            acquireAimLock();
          }
        }
        return;
      }
      if (e.button !== 0) return;
      if (!sfxInitializedRef.current) {
        initSfx();
        sfxInitializedRef.current = true;
        setSfxReady(true);
      }
      if (modeRef.current !== "walk") return;
      if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock?.();
        return;
      }
      mouseHeldRef.current = true;
      const behavior = getWeaponBehavior(weaponRef.current);
      if (behavior.mode === "auto" || behavior.mode === "burst") {
        if (behavior.mode === "burst" && !burstQueueRef.current) {
          burstQueueRef.current = { shotsLeft: behavior.shots, nextIn: 0 };
        }
      } else {
        shoot();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) {
        if (adsRef.current) {
          adsRef.current = false;
          setScoped(false);
          playSfx("ads", 0.35, -0.08);
        }
        return;
      }
      if (e.button !== 0) return;
      mouseHeldRef.current = false;
      // cancelling a burst mid-burst is intentional
    };


    /* ---- imperative actions used by the touch HUD ---- */
    const triggerDown = () => {
      if (!sfxInitializedRef.current) {
        initSfx();
        sfxInitializedRef.current = true;
        setSfxReady(true);
      }
      mouseHeldRef.current = true;
      const behavior = getWeaponBehavior(weaponRef.current);
      if (behavior.mode === "auto") return;
      if (behavior.mode === "burst") {
        if (!burstQueueRef.current) burstQueueRef.current = { shotsLeft: behavior.shots, nextIn: 0 };
        return;
      }
      shoot();
    };
    const triggerUp = () => {
      mouseHeldRef.current = false;
    };
    const toggleAds = () => {
      if (adsRef.current) {
        adsRef.current = false;
        setScoped(false);
        playSfx("ads", 0.35, -0.08);
        return;
      }
      adsRef.current = true;
      const cls = getWeapon(weaponRef.current)?.cls;
      if (cls !== "Shotgun" && cls !== "Melee") setScoped(true);
      playSfx("ads", 0.5);
      acquireAimLock();
    };
    const jump = () => {
      keys.add("Space");
      window.setTimeout(() => keys.delete("Space"), 120);
    };
    const heal = () => {
      if (!human || !human.alive || human.hp >= MAX_HP) return false;
      human.hp = Math.min(MAX_HP, human.hp + 75);
      playSfx("equip", 0.8);
      syncHud();
      return true;
    };
    actionsRef.current = { triggerDown, triggerUp, toggleAds, jump, heal, throwWall };

    /* ---- touch look-drag: aiming without a mouse ---- */
    let touchLookId: number | null = null;
    let touchLastX = 0;
    let touchLastY = 0;
    const onTouchLookStart = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || modeRef.current !== "walk") return;
      if (touchLookId !== null) return;
      touchLookId = e.pointerId;
      // keep receiving moves even if the finger slides over HUD overlays
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      touchLastX = e.clientX;
      touchLastY = e.clientY;
      if (!sfxInitializedRef.current) {
        initSfx();
        sfxInitializedRef.current = true;
        setSfxReady(true);
      }
    };
    const onTouchLookEnd = (e: PointerEvent) => {
      if (touchLookId === e.pointerId) touchLookId = null;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (touchLookId === e.pointerId) {
        const cfg = settingsRef.current;
        const sens = cfg.touchSensitivity * (adsRef.current ? cfg.adsMultiplier : 1);
        const inv = cfg.invertY ? -1 : 1;
        yaw -= (e.clientX - touchLastX) * sens;
        // camera forward is the negated dir vector, so dragging down (+clientY)
        // must increase pitch for the view to actually tilt down
        pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - touchLastY) * sens * inv));
        touchLastX = e.clientX;
        touchLastY = e.clientY;
        return;
      }
      if (modeRef.current === "walk") {
        if (document.pointerLockElement !== renderer.domElement) return;
        const cfg = settingsRef.current;
        const sens = cfg.mouseSensitivity * (adsRef.current ? cfg.adsMultiplier : 1);
        const inv = cfg.invertY ? -1 : 1;
        yaw -= e.movementX * sens;
        pitch = Math.max(-1.2, Math.min(1.2, pitch + e.movementY * sens * inv));
        return;
      }
      if (!dragging) return;
      theta -= (e.clientX - lastX) * 0.005;
      phi = Math.max(0.15, Math.min(1.45, phi - (e.clientY - lastY) * 0.005));
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onWheel = (e: WheelEvent) => {
      if (modeRef.current !== "orbit") return;
      e.preventDefault();
      radius = Math.max(20, Math.min(420, radius + e.deltaY * 0.25));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && modeRef.current === "walk") e.preventDefault();
      keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);

    renderer.domElement.addEventListener("pointerdown", onTouchLookStart);
    window.addEventListener("pointerup", onTouchLookEnd);
    window.addEventListener("pointercancel", onTouchLookEnd);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === renderer.domElement;
      if (modeRef.current === "walk" && !locked && matchRef.current.phase === "round" && !settingsOpenRef.current) {
        setPaused(true);
        suspendSfx();
      }
    };
    document.addEventListener("pointerlockchange", onPointerLockChange);

    const onFullscreenChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);



    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    let limit = 200;
    let disposed = false;

    // The arena GLB ships meshopt-compressed geometry and KTX2/ETC1S textures,
    // so both decoders have to be attached before loading.
    const ktx2Loader = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(renderer);
    const loader = new GLTFLoader();
    loader.setKTX2Loader(ktx2Loader);
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      "/models/arena.glb",
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        root.add(model);

        const colliders: THREE.Mesh[] = [];
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.geometry) colliders.push(m);
        });
        collidersRef.current = colliders;

        // Radar footprint: sample every vertex of the level between knee and
        // roof height into a top-down occupancy grid. The GLB batches whole
        // areas into single meshes, so per-mesh bounds are useless here.
        {
          const RES = 128;
          const EXT = 78;
          const cells = new Uint8Array(RES * RES);
          const v = new THREE.Vector3();
          for (const m of colliders) {
            const pos = m.geometry.getAttribute("position");
            if (!pos) continue;
            m.updateWorldMatrix(true, false);
            const step = pos.count > 60000 ? 3 : 1;
            for (let i = 0; i < pos.count; i += step) {
              v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(m.matrixWorld);
              if (v.y < 0.5 || v.y > 9) continue; // skip floors, roofs, sky
              const gx = Math.floor(((v.x + EXT) / (EXT * 2)) * RES);
              const gz = Math.floor(((v.z + EXT) / (EXT * 2)) * RES);
              if (gx < 0 || gz < 0 || gx >= RES || gz >= RES) continue;
              const idx = gz * RES + gx;
              const cur = cells[idx] ?? 0;
              if (cur < 255) cells[idx] = cur + 1;
            }
          }
          mapGridRef.current = { cells, res: RES, extent: EXT };
        }

        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        limit = Math.max(size.x, size.z) / 2 - 2;
        radius = Math.max(size.x, size.z) * 1.15;
        target.set(0, size.y * 0.15, 0);

        // ---- hardcoded spawn spots (from the authored 2v2 spawn meshes) ----
        // one fighter per spot, standing in the middle of its own pad
        const SPAWN_SPOTS: Array<{ name: string; team: Team; top: THREE.Vector3 }> = [
          { name: "SPAWN_BLUE_1", team: "blue", top: new THREE.Vector3(-46.78, 0.58, -67.08) },
          { name: "SPAWN_BLUE_2", team: "blue", top: new THREE.Vector3(-55.04, 0.58, -67.08) },
          { name: "SPAWN_RED_1", team: "red", top: new THREE.Vector3(45.03, 0.58, 66.05) },
          { name: "SPAWN_RED_2", team: "red", top: new THREE.Vector3(53.29, 0.58, 66.05) },
        ];
        const points: SpawnPoint[] = SPAWN_SPOTS.map((s) => ({
          name: s.name,
          team: s.team,
          top: s.top.clone(),
        }));

        const bluePads = points.filter((p) => p.team === "blue");
        const redPads = points.filter((p) => p.team === "red");




        const makeTracer = () => {
          const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(),
            new THREE.Vector3(),
          ]);
          const mat = new THREE.LineBasicMaterial({ color: 0xff9d5c, transparent: true, opacity: 0 });
          const line = new THREE.Line(geo, mat);
          line.frustumCulled = false;
          root.add(line);
          return { line, mat, ttl: 0 };
        };

        const addFighter = (team: Team, index: number, isHuman: boolean) => {
          const pads = team === "blue" ? bluePads : redPads;
          // one fighter per pad; if a team has fewer pads than fighters, stand
          // side by side around the shared pad instead of inside each other
          const pad = pads[index % pads.length]!;
          const overflow = Math.floor(index / pads.length);
          const home: SpawnPoint =
            overflow === 0
              ? pad
              : {
                  ...pad,
                  top: pad.top
                    .clone()
                    .add(
                      new THREE.Vector3(
                        Math.cos(overflow * 2.2) * 2.6,
                        0,
                        Math.sin(overflow * 2.2) * 2.6,
                      ),
                    ),
                };
          const id = `${team.toUpperCase()}_${index + 1}`;
          const weapon = isHuman ? "deagle" : team === "blue" ? "ak47" : index === 0 ? "m4a1" : "ump";
          const f: Fighter = {
            id,
            team,
            isHuman,
            group: null,
            meshes: [],
            hp: MAX_HP,
            alive: true,
            respawnIn: 0,
            home,
            pos: home.top.clone(),
            cooldown: 0.8 + Math.random() * 1.2,
            tracer: null,
            fx: null,
            weapon,
          };
          // personal spawn effect, sitting on this fighter's own spot
          const fx = createSpawnFx(team === "blue" ? "water" : "fire", home.top, initialQuality);
          root.add(fx.group);
          fxList.push(fx);
          f.fx = fx;
          if (!isHuman) {
            const built = buildBot(team, id);
            built.group.position.copy(f.pos);
            root.add(built.group);
            f.group = built.group;
            f.meshes = built.meshes;
            f.tracer = makeTracer();
          }
          fighters.push(f);
          return f;
        };

        // 2v2: you + 1 blue bot vs 2 red bots
        human = addFighter("blue", 0, true);
        humanBody = buildBot("blue", "YOU");
        humanBody.group.position.copy(human.pos);
        humanBody.group.visible = false;
        root.add(humanBody.group);

        {
          const cage = new THREE.Group();
          const box = new THREE.Mesh(
            new THREE.BoxGeometry(SPAWN_BOX_HALF * 2, SPAWN_BOX_HEIGHT, SPAWN_BOX_HALF * 2),
            new THREE.MeshBasicMaterial({
              color: 0x3f8fff,
              transparent: true,
              opacity: 0.08,
              side: THREE.BackSide,
              depthWrite: false,
            }),
          );
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(box.geometry),
            new THREE.LineBasicMaterial({ color: 0x9ecbff, transparent: true, opacity: 0.6 }),
          );
          cage.add(box, edges);
          cage.position.copy(human.home.top).add(new THREE.Vector3(0, SPAWN_BOX_HEIGHT / 2, 0));
          cage.visible = false;
          root.add(cage);
          spawnCageRef.current = { mesh: cage, center: human.home.top.clone() };
        }
        addFighter("blue", 1, false);
        addFighter("red", 0, false);
        addFighter("red", 1, false);

        // the match waits for the player to dismiss the onboarding overlay;
        // enterWalk (the "Enter arena" button) kicks off startMatch.

        // pad key light
        for (const p of points) {
          const spot = new THREE.PointLight(TEAM_COLORS[p.team], 12, 20, 2);
          spot.position.copy(p.top).add(new THREE.Vector3(0, 6, 0));
          root.add(spot);
        }

        clipPlane.constant = box.min.y + size.y * 0.78;
        renderer.clippingPlanes = showRoofRef.current ? [] : [clipPlane];
        clipRef.current = { renderer, plane: clipPlane };

        // ---- real minimap: one orthographic top-down render with the roof clipped ----
        try {
          const RT = 512;
          const EXT = 80; // must match ARENA_EXTENT in Minimap
          const topCam = new THREE.OrthographicCamera(-EXT, EXT, EXT, -EXT, 0.1, 600);
          topCam.up.set(0, 0, -1);
          topCam.position.set(0, 300, 0);
          topCam.lookAt(0, 0, 0);
          const rt = new THREE.WebGLRenderTarget(RT, RT);
          const prevPlanes = renderer.clippingPlanes;
          renderer.clippingPlanes = [clipPlane];
          renderer.setRenderTarget(rt);
          renderer.render(scene, topCam);
          renderer.setRenderTarget(null);
          renderer.clippingPlanes = prevPlanes;

          const buf = new Uint8Array(RT * RT * 4);
          renderer.readRenderTargetPixels(rt, 0, 0, RT, RT, buf);
          const cv = document.createElement("canvas");
          cv.width = cv.height = RT;
          const cx = cv.getContext("2d");
          if (cx) {
            const img = cx.createImageData(RT, RT);
            for (let y = 0; y < RT; y++) {
              const srcRow = (RT - 1 - y) * RT * 4; // GL reads bottom-up
              const dstRow = y * RT * 4;
              img.data.set(buf.subarray(srcRow, srcRow + RT * 4), dstRow);
            }
            cx.putImageData(img, 0, 0);
            mapImageRef.current = cv.toDataURL("image/png");
          }
          rt.dispose();
        } catch {
          // fall back to the occupancy grid minimap
        }

        syncHud();
        setStatus("");
      },
      (e) => {
        if (e.total) setStatus(`Loading map… ${Math.round((e.loaded / e.total) * 100)}%`);
      },
      (err) => {
        console.error("[arena] map load failed", err);
        setStatus("Failed to load the map file.");
      },
    );

    let raf = 0;
    let last = performance.now();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();

    const botTick = (f: Fighter, dt: number) => {
      if (!f.group) return;
      if (matchRef.current.phase !== "round") return;
      if (!f.alive) {
        f.respawnIn -= dt;
        if (f.respawnIn <= 0) respawn(f);
        return;
      }

      // keep bots planted on the ground
      const gy = groundAt(f.pos.x, f.pos.z, f.pos.y + 2);
      if (gy !== null) f.pos.y = gy;
      f.group.position.copy(f.pos);

      // pick the closest living enemy (human counts)
      let bestTarget: { pos: THREE.Vector3; fighter: Fighter } | null = null;
      let bestDist = Infinity;
      for (const other of fighters) {
        if (other.team === f.team || !other.alive) continue;
        const p = other.isHuman ? walkPos : other.pos;
        const d = p.distanceTo(f.pos);
        if (d < bestDist) {
          bestDist = d;
          bestTarget = { pos: p.clone(), fighter: other };
        }
      }
      if (!bestTarget) return;

      const bw = getWeapon(f.weapon);
      const botRange = bw ? getWeaponRange(bw) : 120;
      const botInterval = bw ? getWeaponFireInterval(bw) : 0.65;
      const botWeaponName = bw?.name ?? "Rifle";

      const aim = bestTarget.pos.clone().setY(bestTarget.pos.y + 1.3);
      const eye = f.pos.clone().setY(f.pos.y + 1.3);
      const toTarget = aim.clone().sub(eye);
      const dist = toTarget.length();
      f.group.rotation.y = Math.atan2(toTarget.x, toTarget.z) + Math.PI;

      f.cooldown -= dt;
      if (f.cooldown > 0 || dist > botRange) return;
      f.cooldown = botInterval * (0.9 + Math.random() * 0.4);

      // distant gunfire — attenuated so the arena has depth
      playSfxAt(
        getWeaponBehavior(f.weapon).sound,
        eye.distanceTo(camera.position),
        0.85,
        (Math.random() - 0.5) * 0.05,
      );


      // line of sight
      const dir = toTarget.clone().normalize();
      raycaster.set(eye, dir);
      raycaster.far = dist - 0.4;
      const blocked = raycaster.intersectObjects(collidersRef.current, false).length > 0;

      if (f.tracer) {
        const attr = f.tracer.line.geometry.getAttribute("position") as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        const end = blocked ? eye.clone().add(dir.multiplyScalar(Math.min(dist, 12))) : aim;
        arr[0] = eye.x;
        arr[1] = eye.y;
        arr[2] = eye.z;
        arr[3] = end.x;
        arr[4] = end.y;
        arr[5] = end.z;
        attr.needsUpdate = true;
        f.tracer.mat.color.setHex(f.team === "blue" ? 0x8ec5ff : 0xff9d5c);
        f.tracer.mat.opacity = 1;
        f.tracer.ttl = 0.1;
      }

      if (blocked) return;
      // accuracy falls off with distance
      const hitChance = Math.max(0.25, 0.85 - dist / 160);
      if (Math.random() < hitChance) {
        damage(bestTarget.fighter, BOT_DAMAGE, f);
        if (!bestTarget.fighter.alive) pushKillFeed(f, bestTarget.fighter, botWeaponName);
      }
    };

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      let pendingFire = false;

      for (const fx of fxList) fx.update(dt);
      for (const fx of impactPool) fx.update(dt);

      // pre-round countdown
      if (spawnCageRef.current) {
        spawnCageRef.current.mesh.visible =
          matchRef.current.phase === "countdown" && modeRef.current === "walk";
      }

      if (introTime > 0) {
        introTime = Math.max(0, introTime - dt);
        introRef.current = introTime;
        if (introTime <= 0) setIntro(false);
      }

      if (matchRef.current.phase === "countdown" && introTime <= 0) {
        countdownRef.current = Math.max(0, countdownRef.current - dt);
        const rounded = Math.ceil(countdownRef.current);
        if (matchRef.current.countdown !== rounded) {
          matchRef.current.countdown = rounded;
          setMatch({ ...matchRef.current });
        }
        if (countdownRef.current <= 0) {
          matchRef.current.phase = "round";
          matchRef.current.countdown = 0;
          setMatch({ ...matchRef.current });
        }
      }

      // automatic fire & burst handling
      if (human && human.alive && matchRef.current.phase === "round" && modeRef.current === "walk") {
        // reload progress
        if (isReloadingRef.current && reloadTimerRef.current > 0) {
          reloadTimerRef.current = Math.max(0, reloadTimerRef.current - dt);
          const rounded = Math.ceil(reloadTimerRef.current * 10) / 10;
          if (rounded !== reloadLeft) {
            setReloadLeft(rounded);
          }
          if (reloadTimerRef.current <= 0) {
            finishReload(weaponRef.current);
          }
        }
        // firing itself happens after the camera update, further down the frame
        pendingFire = true;
      }

      if (humanBody) humanBody.group.visible = introTime > 0 && modeRef.current === "walk";


      if (introTime > 0 && human && modeRef.current === "walk") {
        // cinematic spawn intro: camera hovers in front of the player's face
        const p = human.pos;
        if (humanBody) {
          humanBody.group.position.copy(p);
          humanBody.group.rotation.y = yaw + Math.PI;
        }
        const face = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const t = 1 - introTime / 5;
        const dist = 4.6 - t * 2.1;
        const head = new THREE.Vector3(p.x, p.y + EYE_HEIGHT, p.z);
        const orbitSwing = Math.sin(t * Math.PI) * 0.5;
        camera.position.set(
          head.x + face.x * dist + Math.cos(yaw) * orbitSwing * dist * 0.4,
          head.y + 0.45 + (1 - t) * 0.8,
          head.z + face.z * dist - Math.sin(yaw) * orbitSwing * dist * 0.4,
        );
        camera.lookAt(head);
      } else if (modeRef.current === "orbit") {
        theta += dt * 0.03;
        camera.position.set(
          target.x + radius * Math.sin(phi) * Math.cos(theta),
          target.y + radius * Math.cos(phi),
          target.z + radius * Math.sin(phi) * Math.sin(theta),
        );
        camera.lookAt(target);
      } else if (human) {

        if (!human.alive) {
          // drop out of ADS/scope while dead so nothing lingers on respawn
          if (adsRef.current) {
            adsRef.current = false;
            setScoped(false);
          }
          if (adsProgressRef.current > 0) {
            adsProgressRef.current = Math.max(0, adsProgressRef.current - dt * 6);
            if (scopeRef.current) scopeRef.current.style.opacity = "0";
            if (crosshairRef.current) crosshairRef.current.style.opacity = "1";
            if (centerDotRef.current) centerDotRef.current.style.opacity = "1";
            camera.fov = BASE_FOV;
            camera.updateProjectionMatrix();
          }
          human.respawnIn -= dt;
          setPlayerRespawn(Math.max(0, Math.ceil(human.respawnIn)));
          if (human.respawnIn <= 0) respawn(human);
        } else {
          const speed = (proneRef.current ? 3.4 : keys.has("ShiftLeft") ? 16 : 8) * dt;
          forward.set(Math.sin(yaw), 0, Math.cos(yaw));
          right.set(Math.cos(yaw), 0, -Math.sin(yaw));
          const move = new THREE.Vector3();
          if (keys.has("KeyW") || keys.has("ArrowUp")) move.sub(forward);
          if (keys.has("KeyS") || keys.has("ArrowDown")) move.add(forward);
          if (keys.has("KeyA") || keys.has("ArrowLeft")) move.sub(right);
          if (keys.has("KeyD") || keys.has("ArrowRight")) move.add(right);

          const colliders = collidersRef.current;

          if (move.lengthSq() > 0) {
            move.normalize().multiplyScalar(speed);

            // wall check from chest height
            if (colliders.length > 0) {
              const chest = scratch.copy(walkPos).setY(walkPos.y + 1.0);
              raycaster.set(chest, move.clone().normalize());
              raycaster.far = PLAYER_RADIUS + speed + 0.05;
              const hits = raycaster.intersectObjects(colliders, false);
              if (hits.length > 0 && hits[0]) {
                const allowed = Math.max(0, hits[0].distance - PLAYER_RADIUS - 0.05);
                if (allowed < speed) move.normalize().multiplyScalar(allowed);
              }
            }

            // step check: only small ledges are walkable, taller must be jumped
            if (grounded && move.lengthSq() > 0) {
              const nx = walkPos.x + move.x;
              const nz = walkPos.z + move.z;
              const nextGround = groundAt(nx, nz, walkPos.y);
              if (nextGround !== null && nextGround - walkPos.y > STEP_UP) {
                move.set(0, 0, 0); // blocked — jump over it
              }
            }

            walkPos.x += move.x;
            walkPos.z += move.z;
          }

          // jump + gravity
          if (keys.has("Space") && grounded) {
            velY = JUMP_SPEED;
            grounded = false;
            playSfx("jump", 0.5);
          }
          velY -= GRAVITY * dt;
          walkPos.y += velY * dt;

          const gy = groundAt(walkPos.x, walkPos.z, walkPos.y);
          if (gy !== null) {
            const wasAirborne = !grounded;
            const impact = -velY;
            if (walkPos.y <= gy + 0.02) {
              walkPos.y = gy;
              velY = 0;
              grounded = true;
              if (wasAirborne && impact > 3) playSfx("land", Math.min(0.7, 0.25 + impact * 0.03));
            } else if (velY <= 0 && walkPos.y - gy < 0.35) {
              walkPos.y = gy;
              velY = 0;
              grounded = true;
              if (wasAirborne && impact > 3) playSfx("land", Math.min(0.7, 0.25 + impact * 0.03));
            } else {
              grounded = false;
            }
          }

          walkPos.x = Math.max(-limit, Math.min(limit, walkPos.x));
          walkPos.z = Math.max(-limit, Math.min(limit, walkPos.z));

          // during the buy phase you are locked inside your spawn cage
          const cage = spawnCageRef.current;
          if (matchRef.current.phase === "countdown" && cage) {
            walkPos.x = Math.max(cage.center.x - SPAWN_BOX_HALF, Math.min(cage.center.x + SPAWN_BOX_HALF, walkPos.x));
            walkPos.z = Math.max(cage.center.z - SPAWN_BOX_HALF, Math.min(cage.center.z + SPAWN_BOX_HALF, walkPos.z));
            const ceil = cage.center.y + SPAWN_BOX_HEIGHT - eyeHeight();
            if (walkPos.y > ceil) {
              walkPos.y = ceil;
              velY = Math.min(velY, 0);
            }
          }
          human.pos.copy(walkPos);

          camera.position.set(walkPos.x, walkPos.y + eyeHeight(), walkPos.z);

          // screen shake decay
          if (shakeRef.current > 0) {
            const s = shakeRef.current;
            camera.position.x += (Math.random() - 0.5) * s;
            camera.position.y += (Math.random() - 0.5) * s;
            camera.position.z += (Math.random() - 0.5) * s;
            shakeRef.current = Math.max(0, shakeRef.current - dt * 2.8);
          }

          // recoil recovery
          recoilRef.current = Math.max(0, recoilRef.current - dt * 0.45);
          recoilYawRef.current *= Math.max(0, 1 - dt * 5);
          weaponCooldownRef.current = Math.max(0, weaponCooldownRef.current - dt);

          // keep the scoped aim glued to the locked body part
          updateAimLock(dt);

          const effectiveYaw = yaw + recoilYawRef.current;
          const effectivePitch = pitch - recoilRef.current;
          const dir = new THREE.Vector3(
            Math.sin(effectiveYaw) * Math.cos(effectivePitch),
            Math.sin(effectivePitch),
            Math.cos(effectiveYaw) * Math.cos(effectivePitch),
          );
          camera.lookAt(camera.position.clone().add(dir.multiplyScalar(-1)));

          // ADS: ease a 0..1 progress value, then drive both the FOV and the
          // scope overlay from it so nothing ever snaps.
          const adsTarget = adsRef.current ? 1 : 0;
          const rate = adsTarget > adsProgressRef.current ? 8.5 : 11;
          adsProgressRef.current += (adsTarget - adsProgressRef.current) * (1 - Math.exp(-dt * rate));
          if (Math.abs(adsTarget - adsProgressRef.current) < 0.002) adsProgressRef.current = adsTarget;
          const raw = adsProgressRef.current;
          const ease = raw * raw * (3 - 2 * raw); // smoothstep
          const zoom = Math.max(1, getWeaponBehavior(weaponRef.current).zoom);
          const nextFov = BASE_FOV + (BASE_FOV / zoom - BASE_FOV) * ease;
          if (Math.abs(camera.fov - nextFov) > 0.01) {
            camera.fov = nextFov;
            camera.updateProjectionMatrix();
          }
          // the glass only slides in over the last part of the transition
          const scopeAlpha = scopedRef.current ? Math.max(0, (ease - 0.45) / 0.55) : 0;
          if (scopeRef.current) scopeRef.current.style.opacity = String(scopeAlpha);
          if (crosshairRef.current) crosshairRef.current.style.opacity = String(1 - scopeAlpha);
          if (centerDotRef.current) centerDotRef.current.style.opacity = String(1 - scopeAlpha);

          // footsteps: distance-driven so the cadence matches the actual speed
          const moved = Math.hypot(walkPos.x - lastStepPos.x, walkPos.z - lastStepPos.z);
          const sprinting = keys.has("ShiftLeft");
          if (grounded && move.lengthSq() > 0) {
            stepDist += moved;
            const stride = sprinting ? 1.75 : 1.5;
            if (stepDist >= stride) {
              stepDist = 0;
              if (sprinting) {
                runStepIndex = (runStepIndex + 1) % RUN_KINDS.length;
                playSfx(RUN_KINDS[runStepIndex] ?? "steprun", 0.6, (Math.random() - 0.5) * 0.14);
              } else {
                // shuffle-free rotation: never repeat the same heel sample twice
                stepIndex = (stepIndex + 1 + (Math.random() < 0.35 ? 1 : 0)) % STEP_KINDS.length;
                playSfx(STEP_KINDS[stepIndex] ?? "step1", 0.5, (Math.random() - 0.5) * 0.14);
              }
            }
          } else {
            stepDist = Math.min(stepDist, 1.2);
          }
          lastStepPos.set(walkPos.x, 0, walkPos.z);
        }
      }

      // automatic / burst fire, run only once the camera is in its final pose
      if (pendingFire) {
        const behavior = getWeaponBehavior(weaponRef.current);
        if (burstQueueRef.current) {
          burstQueueRef.current.nextIn -= dt;
          if (burstQueueRef.current.nextIn <= 0) {
            const q = burstQueueRef.current;
            shoot(true);
            q.shotsLeft -= 1;
            if (q.shotsLeft <= 0) {
              burstQueueRef.current = null;
            } else {
              q.nextIn = behavior.interval;
            }
          }
        }
        const canAutoFire =
          mouseHeldRef.current &&
          (behavior.mode === "auto" || (autoFireRef.current && behavior.mode === "single")) &&
          weaponCooldownRef.current <= 0 &&
          !isReloadingRef.current;
        if (canAutoFire) {
          shoot(true);
        }
      }

      if (weaponCooldownRef.current <= 0 && !weaponReady) {
        setWeaponReady(true);
      }


      for (const f of fighters) {
        if (!f.isHuman) botTick(f, dt);
        if (f.tracer && f.tracer.ttl > 0) {
          f.tracer.ttl -= dt;
          f.tracer.mat.opacity = Math.max(0, f.tracer.ttl / 0.1);
        }
      }

      const laser = laserRef.current;
      if (laser && laser.ttl > 0) {
        laser.ttl -= dt;
        const t = Math.max(0, laser.ttl / 0.12);
        laser.material.opacity = t;
        laser.spark.intensity = t * 5;
        (laser.sparkMesh.material as THREE.MeshBasicMaterial).opacity = t;
        if (laser.ttl <= 0) {
          laser.sparkMesh.visible = false;
          laser.spark.intensity = 0;
        }
      }

      const muzzle = muzzleRef.current;
      if (muzzle && muzzle.ttl > 0) {
        muzzle.ttl -= dt;
        const t = Math.max(0, muzzle.ttl / 0.06);
        (muzzle.mesh.material as THREE.MeshBasicMaterial).opacity = t;
        muzzle.light.intensity = t * 18;
        muzzle.mesh.scale.setScalar(1 + (1 - t) * 2.5);
        if (muzzle.ttl <= 0) {
          muzzle.mesh.visible = false;
          muzzle.light.intensity = 0;
        }
      }

      if (hitMarkerRef.current > 0) {
        hitMarkerRef.current = Math.max(0, hitMarkerRef.current - dt);
        if (hitMarkerRef.current <= 0) setHitMarker(0);
      }

      if (killFeedRef.current.length > 0) {
        let changed = false;
        for (const item of killFeedRef.current) {
          item.time -= dt;
          if (item.time <= 0) changed = true;
        }
        if (changed) {
          killFeedRef.current = killFeedRef.current.filter((i) => i.time > 0);
          setKillFeed([...killFeedRef.current]);
        }
      }

      if (intermissionRef.current > 0) {
        intermissionRef.current = Math.max(0, intermissionRef.current - dt);
        const rounded = Math.ceil(intermissionRef.current);
        if (matchRef.current.countdown !== rounded) {
          matchRef.current.countdown = rounded;
          setMatch({ ...matchRef.current });
        }
      }



      radarRef.current = {
        fighters: fighters.map((f) => ({
          x: f.pos.x,
          z: f.pos.z,
          team: f.team,
          alive: f.alive,
          isHuman: f.isHuman,
        })),
        player: human ? { x: walkPos.x, z: walkPos.z, yaw } : null,
      };

      if (damageFlashRef.current > 0) {
        damageFlashRef.current = Math.max(0, damageFlashRef.current - dt * 1.8);
        const v = vignetteRef.current;
        if (v) v.style.opacity = String(damageFlashRef.current);
      }

      const ch = crosshairRef.current;
      if (ch) {
        const b = getWeaponBehavior(weaponRef.current);
        const size = 14 + b.spread * 900 + Math.min(0.32, recoilRef.current) * 190;
        ch.style.width = `${size}px`;
        ch.style.height = `${size}px`;
      }

      renderer.render(scene, camera);
    };
    animate();

    // warm the sample bytes into the HTTP cache so the first shot is instant
    warmSfx();
    const onVisibility = () => (document.hidden ? suspendSfx() : resumeSfx());
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      for (const t of popupTimersRef.current) window.clearTimeout(t);
      popupTimersRef.current = [];
      renderer.domElement.removeEventListener("pointerdown", onTouchLookStart);
      window.removeEventListener("pointerup", onTouchLookEnd);
      window.removeEventListener("pointercancel", onTouchLookEnd);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mouseup", onMouseUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      suspendSfx();
      ktx2Loader.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };



  }, []);

  useEffect(() => {
    showRoofRef.current = showRoof;
    const c = clipRef.current;
    if (c) c.renderer.clippingPlanes = showRoof ? [] : [c.plane];
  }, [showRoof, hud]);

  const enterWalk = () => {
    startMatchRef.current?.();
    setMode("walk");
    const canvas = mountRef.current?.querySelector("canvas");
    canvas?.requestPointerLock?.();
  };

  const enter = () => {
    const cfg = settings.quickMatch ? MATCH_CONFIG.quick : MATCH_CONFIG.standard;
    setMatchConfig(cfg);
    matchConfigRef.current = cfg;
    setShowOnboarding(false);
    enterWalk();
  };

  // The match starts when the player dismisses the onboarding overlay.

  useEffect(() => {
    if (match.phase === "countdown" && mode === "walk" && !intro) {
      setShopOpen(true);
      document.exitPointerLock?.();
    } else {
      setShopOpen(false);
    }
  }, [match.phase, mode, intro]);


  /** Equip a weapon respecting the loadout rule: 2 heavy + 1 sidearm. */
  const equipWeapon = (w: Weapon) => {
    setSlots((prev) => {
      const next = [...prev];
      if (!isHeavy(w)) {
        next[2] = w.id;
        return next;
      }
      const existing = next.indexOf(w.id);
      if (existing !== -1) return next;
      const empty = next[0] === null ? 0 : next[1] === null ? 1 : -1;
      const target = empty !== -1 ? empty : activeSlot < 2 ? activeSlot : 0;
      next[target] = w.id;
      return next;
    });
    setActiveSlot(() => {
      if (!isHeavy(w)) return 2;
      return slots.indexOf(w.id) !== -1
        ? slots.indexOf(w.id)
        : slots[0] === null
          ? 0
          : slots[1] === null
            ? 1
            : activeSlot < 2
              ? activeSlot
              : 0;
    });
  };

  const buyWeapon = (w: Weapon) => {
    if (owned.includes(w.id)) {
      equipWeapon(w);
      return;
    }
    if (credits < w.price) {
      playSfx("dryfire", 0.5);
      return;
    }
    playSfx("buy", 0.85);
    setCredits((c) => c - w.price);
    setOwned((o) => [...o, w.id]);
    setAmmo((prev) => ({
      ...prev,
      [w.id]: { mag: getMagazine(w.id), reserve: getReserveAmmo(w.id) },
    }));
    equipWeapon(w);
  };

  const sellAllWeapons = () => {
    const heavyIds = slots.slice(0, 2).filter(Boolean) as string[];
    if (heavyIds.length === 0) return;
    const refund = heavyIds.reduce((sum, id) => sum + (getWeapon(id)?.price ?? 0) * 0.5, 0);
    setCredits((c) => c + Math.floor(refund));
    setSlots((prev) => [null, null, prev[2] ?? null, prev[3] ?? "fists"]);
    setActiveSlot(2);
  };


  const selectSlot = (i: number) => {

    if (!slots[i]) return;
    setActiveSlot(i);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyR" && !isReloadingRef.current) {
        const weaponId = weaponRef.current;
        const cur = ammoRef.current[weaponId];
        if (cur && cur.mag < getMagazine(weaponId) && cur.reserve > 0) {
          startReloadRef.current(weaponId);
        }
      }
      if (e.code === "KeyB" && matchRef.current.phase === "countdown") setShopOpen((v) => !v);
      if (e.code === "Backquote") setShowDebug((v) => !v);
      if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3" || e.code === "Digit4") {
        const i = Number(e.code.slice(5)) - 1;
        setSlots((s) => {
          if (s[i]) setActiveSlot(i);
          return s;
        });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const useHealthKit = () => {
    if (kits <= 0) return;
    if (actionsRef.current?.heal()) setKits((k) => Math.max(0, k - 1));
  };

  const throwShieldWall = () => {
    if (wallCharges <= 0) return;
    if (actionsRef.current?.throwWall()) setWallCharges((w) => Math.max(0, w - 1));
  };

  const dropWeapon = (index: number) => {
    if (index === 3) return;
    setSlots((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
    setActiveSlot((cur) => (cur === index ? 3 : cur));
  };

  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="h-full w-full touch-none select-none" />
      <div
        ref={vignetteRef}
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0,
          background:
            "radial-gradient(ellipse at center, transparent 50%, rgba(200,30,30,0.6) 100%)",
        }}
      />

      {status && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs uppercase tracking-[0.3em] text-muted-foreground">
          {status}
        </div>
      )}

      {showOnboarding && !status && (
        <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-background/85 p-6 text-center backdrop-blur-md">
          <h2 className="text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-5xl">
            Lone Wolf Arena
          </h2>
          <p className="max-w-xs text-sm text-muted-foreground">
            A fast 2v2 arena shooter built for short sessions. Pick your loadout, lock on, and fight.
          </p>

          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={enter}
              className="min-w-[220px] rounded-xl bg-[var(--hud-accent)] px-8 py-3 text-sm font-black uppercase tracking-[0.2em] text-[var(--hud-accent-foreground)] shadow-[var(--shadow-hud)] transition hover:brightness-110 active:scale-95"
            >
              Play
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="min-w-[220px] rounded-xl border border-border bg-card/80 px-8 py-3 text-sm font-bold uppercase tracking-[0.15em] text-foreground transition hover:bg-secondary active:scale-95"
            >
              Settings
            </button>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-full border border-border/60 bg-card/60 px-4 py-2 transition hover:bg-card">
            <input
              type="checkbox"
              checked={settings.quickMatch}
              onChange={(e) => setSettings((s) => ({ ...s, quickMatch: e.target.checked }))}
              className="h-4 w-4 accent-[var(--hud-accent)]"
            />
            <span className="text-xs font-bold uppercase tracking-widest text-foreground">Quick match</span>
            <span className="text-[10px] text-muted-foreground">First to 5 · one round</span>
          </label>

          <div className="grid max-w-md gap-2 text-xs text-muted-foreground">
            <p>
              <span className="font-semibold text-[var(--hud-accent)]">W A S D</span> move ·{" "}
              <span className="font-semibold text-[var(--hud-accent)]">Space</span> jump ·{" "}
              <span className="font-semibold text-[var(--hud-accent)]">Click</span> shoot ·{" "}
              <span className="font-semibold text-[var(--hud-accent)]">R</span> reload
            </p>
            <p>
              <span className="font-semibold text-[var(--hud-accent)]">1 2 3 4</span> switch weapons ·{" "}
              <span className="font-semibold text-[var(--hud-accent)]">B</span> armory in buy phase
            </p>
          </div>

          {orbitLeaderboard && (
            <div className="mt-2 rounded-xl border border-border/60 bg-card/70 p-4 backdrop-blur">
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-muted-foreground">Leaderboard</p>
              <div className="mt-2 flex gap-6 text-xs">
                {Object.entries(orbitLeaderboard.totals).map(([team, t]) => (
                  <div key={team} className="text-left">
                    <p className={team === "blue" ? "text-[#3f8fff]" : "text-[#ff3b1f]"}>
                      {team === "blue" ? "Blue" : "Red"}
                    </p>
                    <p className="tabular-nums text-foreground">
                      {t.wins}W {t.losses}L · {t.kills}K {t.deaths}D
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {mode === "walk" && (

        <>
          {editingLayout && (
            <>
              <TouchControls
                settings={settings}
                editing
                onMoveControl={moveControl}
                scale={hudScale}
                press={() => {}}
                release={() => {}}
                onShootStart={() => {}}
                onShootEnd={() => {}}
                onScopeToggle={() => {}}
                scoped={scoped}
                onJump={() => {}}
                onProneToggle={() => {}}
                prone={prone}
                kits={kits}
                onHeal={() => {}}
                walls={wallCharges}
                onThrowWall={() => {}}
                slots={slots}
                onDropWeapon={() => {}}
              />
              <button
                type="button"
                onClick={() => setEditingLayout(false)}
                className="pointer-events-auto absolute bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-[var(--hud-accent)] px-6 py-2 text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--hud-accent-foreground)]"
              >
                Save layout
              </button>
            </>
          )}
          {settingsOpen && !editingLayout && (
            <SettingsPanel
              settings={settings}
              onChange={setSettings}
              editing={editingLayout}
              onToggleEditing={() => setEditingLayout(true)}
              onClose={() => setSettingsOpen(false)}
            />
          )}
          {paused && (
            <div className="pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background/85 p-6 text-center backdrop-blur-md">
              <h2 className="text-3xl font-black uppercase tracking-[0.15em] text-foreground sm:text-4xl">
                Paused
              </h2>
              <p className="max-w-xs text-xs text-muted-foreground">
                Tap resume to jump back in, or open settings to tweak sensitivity, quality and controls.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPaused(false);
                    resumeSfx();
                    mountRef.current?.querySelector("canvas")?.requestPointerLock?.();
                  }}
                  className="min-w-[200px] rounded-xl bg-[var(--hud-accent)] px-8 py-3 text-xs font-black uppercase tracking-[0.2em] text-[var(--hud-accent-foreground)] shadow-[var(--shadow-hud)] transition hover:brightness-110 active:scale-95"
                >
                  Resume
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaused(false);
                    setSettingsOpen(true);
                    document.exitPointerLock?.();
                  }}
                  className="min-w-[200px] rounded-xl border border-border bg-card/80 px-8 py-3 text-xs font-bold uppercase tracking-[0.15em] text-foreground transition hover:bg-secondary active:scale-95"
                >
                  Settings
                </button>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="min-w-[200px] rounded-xl border border-border bg-card/80 px-8 py-3 text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground transition hover:bg-secondary active:scale-95"
                >
                  Main menu
                </button>
              </div>
            </div>
          )}
          <div
            className="pointer-events-none absolute inset-0 z-10"
            style={{ transform: `scale(${hudScale})`, transformOrigin: "top left" }}
          >
            <Minimap radarRef={radarRef} mapRef={mapGridRef} imageRef={mapImageRef} />
          </div>

          {/* status strip right of the minimap: settings, companion, ping, spectators */}
          <div className="absolute left-[148px] top-3 z-10 flex items-center gap-3 text-white/70 sm:left-[156px] sm:top-4">
            <button
              type="button"
              aria-label="Open settings"
              className="pointer-events-auto rounded-md p-0.5 transition hover:text-white"
              onClick={() => {
                setSettingsOpen(true);
                document.exitPointerLock?.();
              }}
            >
              <Settings className="h-4 w-4" />
            </button>
            <PawPrint className="h-4 w-4" />
            <span className="flex items-center gap-1 text-[9px] font-semibold tabular-nums">
              <Wifi className="h-4 w-4" />
              92
            </span>
            <span className="flex items-center gap-1 text-[9px] font-semibold tabular-nums">
              <Eye className="h-4 w-4" />
              {hud.filter((f) => f.team === "blue" && f.alive).length}
            </span>
          </div>
          <div className="pointer-events-none absolute left-[152px] top-9 z-10 text-white/60 sm:left-[160px] sm:top-10">
            <Smile className="h-4 w-4" />
          </div>

          {/* Floating damage numbers at the hit point */}
          <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
            {damagePopups.map((d) => (
              <span
                key={d.id}
                className="absolute font-extrabold tabular-nums drop-shadow-[0_2px_3px_rgba(0,0,0,0.85)]"
                style={{
                  left: d.x,
                  top: d.y,
                  color: d.head ? "rgb(255,64,48)" : "rgb(255,214,64)",
                  fontSize: d.head ? 30 : 20,
                  transform: "translate(-50%, -50%)",
                  animation: "arena-dmg-float 900ms ease-out forwards",
                }}
              >
                {d.amount}
                {d.head && <span className="ml-1 align-middle text-[0.55em] tracking-widest">HS</span>}
              </span>
            ))}
          </div>

          {/* Scope overlay — Free Fire style. Sides stay transparent so the player keeps peripheral vision. */}
          <div ref={scopeRef} className="pointer-events-none absolute inset-0 z-20" style={{ opacity: 0 }}>
            {/* Subtle darkening only at the bezel edge, sides remain see-through */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(circle at center, rgba(0,0,0,0) 26%, rgba(0,0,0,0.35) 28%, rgba(0,0,0,0) 32%)",
              }}
            />
            {/* Chunky dark bezel ring with metallic inner highlight */}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                width: "56vh",
                height: "56vh",
                boxShadow:
                  "0 0 0 10px rgba(10,12,14,0.98), 0 0 0 12px rgba(60,64,70,0.6), inset 0 0 0 6px rgba(18,20,24,0.95), inset 0 0 0 8px rgba(120,128,140,0.35), inset 0 0 40px rgba(0,0,0,0.9)",
              }}
            />
            {/* Inner lens recess shadow */}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ width: "52vh", height: "52vh", boxShadow: "inset 0 0 28px rgba(0,0,0,0.85)" }}
            />
            {/* Reticle: short edge ticks + thin cross lines */}
            <div className="absolute left-1/2 top-1/2 h-px w-[44vh] -translate-x-1/2 -translate-y-1/2 bg-black/55" />
            <div className="absolute left-1/2 top-1/2 h-[44vh] w-px -translate-x-1/2 -translate-y-1/2 bg-black/55" />
            {/* Tick marks at the four edges */}
            <div className="absolute left-1/2 top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-[20vh] bg-black/85" />
            <div className="absolute left-1/2 top-1/2 h-2.5 w-0.5 -translate-x-1/2 translate-y-[20vh] bg-black/85" />
            <div className="absolute left-1/2 top-1/2 h-0.5 w-2.5 -translate-x-[20vh] -translate-y-1/2 bg-black/85" />
            <div className="absolute left-1/2 top-1/2 h-0.5 w-2.5 translate-x-[20vh] -translate-y-1/2 bg-black/85" />
            {/* Green center dot with glow */}
            <div
              className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: "#7CFC52", boxShadow: "0 0 6px 2px rgba(124,252,82,0.7)" }}
            />
            {/* Distance readout near top-right of the lens */}
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[16vh] text-[10px] font-semibold tabular-nums text-emerald-300/80">
              59m
            </span>
            {/* Thin scope-mount shapes at the bottom */}
            <div className="absolute left-1/2 top-1/2 h-2.5 w-10 -translate-x-1/2 translate-y-[25vh] rounded-sm bg-black/70" />
            <div className="absolute left-1/2 top-1/2 h-1.5 w-6 -translate-x-1/2 translate-y-[27.5vh] rounded-sm bg-black/60" />
          </div>

          {/* thin bottom-centre vitals strip */}
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 w-[320px] -translate-x-1/2 sm:w-[380px]">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-widest text-white/70">
                HP {playerHp}/{MAX_HP}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-black/70 ring-1 ring-white/20">
                <div
                  className="h-full bg-white transition-all duration-150"
                  style={{ width: `${Math.max(0, Math.min(100, (playerHp / MAX_HP) * 100))}%` }}
                />
              </div>
              <span className="text-[9px] uppercase tracking-widest text-white/45 tabular-nums">
                {playerStatsHud.kills}K/{playerStatsHud.deaths}D
              </span>
            </div>
          </div>

          <div
            ref={crosshairRef}
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground/80 shadow-[0_0_6px_rgba(0,0,0,0.7)]"
            style={{ width: 18, height: 18, opacity: 1 }}
          />
          <div
            ref={centerDotRef}
            className="pointer-events-none absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
          />
          {hitMarker > 0 && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="relative h-8 w-8">
                <div className="absolute left-1/2 top-0 h-3 w-0.5 -translate-x-1/2 bg-primary" />
                <div className="absolute bottom-0 left-1/2 h-3 w-0.5 -translate-x-1/2 bg-primary" />
                <div className="absolute left-0 top-1/2 h-0.5 w-3 -translate-y-1/2 bg-primary" />
                <div className="absolute right-0 top-1/2 h-0.5 w-3 -translate-y-1/2 bg-primary" />
              </div>
            </div>
          )}
          {!weaponReady && (
            <div className="pointer-events-none absolute bottom-28 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-widest text-muted-foreground">
              Recharging…
            </div>
          )}
          {match.phase === "countdown" && !shopOpen && (
            <div className="pointer-events-none absolute inset-x-0 top-24 flex flex-col items-center gap-1">
              <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">
                Round {match.round} · buy phase · press B for armory
              </p>
              <p className="text-5xl font-bold tabular-nums text-foreground">{match.countdown}</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Locked inside your spawn cage
              </p>
            </div>
          )}

          {shopOpen && (
            <WeaponShop
              credits={credits}
              owned={owned}
              slots={slots}
              activeSlot={activeSlot}
              secondsLeft={match.countdown}
              totalSeconds={COUNTDOWN_SECONDS}
              onBuy={buyWeapon}
              onSelectSlot={selectSlot}
              onSellAll={sellAllWeapons}
              onClose={() => setShopOpen(false)}
            />
          )}

          {!shopOpen && (
            <div
              className="pointer-events-none absolute inset-0 z-10"
              style={{ transform: `scale(${hudScale})`, transformOrigin: "top right" }}
            >
              <WeaponSlots slots={slots} activeSlot={activeSlot} onSelect={selectSlot} ammo={ammo} />
            </div>
          )}

          {!shopOpen && !paused && !settingsOpen && (
            <TouchControls
              settings={settings}
              editing={editingLayout}
              onMoveControl={moveControl}
              scale={hudScale}
              press={(code) => keysRef.current.add(code)}
              release={(code) => keysRef.current.delete(code)}
              onShootStart={() => actionsRef.current?.triggerDown()}
              onShootEnd={() => actionsRef.current?.triggerUp()}
              onScopeToggle={() => actionsRef.current?.toggleAds()}
              scoped={scoped}
              onJump={() => actionsRef.current?.jump()}
              onProneToggle={() => setProne((v) => !v)}
              prone={prone}
              kits={kits}
              onHeal={useHealthKit}
              walls={wallCharges}
              onThrowWall={throwShieldWall}
              slots={slots}
              onDropWeapon={dropWeapon}
            />
          )}

          {!shopOpen && (() => {
            const activeId = slots[activeSlot] ?? "deagle";
            const w = getWeapon(activeId);
            const cur = ammo[activeId];
            const mag = cur?.mag ?? 0;
            const reserve = cur?.reserve ?? 0;
            const magSize = getMagazine(activeId);
            const hasAmmo = magSize > 0;
            const empty = hasAmmo && mag === 0;
            const low = hasAmmo && mag > 0 && mag <= Math.max(1, Math.ceil(magSize * 0.25));
            return (
              <div className="pointer-events-none absolute bottom-[186px] right-5 flex flex-col items-end gap-1">
                <div
                  className={`flex items-baseline gap-2 rounded-md border px-3 py-1 backdrop-blur transition-colors ${
                    empty
                      ? "border-destructive bg-destructive/15"
                      : low
                        ? "border-[var(--hud-accent)]/70 bg-[var(--hud-panel)]/90"
                        : "border-border/60 bg-[var(--hud-panel)]/90"
                  }`}
                >
                  <span
                    className={`text-xl font-bold tabular-nums ${
                      empty ? "text-destructive animate-pulse" : low ? "text-[var(--hud-accent)]" : "text-foreground"
                    }`}
                  >
                    {mag}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">/ {reserve}</span>
                </div>
                {empty && !isReloading && (
                  <div className="animate-pulse rounded-md bg-destructive px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-destructive-foreground">
                    Reload
                  </div>
                )}
                {isReloading && (
                  <div className="rounded-md bg-[var(--hud-accent)]/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[var(--hud-accent-foreground)]">
                    Reloading… {reloadLeft.toFixed(1)}s
                  </div>
                )}
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  {w?.name ?? "Deagle"}
                </p>
              </div>
            );
          })()}


          {playerRespawn > 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/50">
              <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Eliminated</p>
              <p className="text-4xl font-bold text-foreground">Respawn in {playerRespawn}</p>
            </div>
          )}
          {match.phase !== "round" && match.phase !== "countdown" && match.phase !== "warmup" && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/60">
              <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">
                {match.phase === "intermission" ? "Round over" : "Match over"}
              </p>
              {(() => {
                const winner = match.matchWinner ?? match.roundWinner;
                const won = winner === "blue";
                return won ? (
                  <div className="rounded-md border-2 border-[#ffd76a] bg-gradient-to-b from-[#ffe9a8] to-[#e2a712] px-10 py-3 shadow-[0_0_40px_-8px_rgba(255,200,80,0.9)]">
                    <p className="text-4xl font-black uppercase tracking-[0.25em] text-[#4a2c00] sm:text-5xl">
                      Booyah
                    </p>
                  </div>
                ) : (
                  <div className="rounded-md border-2 border-white/25 bg-gradient-to-b from-[#5b6068] to-[#2b2f35] px-10 py-3 shadow-[0_0_40px_-12px_rgba(0,0,0,0.9)]">
                    <p className="text-4xl font-black uppercase tracking-[0.25em] text-white/80 sm:text-5xl">
                      Defeat
                    </p>
                  </div>
                );
              })()}
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {match.blue} – {match.red}
              </p>
              <p className="text-sm uppercase tracking-widest text-muted-foreground">
                You · {playerStatsHud.kills} K / {playerStatsHud.deaths} D
              </p>
              {match.countdown > 0 && (
                <p className="text-sm uppercase tracking-widest text-muted-foreground">
                  {match.phase === "matchEnd" ? "Next match" : "Next round"} in {match.countdown}
                </p>
              )}
              <button
                onClick={enterWalk}
                className="pointer-events-auto mt-2 rounded-lg bg-[var(--hud-accent)] px-6 py-2 text-xs font-bold uppercase tracking-widest text-[var(--hud-accent-foreground)] transition hover:brightness-110"
              >
                Play again
              </button>
            </div>
          )}
        </>
      )}




      {/* killfeed */}
      {killFeed.length > 0 && (
        <div className="pointer-events-none absolute right-4 top-[152px] flex max-w-xs flex-col gap-1 sm:right-5 sm:top-[158px]">
          {killFeed.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-card/80 px-3 py-1.5 text-xs text-foreground backdrop-blur"
            >
              <Skull className="h-3 w-3 text-muted-foreground" />
              <span className={item.killerTeam === "blue" ? "text-[#3f8fff]" : "text-[#ff3b1f]"}>
                {item.killer}
              </span>
              <span className="text-muted-foreground">{item.weapon}</span>
              <span className={item.victimTeam === "blue" ? "text-[#3f8fff]" : "text-[#ff3b1f]"}>
                {item.victim}
              </span>
            </div>
          ))}
        </div>
      )}

      {(leaderboard || orbitLeaderboard) && (
        <div className="pointer-events-none absolute left-3 top-[130px] max-w-xs rounded-lg border border-border/60 bg-card/80 p-3 backdrop-blur sm:left-4 sm:top-[136px]">
          <p className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground">Leaderboard</p>
          <div className="mt-2 space-y-1 text-xs">
            {Object.entries((leaderboard ?? orbitLeaderboard)!.totals).map(([team, t]) => (
              <div key={team} className="flex justify-between gap-4">
                <span className={team === "blue" ? "text-[#3f8fff]" : "text-[#ff3b1f]"}>
                  {team === "blue" ? "Blue" : "Red"}
                </span>
                <span className="tabular-nums text-foreground">
                  {t.wins}W {t.losses}L · {t.kills}K {t.deaths}D
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* scoreboard */}
      {hud.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 sm:top-3">
          <div className="flex items-stretch overflow-hidden rounded-[3px] shadow-[0_0_18px_-6px_rgba(0,0,0,0.95)]">
            <div
              className="flex min-w-12 items-center justify-center bg-gradient-to-b from-[#2f7dfd] to-[#1147a8] px-3 py-0.5 text-base font-extrabold tabular-nums text-white"
              style={{ clipPath: "polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%)" }}
            >
              {score.blue}
            </div>
            <div className="flex flex-col items-center justify-center bg-black/80 px-4 py-0.5 text-center backdrop-blur">
              <span className="text-[11px] font-bold tabular-nums leading-tight text-[#ffd45e]">
                {String(Math.floor(match.countdown / 60)).padStart(2, "0")}:
                {String(match.countdown % 60).padStart(2, "0")}
              </span>
              <span className="text-[7px] uppercase tracking-[0.25em] text-white/55">
                R{match.round} · {hud.filter((f) => f.team === "blue" && f.alive).length}v
                {hud.filter((f) => f.team === "red" && f.alive).length}
              </span>
            </div>
            <div
              className="flex min-w-12 items-center justify-center bg-gradient-to-b from-[#ff8a3d] to-[#c93a10] px-3 py-0.5 text-base font-extrabold tabular-nums text-white"
              style={{ clipPath: "polygon(8px 0, 100% 0, 100% 100%, 0 100%)" }}
            >
              {score.red}
            </div>
          </div>

          {/* objective / progress ribbon under the score, as in the reference HUD */}
          <div className="relative mx-auto mt-1.5 h-4 w-[280px] overflow-hidden rounded-[2px] border border-[#e0b64a]/60 bg-black/70 sm:w-[340px]">
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#8c6a12] via-[#e9c34f] to-[#8c6a12] transition-all duration-300"
              style={{ width: `${Math.min(100, (score.blue / matchConfig.roundsToWinMatch) * 100)}%` }}
            />
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold uppercase tracking-[0.3em] text-white/90 drop-shadow">
              Victory
            </span>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute left-3 top-1/2 z-20 -translate-y-1/2">
        <div className="pointer-events-auto flex flex-col items-start gap-2">
          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                const next = !settings.muted;
                setSettings((prev) => ({ ...prev, muted: next }));
                setMuted(next);
              }}
              className="rounded-lg border border-border bg-card/70 p-2 text-muted-foreground backdrop-blur transition-colors hover:bg-secondary"
              aria-label={muted ? "Unmute audio" : "Mute audio"}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <button
              onClick={() => {
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen?.().catch(() => {});
                } else {
                  document.exitFullscreen?.().catch(() => {});
                }
              }}
              className="rounded-lg border border-border bg-card/70 p-2 text-muted-foreground backdrop-blur transition-colors hover:bg-secondary"
              aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
          {showDebug && (
            <div className="flex flex-col items-stretch gap-2 rounded-lg border border-border/60 bg-card/85 p-3 backdrop-blur">

              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Debug</p>
              <button
                onClick={() => setShowRoof((v) => !v)}
                className="rounded-md border border-border bg-card/80 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-foreground transition-colors hover:bg-secondary"
              >
                {showRoof ? "Hide roof" : "Show roof"}
              </button>
              <button
                onClick={() => setMode((m) => (m === "orbit" ? "walk" : "orbit"))}
                className="rounded-md border border-border bg-card/80 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-foreground transition-colors hover:bg-secondary"
              >
                {mode === "orbit" ? "Ground view" : "Orbit view"}
              </button>
              <button
                onClick={enterWalk}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Restart match
              </button>
            </div>
          )}
          <button
            onClick={() => setShowDebug((v) => !v)}
            className="rounded-lg border border-border bg-card/70 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground backdrop-blur transition-colors hover:bg-secondary"
          >
            {showDebug ? "Close debug" : "Debug (`)"}
          </button>
        </div>
      </div>
    </div>
  );
}
