/** Result cards: seed, per-structure coordinates and distances, mini map. */

import { biomeById, biomeName } from '../data/biomes';
import { STRUCT, structureName } from '../data/structures';
import { distance } from '../search/criteria';
import { targetOf as targetFor } from '../search/score';
import { KIND, type Match, type MatchHit } from '../search/types';

const DIM_COLORS: Record<number, string> = {
  0: '#5ac36a',
  [-1]: '#e08a72',
  1: '#c9a4e8',
};
const BIOME_COLOR = '#63b3ed';



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

  ctx.fillStyle = '#0a0e13';
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();

  // axes
  ctx.strokeStyle = '#1a2029';
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
    ctx.strokeStyle = '#1e2732';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = '#2f3d4d';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, extent * scale, 0, Math.PI * 2);
  ctx.stroke();

  // ring labels on the north axis
  ctx.fillStyle = '#4b5765';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const r of [...inner, extent]) {
    ctx.fillText(`${r}`, cx + 4, cy - r * scale - 7);
  }

  // target point
  ctx.fillStyle = '#e6edf3';
  ctx.beginPath();
  ctx.arc(cx, cy, size < 400 ? 3.5 : 5, 0, Math.PI * 2);
  ctx.fill();

  const dot = size < 400 ? 5 : 7;
  const plotted: Plotted[] = [];
  for (const hit of m.hits) {
    const t = targetFor(hit, m);
    const px = cx + (hit.x - t.x) * scale;
    const pz = cy + (hit.z - t.z) * scale;
    const color = hit.kind === KIND.biome ? BIOME_COLOR : (DIM_COLORS[hit.dim] ?? '#5ac36a');

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, pz, dot, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0a0e13';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (size >= 400) {
      ctx.fillStyle = '#93a1b1';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(hitLabel(hit), px, pz - dot - 3);
    }

    plotted.push({ hit, px, pz });
  }

  ctx.restore();

  // Compass sits outside the clipped area so panning never moves it.
  ctx.fillStyle = '#6f7c8b';
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

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    const next = Math.min(20, Math.max(0.5, view.zoom * factor));
    // Zoom about the cursor rather than the centre, so what you point at
    // stays where it is.
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left - (view.size / 2 + view.panX);
    const my = ev.clientY - rect.top - (view.size / 2 + view.panY);
    const ratio = next / view.zoom;
    view.panX -= mx * (ratio - 1);
    view.panY -= my * (ratio - 1);
    view.zoom = next;
    redraw();
  }, { passive: false });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('mousedown', (ev) => {
    dragging = true;
    lastX = ev.clientX;
    lastY = ev.clientY;
    canvas.classList.add('grabbing');
  });
  // Dragging is tracked on the window so the pan keeps up when the pointer
  // leaves the canvas, which means these have to be torn down on close.
  const onMove = (ev: MouseEvent): void => {
    if (!dragging) return;
    view.panX += ev.clientX - lastX;
    view.panY += ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    redraw();
  };
  const onUp = (): void => {
    dragging = false;
    canvas.classList.remove('grabbing');
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  const shut = (): void => {
    overlay.remove();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', redraw);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
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
  overlay.addEventListener('mousedown', (ev) => {
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
  const plotted = drawMap(canvas, m, radii, { size: MAP_SIZE, zoom: 1, panX: 0, panY: 0 });

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
