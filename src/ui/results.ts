/** Result cards: seed, per-structure coordinates and distances, mini map. */

import { biomeById, biomeName } from '../data/biomes';
import { STRUCT, structureName } from '../data/structures';
import { distance } from '../search/criteria';
import { targetOf as targetFor } from '../search/score';
import { KIND, type Match, type MatchHit } from '../search/types';

/**
 * Canvas colours, read off the root element so the map follows the theme.
 *
 * Resolved once per draw rather than per shape: getComputedStyle forces a
 * style recalc, and the map redraws on every pan and zoom frame.
 */
interface Palette {
  readonly bg: string;
  readonly axis: string;
  readonly grid: string;
  readonly ring: string;
  readonly ringLabel: string;
  readonly centre: string;
  readonly label: string;
  readonly scale: string;
  readonly biome: string;
  readonly dim: Record<number, string>;
}

/**
 * Card maps.
 *
 * Two jobs. Canvas pixels are not styled by CSS, so a theme change has to
 * repaint them. And drawing one is expensive: during a search the list is
 * rebuilt several times a second, and at a few hundred matches redrawing every
 * map on every rebuild froze the page for over a second at a time. So a map is
 * drawn only once it scrolls into view, which in practice means a handful
 * rather than the whole list.
 */
interface CardMap {
  canvas: HTMLCanvasElement;
  paint: () => void;
  painted: boolean;
}

const cardMaps = new Set<CardMap>();
const mapOf = new WeakMap<Element, CardMap>();

/** Undefined where IntersectionObserver is missing, e.g. under a test runner. */
const mapWatcher =
  typeof IntersectionObserver === 'undefined'
    ? undefined
    : new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            const card = mapOf.get(e.target);
            if (card && !card.painted) {
              card.paint();
              card.painted = true;
            }
          }
        },
        // Start drawing slightly before a card reaches the viewport, so
        // scrolling does not reveal a blank square.
        { rootMargin: '300px' },
      );

function watchMap(card: CardMap): void {
  cardMaps.add(card);
  if (!mapWatcher) {
    card.paint();
    card.painted = true;
    return;
  }
  mapOf.set(card.canvas, card);
  mapWatcher.observe(card.canvas);
}

/** Repaints the card maps that have actually been drawn. */
export function repaintMaps(): void {
  for (const entry of [...cardMaps]) {
    if (!entry.canvas.isConnected) forget(entry);
    else if (entry.painted) entry.paint();
  }
}

/**
 * Drops entries whose canvas has left the document.
 *
 * The result list is rebuilt wholesale several times a second during a search,
 * so without this the registry grows by a full listful every time and keeps
 * every detached canvas alive with it.
 */
export function pruneMaps(): void {
  for (const entry of [...cardMaps]) {
    if (!entry.canvas.isConnected) forget(entry);
  }
}

function forget(entry: CardMap): void {
  cardMaps.delete(entry);
  mapWatcher?.unobserve(entry.canvas);
  mapOf.delete(entry.canvas);
}

function palette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--map-bg', '#0a0e13'),
    axis: v('--map-axis', '#1a2029'),
    grid: v('--map-grid', '#1e2732'),
    ring: v('--map-ring', '#2f3d4d'),
    ringLabel: v('--map-ring-label', '#4b5765'),
    centre: v('--text', '#e6edf3'),
    label: v('--muted', '#93a1b1'),
    scale: v('--faint', '#6f7c8b'),
    biome: v('--biome-dot', '#63b3ed'),
    dim: {
      0: v('--accent', '#5ac36a'),
      [-1]: v('--nether', '#e08a72'),
      1: v('--end', '#c9a4e8'),
    },
  };
}



function hitLabel(hit: MatchHit): string {
  if (hit.kind === KIND.biome) return biomeById(hit.id)?.name ?? `Biome #${hit.id}`;
  if (hit.id === STRUCT.Village && hit.biome >= 0) {
    const b = biomeName(hit.biome);
    if (b) return `${b} village`;
  }
  return structureName(hit.id);
}

const MAP_SIZE = 300; // CSS pixels; the canvas is drawn at 2x for sharpness

interface Plotted {
  hit: MatchHit;
  px: number;
  pz: number;
}

/** How the map is currently being looked at. */
interface MapView {
  size: number;
  zoom: number;
  panX: number;
  panY: number;
}

/**
 * How far out the map should reach, in blocks.
 *
 * This follows the structures rather than the search radius. Asking for
 * something within 1000 blocks and finding it all inside 300 used to draw a
 * 1000 block circle with everything huddled in the middle, which wastes the
 * whole picture. Instead the furthest hit gets 100 blocks of breathing room
 * and the result is rounded up to a whole hundred, so four structures inside
 * 400 blocks give a 500 block map.
 */
export function mapExtent(m: Match): number {
  let furthest = 0;
  for (const hit of m.hits) {
    const t = targetFor(hit, m);
    const d = Math.hypot(hit.x - t.x, hit.z - t.z);
    if (d > furthest) furthest = d;
  }
  return Math.max(100, Math.ceil((furthest + 100) / 100) * 100);
}

/**
 * Draws the preview map: distance rings, compass labels, the target point and
 * every hit. Returns on-screen positions so the caller can hit-test hovers.
 */
function drawMap(
  canvas: HTMLCanvasElement,
  m: Match,
  radii: readonly number[],
  view: MapView,
): Plotted[] {
  const extent = mapExtent(m);
  const dpr = 2;
  const size = view.size;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const margin = size < 400 ? 18 : 26;
  const scale = ((size / 2 - margin) / extent) * view.zoom;
  const cx = size / 2 + view.panX;
  const cy = size / 2 + view.panY;
  const pal = palette();

  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();

  // axes
  ctx.strokeStyle = pal.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, size);
  ctx.moveTo(0, cy);
  ctx.lineTo(size, cy);
  ctx.stroke();

  // Rings: the map extent, plus any search radius that fits inside it so the
  // limits you set are still visible when they are relevant.
  const inner = [...new Set(radii)].filter((r) => r < extent).sort((a, b) => a - b);
  for (const r of inner) {
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = pal.ring;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, extent * scale, 0, Math.PI * 2);
  ctx.stroke();

  // ring labels on the north axis
  ctx.fillStyle = pal.ringLabel;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const r of [...inner, extent]) {
    ctx.fillText(`${r}`, cx + 4, cy - r * scale - 7);
  }

  // target point
  ctx.fillStyle = pal.centre;
  ctx.beginPath();
  ctx.arc(cx, cy, size < 400 ? 3.5 : 5, 0, Math.PI * 2);
  ctx.fill();

  const dot = size < 400 ? 5 : 7;
  const plotted: Plotted[] = [];
  for (const hit of m.hits) {
    const t = targetFor(hit, m);
    const px = cx + (hit.x - t.x) * scale;
    const pz = cy + (hit.z - t.z) * scale;
    const color = hit.kind === KIND.biome ? pal.biome : (pal.dim[hit.dim] ?? pal.dim[0]!);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, pz, dot, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = pal.bg;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (size >= 400) {
      ctx.fillStyle = pal.label;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(hitLabel(hit), px, pz - dot - 3);
    }

    plotted.push({ hit, px, pz });
  }

  ctx.restore();

  // Compass sits outside the clipped area so panning never moves it.
  ctx.fillStyle = pal.scale;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', size / 2, 8);
  ctx.fillText('S', size / 2, size - 8);
  ctx.fillText('W', 8, size / 2);
  ctx.fillText('E', size - 8, size / 2);

  return plotted;
}

/** Wires hover tooltips onto a canvas for a given set of plotted points. */
function attachTooltip(
  canvas: HTMLCanvasElement,
  tip: HTMLElement,
  m: Match,
  getPlotted: () => Plotted[],
): void {
  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const near = getPlotted().find((p) => Math.hypot(p.px - mx, p.pz - my) <= 10);
    if (!near) {
      tip.hidden = true;
      return;
    }
    const t = targetFor(near.hit, m);
    tip.textContent = `${hitLabel(near.hit)} - ${near.hit.x}, ${near.hit.z} (${distance(
      near.hit.x, near.hit.z, t.x, t.z,
    )} blocks)`;
    tip.hidden = false;
    tip.style.left = `${near.px}px`;
    tip.style.top = `${near.pz - 12}px`;
  });
  canvas.addEventListener('mouseleave', () => {
    tip.hidden = true;
  });
}

/** Opens the full-size map, with scroll to zoom and drag to pan. */
function openLargeMap(m: Match, radii: readonly number[]): void {
  const view: MapView = { size: 0, zoom: 1, panX: 0, panY: 0 };
  let plotted: Plotted[] = [];

  const overlay = document.createElement('div');
  overlay.className = 'map-overlay';

  const panel = document.createElement('div');
  panel.className = 'map-panel';

  const bar = document.createElement('div');
  bar.className = 'map-bar';

  const title = document.createElement('span');
  title.className = 'map-title';
  title.textContent = BigInt.asIntN(64, m.seed).toString();

  const hint = document.createElement('span');
  hint.className = 'map-hint';
  hint.textContent = 'scroll to zoom, drag to pan';

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'secondary small';
  reset.textContent = 'Reset';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'secondary small';
  close.textContent = 'Close';

  bar.append(title, hint, reset, close);

  const stage = document.createElement('div');
  stage.className = 'map-stage';

  const canvas = document.createElement('canvas');
  canvas.className = 'map map-large';

  const tip = document.createElement('div');
  tip.className = 'map-tip';
  tip.hidden = true;

  stage.append(canvas, tip);
  panel.append(bar, stage);
  overlay.append(panel);
  document.body.append(overlay);

  const redraw = (): void => {
    const box = Math.min(stage.clientWidth, stage.clientHeight);
    view.size = Math.max(280, box);
    plotted = drawMap(canvas, m, radii, view);
  };

  attachTooltip(canvas, tip, m, () => plotted);

  /** Scales about a viewport point, so whatever is under it stays put. */
  const zoomAbout = (next: number, clientX: number, clientY: number): void => {
    const clamped = Math.min(20, Math.max(0.5, next));
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left - (view.size / 2 + view.panX);
    const my = clientY - rect.top - (view.size / 2 + view.panY);
    const ratio = clamped / view.zoom;
    view.panX -= mx * (ratio - 1);
    view.panY -= my * (ratio - 1);
    view.zoom = clamped;
  };

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    zoomAbout(view.zoom * (ev.deltaY < 0 ? 1.15 : 1 / 1.15), ev.clientX, ev.clientY);
    redraw();
  }, { passive: false });

  /**
   * Pan and pinch.
   *
   * Pointer events cover mouse, touch and pen with one set of handlers. Live
   * pointers are tracked by id so a second finger turns the drag into a pinch
   * and lifting it goes back to a one-finger pan without a jump.
   */
  const active = new Map<number, { x: number; y: number }>();
  let lastX = 0;
  let lastY = 0;
  let pinchDist = 0;

  const centreOf = (): { x: number; y: number } => {
    let sx = 0;
    let sy = 0;
    for (const p of active.values()) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / active.size, y: sy / active.size };
  };

  const spreadOf = (): number => {
    const [a, b] = [...active.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  canvas.addEventListener('pointerdown', (ev) => {
    active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    canvas.setPointerCapture(ev.pointerId);
    const c = centreOf();
    lastX = c.x;
    lastY = c.y;
    pinchDist = spreadOf();
    canvas.classList.add('grabbing');
  });

  const onMove = (ev: PointerEvent): void => {
    if (!active.has(ev.pointerId)) return;
    active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    const c = centreOf();
    if (active.size >= 2) {
      const spread = spreadOf();
      if (pinchDist > 0 && spread > 0) zoomAbout(view.zoom * (spread / pinchDist), c.x, c.y);
      pinchDist = spread;
    }
    view.panX += c.x - lastX;
    view.panY += c.y - lastY;
    lastX = c.x;
    lastY = c.y;
    redraw();
  };

  const onUp = (ev: PointerEvent): void => {
    if (!active.delete(ev.pointerId)) return;
    if (active.size > 0) {
      // Re-anchor on the remaining pointers so the view does not jump.
      const c = centreOf();
      lastX = c.x;
      lastY = c.y;
      pinchDist = spreadOf();
    } else {
      pinchDist = 0;
      canvas.classList.remove('grabbing');
    }
  };

  // Tracked on the window so a pan keeps up when the pointer leaves the
  // canvas, which means these have to be torn down on close.
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  const shut = (): void => {
    overlay.remove();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', redraw);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
  function onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') shut();
  }

  reset.addEventListener('click', () => {
    view.zoom = 1;
    view.panX = 0;
    view.panY = 0;
    redraw();
  });
  close.addEventListener('click', shut);
  overlay.addEventListener('pointerdown', (ev) => {
    if (ev.target === overlay) shut();
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', redraw);

  redraw();
}

export function renderResult(m: Match, radii: readonly number[]): HTMLElement {
  const card = document.createElement('article');
  card.className = 'result';

  const left = document.createElement('div');

  const head = document.createElement('div');
  head.className = 'result-head';

  const seed = document.createElement('span');
  seed.className = 'seed';
  seed.textContent = BigInt.asIntN(64, m.seed).toString();

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'copy';
  copy.textContent = 'Copy';
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(seed.textContent ?? '').then(() => {
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy'), 1200);
    });
  });

  const spawn = document.createElement('span');
  spawn.className = 'spawn';
  spawn.textContent = `spawn ${m.spawnX}, ${m.spawnZ}`;

  head.append(seed, copy, spawn);
  left.append(head);

  const list = document.createElement('ul');
  list.className = 'hits';
  for (const hit of m.hits) {
    const t = targetFor(hit, m);
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = hitLabel(hit);

    const coords = document.createElement('span');
    coords.className = 'coords';
    coords.textContent = `${hit.x}, ${hit.z}`;

    const dist = document.createElement('span');
    dist.className = 'dist';
    dist.textContent = `${distance(hit.x, hit.z, t.x, t.z)} blocks`;

    li.append(name, coords, dist);
    list.append(li);
  }
  left.append(list);

  const mapWrap = document.createElement('div');
  mapWrap.className = 'map-wrap';

  const canvas = document.createElement('canvas');
  canvas.className = 'map';
  let plotted: Plotted[] = [];
  const paint = (): void => {
    plotted = drawMap(canvas, m, radii, { size: MAP_SIZE, zoom: 1, panX: 0, panY: 0 });
  };
  // Sized up front so the card does not resize when its map is drawn.
  canvas.width = MAP_SIZE;
  canvas.height = MAP_SIZE;
  canvas.style.width = `${MAP_SIZE}px`;
  canvas.style.height = `${MAP_SIZE}px`;
  watchMap({ canvas, paint, painted: false });

  const tip = document.createElement('div');
  tip.className = 'map-tip';
  tip.hidden = true;

  attachTooltip(canvas, tip, m, () => plotted);

  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'map-expand';
  expand.title = 'Enlarge this map';
  expand.textContent = 'Enlarge';
  expand.addEventListener('click', () => openLargeMap(m, radii));

  canvas.addEventListener('dblclick', () => openLargeMap(m, radii));

  mapWrap.append(canvas, tip, expand);
  card.append(left, mapWrap);
  return card;
}
