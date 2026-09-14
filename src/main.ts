/**
 * App entry point: wires the form, the worker pool and the results list.
 *
 * A WASM instance is created on the main thread purely for metadata
 * (which structures exist in which version); all actual searching happens in
 * workers so the UI never blocks.
 */

import { DEFAULT_VERSION, MC_VERSIONS } from './data/versions';
import { SearchEngine } from './search/engine';
import { SearchPool, suggestedWorkerCount } from './search/pool';
import { sortByCloseness } from './search/score';
import { EDITION, KIND, type CriterionKind, type Edition, type Match, type SearchConfig, type TargetMode } from './search/types';
import { CriterionPicker } from './ui/picker';
import { renderResult } from './ui/results';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const editionSel = $<HTMLSelectElement>('edition');
const editionHint = $<HTMLElement>('edition-hint');
const versionSel = $<HTMLSelectElement>('version');
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
const sortNoteEl = $<HTMLElement>('sort-note');
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
/** Every match found in the current search, kept so they can be re-sorted. */
let results: Match[] = [];
/** Drives the stats readout independently of how often workers report. */
let statsTimer: number | null = null;

function showError(message: string | null): void {
  errorEl.hidden = message === null;
  errorEl.textContent = message ?? '';
}

function randomSeed(): bigint {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  // A Bedrock world seed is 32 bits; Java structure placement only uses the
  // low 48, so that is the space each draws its starting point from.
  if (Number(editionSel.value) === EDITION.bedrock) return BigInt(buf[0]!);
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
    edition: Number(editionSel.value) as Edition,
    target: Number(targetSel.value) as TargetMode,
    criteria,
    rules: picker.proximityRules(),
    startSeed: parseStartSeed(),
    seedLimit: 0n,
    matchLimit,
  };
}

/** Repaints the stats readout from the latest recorded totals. */
function refreshStats(): void {
  statScanned.textContent = nf.format(lastScanned);
  statMatches.textContent = nf.format(lastMatches);
  const secs = (performance.now() - startedAt) / 1000;
  statRate.textContent = secs > 0 ? nf.format(Math.round(lastScanned / secs)) : '0';
  hintEl.hidden = !(lastMatches === 0 && lastScanned > SLOW_HINT_AFTER);
}

function startStatsTimer(): void {
  stopStatsTimer();
  statsTimer = window.setInterval(refreshStats, 250);
}

function stopStatsTimer(): void {
  if (statsTimer !== null) {
    window.clearInterval(statsTimer);
    statsTimer = null;
  }
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

/** Re-renders the whole list, closest match first. */
function renderResults(): void {
  emptyEl.hidden = results.length > 0;
  sortNoteEl.hidden = results.length === 0;
  sortByCloseness(results);
  resultsEl.replaceChildren(...results.map((m) => renderResult(m, lastRadii)));
}

function addMatches(matches: Match[]): void {
  results.push(...matches);
  renderResults();
}

async function main(): Promise<void> {
  for (const v of MC_VERSIONS) {
    const o = document.createElement('option');
    o.value = String(v.id);
    o.textContent = v.label;
    o.selected = v.id === DEFAULT_VERSION;
    versionSel.append(o);
  }
  threadsInput.value = '0';
  statThreads.textContent = String(suggestedWorkerCount());

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
      if (kind === KIND.biome) return meta!.supportsBiome(id, mc);
      if (!meta!.supports(id, mc)) return false;
      // On Bedrock, only structures the Bedrock generator actually places.
      if (Number(editionSel.value) === EDITION.bedrock) return meta!.supportsBedrock(id);
      return true;
    },
    () => showError(null),
  );
  picker.render();

  /** Bedrock only shares a generator with Java from 1.18 onwards. */
  const MIN_BEDROCK_VERSION = 22;

  const applyEdition = (): void => {
    const bedrock = Number(editionSel.value) === EDITION.bedrock;
    let changed = false;
    for (const opt of versionSel.options) {
      const tooOld = bedrock && Number(opt.value) < MIN_BEDROCK_VERSION;
      opt.hidden = tooOld;
      opt.disabled = tooOld;
      if (tooOld && opt.selected) changed = true;
    }
    if (changed) versionSel.value = String(DEFAULT_VERSION);
    editionHint.hidden = !bedrock;
    editionHint.textContent = bedrock
      ? 'Bedrock seeds are 32-bit. Versions map to the equivalent Java generation.'
      : '';
    picker.render();
  };

  editionSel.addEventListener('change', applyEdition);
  versionSel.addEventListener('change', () => picker.render());
  applyEdition();

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
    results = [];

    // 0 (or blank) means "pick for me".
    const requested = Number(threadsInput.value);
    const lanes =
      !Number.isFinite(requested) || requested <= 0
        ? suggestedWorkerCount()
        : Math.min(16, Math.round(requested));
    statThreads.textContent = String(lanes);

    pool = new SearchPool(
      {
        onMatch: addMatches,
        // Workers report per block, which is an uneven cadence. Record here
        // and let the timer below drive the readout so it ticks smoothly.
        onProgress: (scanned, _stage2, matchCount) => {
          lastScanned = scanned;
          lastMatches = matchCount;
        },
        onDone: () => {
          stopStatsTimer();
          refreshStats();
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
    startStatsTimer();
    pool.start(config);
  });

  stopBtn.addEventListener('click', () => {
    stopRequested = true;
    stopStatsTimer();
    pool?.stop();
  });

  clearBtn.addEventListener('click', () => {
    results = [];
    resultsEl.replaceChildren();
    emptyEl.hidden = false;
    sortNoteEl.hidden = true;
    hintEl.hidden = true;
    statusEl.textContent = '';
    progressPanel.hidden = true;
  });
}

void main();
