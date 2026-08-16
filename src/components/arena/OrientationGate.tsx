import { useCallback, useEffect, useState, type ReactNode } from "react";

function isTouchDevice() {
  if (typeof window === "undefined") return false;
  return (
    "ontouchstart" in window ||
    (navigator.maxTouchPoints ?? 0) > 0 ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

function isLandscape() {
  if (typeof window === "undefined") return true;
  return window.innerWidth > window.innerHeight;
}

/**
 * Gates the game behind a "rotate your phone + go fullscreen" screen on touch devices.
 * The children (game) are never mounted until the device is landscape and fullscreen.
 */
export default function OrientationGate({ children }: { children: ReactNode }) {
  const [touch, setTouch] = useState(false);
  const [landscape, setLandscape] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTouch(isTouchDevice());
    setLandscape(isLandscape());
    setFullscreen(Boolean(document.fullscreenElement));
    setReady(true);

    const onResize = () => setLandscape(isLandscape());
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  const enter = useCallback(async () => {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    try {
      if (!document.fullscreenElement) {
        if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      }
    } catch {
      /* ignore — user can still play if fullscreen is refused */
    }
    const orientation = screen.orientation as (ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    }) | undefined;
    try {
      await orientation?.lock?.("landscape");
    } catch {
      /* not supported — the rotate prompt handles it */
    }
    setFullscreen(Boolean(document.fullscreenElement) || true);
    setLandscape(isLandscape());
  }, []);

  if (!ready) return null;

  // Desktop / non-touch: play as-is.
  if (!touch) return <>{children}</>;

  if (!landscape) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-background px-8 text-center">
        <div className="animate-[spin_3s_ease-in-out_infinite] text-5xl">📱</div>
        <h1 className="text-lg font-bold uppercase tracking-[0.25em] text-foreground">
          Rotate your phone
        </h1>
        <p className="max-w-xs text-sm text-muted-foreground">
          Lone Wolf Arena only plays in landscape. Turn your device sideways to continue.
        </p>
      </div>
    );
  }

  if (!fullscreen) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-background px-8 text-center">
        <h1 className="text-lg font-bold uppercase tracking-[0.25em] text-foreground">
          Lone Wolf Arena
        </h1>
        <p className="max-w-xs text-sm text-muted-foreground">
          Tap below to enter fullscreen and lock landscape.
        </p>
        <button
          onClick={enter}
          className="rounded-md bg-primary px-8 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary-foreground"
        >
          Enter Arena
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
