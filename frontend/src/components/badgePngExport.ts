function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function exportBadgeCardPng(opts: {
  node: HTMLElement;
  filenameBase: string;
  sizePx?: number;
}) {
  const { toPng } = await import("html-to-image");
  const sizePx = typeof opts.sizePx === "number" && opts.sizePx > 0 ? opts.sizePx : 1024;

  // Mark the exact node we want to adjust inside the cloned document.
  const marker = "data-export-badge-card";
  opts.node.setAttribute(marker, "true");
  try {
    // Render at high quality, keep background transparent, and omit the export button itself.
    const dataUrl = await toPng(opts.node, {
      cacheBust: true,
      pixelRatio: Math.max(2, Math.round(sizePx / 360)),
      backgroundColor: "transparent",
      filter: (n) => {
        if (!(n instanceof HTMLElement)) return true;
        return !n.classList.contains("badge-export-btn");
      },
      onClone: (doc) => {
        // Apply export-only layout tweaks so the PNG matches desired composition
        // without affecting the live UI.
        const card = doc.body.querySelector(`[${marker}="true"]`) as HTMLElement | null;
        if (!card) return;

        // Make the badge art more dominant.
        const medal = card.querySelector(".badge-medal") as HTMLElement | null;
        if (medal) {
          medal.style.transform = "scale(1.18)";
          medal.style.transformOrigin = "center top";
          medal.style.marginTop = "8px";
          medal.style.marginBottom = "10px";
        }

        // Remove the unlocked/locked text line for exports.
        const state = card.querySelector(".badge-state") as HTMLElement | null;
        if (state) state.style.display = "none";

        // Put badge name and star number on the same row.
        const content = card.querySelector(".badge-content") as HTMLElement | null;
        const label = card.querySelector(".badge-label") as HTMLElement | null;
        const stars = card.querySelector(".badge-stars") as HTMLElement | null;
        if (content && label && stars) {
          const row = doc.createElement("div");
          row.style.display = "flex";
          row.style.alignItems = "center";
          row.style.justifyContent = "center";
          row.style.gap = "12px";
          row.style.marginTop = "10px";

          // Tweak typography for export composition.
          label.style.fontSize = "34px";
          label.style.fontWeight = "900";
          label.style.lineHeight = "1.05";
          label.style.margin = "0";
          label.style.padding = "0";

          stars.style.margin = "0";
          stars.style.padding = "0";
          (stars.querySelector(".badge-stars-icon") as HTMLElement | null)?.style.setProperty(
            "font-size",
            "30px"
          );
          (stars.querySelector(".badge-stars-num") as HTMLElement | null)?.style.setProperty(
            "font-size",
            "28px"
          );
          (stars.querySelector(".badge-stars-num") as HTMLElement | null)?.style.setProperty(
            "font-weight",
            "900"
          );

          // Clear content and rebuild (label + stars only).
          content.innerHTML = "";
          row.appendChild(label);
          row.appendChild(stars);
          content.appendChild(row);

          // Reduce extra bottom spacing so art stays dominant.
          content.style.paddingBottom = "8px";
        }
      },
      style: {
        transform: "none",
        // Prevent hover lift/shadows differences while exporting.
        transition: "none"
      }
    });

    const safeBase = opts.filenameBase
      .trim()
      .replaceAll(/[^\w\-]+/g, "_")
      .replaceAll(/^_+|_+$/g, "")
      .slice(0, 80) || "badge";
    downloadDataUrl(dataUrl, `${safeBase}_${sizePx}x${sizePx}.png`);
  } finally {
    opts.node.removeAttribute(marker);
  }
}

