/**
 * App entry point: wires the form, the worker pool and the results list.
 *
 * A WASM instance is created on the main thread purely for metadata
 * (which structures exist in which version); all actual searching happens in
 * workers so the UI never blocks.
 */

import {
  MAX_CUSTOM_PRESETS,
  MAX_PRESET_NAME,
  loadCustomPresets,
  newPresetKey,
  saveCustomPresets,
  summarise,
} from './data/custom-presets';
import { PRESETS, type Preset } from './data/presets';
import {
  MAX_SAVED_SEEDS,
  SHARE_DAYS,
  daysLeft,
  decodeShare,
  encodeShare,
  loadSavedSeeds,
  newSeedKey,
  saveSavedSeeds,
  type SeedRecord,
} from './data/saved-seeds';
import { DEFAULT_VERSION, MC_VERSIONS } from './data/versions';
import { SearchEngine } from './search/engine';
import { SearchPool, suggestedWorkerCount } from './search/pool';
import { sortByCloseness } from './search/score';
import { EDITION, KIND, TARGET, type CriterionKind, type Edition, type Match, type SearchConfig, type TargetMode } from './search/types';
import { CriterionPicker } from './ui/picker';
import { initTheme } from './ui/theme';
import { pruneMaps, renderResult, repaintMaps, type ResultActions } from './ui/results';

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
const verifyInput = $<HTMLInputElement>('verify');
const verifyHint = $<HTMLElement>('verify-hint');
const searchBtn = $<HTMLButtonElement>('search');
const pauseBtn = $<HTMLButtonElement>('pause');
const stopBtn = $<HTMLButtonElement>('stop');
const clearBtn = $<HTMLButtonElement>('clear');
const checkBtn = $<HTMLButtonElement>('check');
const checkSeedInput = $<HTMLInputElement>('check-seed');
const themeBtn = $<HTMLButtonElement>('theme');
const presetList = $<HTMLElement>('preset-list');
const presetNameInput = $<HTMLInputElement>('preset-name');
const presetSaveBtn = $<HTMLButtonElement>('preset-save');
const presetNote = $<HTMLElement>('preset-note');
const savedPanel = $<HTMLElement>('saved-panel');
const savedList = $<HTMLElement>('saved-list');
const savedNote = $<HTMLElement>('saved-note');
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
/** Time spent paused, so it does not drag the seeds/sec figure down. */
let pausedMs = 0;
let pausedAt = 0;
/** Every match found in the current search, kept so they can be re-sorted. */
let results: Match[] = [];
/** Set when new matches have arrived but the list has not been rebuilt yet. */
let resultsDirty = false;
/** The query the current results came from, carried by a save or a share. */
let lastQuery: SearchConfig | null = null;
/** Filled in main(), once the picker and storage exist. */
let resultActions: ResultActions | undefined;
/** Drives the stats readout independently of how often workers report. */
let statsTimer: number | null = null;

function showError(message: string | null): void {
  errorEl.hidden = message === null;
  errorEl.textContent = message ?? '';
}

function randomSeed(): bigint {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  // Java structure placement only reads the low 48 bits, so there is nothing
  // to gain from a wider starting point. Bedrock reads the low 32 for
  // placement but all 64 for biomes, so it draws from the full range.
  if (Number(editionSel.value) === EDITION.bedrock) {
    return BigInt.asUintN(64, (BigInt(buf[0]!) << 32n) | BigInt(buf[1]!));
  }
  return ((BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]!)) & ((1n << 48n) - 1n);
}

/**
 * Turns typed text into a world seed.
 *
 * Both editions take a full 64-bit seed. Bedrock reads only the low 32 bits
 * for structure placement, which is why its structures can be cracked from
 * coordinates alone, but biome generation there reads all 64 like Java's does.
 */
function parseSeed(raw: string, label: string): bigint {
  try {
    return BigInt.asUintN(64, BigInt(raw));
  } catch {
    throw new Error(`${label} must be a whole number.`);
  }
}

function parseStartSeed(): bigint {
  const raw = startSeedInput.value.trim();
  if (raw === '') return randomSeed();
  return parseSeed(raw, 'Start seed');
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
    verify: verifyInput.checked,
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
  flushResults();
  statScanned.textContent = nf.format(lastScanned);
  statMatches.textContent = nf.format(lastMatches);
  // Paused time is excluded, otherwise the rate decays while nothing is
  // actually being scanned.
  const held = pausedAt > 0 ? performance.now() - pausedAt : 0;
  const secs = (performance.now() - startedAt - pausedMs - held) / 1000;
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
  pauseBtn.disabled = !running;
  if (!running) pauseBtn.textContent = 'Pause';
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

/**
 * Rebuilds the result list, closest match first.
 *
 * Every card is built fresh because the list is kept sorted by closeness, so
 * a new match can land anywhere in it. Each card also draws a map, which makes
 * this far too expensive to run once per batch of matches: several workers
 * reporting at once turned into several full redraws a second, and with a
 * large match limit that is hundreds of canvases per redraw. It froze the page
 * for seconds at a time. Hence renderResults() is never called directly from
 * the match handler; `resultsDirty` marks it and the stats timer flushes it at
 * most four times a second.
 */
function renderResults(): void {
  resultsDirty = false;
  emptyEl.hidden = results.length > 0;
  sortNoteEl.hidden = results.length === 0;
  sortByCloseness(results);
  resultsEl.replaceChildren(
    ...results.map((m) => renderResult(m, lastRadii, resultActions)),
  );
  // The cards just replaced are detached now, so their map entries can go.
  pruneMaps();
}

function flushResults(): void {
  if (resultsDirty) renderResults();
}

function addMatches(matches: Match[]): void {
  results.push(...matches);
  resultsDirty = true;
}

async function main(): Promise<void> {
  // Before anything slow, so the control works while the engine is loading.
  // Canvas pixels are not restyled by CSS, so the maps already on the page
  // have to be repainted when the palette changes.
  initTheme(themeBtn, $<HTMLElement>('theme-icon'), $<HTMLElement>('theme-label'), repaintMaps);

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
    () => {
      showError(null);
      // Any hand edit means the selection is no longer that preset.
      presetList
        .querySelectorAll('.preset.on, .preset-option.on')
        .forEach((el) => el.classList.remove('on'));
    },
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
      ? 'Structure variant filters are Java only. Bedrock reads the low 32 bits of the seed for structures and all 64 for biomes.'
      : '';
    picker.setJavaOnlyAllowed(!bedrock);
    picker.render();
  };

  /*
   * Preset buttons. A preset replaces the selection outright, which is what
   * makes "click one, hit search" work, but it leaves edition, version, target
   * and thread count alone: those are the user's setup, not part of the query.
   */
  let custom = loadCustomPresets();

  const setNote = (text: string): void => {
    presetNote.textContent = text;
  };

  const usePreset = (preset: Preset): void => {
    showError(null);
    picker.applyPreset(preset);
    presetList.querySelectorAll('.preset, .preset-option').forEach((el) => {
      el.classList.toggle('on', (el as HTMLElement).dataset['preset'] === preset.key);
    });
  };

  const presetButton = (preset: Preset, own: boolean): HTMLElement => {
    const slot = document.createElement('div');
    slot.className = 'preset-slot';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset';
    btn.dataset['preset'] = preset.key;

    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = preset.name;

    const blurb = document.createElement('span');
    blurb.className = 'preset-blurb';
    blurb.textContent = preset.blurb;

    btn.append(name, blurb);
    btn.addEventListener('click', () => usePreset(preset));
    slot.append(btn);

    // Only the user's own presets can be removed. The four built-ins are
    // compiled into the page and get no delete control at all. It is a sibling
    // rather than a child of the button, so it is reachable by keyboard.
    if (own) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'preset-delete';
      remove.textContent = '\u2715';
      remove.title = `Delete "${preset.name}"`;
      remove.setAttribute('aria-label', `Delete preset ${preset.name}`);
      remove.addEventListener('click', () => {
        custom = custom.filter((p) => p.key !== preset.key);
        saveCustomPresets(custom);
        setNote(`Deleted "${preset.name}".`);
        renderPresets();
      });
      slot.append(remove);
    }

    return slot;
  };

  /**
   * A tile holding several presets that are variations on one idea: a heading,
   * a row of options, and one shared blurb. Same footprint as a single preset.
   */
  const presetGroup = (title: string, members: readonly Preset[]): HTMLElement => {
    const slot = document.createElement('div');
    slot.className = 'preset-slot';

    const tile = document.createElement('div');
    tile.className = 'preset preset-group';

    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = title;

    const options = document.createElement('div');
    options.className = 'preset-options';
    for (const preset of members) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'preset-option';
      opt.dataset['preset'] = preset.key;
      opt.textContent = preset.option ?? preset.name;
      opt.title = preset.name;
      opt.addEventListener('click', () => usePreset(preset));
      options.append(opt);
    }

    const blurb = document.createElement('span');
    blurb.className = 'preset-blurb';
    blurb.textContent = members[0]?.blurb ?? '';

    tile.append(name, options, blurb);
    slot.append(tile);
    return slot;
  };

  function renderPresets(): void {
    const tiles: HTMLElement[] = [];
    // Consecutive presets sharing a group collapse into one tile.
    for (let i = 0; i < PRESETS.length; ) {
      const preset = PRESETS[i]!;
      if (preset.group === undefined) {
        tiles.push(presetButton(preset, false));
        i += 1;
        continue;
      }
      const members: Preset[] = [];
      while (i < PRESETS.length && PRESETS[i]!.group === preset.group) {
        members.push(PRESETS[i]!);
        i += 1;
      }
      tiles.push(presetGroup(preset.group, members));
    }
    presetList.replaceChildren(...tiles, ...custom.map((p) => presetButton(p, true)));
    presetSaveBtn.disabled = custom.length >= MAX_CUSTOM_PRESETS;
  }

  /* --- saved seeds and share links ------------------------------------ */

  let saved = loadSavedSeeds();

  const setSavedNote = (text: string): void => {
    savedNote.textContent = text;
  };

  /** The query a result came from, in the shape a seed record stores. */
  const recordFor = (m: Match): SeedRecord | null => {
    if (!lastQuery) return null;
    const { criteria, rules } = picker.exportSelection();
    return {
      seed: BigInt.asIntN(64, m.seed).toString(),
      mc: lastQuery.mc,
      edition: lastQuery.edition,
      target: lastQuery.target,
      criteria,
      rules,
    };
  };

  const shareUrl = (record: SeedRecord): string => {
    const base = `${location.origin}${location.pathname}`;
    return `${base}#s=${encodeShare(record)}`;
  };

  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  function renderSaved(): void {
    savedPanel.hidden = saved.length === 0;
    savedList.replaceChildren(...saved.map((entry) => {
      const row = document.createElement('div');
      row.className = 'saved';

      const seed = document.createElement('span');
      seed.className = 'saved-seed';
      seed.textContent = entry.seed;

      const meta = document.createElement('span');
      meta.className = 'saved-meta';
      const version = MC_VERSIONS.find((v) => v.id === entry.mc)?.label ?? `MC #${entry.mc}`;
      const edition = entry.edition === EDITION.bedrock ? 'Bedrock' : 'Java';
      meta.textContent = `${edition} ${version} - ${entry.criteria.length} criteria`;

      const actions = document.createElement('div');
      actions.className = 'saved-actions';

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'secondary small';
      open.textContent = 'Open';
      open.addEventListener('click', () => applyRecord(entry, 'Loaded that seed.'));

      const share = document.createElement('button');
      share.type = 'button';
      share.className = 'secondary small';
      share.textContent = 'Share';
      share.addEventListener('click', () => {
        void copyToClipboard(shareUrl(entry)).then((ok) => {
          setSavedNote(ok
            ? `Link copied. It stops working in ${SHARE_DAYS} days.`
            : 'Could not reach the clipboard. Copy the address bar after opening the seed.');
        });
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost small';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => {
        saved = saved.filter((x) => x.key !== entry.key);
        saveSavedSeeds(saved);
        renderSaved();
        setSavedNote('Deleted.');
      });

      actions.append(open, share, remove);
      row.append(seed, meta, actions);
      return row;
    }));
  }

  const saveSeed = (m: Match): void => {
    const record = recordFor(m);
    if (!record) {
      setSavedNote('Nothing to save yet.');
      return;
    }
    if (saved.some((x) => x.seed === record.seed)) {
      savedPanel.hidden = false;
      setSavedNote('That seed is already saved.');
      return;
    }
    if (saved.length >= MAX_SAVED_SEEDS) {
      savedPanel.hidden = false;
      setSavedNote(`You can keep ${MAX_SAVED_SEEDS} seeds. Delete one to make room.`);
      return;
    }
    saved = [...saved, { ...record, key: newSeedKey(), savedAt: Date.now() }];
    if (!saveSavedSeeds(saved)) {
      saved = loadSavedSeeds();
      renderSaved();
      setSavedNote('This browser would not let the page store anything, so it was not saved.');
      return;
    }
    renderSaved();
    setSavedNote(`Saved. ${saved.length} of ${MAX_SAVED_SEEDS} kept in this browser.`);
  };

  const shareSeed = (m: Match, button: HTMLButtonElement): void => {
    const record = recordFor(m);
    if (!record) return;
    void copyToClipboard(shareUrl(record)).then((ok) => {
      button.textContent = ok ? 'Copied' : 'Failed';
      setTimeout(() => (button.textContent = 'Share'), 1400);
      savedPanel.hidden = saved.length === 0 && !ok;
      setSavedNote(ok
        ? `Share link copied. It carries the seed inside it and stops working in ${SHARE_DAYS} days.`
        : 'Could not reach the clipboard.');
    });
  };

  resultActions = { onSave: saveSeed, onShare: shareSeed };

  /**
   * Puts a stored or shared seed back on screen: restores the query that
   * found it, then runs that query against the one seed.
   */
  function applyRecord(record: SeedRecord, doneMessage: string): void {
    showError(null);
    editionSel.value = String(record.edition);
    applyEdition();
    if (MC_VERSIONS.some((v) => v.id === record.mc)) versionSel.value = String(record.mc);
    targetSel.value = String(record.target);
    picker.applyPreset({
      key: 'shared', name: 'Shared', blurb: '',
      criteria: record.criteria, rules: record.rules,
    });
    checkSeedInput.value = record.seed;
    checkBtn.click();
    setSavedNote(doneMessage);
    savedPanel.hidden = saved.length === 0;
  }

  renderSaved();

  /*
   * A share link carries its payload in the fragment, which browsers never
   * send to the host. Opening one restores the query and checks the seed.
   */
  const openSharedLink = (): void => {
    const match = /(?:^|[#&])s=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!match) return;
    const result = decodeShare(match[1]!);
    if (!result.ok) {
      savedPanel.hidden = false;
      setSavedNote(result.reason === 'expired'
        ? `That share link has expired. Links last ${SHARE_DAYS} days.`
        : 'That share link could not be read.');
      return;
    }
    const left = daysLeft(result.expiresAt);
    applyRecord(result.record, `Opened a shared seed. The link expires in ${left} day${left === 1 ? '' : 's'}.`);
  };

  const savePreset = (): void => {
    const name = presetNameInput.value.trim().slice(0, MAX_PRESET_NAME);
    if (name === '') {
      setNote('Give it a name first.');
      presetNameInput.focus();
      return;
    }
    if (custom.length >= MAX_CUSTOM_PRESETS) {
      setNote(`You can keep ${MAX_CUSTOM_PRESETS} saved presets. Delete one to make room.`);
      return;
    }

    const { criteria, rules } = picker.exportSelection();
    if (criteria.length === 0) {
      setNote('Tick at least one structure or biome, then save.');
      return;
    }

    custom = [
      ...custom,
      { key: newPresetKey(), name, blurb: summarise(criteria, rules), criteria, rules, custom: true },
    ];
    if (!saveCustomPresets(custom)) {
      custom = loadCustomPresets();
      renderPresets();
      setNote('This browser would not let the page store anything, so it was not saved.');
      return;
    }
    presetNameInput.value = '';
    renderPresets();
    setNote(`Saved "${name}". Stored in this browser only.`);
  };

  presetSaveBtn.addEventListener('click', savePreset);
  presetNameInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      savePreset();
    }
  });
  renderPresets();

  editionSel.addEventListener('change', applyEdition);
  versionSel.addEventListener('change', () => picker.render());
  applyEdition();

  /*
   * Double-checking only earns its keep on an origin scan, which is the one
   * target that computes no spawn at all. Rather than disable the box on the
   * other targets, where it just looks broken, the two controls are kept in
   * step: ticking it switches to the origin, and moving to a spawn target
   * unticks it. Either way a click always does something visible.
   */
  const ORIGIN_HINT =
    'Scans from (0, 0), which is far faster, then works out the real spawn of each match and requires everything to still be in range from there. Seeds that are not are dropped.';

  const paintVerifyHint = (): void => {
    verifyHint.textContent =
      Number(targetSel.value) === TARGET.origin
        ? ORIGIN_HINT
        : `Ticking this switches the target to the world origin. ${ORIGIN_HINT}`;
  };

  targetSel.addEventListener('change', () => {
    if (Number(targetSel.value) !== TARGET.origin) verifyInput.checked = false;
    paintVerifyHint();
  });

  verifyInput.addEventListener('change', () => {
    if (verifyInput.checked) targetSel.value = String(TARGET.origin);
    paintVerifyHint();
  });

  paintVerifyHint();

  searchBtn.addEventListener('click', () => {
    showError(null);
    // Belt and braces: the button is disabled while a search runs, but never
    // leave an old pool's workers alive if that ever stops holding. Done
    // before the UI is reset, since stop() runs the old pool's onDone.
    pool?.stop();
    let config: SearchConfig;
    try {
      config = buildConfig(picker);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
      return;
    }

    lastQuery = config;
    lastRadii = config.criteria.map((c) => c.radius);
    // A new search starts a clean list, so old matches from a different query
    // cannot sit alongside the new ones.
    results = [];
    resultsDirty = false;
    resultsEl.replaceChildren();
    sortNoteEl.hidden = true;
    startedAt = performance.now();
    statScanned.textContent = '0';
    statMatches.textContent = '0';
    statRate.textContent = '0';
    statusEl.textContent = '';
    statusEl.className = 'status';
    lastScanned = 0;
    lastMatches = 0;
    stopRequested = false;
    pausedMs = 0;
    pausedAt = 0;
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
          if (pausedAt > 0) {
            pausedMs += performance.now() - pausedAt;
            pausedAt = 0;
          }
          stopStatsTimer();
          refreshStats();
          flushResults();
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

  checkBtn.addEventListener('click', () => {
    showError(null);
    const raw = checkSeedInput.value.trim();
    if (raw === '') {
      showError('Enter a seed to check.');
      return;
    }
    let seed: bigint;
    let config: SearchConfig;
    try {
      seed = parseSeed(raw, 'A seed');
      config = buildConfig(picker);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
      return;
    }

    pool?.stop();
    lastQuery = config;
    lastRadii = config.criteria.map((c) => c.radius);
    results = [];
    resultsEl.replaceChildren();

    let found: Match | null;
    try {
      found = meta!.inspect(seed, config.mc, config.edition, config.target, config.criteria, config.rules);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
      return;
    }

    progressPanel.hidden = false;
    statScanned.textContent = '1';
    statMatches.textContent = found ? '1' : '0';
    statRate.textContent = '0';
    barEl.hidden = true;

    if (!found) {
      sortNoteEl.hidden = true;
      emptyEl.hidden = false;
      statusEl.textContent =
        'That seed does not satisfy everything you ticked. Loosen a distance or drop a criterion to see what it does have.';
      statusEl.className = 'status warn';
      return;
    }
    addMatches([found]);
    // Nothing is running to flush the list here: the stats timer only ticks
    // during a search, so a checked seed has to be drawn straight away.
    flushResults();
    statusEl.textContent = 'That seed matches everything you ticked.';
    statusEl.className = 'status done';
  });

  checkSeedInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') checkBtn.click();
  });

  pauseBtn.addEventListener('click', () => {
    if (!pool?.isRunning) return;
    if (pool.isPaused) {
      pool.resume();
      pausedMs += performance.now() - pausedAt;
      pausedAt = 0;
      pauseBtn.textContent = 'Pause';
      statusEl.textContent = '';
      statusEl.className = 'status';
      barEl.hidden = false;
      startStatsTimer();
    } else {
      pool.pause();
      pausedAt = performance.now();
      pauseBtn.textContent = 'Resume';
      stopStatsTimer();
      refreshStats();
      barEl.hidden = true;
      statusEl.textContent = `Paused after ${nf.format(lastScanned)} seeds. Resume to carry on from here.`;
      statusEl.className = 'status';
    }
  });

  stopBtn.addEventListener('click', () => {
    stopRequested = true;
    stopStatsTimer();
    if (pausedAt > 0) {
      pausedMs += performance.now() - pausedAt;
      pausedAt = 0;
    }
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

  // Last, so a shared link lands on a fully wired page.
  openSharedLink();
}

void main();
