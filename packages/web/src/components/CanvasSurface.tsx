/**
 * SONE web — a canvas page (ADR-0043).
 *
 * Items are absolutely placed in one plane; there is no order, only positions,
 * so nothing here is a list. The document is the truth and this reads it on
 * every change — a canvas is small enough that redrawing all of it is cheaper
 * than working out what moved.
 *
 * The one piece of care is the stroke. A pen writes to the document *once, when
 * it lifts*: sixty updates a second per stroke is a log that grows forever and a
 * document carrying the history of somebody's wrist. While the pen is down the
 * points live in a ref and are drawn from local state, and nothing is shared —
 * which also means an unfinished stroke is not somebody else's problem.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
} from 'react';

import type { PageHandle } from '@sone/client';
import {
  addItem,
  bringToFront,
  canvasMap,
  moveItems,
  readCanvas,
  removeItem,
  resizeItem,
  type CanvasItem,
} from '@sone/core';

import { api } from '../api/client.ts';

import { useT } from '../i18n/useT.tsx';
import { TrashIcon } from './icons.tsx';

type Tool = 'select' | 'pen' | 'text' | 'erase';

/** A stroke's points as an SVG path. Straight segments; a canvas is not calligraphy. */
function pathFrom(points: number[]): string {
  if (points.length < 4) return '';
  let d = `M ${points[0]} ${points[1]}`;
  for (let at = 2; at < points.length; at += 2) d += ` L ${points[at]} ${points[at + 1]}`;
  return d;
}

/** A path's own box, since a stroke has no width and height of its own. */
function boxOf(item: CanvasItem): { x: number; y: number; w: number; h: number } {
  if (item.kind !== 'path' || !item.points?.length) {
    return { x: item.x, y: item.y, w: item.w, h: item.h };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let at = 0; at < item.points.length; at += 2) {
    const x = item.points[at] ?? 0;
    const y = item.points[at + 1] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function within(item: CanvasItem, point: { x: number; y: number }): boolean {
  const box = boxOf(item);
  // A stroke is a line rather than a rectangle, so its box is generous — but an
  // eraser that only works on the exact pixel is an eraser nobody can use.
  return (
    point.x >= box.x - 4 &&
    point.x <= box.x + box.w + 4 &&
    point.y >= box.y - 4 &&
    point.y <= box.y + box.h + 4
  );
}

function overlaps(item: CanvasItem, band: { x: number; y: number; w: number; h: number }): boolean {
  const box = boxOf(item);
  return (
    box.x < band.x + band.w &&
    box.x + box.w > band.x &&
    box.y < band.y + band.h &&
    box.y + box.h > band.y
  );
}

const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `it-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function CanvasSurface({
  handle,
  pageId,
  canEdit,
}: {
  handle: PageHandle;
  /** Whose files an image on this canvas belongs to (ADR-0029). */
  pageId: string;
  canEdit: boolean;
}): ReactElement {
  const { t } = useT();
  const doc = handle.doc;

  const [items, setItems] = useState<CanvasItem[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  /** The stroke being drawn, if any. Local until the pen lifts. */
  const [drawing, setDrawing] = useState<number[] | null>(null);

  /** What the pen writes with. Per person and per session, not in the document:
   *  the colour somebody draws in is theirs, and the stroke keeps it once
   *  drawn. */
  const [ink, setInk] = useState<{ colour: string; width: number }>({
    colour: 'currentColor',
    width: 2,
  });
  const [busy, setBusy] = useState(false);
  /**
   * How far in. One number, not a matrix: the plane is scaled from its own
   * origin and panning is the scroller's job, so there is no second coordinate
   * system to keep in step — which is where a hand-rolled viewport usually goes
   * wrong.
   */
  const [zoom, setZoom] = useState(1);
  /** A rubber band, while one is being dragged. In canvas coordinates. */
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const bandFrom = useRef<{ x: number; y: number } | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const surface = useRef<HTMLDivElement | null>(null);
  /**
   * What is being dragged.
   *
   * `last` rather than an offset, because a group moves by a delta: the offset
   * belongs to the item under the finger, and the others have their own. Deltas
   * are also what let two people drag two overlapping groups without arguing
   * about where the shared item is.
   */
  const dragging = useRef<{ ids: string[]; last: { x: number; y: number } } | null>(null);
  /** Panning: the scroller's position when the drag began. */
  const panning = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  /** Resizing, which is dragging a corner rather than the item. */
  const sizing = useRef<{ id: string; x: number; y: number; w: number; h: number } | null>(null);

  /** Whether space is held, which turns a drag into panning. */
  const [space, setSpace] = useState(false);
  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      // Not while typing in a note: space is a word separator first.
      if (event.code !== 'Space' || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      setSpace(true);
    };
    const up = (event: KeyboardEvent): void => {
      if (event.code === 'Space') setSpace(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Redraw on any change to the map. Deep, because an item's own keys are where
  // a move lands — observing only the map would miss everything except adding
  // and removing.
  useEffect(() => {
    const map = canvasMap(doc);
    const read = (): void => setItems(readCanvas(doc));
    read();
    map.observeDeep(read);
    return () => map.unobserveDeep(read);
  }, [doc]);

  /** Where a pointer is, in canvas coordinates. */
  const at = useCallback(
    (event: { clientX: number; clientY: number }): { x: number; y: number } => {
      const box = surface.current?.getBoundingClientRect();
      // Divided by the zoom, because everything stored is in canvas units and
      // the pointer speaks screen ones. Getting this wrong is the classic
      // canvas bug: things land where you clicked at 100% and nowhere near it
      // at any other size.
      return {
        x: (event.clientX - (box?.left ?? 0) + (surface.current?.scrollLeft ?? 0)) / zoom,
        y: (event.clientY - (box?.top ?? 0) + (surface.current?.scrollTop ?? 0)) / zoom,
      };
    },
    [zoom],
  );

  const onSurfaceDown = (event: PointerEvent<HTMLDivElement>): void => {
    // Panning first, and before the edit check: moving the view is reading, not
    // writing, so somebody with read-only access can still get around the board.
    //
    // The middle button or a held space, which are the two gestures every
    // drawing tool has trained people to expect. Not a drag with the left
    // button on empty space — that is the rubber band, and a canvas that pans
    // when you meant to select is one you cannot select on.
    if (event.button === 1 || space) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panning.current = {
        x: event.clientX,
        y: event.clientY,
        left: surface.current?.scrollLeft ?? 0,
        top: surface.current?.scrollTop ?? 0,
      };
      return;
    }

    if (!canEdit) return;
    const point = at(event);

    if (tool === 'pen') {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrawing([point.x, point.y]);
      return;
    }
    if (tool === 'erase') {
      // Whatever is under the pointer, topmost first — the same order the eye
      // uses, since the topmost is what somebody sees themselves rubbing out.
      const hit = [...items].reverse().find((item) => within(item, point));
      if (hit) removeItem(doc, hit.id);
      return;
    }
    if (tool === 'text') {
      const id = newId();
      addItem(doc, { id, kind: 'text', x: point.x, y: point.y, text: '' });
      setSelected(id);
      setTool('select');
      return;
    }
    // Clicking the empty plane clears the selection and starts a rubber band.
    setSelected(null);
    setChosen(new Set());
    bandFrom.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onSurfaceMove = (event: PointerEvent<HTMLDivElement>): void => {
    const pan = panning.current;
    if (pan && surface.current) {
      // In screen units, not canvas ones: the scroller is what moves, and it
      // does not know about the zoom.
      surface.current.scrollLeft = pan.left - (event.clientX - pan.x);
      surface.current.scrollTop = pan.top - (event.clientY - pan.y);
      return;
    }

    const point = at(event);

    if (drawing) {
      // Every point while the pen is down, in local state only.
      setDrawing((current) => (current ? [...current, point.x, point.y] : current));
      return;
    }
    const from = bandFrom.current;
    if (from) {
      setBand({
        x: Math.min(from.x, point.x),
        y: Math.min(from.y, point.y),
        w: Math.abs(point.x - from.x),
        h: Math.abs(point.y - from.y),
      });
      return;
    }
    const size = sizing.current;
    if (size) {
      resizeItem(doc, size.id, size.w + (point.x - size.x), size.h + (point.y - size.y));
      return;
    }
    const drag = dragging.current;
    if (drag) {
      moveItems(doc, drag.ids, point.x - drag.last.x, point.y - drag.last.y);
      drag.last = point;
    }
  };

  const onSurfaceUp = (): void => {
    panning.current = null;
    dragging.current = null;
    sizing.current = null;

    if (bandFrom.current) {
      bandFrom.current = null;
      if (band && band.w > 4 && band.h > 4) {
        // Everything the band touches, not only what it encloses: a stroke that
        // starts outside the band is still one somebody meant to catch.
        setChosen(new Set(items.filter((item) => overlaps(item, band)).map((item) => item.id)));
      }
      setBand(null);
      return;
    }
    if (!drawing) return;

    // One write, at the end. The points are stored relative to nothing — the
    // path carries absolute coordinates and the item sits at the origin, so a
    // stroke can be moved later by moving the item rather than every point.
    if (drawing.length >= 4) {
      addItem(doc, {
        id: newId(),
        kind: 'path',
        x: 0,
        y: 0,
        points: drawing,
        colour: ink.colour,
        width: ink.width,
      });
    }
    setDrawing(null);
  };

  /**
   * A picture dropped onto the plane.
   *
   * The same upload every other file uses — the workspace's file, served by the
   * same route, counted in the same storage (ADR-0029). A canvas that had its
   * own picture store would be a second place for a backup to miss.
   */
  const onDrop = async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    if (!canEdit) return;
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;

    const box = surface.current?.getBoundingClientRect();
    const x = event.clientX - (box?.left ?? 0) + (surface.current?.scrollLeft ?? 0);
    const y = event.clientY - (box?.top ?? 0) + (surface.current?.scrollTop ?? 0);

    setBusy(true);
    try {
      const uploaded = await api.uploadFile(pageId, file);
      addItem(doc, {
        id: newId(),
        kind: uploaded.category === 'image' ? 'image' : 'text',
        x,
        y,
        w: 320,
        h: 240,
        ...(uploaded.category === 'image'
          ? { fileId: uploaded.id }
          : // Anything that is not a picture becomes a note naming it, rather
            // than nothing at all: a file dropped on a board was meant to be
            // there, and refusing silently looks like a broken drop target.
            { text: uploaded.filename }),
      });
    } catch {
      // Silent, deliberately: the upload's own errors are reported by the page,
      // and a canvas is not the place to explain a proxy's size limit.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="canvas-page">
      {canEdit && (
        <div className="canvas-tools" role="toolbar" aria-label={t('canvas.tools')}>
          {(['select', 'pen', 'text', 'erase'] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={tool === id ? 'canvas-tool current' : 'canvas-tool'}
              aria-pressed={tool === id}
              onClick={() => setTool(id)}
            >
              {t(`canvas.tool.${id}` as 'canvas.tool.select')}
            </button>
          ))}

          {tool === 'pen' && (
            <>
              {/* The colours the workspace already knows, so ink matches
                  everything else that is coloured here (ADR-0030). */}
              {['currentColor', '#c0392b', '#2d7a4f', '#2a6f97', '#b8860b'].map((colour) => (
                <button
                  key={colour}
                  type="button"
                  className={ink.colour === colour ? 'canvas-ink-choice current' : 'canvas-ink-choice'}
                  style={{ color: colour }}
                  aria-label={t('canvas.colour')}
                  aria-pressed={ink.colour === colour}
                  onClick={() => setInk((current) => ({ ...current, colour }))}
                />
              ))}
              <label className="canvas-ink-width">
                {t('canvas.thickness')}
                <input
                  type="range"
                  min={1}
                  max={12}
                  value={ink.width}
                  onChange={(event) =>
                    setInk((current) => ({ ...current, width: Number(event.target.value) }))
                  }
                />
              </label>
            </>
          )}

          {/* How far in. Buttons rather than a pinch alone: a mouse has no
              pinch, and a percentage nobody can read back is a viewport people
              get lost in. */}
          <div className="canvas-zoom">
            <button
              type="button"
              className="canvas-tool"
              aria-label={t('canvas.zoomOut')}
              onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.25) * 100) / 100))}
            >
              −
            </button>
            <button
              type="button"
              className="canvas-tool"
              onClick={() => setZoom(1)}
              title={t('canvas.zoomReset')}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="canvas-tool"
              aria-label={t('canvas.zoomIn')}
              onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))}
            >
              +
            </button>
          </div>

          {(selected || chosen.size > 0) && (
            <button
              type="button"
              className="canvas-tool destructive"
              aria-label={t('canvas.remove')}
              title={t('canvas.remove')}
              onClick={() => {
                // Everything chosen, or the one thing selected. One transaction
                // either way, so it arrives elsewhere as one removal.
                const ids = chosen.size > 0 ? [...chosen] : selected ? [selected] : [];
                doc.transact(() => ids.forEach((id) => removeItem(doc, id)));
                setSelected(null);
                setChosen(new Set());
              }}
            >
              <TrashIcon />
            </button>
          )}
        </div>
      )}

      <div
        className="canvas-surface"
        data-tool={space ? 'pan' : tool}
        ref={surface}
        onPointerDown={onSurfaceDown}
        onPointerMove={onSurfaceMove}
        onPointerUp={onSurfaceUp}
        onPointerCancel={onSurfaceUp}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void onDrop(event)}
        data-busy={busy ? 'true' : undefined}
      >
        {/* One scaled plane, so zooming is a single transform and nothing else
            in here has to know about it. Scaled from its own origin, which is
            what keeps the arithmetic in `at` to one division. */}
        <div
          className="canvas-plane"
          style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}
        >
        {/* Every stroke in one SVG, under the items: ink is the background a
            note is stuck onto, which is what a whiteboard is. */}
        <svg className="canvas-ink" aria-hidden="true">
          {items
            .filter((item) => item.kind === 'path' && item.points)
            .map((item) => (
              <path
                key={item.id}
                d={pathFrom(item.points ?? [])}
                stroke={item.colour ?? 'currentColor'}
                strokeWidth={item.width ?? 2}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          {drawing && (
            <path
              d={pathFrom(drawing)}
              stroke="currentColor"
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>

        {items
          .filter((item) => item.kind !== 'path')
          .map((item) => (
            <div
              key={item.id}
              className={
                selected === item.id || chosen.has(item.id)
                  ? 'canvas-item selected'
                  : 'canvas-item'
              }
              style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
              onPointerDown={(event) => {
                if (!canEdit || tool !== 'select') return;
                // The item, not the plane behind it.
                event.stopPropagation();
                const point = at(event);
                // The whole chosen set when this item is part of one, so a band
                // followed by a drag moves everything it caught.
                const ids = chosen.has(item.id) ? [...chosen] : [item.id];
                dragging.current = { ids, last: point };
                setSelected(item.id);
                if (ids.length === 1) {
                  setChosen(new Set());
                  bringToFront(doc, item.id);
                }
              }}
            >
              {item.kind === 'text' && (
                <textarea
                  className="canvas-text"
                  defaultValue={item.text ?? ''}
                  readOnly={!canEdit}
                  aria-label={t('canvas.textItem')}
                  // Typed straight into the shared text, so two people in one
                  // box merge rather than overwrite (ADR-0043).
                  onChange={(event) => {
                    const entry = canvasMap(doc).get(item.id);
                    const text = entry?.get('text');
                    if (!text || typeof text !== 'object' || !('delete' in text)) return;
                    const shared = text as { delete: (a: number, b: number) => void; insert: (a: number, s: string) => void; length: number };
                    doc.transact(() => {
                      shared.delete(0, shared.length);
                      shared.insert(0, event.target.value);
                    });
                  }}
                  // The surface must not start a drag or a stroke when somebody
                  // is aiming at the words.
                  onPointerDown={(event) => event.stopPropagation()}
                />
              )}

              {item.kind === 'image' && item.fileId && (
                <img className="canvas-image" src={`/api/files/${item.fileId}`} alt="" />
              )}

              {/* The corner, only on what is selected: a handle on everything
                  is eight more things to hit by accident. */}
              {canEdit && selected === item.id && (
                <span
                  className="canvas-size"
                  role="button"
                  aria-label={t('canvas.resize')}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    const point = at(event);
                    sizing.current = {
                      id: item.id,
                      x: point.x,
                      y: point.y,
                      w: item.w,
                      h: item.h,
                    };
                  }}
                />
              )}
            </div>
          ))}

        {/* The band, drawn in the plane so it scales with everything else. */}
        {band && (
          <div
            className="canvas-band"
            style={{ left: band.x, top: band.y, width: band.w, height: band.h }}
            aria-hidden="true"
          />
        )}
        </div>
      </div>
    </div>
  );
}
