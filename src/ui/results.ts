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

function drawMap(canvas: HTMLCanvasElement, m: Match, radius: number): void {
  const size = 360;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const cx = size / 2;
  const scale = size / 2 / (radius * 1.15);

  ctx.fillStyle = '#0a0e13';
  ctx.fillRect(0, 0, size, size);

  // radius ring
  ctx.strokeStyle = '#26303d';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cx, radius * scale, 0, Math.PI * 2);
  ctx.stroke();

  // axes
  ctx.strokeStyle = '#1a2029';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, size);
  ctx.moveTo(0, cx);
  ctx.lineTo(size, cx);
  ctx.stroke();

  // target point
  ctx.fillStyle = '#e6edf3';
  ctx.beginPath();
  ctx.arc(cx, cx, 4, 0, Math.PI * 2);
  ctx.fill();

  for (const hit of m.hits) {
    const t = targetFor(hit, m);
    const px = cx + (hit.x - t.x) * scale;
    const pz = cx + (hit.z - t.z) * scale;
    ctx.fillStyle = hit.kind === KIND.biome ? BIOME_COLOR : (DIM_COLORS[hit.dim] ?? '#5ac36a');
    ctx.beginPath();
    ctx.arc(px, pz, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function renderResult(m: Match, radius: number): HTMLElement {
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

  const canvas = document.createElement('canvas');
  canvas.className = 'map';
  drawMap(canvas, m, radius);

  card.append(left, canvas);
  return card;
}
