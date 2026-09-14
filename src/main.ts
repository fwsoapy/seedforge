/**
 * App entry point: wires the form, the worker pool and the results list.
 *
 * A WASM instance is created on the main thread purely for metadata
 * (which structures exist in which version); all actual searching happens in
 * workers so the UI never blocks.
 */

import { DEFAULT_VERSION, MC_VERSIONS, versionNote } from './data/versions';
import { SearchEngine } from './search/engine';
import { SearchPool, suggestedWorkerCount } from './search/pool';
import { KIND, type CriterionKind, type Match, type SearchConfig, type TargetMode } from './search/types';
import { CriterionPicker } from './ui/picker';
import { renderResult } from './ui/results';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const versionSel = $<HTMLSelectElement>('version');
const versionNoteEl = $<HTMLElement>('version-note');
const targetSel = $<HTMLSelectElement>('target');
const startSeedInput = $<HTMLInputElement>('start-seed');
const matchLimitInput = $<HTMLInputElement>('match-limit');
const threadsInput = $<HTMLInputElement>('threads');
const searchBtn = $<HTMLButtonElement>('search');
const stopBtn = $<HTMLButtonElement>('stop');
const clearBtn = $<HTMLButtonElement>('clear');
const errorEl = $<HTMLParagraphElement>('error');
const progressPanel = $<HTMLElement>('progress-panel');
const resultsEl = $<HTMLElement>('results');
const emptyEl = $<HTMLElement>('empty');
const statScanned = $<HTMLElement>('stat-scanned');
const statMatches = $<HTMLElement>('stat-matches');
const statRate = $<HTMLElement>('stat-rate');
const statThreads = $<HTMLElement>('stat-threads');
const hintEl = $<HTMLElement>('slow-hint');
const statusEl = $<HTMLElement>('status');
const barEl = $<HTMLElement>('bar');

const nf = new Intl.NumberFormat();

let meta: SearchEngine | null = null;
let pool: SearchPool | null = null;
let startedAt = 0;
let lastRadii: number[] = [500];

/** Seeds to scan with no match before suggesting the filters are too tight. */
const SLOW_HINT_AFTER = 2_000_000;

let lastScanned = 0;
let lastMatches = 0;
let stopRequested = false;

function showError(message: string | null): void {
  errorEl.hidden = message === null;
  errorEl.textContent = message ?? '';
}

function randomSeed(): bigint {
  // Structure placement only uses the low 48 bits, so that is the space we
  // draw a random starting point from.
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return ((BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]!)) & ((1n << 48n) - 1n);
}

function parseStartSeed(): bigint {
  const raw = startSeedInput.value.trim();
  if (raw === '') return randomSeed();
  try {
    return BigInt.asUintN(64, BigInt(raw));
  } catch {
    throw new Error('Start seed must be a whole number.');
  }
}

function buildConfig(picker: CriterionPicker): SearchConfig {
  const criteria = picker.criteria();
  if (criteria.length === 0) throw new Error('Pick at least one structure or biome to search for.');
  for (const c of criteria) {
    if (!Number.isFinite(c.radius) || c.radius < 1) {
      throw new Error('Every criterion needs a distance of at least 1 block.');
    }
  }

  const matchLimit = Math.max(1, Number(matchLimitInput.value) || 20);

  return {
    mc: Number(versionSel.value),
    target: Number(targetSel.value) as TargetMode,
    criteria,
    rules: picker.proximityRules(),
    startSeed: parseStartSeed(),
    seedLimit: 0n,
    matchLimit,
  };
}

function setRunning(running: boolean): void {
  searchBtn.disabled = running;
  stopBtn.disabled = !running;
  searchBtn.textContent = running ? 'Searching...' : 'Search seeds';
  // The animated bar is the "still working" signal - it has to stop when the
  // search does, otherwise a finished search looks like a hung one.
  barEl.hidden = !running;
  if (running) progressPanel.hidden = false;
}

/** Final line under the stats: what the search actually ended up doing. */
function reportDone(matches: number, scanned: number, limit: number, stopped: boolean): void {
  const seeds = `${nf.format(scanned)} seed${scanned === 1 ? '' : 's'}`;
  if (matches === 0) {
    statusEl.textContent = stopped
      ? `Stopped after ${seeds}. No matches yet - try a larger radius or fewer criteria.`
      : `No matches in ${seeds}. Try a larger radius or fewer criteria.`;
    statusEl.className = 'status warn';
    return;
  }
  const found = `Found ${nf.format(matches)} seed${matches === 1 ? '' : 's'} in ${seeds}`;
  statusEl.textContent =
    !stopped && limit > 0 && matches >= limit
      ? `${found}. That is the ${nf.format(limit)}-match limit - raise it under Advanced for more.`
      : `${found}.`;
  statusEl.className = 'status done';
}

function addMatches(matches: Match[]): void {
  emptyEl.hidden = true;
  for (const m of matches) resultsEl.append(renderResult(m, lastRadii));
}

async function main(): Promise<void> {
  for (const v of MC_VERSIONS) {
    const o = document.createElement('option');
    o.value = String(v.id);
    o.textContent = v.label;
    o.selected = v.id === DEFAULT_VERSION;
    versionSel.append(o);
  }
  threadsInput.value = String(suggestedWorkerCount());
  statThreads.textContent = threadsInput.value;

  searchBtn.disabled = true;
  searchBtn.textContent = 'Loading engine...';

  try {
    meta = await SearchEngine.create();
  } catch (err) {
    showError(
      `Could not load the search engine: ${err instanceof Error ? err.message : String(err)}`,
    );
    searchBtn.textContent = 'Search seeds';
    return;
  }

  searchBtn.disabled = false;
  searchBtn.textContent = 'Search seeds';

  const picker = new CriterionPicker(
    $<HTMLElement>('structure-list'),
    $<HTMLElement>('biome-list'),
    $<HTMLElement>('selected-list'),
    $<HTMLElement>('selected-count'),
    $<HTMLElement>('rules-list'),
    $<HTMLButtonElement>('add-rule'),
    (kind: CriterionKind, id: number) => {
      const mc = Number(versionSel.value);
      return kind === KIND.biome ? meta!.supportsBiome(id, mc) : meta!.supports(id, mc);
    },
    () => showError(null),
  );
  picker.render();

  const showVersionNote = (): void => {
    const note = versionNote(Number(versionSel.value));
    versionNoteEl.textContent = note ?? '';
    versionNoteEl.hidden = note === null;
  };
  showVersionNote();

  versionSel.addEventListener('change', () => {
    picker.render();
    showVersionNote();
  });

  searchBtn.addEventListener('click', () => {
    showError(null);
    let config: SearchConfig;
    try {
      config = buildConfig(picker);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
      return;
    }

    lastRadii = config.criteria.map((c) => c.radius);
    startedAt = performance.now();
    statScanned.textContent = '0';
    statMatches.textContent = '0';
    statRate.textContent = '0';
    statusEl.textContent = '';
    statusEl.className = 'status';
    lastScanned = 0;
    lastMatches = 0;
    stopRequested = false;

    const lanes = Math.max(1, Math.min(16, Number(threadsInput.value) || suggestedWorkerCount()));
    statThreads.textContent = String(lanes);

    pool = new SearchPool(
      {
        onMatch: addMatches,
        onProgress: (scanned, _stage2, matchCount) => {
          lastScanned = scanned;
          lastMatches = matchCount;
          statScanned.textContent = nf.format(scanned);
          statMatches.textContent = nf.format(matchCount);
          const secs = (performance.now() - startedAt) / 1000;
          statRate.textContent = secs > 0 ? nf.format(Math.round(scanned / secs)) : '0';
          hintEl.hidden = !(matchCount === 0 && scanned > SLOW_HINT_AFTER);
        },
        onDone: () => {
          setRunning(false);
          hintEl.hidden = true;
          reportDone(lastMatches, lastScanned, config.matchLimit, stopRequested);
        },
        onError: (message) => showError(message),
      },
      lanes,
    );

    hintEl.hidden = true;
    progressPanel.hidden = false;
    setRunning(true);
    pool.start(config);
  });

  stopBtn.addEventListener('click', () => {
    stopRequested = true;
    pool?.stop();
  });

  clearBtn.addEventListener('click', () => {
    resultsEl.replaceChildren();
    emptyEl.hidden = false;
    hintEl.hidden = true;
    statusEl.textContent = '';
    progressPanel.hidden = true;
  });
}

void main();
