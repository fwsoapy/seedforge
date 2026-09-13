/**
 * Criterion picker.
 *
 * The grid itself is a uniform row of chips - one line each, all the same
 * height - so it stays aligned no matter which entries have variant options.
 * Anything ticked then gets a row in the "selected" list underneath, where its
 * dropdowns live. That keeps the grid tidy and puts the controls you are
 * actually adjusting in one place.
 */

import { SEARCHABLE_BIOMES, type BiomeDef } from '../data/biomes';
import { STRUCTURES, type StructureDef, type VariantGroup } from '../data/structures';
import { KIND, type Criterion, type CriterionKind, type ProximityRule } from '../search/types';

/** Distance a newly ticked criterion starts at, in blocks. */
export const DEFAULT_RADIUS = 500;

interface Selection {
  variants: Record<string, string | null>;
  radius: number;
}

interface Entry {
  kind: CriterionKind;
  id: number;
  name: string;
  dim: 'overworld' | 'nether' | 'end';
  note?: string;
  variants?: readonly VariantGroup[];
}

const key = (kind: CriterionKind, id: number): string => `${kind}:${id}`;
const keyOf = (e: Entry): string => key(e.kind, e.id);

function structureEntry(def: StructureDef): Entry {
  return {
    kind: KIND.structure,
    id: def.id,
    name: def.name,
    dim: def.dim,
    ...(def.note !== undefined ? { note: def.note } : {}),
    ...(def.variants !== undefined ? { variants: def.variants } : {}),
  };
}

function biomeEntry(def: BiomeDef): Entry {
  return {
    kind: KIND.biome,
    id: def.id,
    name: def.name,
    dim: 'overworld',
    ...(def.note !== undefined ? { note: def.note } : {}),
  };
}

export class CriterionPicker {
  /** key -> selection. Insertion order is the order criteria are searched. */
  private readonly selected = new Map<string, Selection>();
  private entries: Entry[] = [];
  /** Proximity rules, holding criterion keys so they survive re-renders. */
  private rules: { a: string; b: string; maxDist: number }[] = [];

  constructor(
    private readonly structureRoot: HTMLElement,
    private readonly biomeRoot: HTMLElement,
    private readonly selectedRoot: HTMLElement,
    private readonly selectedCount: HTMLElement,
    private readonly rulesRoot: HTMLElement,
    private readonly addRuleBtn: HTMLButtonElement,
    private readonly supports: (kind: CriterionKind, id: number) => boolean,
    private readonly onChange: () => void,
  ) {
    this.addRuleBtn.addEventListener('click', () => this.addRule());
  }

  /** Re-renders for the current version, dropping now-invalid selections. */
  render(): void {
    this.entries = [
      ...STRUCTURES.filter((d) => this.supports(KIND.structure, d.id)).map(structureEntry),
      ...SEARCHABLE_BIOMES.filter((d) => this.supports(KIND.biome, d.id)).map(biomeEntry),
    ];

    const valid = new Set(this.entries.map((e) => key(e.kind, e.id)));
    for (const k of [...this.selected.keys()]) {
      if (!valid.has(k)) this.selected.delete(k);
    }

    this.structureRoot.replaceChildren(
      ...this.entries.filter((e) => e.kind === KIND.structure).map((e) => this.chip(e)),
    );
    this.biomeRoot.replaceChildren(
      ...this.entries.filter((e) => e.kind === KIND.biome).map((e) => this.chip(e)),
    );
    this.renderSelected();
  }

  criteria(): Criterion[] {
    return [...this.selected.entries()].map(([k, sel]) => {
      const [kind, id] = k.split(':').map(Number);
      return { kind: kind as CriterionKind, id: id!, variants: sel.variants, radius: sel.radius };
    });
  }

  /** Rules translated to indices into `criteria()`. Dangling rules are dropped. */
  proximityRules(): ProximityRule[] {
    const order = [...this.selected.keys()];
    const out: ProximityRule[] = [];
    for (const r of this.rules) {
      const a = order.indexOf(r.a);
      const b = order.indexOf(r.b);
      if (a < 0 || b < 0 || a === b) continue;
      out.push({ a, b, maxDist: r.maxDist });
    }
    return out;
  }

  /** Dimension of a selected criterion, for validating a rule. */
  private dimOf(key: string): string {
    return this.entries.find((e) => keyOf(e) === key)?.dim ?? 'overworld';
  }

  private addRule(): void {
    const keys = [...this.selected.keys()];
    if (keys.length < 2) return;
    // Default to the first pair that shares a dimension, since a distance
    // between an overworld and a nether structure is not a real measurement.
    for (const a of keys) {
      for (const b of keys) {
        if (a === b || this.dimOf(a) !== this.dimOf(b)) continue;
        if (this.rules.some((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a))) continue;
        this.rules.push({ a, b, maxDist: 200 });
        this.renderSelected();
        this.onChange();
        return;
      }
    }
  }

  private toggle(entry: Entry, on: boolean): void {
    const k = key(entry.kind, entry.id);
    if (on) {
      const variants: Record<string, string | null> = {};
      for (const g of entry.variants ?? []) variants[g.key] = null;
      this.selected.set(k, { variants, radius: DEFAULT_RADIUS });
    } else {
      this.selected.delete(k);
      this.rules = this.rules.filter((r) => r.a !== k && r.b !== k);
    }
    this.render();
    this.onChange();
  }

  private chip(entry: Entry): HTMLElement {
    const k = key(entry.kind, entry.id);
    const on = this.selected.has(k);

    const chip = document.createElement('label');
    chip.className = 'chip';
    chip.classList.toggle('on', on);
    if (entry.note) chip.title = entry.note;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = on;
    cb.addEventListener('change', () => this.toggle(entry, cb.checked));

    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = entry.name;

    chip.append(cb, name);

    if (entry.dim !== 'overworld') {
      const tag = document.createElement('span');
      tag.className = `dim-tag ${entry.dim}`;
      tag.textContent = entry.dim === 'nether' ? 'N' : 'E';
      tag.title = entry.dim === 'nether' ? 'Nether' : 'The End';
      chip.append(tag);
    }
    if (entry.variants?.length) {
      const dot = document.createElement('span');
      dot.className = 'chip-opts';
      dot.textContent = '•';
      dot.title = 'Has options';
      chip.append(dot);
    }
    return chip;
  }

  private renderSelected(): void {
    const rows: HTMLElement[] = [];
    for (const [k, sel] of this.selected) {
      const entry = this.entries.find((e) => key(e.kind, e.id) === k);
      if (!entry) continue;
      rows.push(this.selectedRow(entry, sel));
    }

    this.selectedCount.textContent = String(this.selected.size);
    this.selectedRoot.replaceChildren(...rows);
    this.selectedRoot.parentElement?.toggleAttribute('hidden', rows.length === 0);
    this.renderRules();
  }

  private renderRules(): void {
    // Drop rules whose structures are no longer selected.
    this.rules = this.rules.filter((r) => this.selected.has(r.a) && this.selected.has(r.b));

    const keys = [...this.selected.keys()];
    this.addRuleBtn.disabled = keys.length < 2;
    this.rulesRoot.replaceChildren(...this.rules.map((r, i) => this.ruleRow(r, i, keys)));
    this.rulesRoot.parentElement?.toggleAttribute('hidden', keys.length < 2);
  }

  private ruleRow(
    rule: { a: string; b: string; maxDist: number },
    index: number,
    keys: string[],
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'rule-row';

    const pick = (which: 'a' | 'b'): HTMLSelectElement => {
      const sel = document.createElement('select');
      for (const k of keys) {
        const entry = this.entries.find((e) => keyOf(e) === k);
        if (!entry) continue;
        const o = document.createElement('option');
        o.value = k;
        o.textContent = entry.name;
        sel.append(o);
      }
      sel.value = rule[which];
      sel.addEventListener('change', () => {
        rule[which] = sel.value;
        this.renderRules();
        this.onChange();
      });
      return sel;
    };

    const a = pick('a');
    const within = document.createElement('span');
    within.className = 'rule-text';
    within.textContent = 'within';

    const dist = document.createElement('input');
    dist.type = 'number';
    dist.min = '0';
    dist.step = '16';
    dist.className = 'rule-dist';
    dist.value = String(rule.maxDist);
    dist.addEventListener('change', () => {
      rule.maxDist = Math.max(0, Number(dist.value) || 0);
      this.onChange();
    });

    const of = document.createElement('span');
    of.className = 'rule-text';
    of.textContent = 'blocks of';

    const b = pick('b');

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'sel-remove';
    remove.textContent = '✕';
    remove.title = 'Remove this rule';
    remove.addEventListener('click', () => {
      this.rules.splice(index, 1);
      this.renderRules();
      this.onChange();
    });

    row.append(a, within, dist, of, b, remove);

    if (this.dimOf(rule.a) !== this.dimOf(rule.b)) {
      const warn = document.createElement('p');
      warn.className = 'rule-warn';
      warn.textContent =
        'These are in different dimensions - their coordinates are not comparable, so this rule cannot be applied.';
      row.append(warn);
    }
    return row;
  }

  private selectedRow(entry: Entry, sel: Selection): HTMLElement {
    const variants = sel.variants;
    const row = document.createElement('div');
    row.className = 'sel-row';

    const head = document.createElement('div');
    head.className = 'sel-head';

    const name = document.createElement('span');
    name.className = 'sel-name';
    name.textContent = entry.name;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'sel-remove';
    remove.textContent = '✕';
    remove.title = `Remove ${entry.name}`;
    remove.addEventListener('click', () => this.toggle(entry, false));

    head.append(name, remove);
    row.append(head);

    // Each criterion carries its own distance limit.
    const distWrap = document.createElement('label');
    distWrap.className = 'sel-dist';
    const distLabel = document.createElement('span');
    distLabel.textContent =
      entry.dim === 'nether' ? 'Within (Nether blocks)' : 'Within (blocks of spawn)';
    const dist = document.createElement('input');
    dist.type = 'number';
    dist.min = '16';
    dist.step = '16';
    dist.value = String(sel.radius);
    dist.addEventListener('change', () => {
      sel.radius = Math.max(1, Number(dist.value) || DEFAULT_RADIUS);
      this.onChange();
    });
    distWrap.append(distLabel, dist);
    row.append(distWrap);

    if (entry.note) {
      const note = document.createElement('p');
      note.className = 'sel-note';
      note.textContent = entry.note;
      row.append(note);
    }

    if (entry.variants?.length) {
      const box = document.createElement('div');
      box.className = 'sel-variants';
      for (const group of entry.variants) {
        box.append(this.variantControl(group, variants));
      }
      row.append(box);
    }
    return row;
  }

  private variantControl(
    group: VariantGroup,
    variants: Record<string, string | null>,
  ): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'sel-variant';

    const title = document.createElement('span');
    title.textContent = group.label;
    if (group.experimental) {
      const exp = document.createElement('span');
      exp.className = 'exp';
      exp.textContent = ' experimental';
      title.append(exp);
    }
    if (group.note) wrap.title = group.note;

    const select = document.createElement('select');
    for (const opt of group.options) {
      const o = document.createElement('option');
      o.value = opt.value ?? '';
      o.textContent = opt.label;
      select.append(o);
    }
    select.value = variants[group.key] ?? '';
    select.addEventListener('change', () => {
      variants[group.key] = select.value === '' ? null : select.value;
      this.onChange();
    });

    wrap.append(title, select);
    return wrap;
  }
}
