/** Toasts for Badges expanded view (e.g. iOS / iPadOS CSS-only layout). */

export function toastBadgesFullWindowLayout(): void {
  window.dispatchEvent(
    new CustomEvent("pst:toast", {
      detail: {
        kind: "info",
        title: "Badges",
        message: "Expanded layout — native full screen is not used on this device.",
        durationMs: 2200,
        bypassTrueFullscreenToastSuppress: true
      }
    })
  );
}
