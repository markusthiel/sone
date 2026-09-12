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
import { acts, gestures, readPenSeen, rememberPenSeen } from './canvasInput.ts';
import {
  THEME_COLORS,
  colorValue,
  CANVAS_BACKGROUNDS,
  readBackground,
  setBackground,
  type CanvasBackground,
  addItem,
  bringToFront,
  canvasMap,
  duplicateItem,
  lockItem,
  moveItems,
  readCanvas,
  removeItem,
  resizeItem,
  type CanvasItem,
} from '@sone/core';

import { api } from '../api/client.ts';

import { useCanvasHistory } from '../hooks/useCanvasHistory.ts';
import { useT } from '../i18n/useT.tsx';
import {
  MessageIcon,
  ArrowUpIcon,
  ArrowUturnIcon,
  DuplicateIcon,
  LockIcon,
  CursorIcon,
  EllipseIcon,
  EraserIcon,
  HandIcon,
  ImageIcon,
  LineIcon,
  PencilIcon,
  RectangleIcon,
  TextIcon,
  TrashIcon,
} from './icons.tsx';

type Tool = 'select' | 'hand' | 'pen' | 'text' | 'rect' | 'ellipse' | 'line' | 'erase';

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
  // Plus wherever the stroke has been moved to. The points are where the pen
  // went; the item's position is where that drawing now sits, and a hit test
  // that forgot the second missed every stroke anybody had dragged.
  return { x: minX + item.x, y: minY + item.y, w: maxX - minX, h: maxY - minY };
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
  onCommentItem,
  commented,
}: {
  handle: PageHandle;
  /** Whose files an image on this canvas belongs to (ADR-0029). */
  pageId: string;
  canEdit: boolean;
  /** Start a thread about one item (ADR-0046). */
  onCommentItem: (itemId: string) => void;
  /**
   * Which items have comments, and how many are internal (ADR-0057).
   *
   * The canvas received no threads at all until now, so a commented item looked
   * exactly like an uncommented one and the only way to find a discussion was
   * the panel. That is a gap in ADR-0046 rather than in the internal-comment
   * work, and it is why ADR-0057 could defer "the canvas draws its own marks":
   * there were none.
   */
  commented?: ReadonlyMap<string, { total: number; internal: number }>;
}): ReactElement {
  const { t } = useT();
  const doc = handle.doc;

  const [items, setItems] = useState<CanvasItem[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  /** The stroke being drawn, if any. Local until the pen lifts. */
  const [drawing, setDrawing] = useState<number[] | null>(null);
  /** What the handle belongs to, and the box it hangs off. */
  const selectedItem = items.find((item) => item.id === selected) ?? null;
  const handleBox = selectedItem ? boxOf(selectedItem) : { x: 0, y: 0, w: 0, h: 0 };

  /** A note just placed, which should have the caret. */
  const [typing, setTyping] = useState<string | null>(null);

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

  /**
   * The contacts currently down, and whether a pen has ever been one (ADR-0179).
   *
   * In a ref rather than in state: they are read inside the pointer handlers
   * and nothing is drawn from them, so a render per finger would be a render
   * for nothing. `penSeen` is state as well, because the toolbar says so.
   */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const [penSeen, setPenSeen] = useState(readPenSeen);
  /** A two-finger pinch in progress: what it started from. */
  const pinch = useRef<{ span: number; zoom: number; x: number; y: number; panX: number; panY: number } | null>(
    null,
  );
  /** A rubber band, while one is being dragged. In canvas coordinates. */
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const bandFrom = useRef<{ x: number; y: number } | null>(null);
  /** The shape being dragged out, if any. */
  const shaping = useRef<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(
    null,
  );
  const [shape, setShape] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
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
  /**
   * Where the plane sits, in screen pixels.
   *
   * An offset rather than a scroller, which is what makes the board endless: a
   * scroller needs a size to scroll within, so it needs the plane to have ends —
   * and 4000 pixels of ends is both a wall somebody eventually hits and two
   * scrollbars saying how far along a nothing they are.
   */
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panning = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  /** Resizing, which is dragging a corner rather than the item. */
  const sizing = useRef<{ id: string; x: number; y: number; w: number; h: number } | null>(null);

  // Undo, which on a shared board takes back what *you* did and never reaches
  // across to somebody else's stroke.
  const history = useCanvasHistory(doc);
  const [background, setBackgroundState] = useState<CanvasBackground>('dots');

  /** Whether space is held, which turns a drag into panning. */
  const [space, setSpace] = useState(false);
  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      const typing = event.target instanceof HTMLTextAreaElement;

      // Undo and redo, the shortcuts everything else in this application uses.
      // Not while typing: a note's own text has the browser's undo, and taking
      // that over would make one keystroke mean two things.
      if (!typing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
        return;
      }

      // Not while typing in a note: space is a word separator first.
      if (event.code !== 'Space' || typing) return;
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
  }, [history]);

  // Redraw on any change to the map. Deep, because an item's own keys are where
  // a move lands — observing only the map would miss everything except adding
  // and removing.
  useEffect(() => {
    const map = canvasMap(doc);
    const read = (): void => {
      setItems(readCanvas(doc));
      setBackgroundState(readBackground(doc));
    };
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
      // The pan first, then the zoom: the plane is translated and then scaled
      // from its own origin, so undoing that is subtracting and then dividing.
      return {
        x: (event.clientX - (box?.left ?? 0) - pan.x) / zoom,
        y: (event.clientY - (box?.top ?? 0) - pan.y) / zoom,
      };
    },
    [zoom, pan],
  );

  const onSurfaceDown = (event: PointerEvent<HTMLDivElement>): void => {
    /*
     * What this contact is (ADR-0179).
     *
     * A pen marks the device for good: from then on a finger moves the view and
     * only the pen works the tools, which is what keeps a resting hand from
     * drawing, erasing and selecting.
     */
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    let seen = penSeen;
    if (event.pointerType === 'pen' && !penSeen) {
      rememberPenSeen();
      setPenSeen(true);
      seen = true;
    }
    const contact = {
      pointerType: event.pointerType || 'mouse',
      penSeen: seen,
      touches: touches.current.size,
    };

    if (gestures(contact)) {
      event.currentTarget.setPointerCapture(event.pointerId);
      if (touches.current.size === 2) {
        // A pinch replaces whatever one finger had started: two contacts are a
        // gesture about the view, and the first was never a tool.
        const [a, b] = [...touches.current.values()];
        if (a && b) {
          pinch.current = {
            span: Math.hypot(b.x - a.x, b.y - a.y),
            zoom,
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            panX: pan.x,
            panY: pan.y,
          };
        }
        panning.current = null;
      } else {
        panning.current = { x: event.clientX, y: event.clientY, left: pan.x, top: pan.y };
      }
      return;
    }
    // A contact that neither works the tools nor moves the view is a palm.
    if (!acts(contact)) return;

    // Panning first, and before the edit check: moving the view is reading, not
    // writing, so somebody with read-only access can still get around the board.
    //
    // The middle button or a held space, which are the two gestures every
    // drawing tool has trained people to expect. Not a drag with the left
    // button on empty space — that is the rubber band, and a canvas that pans
    // when you meant to select is one you cannot select on.
    if (event.button === 1 || space || tool === 'hand') {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panning.current = { x: event.clientX, y: event.clientY, left: pan.x, top: pan.y };
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
      const hit = [...items].reverse().find((item) => within(item, point) && !item.locked);
      if (hit) removeItem(doc, hit.id);
      return;
    }
    // A shape is drawn by dragging its box, which is the same gesture as the
    // band and needs no second idea.
    if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
      event.currentTarget.setPointerCapture(event.pointerId);
      shaping.current = { from: point, to: point };
      setShape({ x: point.x, y: point.y, w: 0, h: 0 });
      return;
    }
    if (tool === 'text') {
      const id = newId();
      addItem(doc, { id, kind: 'text', x: point.x, y: point.y, text: '' });
      setSelected(id);
      // Ready to type. A note that has to be clicked after being placed is two
      // actions for one intention, and the second one is not obvious.
      setTyping(id);
      // Back to selecting, so the next click moves the note rather than
      // stacking another one behind it.
      setTool('select');
      return;
    }
    // A stroke or a shape under the pointer: those are drawn in the ink layer
    // rather than as elements, so nothing catches the press for them. Topmost
    // first, the order the eye uses.
    if (tool === 'select') {
      const hit = [...items]
        .reverse()
        .find((item) => item.kind !== 'text' && item.kind !== 'image' && within(item, point));
      if (hit) {
        setSelected(hit.id);
        setChosen(new Set());
        if (!hit.locked) {
          dragging.current = { ids: [hit.id], last: point };
          bringToFront(doc, hit.id);
        }
        return;
      }
    }

    // Clicking the empty plane clears the selection and starts a rubber band.
    setSelected(null);
    setChosen(new Set());
    bandFrom.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onSurfaceMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    /*
     * Two fingers move and scale the plane together (ADR-0179).
     *
     * Anchored on the midpoint, so the board grows around what is between the
     * fingers rather than around a corner — which is the difference between a
     * zoom somebody can aim and one they have to chase with a pan afterwards.
     */
    const grip = pinch.current;
    if (grip && touches.current.size >= 2) {
      const [a, b] = [...touches.current.values()];
      if (a && b) {
        const span = Math.hypot(b.x - a.x, b.y - a.y);
        // A pinch that has not opened yet would divide by nothing.
        if (grip.span > 1) {
          const next = Math.min(3, Math.max(0.25, (grip.zoom * span) / grip.span));
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const scale = next / grip.zoom;
          setZoom(next);
          setPan({
            x: midX - (grip.x - grip.panX) * scale,
            y: midY - (grip.y - grip.panY) * scale,
          });
        }
      }
      return;
    }

    const grab = panning.current;
    if (grab) {
      // In screen units, not canvas ones: the plane moves under the pointer by
      // exactly as far as the pointer moved, whatever the zoom.
      setPan({
        x: grab.left + (event.clientX - grab.x),
        y: grab.top + (event.clientY - grab.y),
      });
      return;
    }

    const point = at(event);

    if (drawing) {
      /*
       * Every point while the pen is down, in local state only — and every
       * point the browser *had*, not only the one it woke us for.
       *
       * A pen reports faster than a frame, and `getCoalescedEvents` is where
       * the ones in between are kept. Without it a quick stroke is a polygon
       * with a corner per frame, which is exactly the thing that makes writing
       * by hand feel wrong.
       */
      const more =
        typeof event.nativeEvent.getCoalescedEvents === 'function'
          ? event.nativeEvent.getCoalescedEvents()
          : [];
      const points =
        more.length > 1
          ? more.flatMap((one) => {
              const p = at(one as unknown as PointerEvent<HTMLDivElement>);
              return [p.x, p.y];
            })
          : [point.x, point.y];
      setDrawing((current) => (current ? [...current, ...points] : current));
      return;
    }
    const shaping_ = shaping.current;
    if (shaping_) {
      shaping_.to = point;
      setShape({
        x: Math.min(shaping_.from.x, point.x),
        y: Math.min(shaping_.from.y, point.y),
        w: Math.abs(point.x - shaping_.from.x),
        h: Math.abs(point.y - shaping_.from.y),
      });
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

  /**
   * The wheel moves the board; the wheel with a modifier changes how far in.
   *
   * Which is what every drawing tool does, and the reason there are no
   * scrollbars to reach for. Zooming keeps the point under the pointer still:
   * anchoring to the corner instead makes zooming feel like the board running
   * away, since what somebody is looking at is never the corner.
   */
  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey) {
      const box = surface.current?.getBoundingClientRect();
      const px = event.clientX - (box?.left ?? 0);
      const py = event.clientY - (box?.top ?? 0);
      const next = Math.min(3, Math.max(0.25, zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
      // Keep the canvas point under the pointer where it is: solve
      // (px - pan) / zoom = (px - next_pan) / next.
      setPan((current) => ({
        x: px - ((px - current.x) / zoom) * next,
        y: py - ((py - current.y) / zoom) * next,
      }));
      setZoom(next);
      return;
    }
    setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
  };

  /** A contact let go of, whatever it was doing. */
  const forget = (event: PointerEvent<HTMLDivElement>): void => {
    touches.current.delete(event.pointerId);
    if (touches.current.size < 2) pinch.current = null;
  };

  /**
   * The system took the contact back (ADR-0179).
   *
   * This ran `onSurfaceUp`, which **commits** the stroke — so a touch Safari
   * reclaimed mid-gesture wrote a line. That is the palm arriving by a second
   * door, and it was there before any of this: a cancel is the strongest
   * rejection signal a browser gives, and it was being read as a signature.
   */
  const onSurfaceCancel = (event: PointerEvent<HTMLDivElement>): void => {
    forget(event);
    panning.current = null;
    dragging.current = null;
    sizing.current = null;
    shaping.current = null;
    bandFrom.current = null;
    setShape(null);
    setBand(null);
    setDrawing(null);
  };

  const onSurfaceUp = (event?: PointerEvent<HTMLDivElement>): void => {
    if (event) forget(event);
    panning.current = null;
    dragging.current = null;
    sizing.current = null;

    const drawn = shaping.current;
    if (drawn) {
      shaping.current = null;
      const box = {
        x: Math.min(drawn.from.x, drawn.to.x),
        y: Math.min(drawn.from.y, drawn.to.y),
        w: Math.abs(drawn.to.x - drawn.from.x),
        h: Math.abs(drawn.to.y - drawn.from.y),
      };
      // A tap rather than a drag makes nothing: a shape with no size is a shape
      // nobody can grab to give one.
      if (box.w > 4 || box.h > 4) {
        addItem(doc, {
          id: newId(),
          kind: tool === 'ellipse' ? 'ellipse' : tool === 'line' ? 'line' : 'rect',
          // A line keeps the corners it was drawn between rather than a box, so
          // dragging up-left draws up-left instead of flipping.
          ...(tool === 'line'
            ? { x: drawn.from.x, y: drawn.from.y, w: drawn.to.x - drawn.from.x, h: drawn.to.y - drawn.from.y }
            : box),
          colour: ink.colour,
          width: ink.width,
        });
      }
      setShape(null);
      return;
    }

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
    const x = (event.clientX - (box?.left ?? 0) - pan.x) / zoom;
    const y = (event.clientY - (box?.top ?? 0) - pan.y) / zoom;

    await place(file, { x, y });
  };

  /**
   * Upload a file and put it on the board.
   *
   * Shared by the drop target and the button, because "insert a picture" should
   * mean one thing however somebody arrived at it — and because the drop was the
   * only way in, which is a way nobody finds who has not been told.
   */
  const place = async (file: File, at_: { x: number; y: number }): Promise<void> => {
    setBusy(true);
    try {
      const uploaded = await api.uploadFile(pageId, file);
      addItem(doc, {
        id: newId(),
        kind: uploaded.category === 'image' ? 'image' : 'text',
        x: at_.x,
        y: at_.y,
        w: 320,
        h: 240,
        // Named and measured, so the files panel can list a board's pictures
        // beside a page's without a request per file.
        filename: uploaded.filename,
        sizeBytes: uploaded.sizeBytes,
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

  /** A picture chosen from a button rather than dropped. */
  const pickImage = (): void => {
    const field = document.createElement('input');
    field.type = 'file';
    field.accept = 'image/*';
    field.addEventListener('change', () => {
      const file = field.files?.[0];
      if (file) void place(file, { x: -pan.x / zoom + 80, y: -pan.y / zoom + 80 });
    });
    field.click();
  };

  return (
    <div className="canvas-page">
      {canEdit && (
        <div className="canvas-tools" role="toolbar" aria-label={t('canvas.tools')}>
          {/* Marks rather than words. Seven labels in a row is most of the bar,
              and each of these is the thing it makes — a rectangle is a
              rectangle — which is the condition for dropping the word. The word
              stays as the tooltip and the accessible label (ADR-0042). */}
          {(
            [
              ['select', CursorIcon],
              // A hand, because a phone has neither a middle button nor a space
              // key — so on the device most likely to be used for drawing there
              // was no way to move the board at all.
              ['hand', HandIcon],
              ['pen', PencilIcon],
              ['text', TextIcon],
              ['rect', RectangleIcon],
              ['ellipse', EllipseIcon],
              ['line', LineIcon],
              ['erase', EraserIcon],
            ] as const
          ).map(([id, Mark]) => (
            <button
              key={id}
              type="button"
              className={tool === id ? 'canvas-tool mark current' : 'canvas-tool mark'}
              aria-pressed={tool === id}
              title={t(`canvas.tool.${id}` as 'canvas.tool.select')}
              aria-label={t(`canvas.tool.${id}` as 'canvas.tool.select')}
              onClick={() => setTool(id)}
            >
              <Mark />
            </button>
          ))}

          <button
            type="button"
            className="canvas-tool mark"
            onClick={pickImage}
            title={t('canvas.image')}
            aria-label={t('canvas.image')}
          >
            <ImageIcon />
          </button>

          {/* How the board is ruled. Beside the tools rather than in a settings
              panel: it is a property of this board that somebody changes while
              looking at it. */}
          <select
            className="canvas-ruling"
            aria-label={t('canvas.background')}
            value={background}
            onChange={(event) => setBackground(doc, event.target.value as CanvasBackground)}
          >
            {CANVAS_BACKGROUNDS.map((id) => (
              <option key={id} value={id}>
                {t(`canvas.background.${id}` as 'canvas.background.dots')}
              </option>
            ))}
          </select>

          {(tool === 'pen' || tool === 'rect' || tool === 'ellipse' || tool === 'line') && (
            <>
              {/* The workspace's own palette, not five colours invented here.
                *
                * They were five hex values that matched nothing: a board drawn
                * in them sat inside a workspace whose tags, columns and folder
                * icons used a palette somebody had chosen (ADR-0030). The
                * default is the text colour, so a stroke follows the theme
                * light or dark rather than being black on both. */}
              {['currentColor', ...THEME_COLORS].map((name) => {
                const value = name === 'currentColor' ? 'currentColor' : colorValue(name);
                return (
                  <button
                    key={name}
                    type="button"
                    className={
                      ink.colour === value ? 'canvas-ink-choice current' : 'canvas-ink-choice'
                    }
                    style={{ color: value }}
                    title={name === 'currentColor' ? t('canvas.colour.default') : name}
                    aria-label={name === 'currentColor' ? t('canvas.colour.default') : name}
                    aria-pressed={ink.colour === value}
                    onClick={() => setInk((current) => ({ ...current, colour: value ?? 'currentColor' }))}
                  />
                );
              })}

              {/* And any colour at all, for the one somebody has in mind that a
                  palette of eight does not contain. */}
              <input
                type="color"
                className="canvas-ink-custom"
                aria-label={t('canvas.colour.own')}
                title={t('canvas.colour.own')}
                onChange={(event) =>
                  setInk((current) => ({ ...current, colour: event.target.value }))
                }
              />
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

          <button
            type="button"
            className="canvas-tool"
            disabled={!history.canUndo}
            aria-label={t('canvas.undo')}
            title={t('canvas.undo')}
            onClick={history.undo}
          >
            <ArrowUturnIcon />
          </button>
          <button
            type="button"
            className="canvas-tool redo"
            disabled={!history.canRedo}
            aria-label={t('canvas.redo')}
            title={t('canvas.redo')}
            onClick={history.redo}
          >
            <ArrowUturnIcon />
          </button>

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
              onClick={() => {
                // Back to actual size *and* to the origin. Without scrollbars
                // there is nothing to say how far somebody has wandered, so the
                // one control that resets has to reset both.
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
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
        data-tool={space || tool === 'hand' ? 'pan' : tool}
        ref={surface}
        onPointerDown={onSurfaceDown}
        onPointerMove={onSurfaceMove}
        onPointerUp={onSurfaceUp}
        onPointerCancel={onSurfaceCancel}
        onWheel={onWheel}
        // The grid, moved with the board and spaced by the zoom — the plane has
        // no size to paint it on, and a grid that stays put makes a moving board
        // look still.
        data-ruling={background}
        style={{
          backgroundPosition: `${pan.x}px ${pan.y}px`,
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void onDrop(event)}
        data-busy={busy ? 'true' : undefined}
      >
        {/* One scaled plane, so zooming is a single transform and nothing else
            in here has to know about it. Scaled from its own origin, which is
            what keeps the arithmetic in `at` to one division. */}
        <div
          className="canvas-plane"
          // With a drawing tool in hand, nothing on the board catches the
          // press: a stroke started over a note went to the note instead of the
          // surface, so you could not draw across your own board.
          data-drawing={tool !== 'select' ? 'true' : undefined}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
        {/* Everything in one stack, in the order the document gives.
          *
          * It was two layers — every stroke in one SVG underneath, every note
          * and picture above it — which meant ink could never be in front of a
          * note however anybody ordered it, and "bring to front" moved an item
          * within a layer it could not leave. A stroke drawn over a picture
          * disappeared behind it.
          *
          * So each drawn item gets its own small SVG at its own box, and the
          * whole list is rendered in `z` order like any other stack. The cost is
          * one element per stroke instead of one for all of them, which is the
          * right trade: a board has tens of strokes, not thousands, and the
          * alternative is an ordering that only half works.
          */}
        {items.map((item) => {
          const box = boxOf(item);
          const pad = (item.width ?? 2) + 4;

          if (item.kind === 'path' || item.kind === 'rect' || item.kind === 'ellipse' || item.kind === 'line') {
            return (
              <svg
                key={item.id}
                className="canvas-drawn"
                style={{
                  left: box.x - pad,
                  top: box.y - pad,
                  width: box.w + pad * 2,
                  height: box.h + pad * 2,
                }}
                viewBox={`${box.x - pad} ${box.y - pad} ${box.w + pad * 2} ${box.h + pad * 2}`}
                aria-hidden="true"
              >
                {item.kind === 'path' && (
                  <path
                    transform={`translate(${item.x} ${item.y})`}
                    d={pathFrom(item.points ?? [])}
                    stroke={item.colour ?? 'currentColor'}
                    strokeWidth={item.width ?? 2}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {item.kind === 'line' && (
                  <line
                    x1={item.x}
                    y1={item.y}
                    x2={item.x + item.w}
                    y2={item.y + item.h}
                    stroke={item.colour ?? 'currentColor'}
                    strokeWidth={item.width ?? 2}
                    strokeLinecap="round"
                  />
                )}
                {item.kind === 'ellipse' && (
                  <ellipse
                    cx={item.x + item.w / 2}
                    cy={item.y + item.h / 2}
                    rx={Math.abs(item.w / 2)}
                    ry={Math.abs(item.h / 2)}
                    stroke={item.colour ?? 'currentColor'}
                    strokeWidth={item.width ?? 2}
                    fill={item.fill ?? 'none'}
                  />
                )}
                {item.kind === 'rect' && (
                  <rect
                    x={item.x}
                    y={item.y}
                    width={Math.abs(item.w)}
                    height={Math.abs(item.h)}
                    rx={4}
                    stroke={item.colour ?? 'currentColor'}
                    strokeWidth={item.width ?? 2}
                    fill={item.fill ?? 'none'}
                  />
                )}
              </svg>
            );
          }

          return (
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
                if (item.locked) {
                  // Selectable, so it can be unlocked; not draggable.
                  event.stopPropagation();
                  setSelected(item.id);
                  return;
                }
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
                  ref={(field) => {
                    if (field && typing === item.id) {
                      field.focus();
                      setTyping(null);
                    }
                  }}
                  defaultValue={item.text ?? ''}
                  readOnly={!canEdit}
                  aria-label={t('canvas.textItem')}
                  onChange={(event) => {
                    const entry = canvasMap(doc).get(item.id);
                    const text = entry?.get('text');
                    if (!text || typeof text !== 'object' || !('delete' in text)) return;
                    const shared = text as {
                      delete: (a: number, b: number) => void;
                      insert: (a: number, s: string) => void;
                      length: number;
                    };
                    doc.transact(() => {
                      shared.delete(0, shared.length);
                      shared.insert(0, event.target.value);
                    });
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                />
              )}

              {item.kind === 'image' && item.fileId && (
                <img
                  className="canvas-image"
                  src={`/api/files/${item.fileId}`}
                  alt=""
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                />
              )}

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
          );
        })}

        {/* What is being drawn right now, above everything: it is the thing the
            hand is doing, and hiding it behind a note would be the same fault
            this render fixed. */}
        <svg className="canvas-ink" viewBox="-10000 -10000 20000 20000" aria-hidden="true">
          {shape && shaping.current && tool === 'line' && (
            <line
              x1={shaping.current.from.x}
              y1={shaping.current.from.y}
              x2={shaping.current.to.x}
              y2={shaping.current.to.y}
              stroke={ink.colour}
              strokeWidth={ink.width}
              strokeLinecap="round"
              opacity={0.6}
            />
          )}
          {shape && tool === 'ellipse' && (
            <ellipse
              cx={shape.x + shape.w / 2}
              cy={shape.y + shape.h / 2}
              rx={shape.w / 2}
              ry={shape.h / 2}
              stroke={ink.colour}
              strokeWidth={ink.width}
              fill="none"
              opacity={0.6}
            />
          )}
          {shape && tool === 'rect' && (
            <rect
              x={shape.x}
              y={shape.y}
              width={shape.w}
              height={shape.h}
              rx={4}
              stroke={ink.colour}
              strokeWidth={ink.width}
              fill="none"
              opacity={0.6}
            />
          )}
          {drawing && (
            <path
              d={pathFrom(drawing)}
              stroke={ink.colour}
              strokeWidth={ink.width}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>

        {/* The handle for whatever is selected, wherever it is.
          *
          * In the plane, so it sits on the thing rather than near where the
          * thing used to be — and it is the only way to reach a stroke or a
          * shape, which have no element of their own to put controls on.
          *
          * The four are what somebody does to a thing once it exists rather than
          * while making it: copy it, pin it down, put it in front, remove it.
          * Moving is not among them because moving is dragging — a button that
          * says "move" and then waits for a drag is a button that explains a
          * gesture instead of being one.
          */}
        {/* A mark on every commented item (ADR-0046, ADR-0057).
          *
          * Outside the item and over its corner, because an item can be a
          * drawn shape with no element to put a badge inside. It is drawn for
          * everybody, not only an editor: reading a page is when somebody wants
          * to know a thing has been discussed.
          *
          * The internal ones are named in the label rather than shown in
          * another colour — the same rule as the panel, and for the same
          * reason: a colour is a convention nobody has learnt, and this is the
          * one distinction where being wrong is a disclosure. */}
        {[...(commented ?? new Map())].map(([itemId, counts]) => {
          const item = items.find((one) => one.id === itemId);
          if (!item) return null;
          const box = boxOf(item);
          return (
            <span
              key={`comment-${itemId}`}
              className="canvas-comment-mark"
              data-internal={counts.internal > 0 ? 'true' : undefined}
              style={{ left: box.x + box.w - 8, top: box.y - 8 }}
              title={
                counts.internal > 0
                  ? t('canvas.commentedInternal', {
                      count: counts.total,
                      internal: counts.internal,
                    })
                  : t('canvas.commented', { count: counts.total })
              }
              aria-label={
                counts.internal > 0
                  ? t('canvas.commentedInternal', {
                      count: counts.total,
                      internal: counts.internal,
                    })
                  : t('canvas.commented', { count: counts.total })
              }
            >
              {counts.total}
            </span>
          );
        })}

        {canEdit && selectedItem && (
          <div
            className="canvas-handle"
            style={{
              left: handleBox.x,
              top: handleBox.y - 40 / zoom,
              // Drawn at its own size whatever the zoom: a control that shrinks
              // with the board becomes unusable at the size somebody zooms out
              // to in order to see the whole board.
              transform: `scale(${1 / zoom})`,
              transformOrigin: '0 100%',
            }}
            role="toolbar"
            aria-label={t('canvas.handle')}
            // The press must not reach the surface underneath.
            //
            // It did, and the surface clears the selection on a press against
            // the empty plane — so the handle unmounted between `pointerdown`
            // and `click`, and the click landed on nothing. The buttons looked
            // dead; they were never reached.
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="canvas-handle-action"
              title={t('canvas.duplicate')}
              aria-label={t('canvas.duplicate')}
              onClick={() => duplicateItem(doc, selectedItem.id, newId())}
            >
              <DuplicateIcon />
            </button>
            {/* Comment on this item (ADR-0046).
              *
              * In the item's own menu, because that is where the question "what
              * about this one" is asked. The anchor is the item's id — no
              * position, no mapping, no quotation needed to survive a rewrite:
              * the item exists or it does not. */}
            <button
              type="button"
              className="canvas-handle-action"
              title={t('canvas.comment')}
              aria-label={t('canvas.comment')}
              onClick={() => onCommentItem(selectedItem.id)}
            >
              <MessageIcon />
            </button>
            <button
              type="button"
              className={
                selectedItem.locked ? 'canvas-handle-action current' : 'canvas-handle-action'
              }
              aria-pressed={selectedItem.locked === true}
              title={selectedItem.locked ? t('canvas.unlock') : t('canvas.lock')}
              aria-label={selectedItem.locked ? t('canvas.unlock') : t('canvas.lock')}
              onClick={() => lockItem(doc, selectedItem.id, !selectedItem.locked)}
            >
              <LockIcon />
            </button>
            <button
              type="button"
              className="canvas-handle-action"
              title={t('canvas.toFront')}
              aria-label={t('canvas.toFront')}
              onClick={() => bringToFront(doc, selectedItem.id)}
            >
              <ArrowUpIcon />
            </button>
            <button
              type="button"
              className="canvas-handle-action destructive"
              title={t('canvas.remove')}
              aria-label={t('canvas.remove')}
              onClick={() => {
                removeItem(doc, selectedItem.id);
                setSelected(null);
              }}
            >
              <TrashIcon />
            </button>
          </div>
        )}

        {/* An outline around a selected stroke or shape, which have no element
            of their own to carry one. */}
        {selectedItem && (selectedItem.kind === 'path' || selectedItem.kind === 'rect' ||
          selectedItem.kind === 'ellipse' || selectedItem.kind === 'line') && (
          <div
            className="canvas-outline"
            style={{
              left: handleBox.x,
              top: handleBox.y,
              width: handleBox.w,
              height: handleBox.h,
            }}
            aria-hidden="true"
          />
        )}

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
