/** Shared Fullscreen API helpers (vendor-prefixed + Promise-normalized). */

/** Fired when fullscreen or in-app fullscreen overlays change so listeners can re-check {@link isAppTrueFullscreenActive}. */
export const PST_TRUE_FULLSCREEN_CONTEXT_EVENT = "pst:true-fullscreen-context";

/**
 * True full-screen UX: native element fullscreen, Badges expanded viewport, or Productivity chart fullscreen overlay.
 * Used to suppress toasts (they sit outside the fullscreen subtree or are visually wrong).
 */
export function isAppTrueFullscreenActive(): boolean {
  if (typeof document === "undefined") return false;
  if (getBrowserFullscreenElement()) return true;
  /* Badges expanded layer + Productivity chart layer both use `.pa-fs-overlay` portaled to `body`. */
  if (document.querySelector(".pa-fs-overlay")) return true;
  return false;
}

export function getBrowserFullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  const d = document as Document & {
    webkitFullscreenElement?: Element | null;
    mozFullScreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };
  return (
    document.fullscreenElement ??
    d.webkitFullscreenElement ??
    d.mozFullScreenElement ??
    d.msFullscreenElement ??
    null
  );
}

type FullscreenHost = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>;
  webkitRequestFullScreen?: () => void | Promise<void>;
  mozRequestFullScreen?: () => void | Promise<void>;
  msRequestFullscreen?: () => void | Promise<void>;
};

async function callMaybePromise(fn: () => void | Promise<void>): Promise<void> {
  await Promise.resolve(fn());
}

/**
 * iOS / iPadOS: arbitrary `<div>` fullscreen is unsupported or unreliable; PWA / WebKit use different rules.
 * Prefer CSS “viewport fill” there. Includes iPadOS desktop UA (`MacIntel` + touch).
 */
export function prefersCssOnlyElementFullscreen(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPod/i.test(ua)) return true;
  if (/iPad/i.test(ua)) return true;
  const nav = navigator as Navigator & { maxTouchPoints?: number; userAgentData?: { platform?: string } };
  if (nav.userAgentData?.platform === "iOS") return true;
  if (navigator.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1) return true;
  return false;
}

function hostIsFullscreen(host: Element): boolean {
  return getBrowserFullscreenElement() === host;
}

/**
 * Enter native element fullscreen. Order is tuned for real engines:
 * - Plain `requestFullscreen()` first (Safari / older Chromium reject unknown `FullscreenOptions` or handle it poorly).
 * - Then `navigationUI: "hide"` where supported (e.g. Chrome).
 * - Then vendor-prefixed methods.
 *
 * After each attempt, checks {@link getBrowserFullscreenElement} so silent failures still try the next path.
 */
export async function requestHTMLElementFullscreen(host: HTMLElement): Promise<boolean> {
  const e = host as FullscreenHost;

  const tryChain = async (attempt: () => void | Promise<void>): Promise<boolean> => {
    try {
      await callMaybePromise(attempt);
    } catch {
      return false;
    }
    if (hostIsFullscreen(host)) return true;
    /* Some WebKit builds resolve late — one extra frame before giving up on this path */
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return hostIsFullscreen(host);
  };

  if (typeof host.requestFullscreen === "function") {
    if (await tryChain(() => host.requestFullscreen())) return true;
    try {
      if (
        await tryChain(() =>
          host.requestFullscreen({ navigationUI: "hide" } as FullscreenOptions)
        )
      ) {
        return true;
      }
    } catch {
      /* options unsupported */
    }
  }

  const legacy: Array<(() => void | Promise<void>) | undefined> = [
    e.webkitRequestFullscreen?.bind(e),
    e.webkitRequestFullScreen?.bind(e),
    e.mozRequestFullScreen?.bind(e),
    e.msRequestFullscreen?.bind(e)
  ];

  for (const fn of legacy) {
    if (typeof fn !== "function") continue;
    if (await tryChain(fn)) return true;
  }

  return false;
}

export async function exitBrowserFullscreenAll(): Promise<void> {
  if (typeof document === "undefined") return;
  const d = document as Document & {
    webkitExitFullscreen?: () => void | Promise<void>;
    mozCancelFullScreen?: () => void | Promise<void>;
    msExitFullscreen?: () => void | Promise<void>;
  };

  for (let i = 0; i < 4 && getBrowserFullscreenElement(); i++) {
    try {
      if (typeof document.exitFullscreen === "function") {
        await Promise.resolve(document.exitFullscreen());
        continue;
      }
    } catch {
      /* try next */
    }
    try {
      if (typeof d.webkitExitFullscreen === "function") {
        await Promise.resolve(d.webkitExitFullscreen());
        continue;
      }
    } catch {
      /* try next */
    }
    try {
      if (typeof d.mozCancelFullScreen === "function") {
        await Promise.resolve(d.mozCancelFullScreen());
        continue;
      }
    } catch {
      /* try next */
    }
    try {
      if (typeof d.msExitFullscreen === "function") {
        await Promise.resolve(d.msExitFullscreen());
      }
    } catch {
      break;
    }
  }
}
