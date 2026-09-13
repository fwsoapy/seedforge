/*
 * SeedForge - WebAssembly bindings around Cubiomes.
 *
 * Exposes a chunked, cancellable seed search to JavaScript. The search is
 * deliberately split into two stages, as structure placement only depends on
 * cheap deterministic RNG math, while the biome confirmation is expensive:
 *
 *   stage 1  getStructurePos()        -> candidate positions, distance filter
 *   stage 2  isViableStructurePos()   -> biome/terrain confirmation
 *
 * Stage 2 only ever runs for seeds that already survived stage 1 for every
 * criterion the user selected.
 */

#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdint.h>

#include "finders.h"
#include "generator.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#define SF_MAX_CRIT     16
#define SF_MAX_HITS     64

/* Pseudo structure types that live outside cubiomes' StructureType enum. */
#define SF_STRONGHOLD   (FEATURE_NUM + 0)

/* Target-point modes. */
#define SF_TARGET_ORIGIN    0
#define SF_TARGET_ESTIMATE  1
#define SF_TARGET_EXACT     2

/* World spawn is not at the origin, so when filtering against spawn we widen
 * the stage-1 radius by this margin and re-check exactly in stage 2.
 * estimateSpawn() searches a 2048 block box in 1.18+ and 256 blocks before
 * that; getSpawn() may wander a little further, hence the slack. */
#define SF_SPAWN_MARGIN 2816

/* Variant trait bits (see getVariant()). */
#define SF_TRAIT_ABANDONED   (1u << 0)  /* zombie village */
#define SF_TRAIT_GIANT       (1u << 1)  /* giant ruined portal */
#define SF_TRAIT_UNDERGROUND (1u << 2)
#define SF_TRAIT_AIRPOCKET   (1u << 3)
#define SF_TRAIT_BASEMENT    (1u << 4)  /* igloo with basement */
#define SF_TRAIT_CRACKED     (1u << 5)  /* geode with a crack */

/* Number of int32 values per criterion in the sf_configure() input array. */
#define SF_CRIT_INTS 8

/* Criterion kinds. */
#define SF_KIND_STRUCTURE 0
#define SF_KIND_BIOME     1

/* Biome criteria sample a scaled grid. The scale is chosen so the grid stays
 * within this many cells; a radius too large for even 1:256 is rejected. */
#define SF_BIOME_CELL_BUDGET 262144

typedef struct
{
    int kind;       /* SF_KIND_* */
    int type;       /* StructureType or SF_STRONGHOLD */
    int variant;    /* village biome constraint, or the wanted biome id */
    uint32_t treq;  /* required trait bits */
    uint32_t tmask; /* which trait bits are constrained */
    int areaMin;    /* starting-piece footprint bounds, 0 = unconstrained */
    int areaMax;
    int sampleY;    /* biome criteria: block height to sample at */
    int dim;        /* DIM_OVERWORLD / DIM_NETHER / DIM_END */
    int slot;       /* index in the caller's criteria array */
    StructureConfig sconf;
    int hasconf;
} Crit;

static Generator g_gen[3];      /* indexed by dim + 1 */
static int       g_genready[3];
static SurfaceNoise g_ensn;
static int       g_ensnready;

static int  g_mc = MC_NEWEST;
static int  g_radius = 500;
static int  g_target = SF_TARGET_ORIGIN;
static int  g_ncrit = 0;
static Crit g_crit[SF_MAX_CRIT];
static int  g_needow = 0;       /* overworld generator needed for the target */
static int *g_bcache = NULL;    /* scratch for biome criteria */
static int  g_bcells = 0;
static int  g_bscale = 16;
static int  g_bside = 0;        /* grid width/height in cells */
static int  g_nbiome = 0;       /* how many criteria are biome criteria */

/* Last-run statistics, read back through sf_stat_*(). */
static uint64_t g_scanned = 0;
static uint64_t g_stage2 = 0;

static inline int sf_dim_of(int type)
{
    switch (type)
    {
    case Fortress:
    case Bastion:
    case Ruined_Portal_N:
        return DIM_NETHER;
    case End_City:
    case End_Gateway:
    case End_Island:
        return DIM_END;
    default:
        return DIM_OVERWORLD;
    }
}

static inline Generator *sf_gen(int dim)
{
    return &g_gen[dim + 1];
}

/* ------------------------------------------------------------------ */
/* configuration                                                       */
/* ------------------------------------------------------------------ */

/* Returns non-zero when a structure type exists in the given MC version. */
EMSCRIPTEN_KEEPALIVE
int sf_supported(int type, int mc)
{
    StructureConfig sc;
    if (type == SF_STRONGHOLD)
        return mc >= MC_1_0;
    return getStructureConfig(type, mc, &sc) != 0;
}

EMSCRIPTEN_KEEPALIVE
int sf_region_size(int type, int mc)
{
    StructureConfig sc;
    if (type == SF_STRONGHOLD)
        return 0;
    if (!getStructureConfig(type, mc, &sc))
        return 0;
    return sc.regionSize;
}

EMSCRIPTEN_KEEPALIVE
int sf_mc_newest(void)
{
    return MC_NEWEST;
}

/*
 * Configure the search.
 *
 * crit is a flat int32 array of SF_CRIT_INTS values per criterion:
 *   [ type, variantBiomeId (-1 = any), traitRequired, traitMask,
 *     startPieceAreaMin, startPieceAreaMax ]
 *
 * Returns the number of accepted criteria, or a negative error code.
 */
EMSCRIPTEN_KEEPALIVE
int sf_configure(int mc, int radius, int target, const int32_t *crit, int ncrit)
{
    int i, d, pass;
    int n = 0;

    if (ncrit < 0 || ncrit > SF_MAX_CRIT)
        return -1;
    if (radius < 0)
        return -2;

    g_mc = mc;
    g_radius = radius;
    g_target = target;
    g_ncrit = ncrit;
    g_nbiome = 0;
    g_needow = (target != SF_TARGET_ORIGIN);

    for (d = 0; d < 3; d++)
        g_genready[d] = 0;
    g_ensnready = 0;

    /* Structure criteria are loaded first so that stage 2 always rejects on
     * the cheaper checks before it touches the biome grid. `slot` keeps the
     * caller's original ordering for the output buffer. */
    for (pass = 0; pass < 2; pass++)
    {
        for (i = 0; i < ncrit; i++)
        {
            const int32_t *in = crit + i * SF_CRIT_INTS;
            int kind = in[0];
            Crit *c;

            if (kind != (pass == 0 ? SF_KIND_STRUCTURE : SF_KIND_BIOME))
                continue;

            c = &g_crit[n++];
            c->kind    = kind;
            c->type    = in[1];
            c->variant = in[2];
            c->treq    = (uint32_t) in[3];
            c->tmask   = (uint32_t) in[4];
            c->areaMin = in[5];
            c->areaMax = in[6];
            c->sampleY = in[7];
            c->slot    = i;
            c->hasconf = 0;

            if (kind == SF_KIND_BIOME)
            {
                c->dim = DIM_OVERWORLD;
                if (!biomeExists(mc, c->variant) || !isOverworld(mc, c->variant))
                    return -4;
                g_nbiome++;
            }
            else
            {
                c->dim = sf_dim_of(c->type);
                if (c->type == SF_STRONGHOLD)
                {
                    if (mc < MC_1_0)
                        return -3;
                }
                else
                {
                    if (!getStructureConfig(c->type, mc, &c->sconf))
                        return -3;
                    c->hasconf = 1;
                }
            }

            if (c->dim == DIM_OVERWORLD)
                g_needow = 1;
            g_genready[c->dim + 1] = 1;
        }
    }

    if (g_needow)
        g_genready[DIM_OVERWORLD + 1] = 1;

    for (d = 0; d < 3; d++)
        if (g_genready[d])
            setupGenerator(&g_gen[d], mc, 0);

    /* Size the biome sampling grid, coarsening the scale until it fits. */
    free(g_bcache);
    g_bcache = NULL;
    g_bcells = 0;
    if (g_nbiome > 0)
    {
        int64_t side;
        g_bscale = 16;
        for (;;)
        {
            side = (int64_t) (2 * radius) / g_bscale + 2;
            if (side * side <= SF_BIOME_CELL_BUDGET)
                break;
            if (g_bscale >= 256)
                return -5; /* radius too large for a biome search */
            g_bscale *= 4;
        }
        g_bside = (int) side;
        g_bcells = g_bside * g_bside;
        g_bcache = (int *) malloc((size_t) g_bcells * sizeof(int));
        if (!g_bcache)
            return -6;
    }

    g_scanned = 0;
    g_stage2 = 0;
    return ncrit;
}

/* ------------------------------------------------------------------ */
/* stage 1: cheap candidate positions                                  */
/* ------------------------------------------------------------------ */

static inline int sf_within(int px, int pz, int cx, int cz, int r)
{
    int64_t dx = (int64_t) px - cx;
    int64_t dz = (int64_t) pz - cz;
    return dx * dx + dz * dz <= (int64_t) r * r;
}

/* Collects generation-attempt positions of one structure type within radius r
 * of (cx, cz). Returns the number of hits written (capped at SF_MAX_HITS). */
static int sf_candidates(const Crit *c, uint64_t seed, int cx, int cz, int r,
                         Pos *out)
{
    int n = 0;

    if (c->type == SF_STRONGHOLD)
    {
        StrongholdIter sh;
        int i;
        initFirstStronghold(&sh, g_mc, seed);
        /* Strongholds are emitted ring by ring at increasing distance. The
         * +/-112 block slack covers the error of the approximate position,
         * and the extra 4096 covers the spread within a single ring, which is
         * wider than the ring-to-ring step. */
        for (i = 0; i < 256; i++)
        {
            int64_t dx = sh.nextapprox.x - (int64_t) cx;
            int64_t dz = sh.nextapprox.z - (int64_t) cz;
            double d = sqrt((double)(dx * dx + dz * dz));
            if (d <= r + 112 && n < SF_MAX_HITS)
                out[n++] = sh.nextapprox;
            if (d > r + 112 + 4096)
                break;
            if (!nextStronghold(&sh, NULL))
                break;
        }
        return n;
    }

    {
        int rs = c->sconf.regionSize << 4;
        int rx0 = (int) floordiv(cx - r, rs);
        int rx1 = (int) floordiv(cx + r, rs);
        int rz0 = (int) floordiv(cz - r, rs);
        int rz1 = (int) floordiv(cz + r, rs);
        int rx, rz;
        Pos p;

        for (rz = rz0; rz <= rz1; rz++)
        {
            for (rx = rx0; rx <= rx1; rx++)
            {
                if (!getStructurePos(c->type, g_mc, seed, rx, rz, &p))
                    continue;
                if (!sf_within(p.x, p.z, cx, cz, r))
                    continue;
                if (n < SF_MAX_HITS)
                    out[n++] = p;
            }
        }
    }
    return n;
}

/* ------------------------------------------------------------------ */
/* stage 2: biome / variant confirmation                               */
/* ------------------------------------------------------------------ */

static int sf_traits_ok(const Crit *c, uint64_t seed, Pos p, int biome)
{
    StructureVariant sv;
    uint32_t t = 0;

    if (!c->tmask && !c->areaMin && !c->areaMax)
        return 1;
    if (!getVariant(&sv, c->type, g_mc, seed, p.x, p.z, biome))
        return 0;

    /* Footprint of the starting piece. This is real data from getVariant(),
     * but it is only a weak proxy for the village's final size: the jigsaw
     * expansion that actually decides that is not modelled by cubiomes.
     * Exposed as a best-effort filter, labelled experimental in the UI. */
    if (c->areaMin || c->areaMax)
    {
        int area = (int) sv.sx * (int) sv.sz;
        if (area <= 0)
            return 0;
        if (c->areaMin && area < c->areaMin)
            return 0;
        if (c->areaMax && area > c->areaMax)
            return 0;
    }
    if (!c->tmask)
        return 1;

    if (sv.abandoned)   t |= SF_TRAIT_ABANDONED;
    if (sv.giant)       t |= SF_TRAIT_GIANT;
    if (sv.underground) t |= SF_TRAIT_UNDERGROUND;
    if (sv.airpocket)   t |= SF_TRAIT_AIRPOCKET;
    if (sv.basement)    t |= SF_TRAIT_BASEMENT;
    if (sv.cracked)     t |= SF_TRAIT_CRACKED;

    return (t & c->tmask) == (c->treq & c->tmask);
}

/*
 * Looks for a biome within radius of (cx, cz) by generating one scaled grid
 * around the target and scanning it for the wanted id.
 *
 * The grid is sampled at 1:16 where it fits, coarsening to 1:64 or 1:256 for
 * large radii. Coarse sampling can step over a patch smaller than the sample
 * spacing, so this can miss a small biome patch - it never invents one.
 */
static int sf_find_biome(const Crit *c, int cx, int cz, int r, Pos *outpos)
{
    Generator *g = sf_gen(DIM_OVERWORLD);
    Range rng;
    int ix, iz;
    int64_t best = (int64_t) r * r + 1;
    int found = 0;

    if (!g_bcache)
        return 0;

    rng.scale = g_bscale;
    rng.x = (cx - r) / g_bscale;
    rng.z = (cz - r) / g_bscale;
    rng.sx = g_bside;
    rng.sz = g_bside;
    /* Vertical scaling is always 1:4 for the non-voronoi scales used here. */
    rng.y = c->sampleY >> 2;
    rng.sy = 1;

    if (genBiomes(g, g_bcache, rng) != 0)
        return 0;

    for (iz = 0; iz < g_bside; iz++)
    {
        for (ix = 0; ix < g_bside; ix++)
        {
            int64_t dx, dz, d2;
            if (g_bcache[iz * g_bside + ix] != c->variant)
                continue;
            dx = (int64_t) (rng.x + ix) * g_bscale - cx;
            dz = (int64_t) (rng.z + iz) * g_bscale - cz;
            d2 = dx * dx + dz * dz;
            if (d2 < best)
            {
                best = d2;
                outpos->x = (int) ((int64_t) (rng.x + ix) * g_bscale);
                outpos->z = (int) ((int64_t) (rng.z + iz) * g_bscale);
                found = 1;
            }
        }
    }
    return found;
}

/* Confirms one criterion. On success writes the winning position (and the
 * biome id reported by cubiomes) into out. */
static int sf_confirm(const Crit *c, uint64_t seed, int cx, int cz, int r,
                      Pos *outpos, int *outbiome)
{
    Pos hits[SF_MAX_HITS];
    int n, i;
    Generator *g = sf_gen(c->dim);

    if (c->kind == SF_KIND_BIOME)
    {
        if (!sf_find_biome(c, cx, cz, r, outpos))
            return 0;
        *outbiome = c->variant;
        return 1;
    }

    if (c->type == SF_STRONGHOLD)
    {
        StrongholdIter sh;
        int k;
        initFirstStronghold(&sh, g_mc, seed);
        for (k = 0; k < 256; k++)
        {
            if (!nextStronghold(&sh, g))
                break;
            if (sf_within(sh.pos.x, sh.pos.z, cx, cz, r))
            {
                *outpos = sh.pos;
                *outbiome = -1;
                return 1;
            }
            {
                int64_t dx = sh.pos.x - (int64_t) cx;
                int64_t dz = sh.pos.z - (int64_t) cz;
                if (sqrt((double)(dx * dx + dz * dz)) > r + 8192)
                    break;
            }
        }
        return 0;
    }

    n = sf_candidates(c, seed, cx, cz, r, hits);
    for (i = 0; i < n; i++)
    {
        int viable = isViableStructurePos(c->type, g, hits[i].x, hits[i].z,
                                          c->variant > 0 ? (uint32_t) c->variant : 0);
        if (!viable)
            continue;

        /* 1.18+ height-dependent structures: cheap terrain plausibility. */
        if (c->dim == DIM_OVERWORLD && g_mc >= MC_1_18 &&
            !isViableStructureTerrain(c->type, g, hits[i].x, hits[i].z))
            continue;

        if (c->type == End_City && g_ensnready &&
            !isViableEndCityTerrain(g, &g_ensn, hits[i].x, hits[i].z))
            continue;

        /* For villages, isViableStructurePos() returns the biome id of the
         * village type; for everything else it is just a boolean. */
        if (!sf_traits_ok(c, seed, hits[i], c->type == Village ? viable : -1))
            continue;

        *outpos = hits[i];
        *outbiome = (c->type == Village) ? viable : -1;
        return 1;
    }
    return 0;
}

/* ------------------------------------------------------------------ */
/* driver                                                              */
/* ------------------------------------------------------------------ */

/*
 * Scans `count` consecutive seeds starting at `start`.
 *
 * outSeeds : uint64 buffer, one entry per match
 * outData  : int32 buffer, 4 ints per criterion per match
 *            [ x, z, biomeId, dim ]
 * outSpawn : int32 buffer, 2 ints per match (target point used)
 *
 * Returns the number of matches written.
 */
EMSCRIPTEN_KEEPALIVE
int sf_run(uint64_t start, int count, uint64_t *outSeeds, int32_t *outData,
           int32_t *outSpawn, int maxOut)
{
    int found = 0;
    int i, k;
    int r1 = g_radius + (g_target == SF_TARGET_ORIGIN ? 0 : SF_SPAWN_MARGIN);
    Pos hits[SF_MAX_HITS];

    g_scanned = 0;
    g_stage2 = 0;

    if (g_ncrit == 0)
        return 0;

    for (i = 0; i < count && found < maxOut; i++)
    {
        uint64_t seed = start + (uint64_t) i;
        int pass = 1;
        int cx = 0, cz = 0;

        g_scanned++;

        /* ---- stage 1 ------------------------------------------------ */
        for (k = 0; k < g_ncrit; k++)
        {
            const Crit *c = &g_crit[k];
            int ccx = cx, ccz = cz, rr = r1;
            if (c->kind != SF_KIND_STRUCTURE)
                continue; /* biome criteria have no cheap positional stage */
            if (c->dim == DIM_NETHER)
            {   /* nether structures are filtered in nether coordinates */
                ccx = cx / 8;
                ccz = cz / 8;
            }
            if (sf_candidates(c, seed, ccx, ccz, rr, hits) == 0)
            {
                pass = 0;
                break;
            }
        }
        if (!pass)
            continue;

        /* ---- stage 2 ------------------------------------------------ */
        g_stage2++;

        if (g_genready[DIM_OVERWORLD + 1])
            applySeed(sf_gen(DIM_OVERWORLD), DIM_OVERWORLD, seed);
        if (g_genready[DIM_NETHER + 1])
            applySeed(sf_gen(DIM_NETHER), DIM_NETHER, seed);
        if (g_genready[DIM_END + 1])
        {
            applySeed(sf_gen(DIM_END), DIM_END, seed);
            initSurfaceNoise(&g_ensn, DIM_END, seed);
            g_ensnready = 1;
        }

        /* 2a: biome confirmation against the widened origin radius.
         * This runs BEFORE the spawn point is computed on purpose. Spawn
         * estimation is by far the most expensive call per seed (it searches
         * a 2048 block box for the fittest position in 1.18+), so anything
         * that can reject a seed more cheaply has to run first. */
        if (g_target != SF_TARGET_ORIGIN)
        {   /* The origin is (0,0) in every dimension, so one centre works
             * for overworld, nether and end criteria alike. */
            for (k = 0; k < g_ncrit; k++)
            {
                Pos p; int biome;
                if (g_crit[k].kind != SF_KIND_STRUCTURE)
                    continue;
                if (!sf_confirm(&g_crit[k], seed, 0, 0, r1, &p, &biome))
                {
                    pass = 0;
                    break;
                }
            }
            if (!pass)
                continue;
        }

        /* 2b: now the seed is worth the spawn calculation. */
        if (g_target == SF_TARGET_ESTIMATE)
        {
            Pos sp = estimateSpawn(sf_gen(DIM_OVERWORLD), NULL);
            cx = sp.x; cz = sp.z;
        }
        else if (g_target == SF_TARGET_EXACT)
        {
            Pos sp = getSpawn(sf_gen(DIM_OVERWORLD));
            cx = sp.x; cz = sp.z;
        }
        else
        {
            cx = 0; cz = 0;
        }

        /* 2c: exact distance filtering around the real target point. */
        for (k = 0; k < g_ncrit; k++)
        {
            const Crit *c = &g_crit[k];
            int ccx = cx, ccz = cz;
            Pos p; int biome;
            if (c->dim == DIM_NETHER)
            {
                ccx = cx / 8;
                ccz = cz / 8;
            }
            if (!sf_confirm(c, seed, ccx, ccz, g_radius, &p, &biome))
            {
                pass = 0;
                break;
            }
            outData[(found * SF_MAX_CRIT + c->slot) * 4 + 0] = p.x;
            outData[(found * SF_MAX_CRIT + c->slot) * 4 + 1] = p.z;
            outData[(found * SF_MAX_CRIT + c->slot) * 4 + 2] = biome;
            outData[(found * SF_MAX_CRIT + c->slot) * 4 + 3] = c->dim;
        }
        if (!pass)
            continue;

        outSeeds[found] = seed;
        outSpawn[found * 2 + 0] = cx;
        outSpawn[found * 2 + 1] = cz;
        found++;
    }

    return found;
}

EMSCRIPTEN_KEEPALIVE
double sf_stat_scanned(void) { return (double) g_scanned; }

EMSCRIPTEN_KEEPALIVE
double sf_stat_stage2(void) { return (double) g_stage2; }

EMSCRIPTEN_KEEPALIVE
int sf_max_crit(void) { return SF_MAX_CRIT; }

/* Convenience for the results panel: world spawn of a single seed. */
EMSCRIPTEN_KEEPALIVE
int sf_spawn(uint64_t seed, int mc, int exact, int32_t *out)
{
    Generator g;
    Pos p;
    setupGenerator(&g, mc, 0);
    applySeed(&g, DIM_OVERWORLD, seed);
    p = exact ? getSpawn(&g) : estimateSpawn(&g, NULL);
    out[0] = p.x;
    out[1] = p.z;
    return 1;
}

EMSCRIPTEN_KEEPALIVE
int sf_crit_ints(void) { return SF_CRIT_INTS; }

/* Whether a biome exists and generates in the overworld of a given version. */
EMSCRIPTEN_KEEPALIVE
int sf_biome_supported(int biomeId, int mc)
{
    return biomeExists(mc, biomeId) && isOverworld(mc, biomeId);
}
