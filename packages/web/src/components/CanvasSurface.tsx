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

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react';

import type { PageHandle } from '@sone/client';
import {
  addItem,
  bringToFront,
  canvasMap,
  moveItem,
  readCanvas,
  removeItem,
  type CanvasItem,
} from '@sone/core';

import { useT } from '../i18n/useT.tsx';
import { TrashIcon } from './icons.tsx';

type Tool = 'select' | 'pen' | 'text';

/** A stroke's points as an SVG path. Straight segments; a canvas is not calligraphy. */
function pathFrom(points: number[]): string {
  if (points.length < 4) return '';
  let d = `M ${points[0]} ${points[1]}`;
  for (let at = 2; at < points.length; at += 2) d += ` L ${points[at]} ${points[at + 1]}`;
  return d;
}

const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `it-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function CanvasSurface({
  handle,
  canEdit,
}: {
  handle: PageHandle;
  canEdit: boolean;
}): ReactElement {
  const { t } = useT();
  const doc = handle.doc;

  const [items, setItems] = useState<CanvasItem[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  /** The stroke being drawn, if any. Local until the pen lifts. */
  const [drawing, setDrawing] = useState<number[] | null>(null);

  const surface = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<{ id: string; dx: number; dy: number } | null>(null);

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
  const at = useCallback((event: PointerEvent): { x: number; y: number } => {
    const box = surface.current?.getBoundingClientRect();
    return {
      x: event.clientX - (box?.left ?? 0) + (surface.current?.scrollLeft ?? 0),
      y: event.clientY - (box?.top ?? 0) + (surface.current?.scrollTop ?? 0),
    };
  }, []);

  const onSurfaceDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!canEdit) return;
    const point = at(event);

    if (tool === 'pen') {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrawing([point.x, point.y]);
      return;
    }
    if (tool === 'text') {
      const id = newId();
      addItem(doc, { id, kind: 'text', x: point.x, y: point.y, text: '' });
      setSelected(id);
      setTool('select');
      return;
    }
    // Clicking the empty plane clears the selection, which is the only way to
    // deselect without a keyboard.
    setSelected(null);
  };

  const onSurfaceMove = (event: PointerEvent<HTMLDivElement>): void => {
    const point = at(event);

    if (drawing) {
      // Every point while the pen is down, in local state only.
      setDrawing((current) => (current ? [...current, point.x, point.y] : current));
      return;
    }
    const drag = dragging.current;
    if (drag) moveItem(doc, drag.id, point.x - drag.dx, point.y - drag.dy);
  };

  const onSurfaceUp = (): void => {
    dragging.current = null;
    if (!drawing) return;

    // One write, at the end. The points are stored relative to nothing — the
    // path carries absolute coordinates and the item sits at the origin, so a
    // stroke can be moved later by moving the item rather than every point.
    if (drawing.length >= 4) {
      addItem(doc, { id: newId(), kind: 'path', x: 0, y: 0, points: drawing, width: 2 });
    }
    setDrawing(null);
  };

  return (
    <div className="canvas-page">
      {canEdit && (
        <div className="canvas-tools" role="toolbar" aria-label={t('canvas.tools')}>
          {(['select', 'pen', 'text'] as const).map((id) => (
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

          {selected && (
            <button
              type="button"
              className="canvas-tool destructive"
              aria-label={t('canvas.remove')}
              title={t('canvas.remove')}
              onClick={() => {
                removeItem(doc, selected);
                setSelected(null);
              }}
            >
              <TrashIcon />
            </button>
          )}
        </div>
      )}

      <div
        className="canvas-surface"
        data-tool={tool}
        ref={surface}
        onPointerDown={onSurfaceDown}
        onPointerMove={onSurfaceMove}
        onPointerUp={onSurfaceUp}
        onPointerCancel={onSurfaceUp}
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
              className={selected === item.id ? 'canvas-item selected' : 'canvas-item'}
              style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
              onPointerDown={(event) => {
                if (!canEdit || tool !== 'select') return;
                // The item, not the plane behind it.
                event.stopPropagation();
                const point = at(event);
                dragging.current = { id: item.id, dx: point.x - item.x, dy: point.y - item.y };
                setSelected(item.id);
                bringToFront(doc, item.id);
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
            </div>
          ))}
      </div>
    </div>
  );
}
