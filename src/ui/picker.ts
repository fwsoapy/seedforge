/**
 * Criterion picker.
 *
 * The grid itself is a uniform row of chips - one line each, all the same
 * height - so it stays aligned no matter which entries have variant options.
 * Anything ticked then gets a row in the "selected" list underneath, where its
 * dropdowns live. That keeps the grid tidy and puts the controls you are
 * actually adjusting in one place.
 */

import { BIOME_GROUPS, SEARCHABLE_BIOMES, type BiomeDef, type BiomeGroup } from '../data/biomes';
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
  /** Biome entries only: which heading they render under. */
  group?: BiomeGroup;
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
    group: def.group,
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
    // Biomes are numerous enough that one flat grid is unreadable, so they
    // render under short headings instead.
    const biomes = this.entries.filter((e) => e.kind === KIND.biome);
    const blocks: HTMLElement[] = [];
    for (const group of BIOME_GROUPS) {
      const inGroup = biomes.filter((e) => e.group === group.key);
      if (inGroup.length === 0) continue;

      const heading = document.createElement('h3');
      heading.className = 'group-heading';
      heading.textContent = group.label;

      const grid = document.createElement('div');
      grid.className = 'chip-grid';
      grid.append(...inGroup.map((e) => this.chip(e)));

      const block = document.createElement('div');
      block.className = 'biome-group';
      block.append(heading, grid);
      blocks.push(block);
    }
    this.biomeRoot.replaceChildren(...blocks);
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

  /**
   * Can a distance between these two be measured at all?
   *
   * Same dimension always works. Overworld and Nether work too: Nether
   * coordinates are 1:8, so the Overworld side is divided by 8 and the rule
   * is measured in Nether blocks - which is exactly what you want for
   * "a bastion near where this portal drops me". The End has no such
   * correspondence, so rules crossing into it are not measurable.
   */
  private measurable(a: string, b: string): boolean {
    const da = this.dimOf(a);
    const db = this.dimOf(b);
    if (da === db) return true;
    return da !== 'end' && db !== 'end';
  }

  /** True when the rule is measured in Nether blocks rather than Overworld ones. */
  private isNetherScaled(a: string, b: string): boolean {
    return this.dimOf(a) !== this.dimOf(b) && this.measurable(a, b);
  }

  private addRule(): void {
    const keys = [...this.selected.keys()];
    if (keys.length < 2) return;
    for (const a of keys) {
      for (const b of keys) {
        if (a === b || !this.measurable(a, b)) continue;
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
    // Long names ellipsise in the grid, so the full text always lives in the
    // tooltip alongside any note.
    chip.title = entry.note ? `${entry.name} - ${entry.note}` : entry.name;

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
    of.textContent = this.isNetherScaled(rule.a, rule.b) ? 'Nether blocks of' : 'blocks of';

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

    if (!this.measurable(rule.a, rule.b)) {
      const warn = document.createElement('p');
      warn.className = 'rule-warn';
      warn.textContent =
        'The End has no coordinate link to the other dimensions, so this distance cannot be measured.';
      row.append(warn);
    } else if (this.isNetherScaled(rule.a, rule.b)) {
      const ow = this.dimOf(rule.a) === 'overworld' ? rule.a : rule.b;
      const name = this.entries.find((e) => keyOf(e) === ow)?.name ?? 'the overworld structure';
      const note = document.createElement('p');
      note.className = 'rule-note';
      note.textContent =
        `Measured in the Nether: ${name}'s coordinates are divided by 8 to get where a portal ` +
        'there would drop you, and the distance is taken from that point.';
      row.append(note);
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
