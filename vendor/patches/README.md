# Cubiomes patches

Upstream [Cubiomes](https://github.com/Cubitect/cubiomes) has not been updated
since November 2024 and stops at the 1.21 Winter Drop. Minecraft has since
shipped 1.21.4 through 1.21.11 and then moved to year-based version numbers,
with 26.1 and 26.2 ("Chaos Cubed", June 2026).

`wasm/build.sh` compiles the pinned submodule with these patches applied to a
scratch copy, so `vendor/cubiomes` itself is never modified.

## Contents

| File | What it is |
| --- | --- |
| `versions.patch` | Extends the version enum to 26.2, selects the 1.21.5 biome tree, adds the `sulfur_caves` biome and its noise parameter range, and lets woodland mansions generate in pale gardens from 1.21.5. Version name strings in `util.c` are left alone; nothing here reads them. |
| `btree21_5.h` | The 1.21.5+ biome tree table. Generated data - it cannot be written by hand. |
| `btree262.h` | The 26.2 biome tree table, which is what actually places sulfur caves. |
| `portal_templates_data.json` | Ruined portal template layouts, including the chest offset within each template. **Staged, not used - see below.** |
| `loot_data/*.json` | Vanilla chest loot tables per version. **Staged, not used - see below.** |

`btree21_5.h` and the loot data come from
[EZ Seed Finder](https://github.com/codingsushi79/ezseedfinder) (MIT).
`btree262.h` originates from the SeedMapper cubiomes fork, by way of
[MCBE-seedcracker](https://github.com/Alist2930/MCBE-seedcracker). `versions.patch` is written for
this repository against the pinned submodule commit.

## What the version changes actually do

- **1.21.4** is the release formerly known in cubiomes as `MC_1_21_WD`
  (Garden Awakens, pale garden). The old name is kept as an alias.
- **1.21.5** (Spring to Life) expanded the pale garden and allowed woodland
  mansions to generate in it. It uses its own biome tree, hence `btree21_5.h`.
- **1.21.6 - 1.21.11** changed nothing about world generation.
- **26.1** (Tiny Takeover) changed nothing about world generation.
- **26.2** (Chaos Cubed) added the `sulfur_caves` biome, and its own biome
  tree to place it. Declaring the biome id is not enough on its own: without
  `btree262.h` the generator uses the 1.21.5 tree and can never emit sulfur
  caves, however many seeds you scan.

When upstream Cubiomes catches up, drop these patches and bump the submodule.

## Why the loot data is not wired up

Filtering seeds by what is inside a ruined portal's chest needs the chest's
exact block position, because Minecraft derives the container's loot seed from
it:

```
lootSeed = worldSeed + BlockPos.hashCode(x, y, z)     // (y + z*31)*31 + x
```

The x and z are obtainable - the template's chest offset plus the structure's
rotation and mirror gives them. **The y is not.** A ruined portal's altitude
follows the terrain, and Cubiomes cannot produce overworld surface height:
`mapApproxHeight()` is documented as "an approximation" at 1:4 horizontal
scale and returns a float.

That is not close enough. The loot seed is a hash, so a y that is one block
out produces an entirely unrelated RNG stream and therefore entirely different
items. There is no partial credit here - the answer is either exact or
meaningless.

EZ Seed Finder, which these data files come from, works around it by
hardcoding `place_y = 48 if nether else 64` and rolling from that. It is
deterministic, so it looks like it works, but for any portal not sitting
exactly at y=64 the loot it reports is not the loot the game will generate.
The same constant also feeds its crying-obsidian and frame-completeness
figures, so those carry the same problem.

We would rather ship no loot filter than one that quietly lies about chest
contents. The data is kept here so the feature can be finished the day a
source of exact structure altitude exists.
