/**
 * Ensures at most one custom tooltip/hovercard is visible app-wide.
 * Toasts dismiss the active tooltip so both never stack.
 */

type Closer = () => void;

let activeTooltipClose: Closer | null = null;

/** Close whatever tooltip currently owns the exclusive slot. */
export function dismissExclusiveTooltip(): void {
  const close = activeTooltipClose;
  activeTooltipClose = null;
  if (!close) return;
  try {
    close();
  } catch {
    // Ignore dismiss failures from unmounted owners.
  }
}

/**
 * Claim the single tooltip slot. Any previous owner is dismissed first.
 * Call the returned release when this tooltip closes (e.g. effect cleanup).
 */
export function claimExclusiveTooltip(close: Closer): () => void {
  const prev = activeTooltipClose;
  activeTooltipClose = close;
  if (prev && prev !== close) {
    try {
      prev();
    } catch {
      // Ignore dismiss failures from unmounted owners.
    }
  }
  return () => {
    if (activeTooltipClose === close) {
      activeTooltipClose = null;
    }
  };
}
