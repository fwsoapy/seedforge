/** Biome ids used for variant constraints (cubiomes/biomes.h). */
export const BIOME = {
  plains: 1,
  desert: 2,
  taiga: 5,
  snowy_tundra: 12,
  savanna: 35,
  meadow: 177,
} as const;

const NAMES: Record<number, string> = {
  [BIOME.plains]: 'Plains',
  [BIOME.desert]: 'Desert',
  [BIOME.taiga]: 'Taiga',
  [BIOME.snowy_tundra]: 'Snowy',
  [BIOME.savanna]: 'Savanna',
  [BIOME.meadow]: 'Meadow',
};

export function biomeName(id: number): string | null {
  return NAMES[id] ?? null;
}
