/**
 * Structure picker. Renders one card per structure that exists in the
 * selected Minecraft version, with its variant dropdowns.
 */

import { STRUCTURES, type StructureDef } from '../data/structures';
import type { Criterion } from '../search/types';

export interface PickerState {
  /** structure id -> selected variant option per group key */
  selected: Map<number, Record<string, string | null>>;
}

export class StructurePicker {
  readonly state: PickerState = { selected: new Map() };

  constructor(
    private readonly root: HTMLElement,
    private readonly isSupported: (structure: number) => boolean,
    private readonly onChange: () => void,
  ) {}

  /** Re-renders for the current version, dropping now-invalid selections. */
  render(): void {
    this.root.replaceChildren();
    for (const def of STRUCTURES) {
      if (!this.isSupported(def.id)) {
        this.state.selected.delete(def.id);
        continue;
      }
      this.root.append(this.card(def));
    }
    this.onChange();
  }

  criteria(): Criterion[] {
    return [...this.state.selected.entries()].map(([structure, variants]) => ({
      structure,
      variants,
    }));
  }

  private card(def: StructureDef): HTMLElement {
    const card = document.createElement('div');
    card.className = 'structure';

    const top = document.createElement('div');
    top.className = 'structure-top';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `struct-${def.id}`;
    cb.checked = this.state.selected.has(def.id);

    const label = document.createElement('label');
    label.htmlFor = cb.id;
    label.textContent = def.name;

    top.append(cb, label);

    if (def.dim !== 'overworld') {
      const tag = document.createElement('span');
      tag.className = `dim-tag ${def.dim}`;
      tag.textContent = def.dim;
      top.append(tag);
    }
    card.append(top);

    if (def.note) {
      const note = document.createElement('p');
      note.className = 'structure-note';
      note.textContent = def.note;
      card.append(note);
    }

    const variantBox = document.createElement('div');
    variantBox.className = 'variants';
    variantBox.hidden = !cb.checked;

    if (def.variants) {
      for (const group of def.variants) {
        const wrap = document.createElement('label');
        const title = document.createElement('span');
        title.textContent = group.label;
        if (group.experimental) {
          const exp = document.createElement('span');
          exp.className = 'exp';
          exp.textContent = ' (experimental)';
          title.append(exp);
        }

        const select = document.createElement('select');
        for (const opt of group.options) {
          const o = document.createElement('option');
          o.value = opt.value ?? '';
          o.textContent = opt.label;
          select.append(o);
        }
        const current = this.state.selected.get(def.id)?.[group.key] ?? null;
        select.value = current ?? '';

        select.addEventListener('change', () => {
          const entry = this.state.selected.get(def.id);
          if (!entry) return;
          entry[group.key] = select.value === '' ? null : select.value;
          this.onChange();
        });

        wrap.append(title, select);
        if (group.note) {
          const note = document.createElement('span');
          note.className = 'variant-note';
          note.textContent = group.note;
          wrap.append(note);
        }
        variantBox.append(wrap);
      }
      card.append(variantBox);
    }

    cb.addEventListener('change', () => {
      if (cb.checked) {
        const variants: Record<string, string | null> = {};
        for (const g of def.variants ?? []) variants[g.key] = null;
        this.state.selected.set(def.id, variants);
      } else {
        this.state.selected.delete(def.id);
      }
      card.classList.toggle('on', cb.checked);
      variantBox.hidden = !cb.checked;
      this.onChange();
    });

    card.classList.toggle('on', cb.checked);
    return card;
  }
}
