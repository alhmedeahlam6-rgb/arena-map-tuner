import { Eye, EyeOff, Move, RotateCcw, Volume2, VolumeX, X } from "lucide-react";
import {
  CONTROL_IDS,
  CONTROL_LABELS,
  QUALITY_LABELS,
  defaultSettings,
  type ArenaSettings,
  type ControlId,
  type Quality,
} from "./settings";

type Props = {
  settings: ArenaSettings;
  onChange: (next: ArenaSettings) => void;
  editing: boolean;
  onToggleEditing: () => void;
  onClose: () => void;
};

function Row({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {label}
        <span className="tabular-nums text-[var(--hud-accent)]">{value}</span>
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const slider =
  "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-[var(--hud-accent)]";

export default function SettingsPanel({ settings, onChange, editing, onToggleEditing, onClose }: Props) {
  const set = <K extends keyof ArenaSettings>(key: K, value: ArenaSettings[K]) =>
    onChange({ ...settings, [key]: value });

  const setControl = (id: ControlId, patch: Partial<ArenaSettings["controls"][ControlId]>) =>
    onChange({ ...settings, controls: { ...settings.controls, [id]: { ...settings.controls[id], ...patch } } });

  return (
    <div className="pointer-events-auto absolute inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-background/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card/95 p-5 shadow-[var(--shadow-hud)]">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.35em] text-foreground">Settings</h2>
          <button aria-label="Close settings" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ---- aim ---- */}
        <section className="mt-5 space-y-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.35em] text-[var(--hud-accent)]">Aim</p>
          <Row label="Mouse sensitivity" value={(settings.mouseSensitivity * 1000).toFixed(1)}>
            <input
              type="range"
              min={0.4}
              max={8}
              step={0.1}
              value={settings.mouseSensitivity * 1000}
              onChange={(e) => set("mouseSensitivity", Number(e.target.value) / 1000)}
              className={slider}
            />
          </Row>
          <Row label="Touch sensitivity" value={(settings.touchSensitivity * 1000).toFixed(1)}>
            <input
              type="range"
              min={1.5}
              max={20}
              step={0.5}
              value={settings.touchSensitivity * 1000}
              onChange={(e) => set("touchSensitivity", Number(e.target.value) / 1000)}
              className={slider}
            />
          </Row>
          <Row label="Scoped sensitivity" value={`${Math.round(settings.adsMultiplier * 100)}%`}>
            <input
              type="range"
              min={20}
              max={120}
              step={5}
              value={settings.adsMultiplier * 100}
              onChange={(e) => set("adsMultiplier", Number(e.target.value) / 100)}
              className={slider}
            />
          </Row>
          <button
            onClick={() => set("invertY", !settings.invertY)}
            className={`w-full rounded-lg border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition ${
              settings.invertY
                ? "border-[var(--hud-accent)] bg-[var(--hud-accent)]/20 text-foreground"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            Invert vertical look {settings.invertY ? "on" : "off"}
          </button>
        </section>

        {/* ---- audio ---- */}
        <section className="mt-6 space-y-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.35em] text-[var(--hud-accent)]">Audio</p>
          <Row label="Master volume" value={`${Math.round(settings.masterVolume * 100)}%`}>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={settings.masterVolume * 100}
              onChange={(e) => set("masterVolume", Number(e.target.value) / 100)}
              className={slider}
            />
          </Row>
          <button
            onClick={() => set("muted", !settings.muted)}
            className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition ${
              settings.muted
                ? "border-destructive bg-destructive/20 text-foreground"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            {settings.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            {settings.muted ? "Muted" : "Sound on"}
          </button>
        </section>

        {/* ---- performance ---- */}
        <section className="mt-6 space-y-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.35em] text-[var(--hud-accent)]">Performance</p>
          <div className="grid grid-cols-3 gap-2">
            {(["low", "medium", "high"] as Quality[]).map((q) => (
              <button
                key={q}
                onClick={() => set("quality", q)}
                className={`rounded-lg border px-2 py-2 text-[10px] font-bold uppercase tracking-[0.1em] transition ${
                  settings.quality === q
                    ? "border-[var(--hud-accent)] bg-[var(--hud-accent)]/20 text-foreground"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                {QUALITY_LABELS[q]}
              </button>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Quality changes apply after reloading the page. Low disables shadows and antialiasing for smoother
            performance on phones and older laptops.
          </p>
        </section>

        {/* ---- combat ---- */}
        <section className="mt-6 space-y-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.35em] text-[var(--hud-accent)]">Combat</p>
          <button
            onClick={() => set("autoFire", !settings.autoFire)}
            className={`w-full rounded-lg border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition ${
              settings.autoFire
                ? "border-[var(--hud-accent)] bg-[var(--hud-accent)]/20 text-foreground"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            Auto-fire {settings.autoFire ? "on" : "off"}
          </button>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            When on, holding the fire button keeps firing. Best for touchscreens and casual play.
          </p>
        </section>

        {/* ---- controls ---- */}
        <section className="mt-6 space-y-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.35em] text-[var(--hud-accent)]">On-screen controls</p>
          <Row label="HUD opacity" value={`${Math.round(settings.hudOpacity * 100)}%`}>
            <input
              type="range"
              min={30}
              max={100}
              step={5}
              value={settings.hudOpacity * 100}
              onChange={(e) => set("hudOpacity", Number(e.target.value) / 100)}
              className={slider}
            />
          </Row>
          <div className="flex gap-2">
            <button
              onClick={() => set("showTouchControls", !settings.showTouchControls)}
              className={`flex-1 rounded-lg border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition ${
                settings.showTouchControls
                  ? "border-border bg-card text-muted-foreground"
                  : "border-destructive bg-destructive/20 text-foreground"
              }`}
            >
              {settings.showTouchControls ? "Controls visible" : "Controls hidden"}
            </button>
            <button
              onClick={onToggleEditing}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition ${
                editing
                  ? "border-[var(--hud-accent)] bg-[var(--hud-accent)]/25 text-foreground"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              <Move className="h-3.5 w-3.5" />
              {editing ? "Done moving" : "Move buttons"}
            </button>
          </div>

          <div className="space-y-1.5">
            {CONTROL_IDS.map((id) => {
              const c = settings.controls[id];
              return (
                <div key={id} className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-foreground">
                      {CONTROL_LABELS[id]}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {Math.round(c.scale * 100)}%
                      </span>
                      <button
                        aria-label={c.hidden ? `Show ${CONTROL_LABELS[id]}` : `Hide ${CONTROL_LABELS[id]}`}
                        onClick={() => setControl(id, { hidden: !c.hidden })}
                        className={c.hidden ? "text-destructive" : "text-[var(--hud-accent)]"}
                      >
                        {c.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        aria-label={`Reset ${CONTROL_LABELS[id]} position`}
                        onClick={() => setControl(id, { dx: 0, dy: 0, scale: 1 })}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <input
                    aria-label={`${CONTROL_LABELS[id]} size`}
                    type="range"
                    min={60}
                    max={180}
                    step={5}
                    value={c.scale * 100}
                    onChange={(e) => setControl(id, { scale: Number(e.target.value) / 100 })}
                    className={`${slider} mt-2`}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <div className="mt-6 flex gap-2">
          <button
            onClick={() => onChange(defaultSettings())}
            className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground transition hover:bg-secondary"
          >
            Reset all
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-lg bg-[var(--hud-accent)] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--hud-accent-foreground)] transition hover:brightness-110"
          >
            Back to match
          </button>
        </div>
      </div>
    </div>
  );
}
