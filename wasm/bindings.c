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

/*
 * Double-checking.
 *
 * Scanning from the origin needs no spawn calculation at all, which makes it
 * around 270x faster than either spawn target (measured: 59,097 seeds/s
 * against 221). Double-checking keeps that speed for the scan and then pays
 * for one getSpawn() per seed that already matched, confirming the same
 * criteria around the real spawn and dropping the seed if they no longer hold.
 *
 * The radii still mean "from the origin"; this adds "and from the real spawn
 * as well" rather than replacing one with the other. It is not a faster way to
 * run a spawn-targeted search - there isn't one, because the spawn of every
 * seed has to be computed to know where its radius even is.
 *
 * An earlier attempt prefiltered on estimateSpawn() and confirmed with
 * getSpawn(). That turned out to be pointless: the two cost nearly the same
 * (230 against 221 seeds/s), so it was slower than just targeting the exact
 * spawn while returning identical results.
 */

/*
 * Spawn calculations allowed in one sf_run() call.
 *
 * The output cap bounds how many MATCHES a call returns, but not how much work
 * it does: a seed can pass the cheap check, pay for a spawn calculation, then
 * fail the check around that spawn and never count towards the cap. With an
 * origin scan reaching tens of thousands of seeds a second, the caller sizes
 * its blocks for that rate, and a block that then turns out to be dense in
 * near-misses can spend tens of seconds inside a single call. That call cannot
 * be interrupted, so progress stops and a stop request waits on it.
 *
 * Bounding the expensive work instead keeps a call near the caller's target of
 * roughly 100ms, since a spawn calculation costs about 4.5ms. Stopping early
 * is safe: sf_run() reports how many seeds it actually scanned and the caller
 * advances by that, so the rest are simply picked up next call.
 */
#define SF_SPAWN_BUDGET 24

/* Variant trait bits (see getVariant()). */
#define SF_TRAIT_ABANDONED   (1u << 0)  /* zombie village */
#define SF_TRAIT_GIANT       (1u << 1)  /* giant ruined portal */
#define SF_TRAIT_UNDERGROUND (1u << 2)
#define SF_TRAIT_AIRPOCKET   (1u << 3)
#define SF_TRAIT_BASEMENT    (1u << 4)  /* igloo with basement */
#define SF_TRAIT_CRACKED     (1u << 5)  /* geode with a crack */

/* Number of int32 values per criterion in the sf_configure() input array. */
#define SF_CRIT_INTS 10

/* Number of int32 values per proximity rule: [ critA, critB, maxDistance ]. */
#define SF_PAIR_INTS 3
#define SF_MAX_PAIRS 32

/* Candidate positions kept per criterion when proximity rules are in play. */
#define SF_MAX_CAND 24

/* Subtype filter: "no constraint". */
#define SF_ANY (-1)

/* Edition. Bedrock places structures with a different RNG entirely. */
#define SF_JAVA    0
#define SF_BEDROCK 1

/* Criterion kinds. */
#define SF_KIND_STRUCTURE 0
#define SF_KIND_BIOME     1

/* Biome criteria sample a scaled grid. The scale is chosen so the grid stays
 * within this many cells; a radius too large for even 1:256 is rejected. */
#define SF_BIOME_CELL_BUDGET 262144

/*
 * Bedrock structure placement.
 *
 * Bedrock divides the world into `spacing` x `spacing` chunk regions like Java
 * does, but derives the region's seed differently and draws the in-region
 * offset from a 32-bit Mersenne Twister rather than Java's LCG:
 *
 *   r_base = (rx*2570712328 + rz*4048968661 + salt) & 0xFFFFFFFF
 *   r_seed = (worldSeedLow32 + r_base) & 0xFFFFFFFF
 *
 * then, seeding MT19937 with r_seed and taking tempered outputs t0..t3 and
 * range = spacing - separation:
 *
 *   linear      ox = t0 % range              oz = t1 % range
 *   triangular  ox = (t0%range + t1%range)/2 oz = (t2%range + t3%range)/2
 *
 * Constants are Mojang's; the implementation here is our own.
 */
#define SF_SPREAD_LINEAR     0
#define SF_SPREAD_TRIANGULAR 1

/*
 * Nether region selection. Fortresses and bastions share one region grid and
 * the game builds exactly one of the pair per site, chosen by a third draw
 * from the same Mersenne Twister that placed it:
 *
 *   mt[2] % 6 >= 2  ->  bastion   (4 in 6)
 *   mt[2] % 6 <  2  ->  fortress  (2 in 6)
 *
 * The 2/3 bastion share matches what the wiki documents for Bedrock, and the
 * rule appears independently in bedrock-dev/MCBEStructureFinder and in
 * Nel-S/Chunkbiomes (a port of Chunkbase's own code). It is disabled in both,
 * so it is reverse engineering rather than a verified spec; the shared site
 * itself is exact either way. See vendor/patches/README.md.
 */
#define SF_PICK_ANY      0
#define SF_PICK_FORTRESS 1
#define SF_PICK_BASTION  2

typedef struct
{
    int type;       /* our structure id */
    uint32_t salt;
    int spacing;    /* region size, in chunks */
    int separation; /* minimum gap, in chunks */
    int spread;     /* SF_SPREAD_* */
    int pick;       /* SF_PICK_*: which half of a shared nether region */
} BedrockConfig;

/*
 * Note the shared entries. On Bedrock the four "temple" structures occupy one
 * region grid and the biome decides which of them appears, exactly as the old
 * Java Feature type did; the biome check downstream disambiguates. Nether
 * fortresses and bastions also share a grid, and the `pick` field says which
 * half of it a criterion wants.
 */
static const BedrockConfig g_bedrock[] = {
    { Village,         10387312,  34,  8, SF_SPREAD_TRIANGULAR, SF_PICK_ANY },
    { Mansion,         10387319,  80, 20, SF_SPREAD_TRIANGULAR, SF_PICK_ANY },
    { End_City,        10387313,  20, 11, SF_SPREAD_TRIANGULAR, SF_PICK_ANY },
    { Monument,        10387313,  32,  5, SF_SPREAD_TRIANGULAR, SF_PICK_ANY },
    { Ancient_City,    20083232,  24,  8, SF_SPREAD_TRIANGULAR, SF_PICK_ANY },
    { Outpost,        165745296,  80, 24, SF_SPREAD_TRIANGULAR, SF_PICK_ANY },
    { Treasure,        16842397,   4,  2, SF_SPREAD_TRIANGULAR, SF_PICK_ANY },
    { Ocean_Ruin,      14357621,  20,  8, SF_SPREAD_LINEAR,     SF_PICK_ANY },
    { Shipwreck,      165745295,  24,  4, SF_SPREAD_LINEAR,     SF_PICK_ANY },
    { Fortress,        30084232,  30,  4, SF_SPREAD_LINEAR,     SF_PICK_FORTRESS },
    { Bastion,         30084232,  30,  4, SF_SPREAD_LINEAR,     SF_PICK_BASTION },
    { Desert_Pyramid,  14357617,  32,  8, SF_SPREAD_LINEAR,     SF_PICK_ANY },
    { Igloo,           14357617,  32,  8, SF_SPREAD_LINEAR,     SF_PICK_ANY },
    { Swamp_Hut,       14357617,  32,  8, SF_SPREAD_LINEAR,     SF_PICK_ANY },
    { Jungle_Temple,   14357617,  32,  8, SF_SPREAD_LINEAR,     SF_PICK_ANY },
    { Ruined_Portal,   40552231,  40, 15, SF_SPREAD_LINEAR,     SF_PICK_ANY },
    { Ruined_Portal_N, 40552231,  25, 10, SF_SPREAD_LINEAR,     SF_PICK_ANY },
};
#define SF_BEDROCK_COUNT ((int)(sizeof(g_bedrock) / sizeof(g_bedrock[0])))

static const BedrockConfig *sf_bedrock_config(int type)
{
    int i;
    for (i = 0; i < SF_BEDROCK_COUNT; i++)
        if (g_bedrock[i].type == type)
            return &g_bedrock[i];
    return NULL;
}

/* --- MT19937, written to the published specification --- */

#define MT_N 624
#define MT_M 397
#define MT_MATRIX 0x9908b0dfUL
#define MT_UPPER 0x80000000UL
#define MT_LOWER 0x7fffffffUL

typedef struct { uint32_t mt[MT_N]; int idx; } Mt19937;

static void mtInit(Mt19937 *r, uint32_t seed)
{
    int i;
    r->mt[0] = seed;
    for (i = 1; i < MT_N; i++)
        r->mt[i] = (uint32_t)(1812433253UL * (r->mt[i-1] ^ (r->mt[i-1] >> 30)) + (uint32_t)i);
    r->idx = MT_N;
}

static void mtTwist(Mt19937 *r)
{
    int i;
    for (i = 0; i < MT_N; i++)
    {
        uint32_t y = (r->mt[i] & MT_UPPER) | (r->mt[(i+1) % MT_N] & MT_LOWER);
        uint32_t next = r->mt[(i + MT_M) % MT_N] ^ (y >> 1);
        if (y & 1)
            next ^= MT_MATRIX;
        r->mt[i] = next;
    }
    r->idx = 0;
}

static uint32_t mtNext(Mt19937 *r)
{
    uint32_t y;
    if (r->idx >= MT_N)
        mtTwist(r);
    y = r->mt[r->idx++];
    y ^= (y >> 11);
    y ^= (y << 7) & 0x9d2c5680UL;
    y ^= (y << 15) & 0xefc60000UL;
    y ^= (y >> 18);
    return y;
}

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
    int radius;     /* this criterion's own distance limit from the target */
    int subtype;    /* bastion type / portal template / stronghold ring, or SF_ANY */
    int dim;        /* DIM_OVERWORLD / DIM_NETHER / DIM_END */
    int slot;       /* index in the caller's criteria array */
    StructureConfig sconf;
    int hasconf;
    const BedrockConfig *bconf; /* non-NULL when searching Bedrock */
} Crit;

/*
 * "structure A must be within maxDist blocks of structure B"
 *
 * A rule may span the Overworld and the Nether, which is the useful case for
 * things like "a bastion near where this ruined portal drops you". Nether
 * coordinates are 1:8, so the Overworld side is divided by 8 and the whole
 * rule is measured in Nether blocks. `scaleA`/`scaleB` hold that divisor.
 */
typedef struct
{
    int a, b;
    int maxDist;
    int scaleA, scaleB;
} Pair;

static Generator g_gen[3];      /* indexed by dim + 1 */
static int       g_genready[3];
static SurfaceNoise g_ensn;
static int       g_ensnready;

static int  g_mc = MC_NEWEST;
static int  g_target = SF_TARGET_ORIGIN;
static int  g_verify = 0;       /* confirm matches against the exact spawn */
static int  g_ncrit = 0;
static Crit g_crit[SF_MAX_CRIT];
static int  g_needow = 0;       /* overworld generator needed for the target */
static int *g_bcache = NULL;    /* scratch for biome criteria */
static int  g_bcells = 0;
static int  g_bscale = 16;
static int  g_bside = 0;        /* grid width/height in cells */
static int  g_nbiome = 0;       /* how many criteria are biome criteria */
static int  g_edition = SF_JAVA;
static int  g_npair = 0;
static Pair g_pair[SF_MAX_PAIRS];

/* Candidate positions per criterion, filled when proximity rules are active. */
static Pos g_cand[SF_MAX_CRIT][SF_MAX_CAND];
static int g_ncand[SF_MAX_CRIT];
static int g_candbiome[SF_MAX_CRIT][SF_MAX_CAND];
static Pos g_chosen[SF_MAX_CRIT];
static int g_chosenbiome[SF_MAX_CRIT];

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
int sf_configure(int mc, int edition, int target, int verify,
                 const int32_t *crit, int ncrit,
                 const int32_t *pairs, int npairs)
{
    int i, d, pass;
    int n = 0;

    if (ncrit < 0 || ncrit > SF_MAX_CRIT)
        return -1;
    if (npairs < 0 || npairs > SF_MAX_PAIRS)
        return -1;

    g_mc = mc;
    g_edition = edition;
    /* Only an origin scan gains anything: the spawn targets already compute
     * the spawn for every seed they look at. */
    g_verify = verify && target == SF_TARGET_ORIGIN;
    g_target = target;
    /* Bedrock and Java only share a generator from 1.18, when the two were
     * unified onto the same noise and climate system. Before that the biome
     * checks below would be meaningless on Bedrock. */
    if (edition == SF_BEDROCK && mc < MC_1_18)
        return -9;
    g_ncrit = ncrit;
    g_nbiome = 0;
    g_npair = npairs;
    g_needow = (target != SF_TARGET_ORIGIN) || g_verify;

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
            c->radius  = in[8];
            c->subtype = in[9];
            c->slot    = i;
            c->hasconf = 0;
            c->bconf   = NULL;

            if (c->radius < 0)
                return -2;

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
                    if (edition == SF_BEDROCK)
                        return -10; /* Bedrock stronghold placement differs */
                }
                else if (edition == SF_BEDROCK)
                {
                    c->bconf = sf_bedrock_config(c->type);
                    if (!c->bconf)
                        return -10; /* not placed by the Bedrock generator */
                    /* getVariant() derives traits from chunkGenerateRnd, which
                     * is Java's LCG. On Bedrock those answers describe a
                     * different world, so refuse rather than filter on them.
                     * The village biome constraint is fine: that comes from
                     * biome generation, which the two editions share. */
                    if (c->tmask || c->areaMin || c->areaMax || c->subtype != SF_ANY)
                        return -11;
                    /* Still need the Java config for the biome checks. */
                    if (!getStructureConfig(c->type, mc, &c->sconf))
                        return -3;
                    c->hasconf = 1;
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

    /* Proximity rules refer to criteria by the caller's index; translate to
     * the internal (structures-first) order. */
    for (i = 0; i < npairs; i++)
    {
        int sa = pairs[i * SF_PAIR_INTS + 0];
        int sb = pairs[i * SF_PAIR_INTS + 1];
        int ia = -1, ib = -1, k;
        if (sa == sb)
            return -7;
        for (k = 0; k < ncrit; k++)
        {
            if (g_crit[k].slot == sa) ia = k;
            if (g_crit[k].slot == sb) ib = k;
        }
        if (ia < 0 || ib < 0)
            return -7;
        {
            int da = g_crit[ia].dim, db = g_crit[ib].dim;
            /* The End has no coordinate correspondence with the other two
             * dimensions, so a rule crossing into it is meaningless. */
            if (da != db && (da == DIM_END || db == DIM_END))
                return -8;
            /* Overworld <-> Nether is measured in Nether blocks, so the
             * Overworld side gets divided by 8. */
            g_pair[i].scaleA = (da != db && da == DIM_OVERWORLD) ? 8 : 1;
            g_pair[i].scaleB = (da != db && db == DIM_OVERWORLD) ? 8 : 1;
        }
        g_pair[i].a = ia;
        g_pair[i].b = ib;
        g_pair[i].maxDist = pairs[i * SF_PAIR_INTS + 2];
        if (g_pair[i].maxDist < 0)
            return -2;
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
        int br = 0;
        for (i = 0; i < ncrit; i++)
            if (g_crit[i].kind == SF_KIND_BIOME && g_crit[i].radius > br)
                br = g_crit[i].radius;
        g_bscale = 16;
        for (;;)
        {
            side = (int64_t) (2 * br) / g_bscale + 2;
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

/*
 * Bedrock's generation-attempt position for one region.
 *
 * Returns 0 when the region does not hold the requested structure, which only
 * happens for the shared nether grid. The +8 puts the coordinate on the
 * structure's starting block rather than the chunk corner, matching what
 * Chunkbase reports.
 */
static int sf_bedrock_pos(const BedrockConfig *bc, uint64_t seed,
                          int regX, int regZ, Pos *pos)
{
    Mt19937 r;
    uint32_t range = (uint32_t)(bc->spacing - bc->separation);
    uint32_t base, ox, oz;

    base = (uint32_t)((uint32_t)regX * 2570712328u
                    + (uint32_t)regZ * 4048968661u
                    + bc->salt);
    mtInit(&r, (uint32_t)(((uint32_t)seed) + base));

    if (range == 0)
    {
        ox = oz = 0;
    }
    else if (bc->spread == SF_SPREAD_TRIANGULAR)
    {
        uint32_t t0 = mtNext(&r) % range;
        uint32_t t1 = mtNext(&r) % range;
        uint32_t t2 = mtNext(&r) % range;
        uint32_t t3 = mtNext(&r) % range;
        ox = (t0 + t1) / 2;
        oz = (t2 + t3) / 2;
    }
    else
    {
        ox = mtNext(&r) % range;
        oz = mtNext(&r) % range;
    }

    /* The draw right after the offsets decides which of the pair is built. */
    if (bc->pick != SF_PICK_ANY)
    {
        int bastion = (int)(mtNext(&r) % 6) >= 2;
        if (bastion != (bc->pick == SF_PICK_BASTION))
            return 0;
    }

    pos->x = (int)((((int64_t)regX * bc->spacing + ox) * 16) + 8);
    pos->z = (int)((((int64_t)regZ * bc->spacing + oz) * 16) + 8);
    return 1;
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
        int spacing = c->bconf ? c->bconf->spacing : c->sconf.regionSize;
        int rs = spacing << 4;
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
                if (c->bconf)
                {
                    if (!sf_bedrock_pos(c->bconf, seed, rx, rz, &p))
                        continue;
                }
                else if (!getStructurePos(c->type, g_mc, seed, rx, rz, &p))
                {
                    continue;
                }
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

    if (!c->tmask && !c->areaMin && !c->areaMax && c->subtype == SF_ANY)
        return 1;
    if (!getVariant(&sv, c->type, g_mc, seed, p.x, p.z, biome))
        return 0;

    /* Subtype is the structure's starting piece index:
     *   Bastion       0 housing units, 1 hoglin stables, 2 treasure, 3 bridge
     *   Ruined portal 1..10 for normal portals, 1..3 for giant ones
     * Both come straight out of getVariant()'s `start`. */
    if (c->subtype != SF_ANY && (int) sv.start != c->subtype)
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

/* Inserts a position into a distance-sorted candidate list (nearest first). */
static void sf_insert(Pos *list, int *biomes, int *n, int max, Pos p, int biome,
                      int cx, int cz)
{
    int64_t dx = (int64_t) p.x - cx, dz = (int64_t) p.z - cz;
    int64_t d2 = dx * dx + dz * dz;
    int i, j;

    for (i = 0; i < *n; i++)
    {
        int64_t ex = (int64_t) list[i].x - cx, ez = (int64_t) list[i].z - cz;
        if (d2 < ex * ex + ez * ez)
            break;
    }
    if (i >= max)
        return;
    for (j = (*n < max ? *n : max - 1); j > i; j--)
    {
        list[j] = list[j - 1];
        biomes[j] = biomes[j - 1];
    }
    list[i] = p;
    biomes[i] = biome;
    if (*n < max)
        (*n)++;
}

/*
 * Collects biome cells within radius of (cx, cz) by generating one scaled
 * grid around the target and scanning it, nearest first.
 *
 * The grid is sampled at 1:16 where it fits, coarsening to 1:64 or 1:256 for
 * large radii. Coarse sampling can step over a patch smaller than the sample
 * spacing, so this can miss a small biome patch - it never invents one.
 */
static int sf_collect_biome(const Crit *c, int cx, int cz, int r, Pos *out,
                            int *biomes, int max)
{
    Generator *g = sf_gen(DIM_OVERWORLD);
    Range rng;
    int ix, iz, n = 0;

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
            Pos p;
            if (g_bcache[iz * g_bside + ix] != c->variant)
                continue;
            p.x = (int) ((int64_t) (rng.x + ix) * g_bscale);
            p.z = (int) ((int64_t) (rng.z + iz) * g_bscale);
            if (!sf_within(p.x, p.z, cx, cz, r))
                continue;
            sf_insert(out, biomes, &n, max, p, c->variant, cx, cz);
        }
    }
    return n;
}

/*
 * Collects every position satisfying one criterion within `r` of (cx, cz),
 * nearest first, capped at `max`.
 *
 * `max` is 1 for a plain AND search, where the first hit is enough. It is
 * larger once proximity rules are in play, because then the solver has to be
 * able to try a different instance of the same structure.
 */
static int sf_collect(const Crit *c, uint64_t seed, int cx, int cz, int r,
                      Pos *out, int *biomes, int max)
{
    Pos hits[SF_MAX_HITS];
    int n, i, found = 0;
    Generator *g = sf_gen(c->dim);

    if (c->kind == SF_KIND_BIOME)
        return sf_collect_biome(c, cx, cz, r, out, biomes, max);

    if (c->type == SF_STRONGHOLD)
    {
        StrongholdIter sh;
        int k;
        initFirstStronghold(&sh, g_mc, seed);
        for (k = 0; k < 256; k++)
        {
            /* nextStronghold() bumps ringnum only once a ring is exhausted,
             * so the ring of the stronghold it is about to return has to be
             * read before the call, not after. */
            int ring = sh.ringnum + 1;
            if (!nextStronghold(&sh, g))
                break;
            /* Subtype on a stronghold selects its ring, counted from 1. */
            if (c->subtype == SF_ANY || ring == c->subtype)
            {
                if (sf_within(sh.pos.x, sh.pos.z, cx, cz, r))
                {
                    sf_insert(out, biomes, &found, max, sh.pos, -1, cx, cz);
                    if (found >= max && max == 1)
                        return found;
                }
            }
            {
                int64_t dx = sh.pos.x - (int64_t) cx;
                int64_t dz = sh.pos.z - (int64_t) cz;
                if (sqrt((double)(dx * dx + dz * dz)) > r + 8192)
                    break;
            }
        }
        return found;
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

        sf_insert(out, biomes, &found, max, hits[i],
                  c->type == Village ? viable : -1, cx, cz);
        if (found >= max && max == 1)
            return found;
    }
    return found;
}

/* Convenience wrapper: does at least one position satisfy this criterion? */
static int sf_confirm(const Crit *c, uint64_t seed, int cx, int cz, int r,
                      Pos *outpos, int *outbiome)
{
    Pos one;
    int biome = -1;
    if (sf_collect(c, seed, cx, cz, r, &one, &biome, 1) == 0)
        return 0;
    *outpos = one;
    *outbiome = biome;
    return 1;
}

/* ------------------------------------------------------------------ */
/* proximity rules                                                     */
/* ------------------------------------------------------------------ */

/* Are the choices made so far consistent with every fully-assigned rule? */
static int sf_pairs_ok(int upto)
{
    int i;
    for (i = 0; i < g_npair; i++)
    {
        const Pair *pr = &g_pair[i];
        int64_t dx, dz;
        if (pr->a > upto || pr->b > upto)
            continue; /* not decided yet */
        /* floordiv, not truncation, so the scaling is right on both sides of
         * the axes. */
        dx = floordiv(g_chosen[pr->a].x, pr->scaleA)
           - floordiv(g_chosen[pr->b].x, pr->scaleB);
        dz = floordiv(g_chosen[pr->a].z, pr->scaleA)
           - floordiv(g_chosen[pr->b].z, pr->scaleB);
        if (dx * dx + dz * dz > (int64_t) pr->maxDist * pr->maxDist)
            return 0;
    }
    return 1;
}

/*
 * Picks one position per criterion such that every proximity rule holds.
 *
 * Plain backtracking. The candidate lists are short (capped at SF_MAX_CAND,
 * nearest first) and a rule prunes as soon as both of its criteria are
 * assigned, so this stays cheap in practice.
 */
static int sf_solve(int k)
{
    int i;
    if (k >= g_ncrit)
        return 1;
    for (i = 0; i < g_ncand[k]; i++)
    {
        g_chosen[k] = g_cand[k][i];
        g_chosenbiome[k] = g_candbiome[k][i];
        if (!sf_pairs_ok(k))
            continue;
        if (sf_solve(k + 1))
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
/*
 * Places every criterion around a target point, applying any proximity rules.
 * `slack` widens each radius, which the double-check pass uses to allow for
 * the estimated spawn sitting slightly off the real one.
 *
 * On success g_chosen / g_chosenbiome hold the picked positions.
 */
static int sf_place(uint64_t seed, int cx, int cz, int slack)
{
    int want = (g_npair > 0) ? SF_MAX_CAND : 1;
    int k;

    for (k = 0; k < g_ncrit; k++)
    {
        const Crit *c = &g_crit[k];
        int ccx = cx, ccz = cz;
        if (c->dim == DIM_NETHER)
        {   /* nether criteria are measured in nether coordinates */
            ccx = (int) floordiv(cx, 8);
            ccz = (int) floordiv(cz, 8);
        }
        g_ncand[k] = sf_collect(c, seed, ccx, ccz, c->radius + slack,
                                g_cand[k], g_candbiome[k], want);
        if (g_ncand[k] == 0)
            return 0;
    }

    if (g_npair > 0)
        return sf_solve(0);

    for (k = 0; k < g_ncrit; k++)
    {
        g_chosen[k] = g_cand[k][0];
        g_chosenbiome[k] = g_candbiome[k][0];
    }
    return 1;
}

EMSCRIPTEN_KEEPALIVE
int sf_run(uint64_t start, int count, uint64_t *outSeeds, int32_t *outData,
           int32_t *outSpawn, int maxOut)
{
    int found = 0;
    int spawns = 0;    /* expensive spawn calculations used by this call */
    int i, k;
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

        /* Leave the rest of the block to the next call rather than running on
         * past the point where this one can still report in good time. */
        if (spawns >= SF_SPAWN_BUDGET)
            break;

        /* A Bedrock world seed is a full 64-bit value, exactly like Java's.
         * The split is in what reads it: structure placement uses only the low
         * 32 bits (which is why a 32-bit cracker can recover them from
         * structure positions alone), while biome generation uses all 64 (which
         * is why recovering the high half needs biome samples). sf_bedrock_pos
         * truncates for placement; everything else gets the whole seed. */

        g_scanned++;

        /* ---- stage 1 ------------------------------------------------ */
        for (k = 0; k < g_ncrit; k++)
        {
            const Crit *c = &g_crit[k];
            int ccx = cx, ccz = cz;
            int rr = c->radius + (g_target == SF_TARGET_ORIGIN ? 0 : SF_SPAWN_MARGIN);
            if (c->kind != SF_KIND_STRUCTURE)
                continue; /* biome criteria have no cheap positional stage */
            if (c->dim == DIM_NETHER)
            {   /* nether structures are filtered in nether coordinates */
                ccx = (int) floordiv(cx, 8);
                ccz = (int) floordiv(cz, 8);
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
                if (!sf_confirm(&g_crit[k], seed, 0, 0,
                                g_crit[k].radius + SF_SPAWN_MARGIN, &p, &biome))
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
            spawns++;
        }
        else if (g_target == SF_TARGET_EXACT)
        {
            Pos sp = getSpawn(sf_gen(DIM_OVERWORLD));
            cx = sp.x; cz = sp.z;
            spawns++;
        }
        else
        {
            cx = 0; cz = 0;
        }

        /* 2c: exact distance filtering around the target point. */
        if (!sf_place(seed, cx, cz, 0))
            continue;

        /* 2d: and again around the real spawn, for the few seeds that got
         * this far. The reported spawn is the exact one, not an estimate. */
        if (g_verify)
        {
            Pos sp = getSpawn(sf_gen(DIM_OVERWORLD));
            cx = sp.x;
            cz = sp.z;
            spawns++;
            if (!sf_place(seed, cx, cz, 0))
                continue;
        }

        for (k = 0; k < g_ncrit; k++)
        {
            const Crit *c = &g_crit[k];
            outData[(found * SF_MAX_CRIT + c->slot) * 4 + 0] = g_chosen[k].x;
            outData[(found * SF_MAX_CRIT + c->slot) * 4 + 1] = g_chosen[k].z;
            outData[(found * SF_MAX_CRIT + c->slot) * 4 + 2] = g_chosenbiome[k];
            outData[(found * SF_MAX_CRIT + c->slot) * 4 + 3] = c->dim;
        }

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

EMSCRIPTEN_KEEPALIVE
int sf_pair_ints(void) { return SF_PAIR_INTS; }

/* Whether a structure is placed by the Bedrock generator at all. */
EMSCRIPTEN_KEEPALIVE
int sf_bedrock_supported(int type)
{
    return sf_bedrock_config(type) != NULL;
}

EMSCRIPTEN_KEEPALIVE
int sf_max_pairs(void) { return SF_MAX_PAIRS; }

/* Whether a biome exists and generates in the overworld of a given version. */
EMSCRIPTEN_KEEPALIVE
int sf_biome_supported(int biomeId, int mc)
{
    return biomeExists(mc, biomeId) && isOverworld(mc, biomeId);
}

/* Bedrock generation-attempt position for one region, for tests and probing. */
EMSCRIPTEN_KEEPALIVE
int sf_bedrock_probe(int type, uint64_t seed, int regX, int regZ, int32_t *out)
{
    const BedrockConfig *bc = sf_bedrock_config(type);
    Pos p;
    if (!bc)
        return 0;
    if (!sf_bedrock_pos(bc, seed, regX, regZ, &p))
        return 0;
    out[0] = p.x;
    out[1] = p.z;
    out[2] = bc->spacing;
    out[3] = bc->separation;
    out[4] = bc->spread;
    return 1;
}
