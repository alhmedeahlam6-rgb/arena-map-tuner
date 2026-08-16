import { useRef, useState, type ReactNode } from "react";
import { X, Move } from "lucide-react";
import { getWeapon } from "./weapons";
import type { ArenaSettings, ControlId } from "./settings";
import { CONTROL_LABELS } from "./settings";
import fistIcon from "@/assets/hud/fist.png";
import crouchIcon from "@/assets/hud/crouch.png";
import proneIcon from "@/assets/hud/prone.png";
import standIcon from "@/assets/hud/stand.png";
import scopeIcon from "@/assets/hud/scope.png";
import medkitIcon from "@/assets/hud/medkit.png";
import wallIcon from "@/assets/hud/wall.png";
import backpackIcon from "@/assets/hud/backpack.png";
import sprintIcon from "@/assets/hud/sprint.png";

type Props = {
  press: (code: string) => void;
  release: (code: string) => void;
  onShootStart: () => void;
  onShootEnd: () => void;
  onScopeToggle: () => void;
  scoped: boolean;
  onJump: () => void;
  onProneToggle: () => void;
  prone: boolean;
  kits: number;
  onHeal: () => void;
  walls: number;
  onThrowWall: () => void;
  slots: (string | null)[];
  onDropWeapon: (index: number) => void;
  /** shrink factor for small / short screens */
  scale?: number;
  settings: ArenaSettings;
  /** layout edit mode: controls become draggable instead of playable */
  editing?: boolean;
  onMoveControl?: ((id: ControlId, dx: number, dy: number) => void) | undefined;
};

/** shared round glass button, matching the reference HUD's dark translucent discs */
const disc =
  "pointer-events-auto flex items-center justify-center rounded-full border border-white/25 bg-black/45 backdrop-blur-sm transition active:scale-95 active:bg-white/25 select-none";

const glyph = "object-contain [filter:invert(1)] opacity-90";

const MOVE_KEYS = ["KeyW", "KeyS", "KeyA", "KeyD"] as const;

type ControlProps = {
  id: ControlId;
  anchor: string;
  origin: string;
  centerX?: boolean;
  settings: ArenaSettings;
  scale: number;
  editing: boolean;
  onMoveControl?: ((id: ControlId, dx: number, dy: number) => void) | undefined;
  children: ReactNode;
};

/** A positioned, resizable, hideable, draggable HUD control. */
function ControlWrap({
  id,
  anchor,
  origin,
  centerX = false,
  settings,
  scale,
  editing,
  onMoveControl,
  children,
}: ControlProps) {
  const dragStart = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const cfg = settings.controls[id];
  if (cfg.hidden && !editing) return null;

  const total = scale * cfg.scale;
  const transform = `translate(${centerX ? "-50%" : "0px"}, 0px) translate(${cfg.dx}px, ${cfg.dy}px) scale(${total})`;

  const editHandlers = editing
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          e.preventDefault();
          e.stopPropagation();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          dragStart.current = { x: e.clientX, y: e.clientY, dx: cfg.dx, dy: cfg.dy };
        },
        onPointerMove: (e: React.PointerEvent) => {
          const s = dragStart.current;
          if (!s) return;
          e.preventDefault();
          onMoveControl?.(id, s.dx + (e.clientX - s.x) / total, s.dy + (e.clientY - s.y) / total);
        },
        onPointerUp: () => {
          dragStart.current = null;
        },
        onPointerCancel: () => {
          dragStart.current = null;
        },
      }
    : {};

  return (
    <div
      {...editHandlers}
      className={`absolute ${anchor} ${editing ? "pointer-events-auto cursor-move touch-none" : ""}`}
      style={{
        transform,
        transformOrigin: origin,
        opacity: cfg.hidden ? 0.25 : settings.hudOpacity,
      }}
    >
      <div
        className={
          editing
            ? "pointer-events-none relative rounded-xl outline-dashed outline-2 outline-offset-4 outline-[var(--hud-accent)]/70"
            : "relative"
        }
      >
        {children}
        {editing && (
          <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white">
            {CONTROL_LABELS[id]}
          </span>
        )}
      </div>
    </div>
  );
}

export default function TouchControls({
  press,
  release,
  onShootStart,
  onShootEnd,
  onScopeToggle,
  scoped,
  onJump,
  onProneToggle,
  prone,
  kits,
  onHeal,
  walls,
  onThrowWall,
  slots,
  onDropWeapon,
  scale = 1,
  settings,
  editing = false,
  onMoveControl,
}: Props) {
  const [bagOpen, setBagOpen] = useState(false);
  const [sprinting, setSprinting] = useState(false);

  // Floating joystick state
  const padRef = useRef<HTMLDivElement>(null);
  const padId = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [baseOffset, setBaseOffset] = useState({ x: 0, y: 0 });
  const baseRef = useRef({ x: 0, y: 0 });
  const stickRadius = 72; // px, visual + logical max
  const deadZone = 0.06;
  // the pad lives inside a CSS-scaled wrapper, so screen pixels must be
  // converted to local pixels or the knob drifts away from the thumb
  const stickScale = scale * (settings.controls.stick?.scale ?? 1) || 1;

  const cw = { settings, scale, editing, onMoveControl };

  const clearMove = () => {
    MOVE_KEYS.forEach((k) => release(k));
    release("ShiftLeft");
    setSprinting(false);
  };

  const applyStick = (dx: number, dy: number) => {
    const dist = Math.hypot(dx, dy);
    const max = stickRadius;
    const clamped = dist > max ? max / dist : 1;
    const nx = dx * clamped;
    const ny = dy * clamped;
    setKnob({ x: nx, y: ny });

    MOVE_KEYS.forEach((k) => release(k));

    if (dist < stickRadius * deadZone) {
      release("ShiftLeft");
      setSprinting(false);
      return;
    }

    // angle-based so diagonals feel even instead of favouring the axes
    const ang = Math.atan2(-ny, nx); // 0 = right, PI/2 = forward
    const deg = (ang * 180) / Math.PI;
    if (deg > 22.5 && deg < 157.5) press("KeyW");
    if (deg < -22.5 && deg > -157.5) press("KeyS");
    if (deg > 112.5 || deg < -112.5) press("KeyA");
    if (deg > -67.5 && deg < 67.5) press("KeyD");
    const run = dist > stickRadius * 0.82;
    setSprinting(run);
    if (run) press("ShiftLeft");
    else release("ShiftLeft");
  };

  /** finger offset from the floating base, in local (unscaled) pixels */
  const stickFromEvent = (e: React.PointerEvent, base = baseOffset) => {
    const el = padRef.current;
    if (!el) return { dx: 0, dy: 0 };
    const r = el.getBoundingClientRect();
    return {
      dx: (e.clientX - (r.left + r.width / 2)) / stickScale - base.x,
      dy: (e.clientY - (r.top + r.height / 2)) / stickScale - base.y,
    };
  };

  const padHandlers = editing
    ? {}
    : {
        onPointerDown: (e: React.PointerEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (!padRef.current) return;
          padId.current = e.pointerId;
          try {
            padRef.current.setPointerCapture(e.pointerId);
          } catch {
            /* capture is best-effort */
          }
          const { dx, dy } = stickFromEvent(e, { x: 0, y: 0 });
          // Float the base under the thumb (clamped inside the pad) and start
          // perfectly centred — no movement until the finger actually drags.
          const floatClamp = stickRadius * 0.55;
          const dist = Math.hypot(dx, dy);
          const ratio = dist > floatClamp ? floatClamp / dist : 1;
          const base = { x: dx * ratio, y: dy * ratio };
          baseRef.current = base;
          setBaseOffset(base);
          setActive(true);
          applyStick(dx - base.x, dy - base.y);
        },
        onPointerMove: (e: React.PointerEvent) => {
          if (padId.current !== e.pointerId || !padRef.current) return;
          e.preventDefault();
          const { dx, dy } = stickFromEvent(e, baseRef.current);
          applyStick(dx, dy);
        },
        onPointerUp: (e: React.PointerEvent) => {
          if (padId.current !== e.pointerId) return;
          resetStick();
        },
        onPointerCancel: (e: React.PointerEvent) => {
          if (padId.current !== e.pointerId) return;
          resetStick();
        },
        onLostPointerCapture: (e: React.PointerEvent) => {
          if (padId.current !== e.pointerId) return;
          resetStick();
        },
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      };

  const tap = (fn: () => void) =>
    editing
      ? {}
      : {
          onPointerDown: (e: React.PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            fn();
          },
          onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        };

  if (!settings.showTouchControls && !editing) return null;

  return (
    <div
      className={`absolute inset-0 z-30 touch-none select-none ${editing ? "pointer-events-auto" : "pointer-events-none"}`}
    >
      {/* ---- sprint / posture indicator, left of the stick ---- */}
      <ControlWrap {...cw} id="sprint" anchor="bottom-[228px] left-8" origin="bottom left">
        <img
          src={sprintIcon}
          alt="Sprinting"
          width={512}
          height={512}
          loading="lazy"
          className={`h-12 w-12 object-contain transition-opacity ${sprinting ? "opacity-100" : "opacity-30"}`}
        />
      </ControlWrap>

      {/* ---- left: floating analog movement stick ---- */}
      <ControlWrap {...cw} id="stick" anchor="bottom-6 left-6" origin="bottom left">
        <div
          ref={padRef}
          {...padHandlers}
          className={`${editing ? "" : "pointer-events-auto"} relative h-[190px] w-[190px] rounded-full`}
        >
          {/* large invisible catch area so thumbs land easily */}
          <div className="absolute inset-0 rounded-full" />
          {/* base ring */}
          <div
            className="absolute left-1/2 top-1/2 h-[150px] w-[150px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/20 bg-black/30 shadow-[0_0_28px_-8px_rgba(0,0,0,0.9)] backdrop-blur-sm transition-all duration-75"
            style={{
              transform: `translate(calc(-50% + ${baseOffset.x}px), calc(-50% + ${baseOffset.y}px))`,
              opacity: active ? 1 : 0.55,
              borderColor: active ? "rgba(255,77,61,0.55)" : "rgba(255,255,255,0.2)",
              boxShadow: active
                ? "0 0 32px -6px rgba(255,77,61,0.45), inset 0 0 24px rgba(0,0,0,0.4)"
                : "0 0 28px -8px rgba(0,0,0,0.9)",
            }}
          >
            {/* inner directional hints */}
            <span className="absolute left-1/2 top-2 -translate-x-1/2 text-[11px] leading-none text-white/40">
              ▲
            </span>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] leading-none text-white/40">
              ▼
            </span>
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] leading-none text-white/40">
              ◀
            </span>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] leading-none text-white/40">
              ▶
            </span>
          </div>
          {/* knob */}
          <div
            className="absolute left-1/2 top-1/2 h-[68px] w-[68px] rounded-full border border-white/30 bg-gradient-to-b from-white/25 to-white/10 shadow-[0_0_22px_-4px_rgba(0,0,0,0.9)] backdrop-blur transition-all duration-75"
            style={{
              transform: `translate(calc(-50% + ${baseOffset.x + knob.x}px), calc(-50% + ${baseOffset.y + knob.y}px))`,
              background: active
                ? "linear-gradient(180deg, rgba(255,77,61,0.35), rgba(255,77,61,0.12))"
                : "linear-gradient(180deg, rgba(255,255,255,0.25), rgba(255,255,255,0.1))",
              boxShadow: active
                ? "0 0 24px -2px rgba(255,77,61,0.5), inset 0 0 10px rgba(255,255,255,0.15)"
                : "0 0 22px -4px rgba(0,0,0,0.9)",
            }}
          />
        </div>
      </ControlWrap>

      {/* ---- bottom-left utility: backpack + gloo wall ---- */}
      <ControlWrap {...cw} id="backpack" anchor="bottom-8 left-[210px]" origin="bottom left">
        <button
          aria-label="Open backpack"
          className={`${disc} h-12 w-12`}
          {...tap(() => setBagOpen((v) => !v))}
        >
          <img
            src={backpackIcon}
            alt=""
            width={512}
            height={512}
            loading="lazy"
            className={`h-6 w-6 ${glyph}`}
          />
        </button>
      </ControlWrap>

      <ControlWrap {...cw} id="wall" anchor="bottom-8 left-[270px]" origin="bottom left">
        <button
          aria-label="Throw shield wall"
          disabled={walls <= 0 && !editing}
          className={`${disc} relative h-14 w-14 ${walls > 0 ? "border-sky-300/60" : "opacity-35"}`}
          {...tap(() => walls > 0 && onThrowWall())}
        >
          <img
            src={wallIcon}
            alt=""
            width={512}
            height={512}
            loading="lazy"
            className={`h-7 w-7 ${glyph}`}
          />
          <span className="absolute -bottom-1 -right-1 rounded-full bg-black/85 px-1.5 text-[10px] font-bold tabular-nums text-white">
            {walls}
          </span>
        </button>
      </ControlWrap>

      {/* ---- consumables strip, centered above the HP bar ---- */}
      <ControlWrap
        {...cw}
        id="medkits"
        anchor="bottom-[54px] left-1/2"
        origin="bottom center"
        centerX
      >
        <div className="flex items-center gap-2">
          {Array.from({ length: 3 }).map((_, i) => {
            const filled = i < kits;
            return (
              <button
                key={i}
                aria-label="Use medkit"
                disabled={!filled && !editing}
                className={`${disc} h-9 w-9 ${filled ? "border-emerald-300/60" : "opacity-30"}`}
                {...tap(() => filled && onHeal())}
              >
                <img
                  src={medkitIcon}
                  alt=""
                  width={512}
                  height={512}
                  loading="lazy"
                  className={`h-4 w-4 ${glyph}`}
                />
              </button>
            );
          })}
        </div>
      </ControlWrap>

      {/* ---- right: scope + fire ---- */}
      <ControlWrap {...cw} id="scope" anchor="bottom-[122px] right-[110px]" origin="bottom right">
        <button
          aria-label="Toggle scope"
          className={`${disc} h-12 w-12 ${scoped ? "border-[var(--hud-accent)] bg-[var(--hud-accent)]/35" : ""}`}
          {...tap(onScopeToggle)}
        >
          <img
            src={scopeIcon}
            alt=""
            width={512}
            height={512}
            loading="lazy"
            className={`h-6 w-6 ${glyph}`}
          />
        </button>
      </ControlWrap>

      <ControlWrap {...cw} id="fire" anchor="bottom-6 right-[92px]" origin="bottom right">
        <button
          aria-label="Fire"
          className={`${disc} h-[88px] w-[88px] border-white/35 bg-white/10`}
          onPointerDown={
            editing
              ? undefined
              : (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  onShootStart();
                }
          }
          onPointerUp={
            editing
              ? undefined
              : (e) => {
                  e.preventDefault();
                  onShootEnd();
                }
          }
          onPointerCancel={editing ? undefined : onShootEnd}
          onLostPointerCapture={editing ? undefined : onShootEnd}
          onContextMenu={(e) => e.preventDefault()}
        >
          <img
            src={fistIcon}
            alt=""
            width={512}
            height={512}
            loading="lazy"
            className={`h-11 w-11 ${glyph}`}
          />
        </button>
      </ControlWrap>

      {/* right edge posture stack: jump / crouch / prone */}
      <ControlWrap {...cw} id="jump" anchor="bottom-[130px] right-6" origin="bottom right">
        <button aria-label="Jump" className={`${disc} h-12 w-12`} {...tap(onJump)}>
          <img
            src={standIcon}
            alt=""
            width={512}
            height={512}
            loading="lazy"
            className={`h-7 w-7 ${glyph}`}
          />
        </button>
      </ControlWrap>

      <ControlWrap {...cw} id="crouch" anchor="bottom-[76px] right-6" origin="bottom right">
        <button
          aria-label="Crouch"
          className={`${disc} h-12 w-12`}
          {...tap(() => {
            press("KeyC");
            setTimeout(() => release("KeyC"), 80);
          })}
        >
          <img
            src={crouchIcon}
            alt=""
            width={512}
            height={512}
            loading="lazy"
            className={`h-7 w-7 ${glyph}`}
          />
        </button>
      </ControlWrap>

      <ControlWrap {...cw} id="prone" anchor="bottom-6 right-6" origin="bottom right">
        <button
          aria-label="Toggle prone"
          className={`${disc} h-12 w-12 ${prone ? "border-[var(--hud-accent)] bg-[var(--hud-accent)]/35" : ""}`}
          {...tap(onProneToggle)}
        >
          <img
            src={proneIcon}
            alt=""
            width={512}
            height={512}
            loading="lazy"
            className={`h-7 w-7 ${glyph}`}
          />
        </button>
      </ControlWrap>

      {editing && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded-full border border-[var(--hud-accent)]/60 bg-black/80 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.25em] text-white">
          <Move className="mr-2 inline h-3 w-3" />
          Drag any control to reposition
        </div>
      )}

      {/* ---- backpack panel ---- */}
      {bagOpen && !editing && (
        <div className="pointer-events-auto absolute left-1/2 top-1/2 w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border/60 bg-card/95 p-4 backdrop-blur">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground">
              Backpack
            </p>
            <button
              aria-label="Close backpack"
              onClick={() => setBagOpen(false)}
              className="text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 space-y-1.5">
            {slots.map((id, i) => {
              const w = getWeapon(id);
              if (!w) return null;
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md border border-border/50 px-2 py-1.5"
                >
                  <img
                    src={w.image}
                    alt={w.name}
                    width={512}
                    height={512}
                    className="h-7 w-11 object-contain"
                    loading="lazy"
                  />
                  <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                    {w.name}
                  </span>
                  {w.id !== "fists" && (
                    <button
                      onClick={() => onDropWeapon(i)}
                      className="rounded bg-destructive/80 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-destructive-foreground"
                    >
                      Drop
                    </button>
                  )}
                </div>
              );
            })}
            <div className="flex items-center gap-2 rounded-md border border-border/50 px-2 py-1.5 text-[11px] text-foreground">
              <img
                src={medkitIcon}
                alt=""
                width={512}
                height={512}
                loading="lazy"
                className={`h-4 w-4 ${glyph}`}
              />
              <span className="flex-1 uppercase tracking-wide">Medkits</span>
              <span className="tabular-nums">{kits}</span>
              <button
                onClick={onHeal}
                disabled={kits <= 0}
                className="rounded bg-[var(--hud-accent)] px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-[var(--hud-accent-foreground)] disabled:opacity-40"
              >
                Use
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border/50 px-2 py-1.5 text-[11px] text-foreground">
              <img
                src={wallIcon}
                alt=""
                width={512}
                height={512}
                loading="lazy"
                className={`h-4 w-4 ${glyph}`}
              />
              <span className="flex-1 uppercase tracking-wide">Shield walls</span>
              <span className="tabular-nums">{walls}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
