/** Coordinates for fixed editor controls, in the layout viewport's CSS pixels. */
export interface OverlayBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface OverlayPlacement {
  top: number;
  left: number;
  maxWidth: number;
  maxHeight: number;
}

export function editorOverlayBounds(editor: HTMLElement): OverlayBounds {
  const win = editor.ownerDocument.defaultView!;
  const visual = win.visualViewport;
  const bounds = {
    top: visual?.offsetTop ?? 0,
    left: visual?.offsetLeft ?? 0,
    bottom: (visual?.offsetTop ?? 0) + (visual?.height ?? win.innerHeight),
    right: (visual?.offsetLeft ?? 0) + (visual?.width ?? win.innerWidth),
  };
  const pane = editor.closest('.main');
  const paneBox = pane?.getBoundingClientRect();
  if (paneBox && paneBox.width > 0 && paneBox.height > 0) {
    bounds.top = Math.max(bounds.top, paneBox.top);
    bounds.bottom = Math.min(bounds.bottom, paneBox.bottom);
    bounds.left = Math.max(bounds.left, paneBox.left);
    bounds.right = Math.min(bounds.right, paneBox.right);
  }
  const header = pane?.querySelector('.topbar')?.getBoundingClientRect();
  if (header && header.top <= bounds.top && header.bottom > bounds.top) {
    bounds.top = Math.min(bounds.bottom, header.bottom);
  }
  // The rail is vertical on desktop and covers the bottom on phones. Only
  // subtract an element that actually covers the lower edge of this pane.
  for (const element of editor.ownerDocument.querySelectorAll('.icon-rail, .mode-bar')) {
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0 && box.left < bounds.right &&
        box.right > bounds.left && box.top > bounds.top && box.top < bounds.bottom && box.bottom >= bounds.bottom) {
      bounds.bottom = box.top;
    }
  }
  return bounds;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, Math.max(min, max)));

/** Flip if possible; clamp if neither side fits (e.g. a document-wide selection). */
export function placeEditorOverlay(
  anchor: { top: number; bottom: number; left: number },
  size: { width: number; height: number },
  bounds: OverlayBounds,
  preferAbove = false,
  gap = 6,
): OverlayPlacement {
  const margin = 8;
  const maxWidth = Math.max(1, bounds.right - bounds.left - margin * 2);
  const maxHeight = Math.max(1, bounds.bottom - bounds.top - margin * 2);
  const width = Math.min(size.width, maxWidth);
  const height = Math.min(size.height, maxHeight);
  const above = anchor.top - gap - height;
  const below = anchor.bottom + gap;
  const fitsAbove = above >= bounds.top + margin && above + height <= bounds.bottom - margin;
  const fitsBelow = below >= bounds.top + margin && below + height <= bounds.bottom - margin;
  const top = preferAbove
    ? (fitsAbove || !fitsBelow ? above : below)
    : (fitsBelow || !fitsAbove ? below : above);
  return {
    top: clamp(top, bounds.top + margin, bounds.bottom - margin - height),
    left: clamp(anchor.left, bounds.left + margin, bounds.right - margin - width),
    maxWidth,
    maxHeight,
  };
}

/** Keep actions beside the visible part of their block; hide them once it leaves. */
export function visibleBlockTop(
  block: { top: number; bottom: number; height: number },
  controlsHeight: number,
  bounds: OverlayBounds,
): number | null {
  if (block.height > 0 && (block.bottom <= bounds.top || block.top >= bounds.bottom)) return null;
  return clamp(block.top, bounds.top + 2, bounds.bottom - controlsHeight - 2);
}
