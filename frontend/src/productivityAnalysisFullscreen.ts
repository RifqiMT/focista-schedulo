/**
 * Productivity Analysis chart overlay fullscreen only.
 * Isolated from Badges; uses `fullscreenApi` for element fullscreen on `.pa-fs-overlay`.
 */

const PA_FULLSCREEN_EVENTS = [
  "fullscreenchange",
  "webkitfullscreenchange",
  "mozfullscreenchange",
  "MSFullscreenChange"
] as const;

export function afterProductivityChartOverlayPaint(callback: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(callback);
  });
}

export function addProductivityAnalysisFullscreenListener(
  handler: () => void
): () => void {
  for (const ev of PA_FULLSCREEN_EVENTS) {
    document.addEventListener(ev, handler);
  }
  return () => {
    for (const ev of PA_FULLSCREEN_EVENTS) {
      document.removeEventListener(ev, handler);
    }
  };
}

export function toastProductivityAnalysisFullscreenBusy(): void {
  window.dispatchEvent(
    new CustomEvent("pst:toast", {
      detail: {
        kind: "info",
        title: "Productivity analysis: full screen busy",
        message:
          "Exit the other full screen view first, then try chart full screen again.",
        durationMs: 2800
      }
    })
  );
}
