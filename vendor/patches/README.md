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
| `portal_templates_data.json` | Ruined portal template layouts, used to locate the chest inside a portal. |
| `loot_data/*.json` | Vanilla chest loot tables per version. |

The table and data files come from
[EZ Seed Finder](https://github.com/codingsushi79/ezseedfinder) (MIT), which
maintains a patched Cubiomes ahead of upstream. `versions.patch` is written for
this repository against the pinned submodule commit.

## What the version changes actually do

- **1.21.4** is the release formerly known in cubiomes as `MC_1_21_WD`
  (Garden Awakens, pale garden). The old name is kept as an alias.
- **1.21.5** (Spring to Life) expanded the pale garden and allowed woodland
  mansions to generate in it. It uses its own biome tree, hence `btree21_5.h`.
- **1.21.6 - 1.21.11** changed nothing about world generation.
- **26.1** (Tiny Takeover) changed nothing about world generation.
- **26.2** (Chaos Cubed) added the `sulfur_caves` biome.

When upstream Cubiomes catches up, drop these patches and bump the submodule.
