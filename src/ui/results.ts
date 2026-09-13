/** Result cards: seed, per-structure coordinates and distances, mini map. */

import { biomeById, biomeName } from '../data/biomes';
import { STRUCT, structureName } from '../data/structures';
import { distance } from '../search/criteria';
import { KIND, type Match, type MatchHit } from '../search/types';

const DIM_COLORS: Record<number, string> = {
  0: '#5ac36a',
  [-1]: '#e08a72',
  1: '#c9a4e8',
};
const BIOME_COLOR = '#63b3ed';

function targetFor(hit: MatchHit, m: Match): { x: number; z: number } {
  // Nether structures are filtered against the Nether-side target point.
  return hit.dim === -1
    ? { x: Math.trunc(m.spawnX / 8), z: Math.trunc(m.spawnZ / 8) }
    : { x: m.spawnX, z: m.spawnZ };
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

/**
 * Draws the preview map: the radius ring, compass labels, the target point and
 * every hit. Returns the on-screen positions so the caller can hit-test hovers.
 */
function drawMap(canvas: HTMLCanvasElement, m: Match, radii: readonly number[]): Plotted[] {
  const radius = Math.max(...radii);
  const dpr = 2;
  const size = MAP_SIZE;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.scale(dpr, dpr);

  const c = size / 2;
  // Leave a margin so the compass labels are not clipped by the edge.
  const margin = 18;
  const scale = (size / 2 - margin) / radius;

  ctx.fillStyle = '#0a0e13';
  ctx.fillRect(0, 0, size, size);

  // axes
  ctx.strokeStyle = '#1a2029';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(c, margin * 0.5);
  ctx.lineTo(c, size - margin * 0.5);
  ctx.moveTo(margin * 0.5, c);
  ctx.lineTo(size - margin * 0.5, c);
  ctx.stroke();

  // One ring per distinct criterion radius, so a search with different
  // per-structure distances does not look like it shares a single limit.
  const rings = [...new Set(radii)].sort((a, b) => a - b);
  for (const r of rings) {
    const outer = r === radius;
    ctx.strokeStyle = outer ? '#2f3d4d' : '#1e2732';
    ctx.lineWidth = outer ? 1.5 : 1;
    if (!outer) ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(c, c, r * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // compass labels. In Minecraft, north is -Z and east is +X, which is the
  // same orientation this map is drawn in.
  ctx.fillStyle = '#6f7c8b';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', c, 8);
  ctx.fillText('S', c, size - 8);
  ctx.fillText('W', 8, c);
  ctx.fillText('E', size - 8, c);

  // Label each ring on the north axis.
  ctx.fillStyle = '#4b5765';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  for (const r of rings) {
    ctx.fillText(`${r}`, c + 4, c - r * scale - 7);
  }

  // target point
  ctx.fillStyle = '#e6edf3';
  ctx.beginPath();
  ctx.arc(c, c, 3.5, 0, Math.PI * 2);
  ctx.fill();

  const plotted: Plotted[] = [];
  for (const hit of m.hits) {
    const t = targetFor(hit, m);
    const px = c + (hit.x - t.x) * scale;
    const pz = c + (hit.z - t.z) * scale;
    const color = hit.kind === KIND.biome ? BIOME_COLOR : (DIM_COLORS[hit.dim] ?? '#5ac36a');

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, pz, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0a0e13';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    plotted.push({ hit, px, pz });
  }
  return plotted;
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
  const plotted = drawMap(canvas, m, radii);

  const tip = document.createElement('div');
  tip.className = 'map-tip';
  tip.hidden = true;

  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const near = plotted.find((p) => Math.hypot(p.px - mx, p.pz - my) <= 9);
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

  mapWrap.append(canvas, tip);
  card.append(left, mapWrap);
  return card;
}
