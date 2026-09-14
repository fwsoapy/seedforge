/**
 * Search worker. One instance per CPU thread; each one owns its own WASM
 * instance and scans a disjoint stripe of the seed space.
 *
 * The worker yields to the event loop between blocks so a `stop` message can
 * actually be delivered mid-search.
 */

import { SearchEngine } from './search/engine';
import type { Criterion, SearchConfig, WorkerIn, WorkerOut } from './search/types';

/**
 * Seeds per sf_run() call, re-tuned at runtime to keep blocks short.
 *
 * The floor matters: a search measuring from world spawn costs several
 * milliseconds per seed, so a 256-seed floor meant a block took a second or
 * more and progress only moved that often. Four seeds is small enough that
 * even the slowest search reports several times a second.
 */
const TARGET_BLOCK_MS = 100;
const MIN_BLOCK = 4;
const MAX_BLOCK = 1 << 16;

/**
 * Seed space is cut into fixed stripes handed out round-robin to the lanes.
 * Fixed stripes mean the adaptive block size can change freely without lanes
 * ever overlapping or skipping seeds.
 */
const STRIPE = 1n << 24n;

let engine: SearchEngine | null = null;
let running = false;
let generation = 0;

function post(msg: WorkerOut): void {
  self.postMessage(msg);
}

async function ensureEngine(): Promise<SearchEngine> {
  engine ??= await SearchEngine.create();
  return engine;
}

const yieldToLoop = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function search(config: SearchConfig, lane: number, lanes: number, gen: number): Promise<void> {
  const eng = await ensureEngine();
  const criteria: Criterion[] = config.criteria;
  eng.configure(config.mc, config.target, criteria, config.rules);

  let block = 64;
  let scanned = 0;
  let stage2 = 0;
  let matchCount = 0;

  let stripe = BigInt(lane);
  let cursor = 0n;
  const stride = BigInt(lanes);

  while (running && gen === generation) {
    if (config.seedLimit > 0n && BigInt(scanned) * stride >= config.seedLimit) break;

    const remaining = STRIPE - cursor;
    const thisBlock = Number(remaining < BigInt(block) ? remaining : BigInt(block));
    const start = config.startSeed + stripe * STRIPE + cursor;

    const t0 = performance.now();
    const res = eng.run(start, thisBlock, criteria);
    const dt = performance.now() - t0;

    scanned += res.scanned;
    stage2 += res.stage2;

    if (res.matches.length > 0) {
      matchCount += res.matches.length;
      post({ type: 'matches', matches: res.matches, scanned, stage2 });
    } else {
      post({ type: 'progress', scanned, stage2 });
    }

    if (config.matchLimit > 0 && matchCount >= config.matchLimit) break;

    // sf_run() also stops early once its output buffer is full, so advance by
    // what was actually scanned rather than by the requested block size.
    cursor += BigInt(res.scanned);
    if (cursor >= STRIPE) {
      stripe += stride;
      cursor = 0n;
    }

    // Aim straight at the target rather than doubling or halving, so the
    // block size settles within a couple of rounds instead of a dozen. The
    // per-round change is clamped to 4x so one slow block cannot collapse it.
    if (dt > 0) {
      const scale = Math.min(4, Math.max(0.25, TARGET_BLOCK_MS / dt));
      block = Math.round(block * scale);
    }
    block = Math.min(MAX_BLOCK, Math.max(MIN_BLOCK, block));

    await yieldToLoop();
  }

  running = false;
  post({ type: 'done', scanned });
}

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (msg.type === 'stop') {
    running = false;
    generation++;
    return;
  }
  if (msg.type === 'start') {
    generation++;
    const gen = generation;
    running = true;
    search(msg.config, msg.lane, msg.lanes, gen).catch((err: unknown) => {
      running = false;
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    });
  }
};

post({ type: 'ready' });
