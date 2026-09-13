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
import { KIND, type Criterion, type CriterionKind } from '../search/types';

interface Entry {
  kind: CriterionKind;
  id: number;
  name: string;
  dim: 'overworld' | 'nether' | 'end';
  note?: string;
  variants?: readonly VariantGroup[];
}

const key = (kind: CriterionKind, id: number): string => `${kind}:${id}`;

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
  /** key -> chosen variant option per group. Insertion order is search order. */
  private readonly selected = new Map<string, Record<string, string | null>>();
  private entries: Entry[] = [];

  constructor(
    private readonly structureRoot: HTMLElement,
    private readonly biomeRoot: HTMLElement,
    private readonly selectedRoot: HTMLElement,
    private readonly selectedCount: HTMLElement,
    private readonly supports: (kind: CriterionKind, id: number) => boolean,
    private readonly onChange: () => void,
  ) {}

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
    return [...this.selected.entries()].map(([k, variants]) => {
      const [kind, id] = k.split(':').map(Number);
      return { kind: kind as CriterionKind, id: id!, variants };
    });
  }

  private toggle(entry: Entry, on: boolean): void {
    const k = key(entry.kind, entry.id);
    if (on) {
      const variants: Record<string, string | null> = {};
      for (const g of entry.variants ?? []) variants[g.key] = null;
      this.selected.set(k, variants);
    } else {
      this.selected.delete(k);
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
    for (const [k, variants] of this.selected) {
      const entry = this.entries.find((e) => key(e.kind, e.id) === k);
      if (!entry) continue;
      rows.push(this.selectedRow(entry, variants));
    }

    this.selectedCount.textContent = String(this.selected.size);
    this.selectedRoot.replaceChildren(...rows);
    this.selectedRoot.parentElement?.toggleAttribute('hidden', rows.length === 0);
  }

  private selectedRow(entry: Entry, variants: Record<string, string | null>): HTMLElement {
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
