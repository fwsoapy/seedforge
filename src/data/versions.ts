/**
 * Minecraft version constants, mirroring the `MCVersion` enum in
 * cubiomes/biomes.h. The numeric ids are what the WASM core expects.
 */

export interface McVersion {
  /** Cubiomes MCVersion enum value. */
  readonly id: number;
  /** Label shown in the version dropdown. */
  readonly label: string;
}

export const MC_VERSIONS: readonly McVersion[] = [
  { id: 28, label: '1.21 (Winter Drop)' },
  { id: 27, label: '1.21.3' },
  { id: 26, label: '1.21.1' },
  { id: 25, label: '1.20' },
  { id: 24, label: '1.19.4' },
  { id: 23, label: '1.19.2' },
  { id: 22, label: '1.18' },
  { id: 21, label: '1.17' },
  { id: 20, label: '1.16.5' },
  { id: 19, label: '1.16.1' },
  { id: 18, label: '1.15' },
  { id: 17, label: '1.14' },
  { id: 16, label: '1.13' },
  { id: 15, label: '1.12' },
  { id: 14, label: '1.11' },
  { id: 13, label: '1.10' },
  { id: 12, label: '1.9' },
  { id: 11, label: '1.8' },
  { id: 10, label: '1.7' },
] as const;

export const DEFAULT_VERSION = 26; // 1.21.1

export function versionLabel(id: number): string {
  return MC_VERSIONS.find((v) => v.id === id)?.label ?? `MC #${id}`;
}
