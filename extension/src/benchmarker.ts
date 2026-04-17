/**
 * Code-Green System Benchmarker
 * ================================
 * Runs a quick set of micro-benchmarks on extension activation to calibrate
 * the heuristic Energy Weights (W) and physical model constants to the
 * actual hardware the developer is running on.
 *
 * Why this matters:
 *   The static weights (W=8.5 for O(n²), W=7.0 for I/O, etc.) were designed
 *   against a "reference" system. A MacBook M3, an Intel Core i5 laptop, and a
 *   cloud VM have very different CPU speeds, memory bandwidth, and I/O tail
 *   latency. This benchmark measures real timing ratios on the current system
 *   and scales all weights proportionally.
 *
 * Architecture:
 *   - Three micro-benchmarks, each < 100ms
 *   - Warm-up pass (3 runs, discarded) then 7 measured runs, median taken
 *   - Calibration factors = measured_ratio / reference_ratio
 *   - Results cached in VS Code globalState (re-run every 7 days or on demand)
 *
 * Reference ratios (what the static weights were calibrated against):
 *   CPU:          string += loop is ~800× slower than array join (V8 baseline)
 *   Memory:       repeated push_back is ~8× more GC pressure than pre-alloc
 *   Algorithmic:  O(n²) nested loop (n=400) is ~400× slower than O(n)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalibrationFactors {
    /** Scales CPU energy weights (string concat, LINQ, delete, etc.) */
    cpu: number;
    /** Scales Memory energy weights (GC pressure patterns) */
    memory: number;
    /**
     * Scales I/O energy weights.
     * We can't benchmark real file I/O safely in the extension host,
     * so I/O calibration uses the CPU factor as the closest proxy
     * (both are dominated by kernel scheduling overhead).
     */
    io: number;
    /** Scales Algorithmic energy weights (nested loops, etc.) */
    algorithmic: number;
}

export interface BenchmarkResult {
    /** Measured time ratio: vampire CPU pattern vs optimal */
    cpuRatio: number;
    /** Measured time ratio: repeated allocation vs pre-allocated */
    memRatio: number;
    /** Measured time ratio: O(n²) nested loop vs O(n) linear */
    algorithmicRatio: number;
    /** Calibration factors derived from the ratios */
    calibrationFactors: CalibrationFactors;
    systemInfo: {
        platform: string;
        arch: string;
        /** Total wall-clock time the benchmark suite took (ms) */
        benchmarkMs: number;
        timestamp: string;
    };
}

// ─── Reference Ratios ─────────────────────────────────────────────────────────
// The time ratios we assumed when assigning the static W values.
// Calibration factor = measured / reference.

/** V8 baseline: string += in 2000-iter loop vs array.push+join */
const REF_CPU_RATIO = 800;

/** Baseline: repeated array push without hint vs pre-allocated Float64Array */
const REF_MEM_RATIO = 8;

/** Baseline: O(n²) for n=400 (160 000 ops) vs O(n) for 160 000 iterations */
const REF_ALG_RATIO = 400;

// ─── Benchmark Helpers ────────────────────────────────────────────────────────

/** Run fn() N times and return the median duration in microseconds */
function medianUs(fn: () => void, runs: number): number {
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
        const t0 = process.hrtime.bigint();
        fn();
        const t1 = process.hrtime.bigint();
        times.push(Number(t1 - t0) / 1000); // ns → μs
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
}

/** Prevent dead-code elimination by returning a value the compiler can't predict */
let _sink: any = 0;

// ─── CPU Benchmark ────────────────────────────────────────────────────────────

/**
 * Measures: String += in a tight loop (vampire) vs Array.push + join (optimal).
 *
 * String concatenation in a loop is the canonical CPU vampire because each
 * iteration copies the entire accumulated string, giving O(n²) total work.
 * Array join does O(n) work. The ratio measures how bad the vampire is on
 * this JS engine and CPU speed.
 */
function benchmarkCPU(): number {
    const ITERS = 2000;
    const RUNS = 7;
    const WARMUP = 3;

    const vampire = () => {
        let s = '';
        for (let i = 0; i < ITERS; i++) s += 'x';
        _sink = s.length; // prevent DCE
    };

    const optimal = () => {
        const parts: string[] = [];
        for (let i = 0; i < ITERS; i++) parts.push('x');
        _sink = parts.join('').length;
    };

    // Warm up
    for (let i = 0; i < WARMUP; i++) { vampire(); optimal(); }

    const vampireUs = medianUs(vampire, RUNS);
    const optimalUs = medianUs(optimal, RUNS);

    // Guard against division by zero on extremely fast systems
    if (optimalUs < 0.1) return REF_CPU_RATIO;
    return vampireUs / optimalUs;
}

// ─── Memory Benchmark ─────────────────────────────────────────────────────────

/**
 * Measures: Repeated object allocation (vampire) vs pre-allocated typed array.
 *
 * The memory vampire triggers many small heap allocations, increasing GC
 * pressure. The optimal version uses a single contiguous TypedArray.
 * The ratio approximates the relative GC overhead.
 */
function benchmarkMemory(): number {
    const COUNT = 5000;
    const RUNS = 7;
    const WARMUP = 3;

    const vampire = () => {
        const arr: { x: number; y: number }[] = [];
        for (let i = 0; i < COUNT; i++) arr.push({ x: i, y: i * 2 });
        _sink = arr[COUNT - 1].y;
    };

    const optimal = () => {
        const buf = new Float64Array(COUNT * 2);
        for (let i = 0; i < COUNT; i++) { buf[i * 2] = i; buf[i * 2 + 1] = i * 2; }
        _sink = buf[(COUNT - 1) * 2 + 1];
    };

    for (let i = 0; i < WARMUP; i++) { vampire(); optimal(); }

    const vampireUs = medianUs(vampire, RUNS);
    const optimalUs = medianUs(optimal, RUNS);

    if (optimalUs < 0.1) return REF_MEM_RATIO;
    return vampireUs / optimalUs;
}

// ─── Algorithmic Benchmark ────────────────────────────────────────────────────

/**
 * Measures: O(n²) nested loop vs O(n) single loop (same total work volume).
 *
 * n=400 → O(n²) does 160 000 multiply-adds.
 * O(n)  does 160 000 add operations.
 * The ratio captures cache-miss and branch-prediction costs of the nested
 * access pattern vs linear stride — the real energy penalty of O(n²).
 */
function benchmarkAlgorithmic(): number {
    const N = 400;
    const LINEAR_N = N * N; // 160 000
    const RUNS = 7;
    const WARMUP = 3;

    const vampire = () => {
        let sum = 0;
        for (let i = 0; i < N; i++)
            for (let j = 0; j < N; j++)
                sum += i * j;
        _sink = sum;
    };

    const optimal = () => {
        let sum = 0;
        for (let i = 0; i < LINEAR_N; i++) sum += i;
        _sink = sum;
    };

    for (let i = 0; i < WARMUP; i++) { vampire(); optimal(); }

    const vampireUs = medianUs(vampire, RUNS);
    const optimalUs = medianUs(optimal, RUNS);

    if (optimalUs < 0.1) return REF_ALG_RATIO;
    return vampireUs / optimalUs;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the full benchmark suite and return calibrated factors.
 *
 * This is designed to complete in < 500ms on any modern system.
 * Call this on extension activation and cache the result.
 */
export function runSystemBenchmark(): BenchmarkResult {
    const wallStart = Date.now();

    const cpuRatio = benchmarkCPU();
    const memRatio = benchmarkMemory();
    const algorithmicRatio = benchmarkAlgorithmic();

    const benchmarkMs = Date.now() - wallStart;

    // Calibration factor = measured / reference
    // Factor > 1 → this system's vampire patterns are WORSE than reference
    // Factor < 1 → this system is faster/more optimized than reference
    const cpuFactor        = clamp(cpuRatio / REF_CPU_RATIO, 0.2, 5.0);
    const memFactor        = clamp(memRatio / REF_MEM_RATIO, 0.2, 5.0);
    const algorithmicFactor = clamp(algorithmicRatio / REF_ALG_RATIO, 0.2, 5.0);

    const calibrationFactors: CalibrationFactors = {
        cpu:          cpuFactor,
        memory:       memFactor,
        io:           cpuFactor,       // CPU proxy for I/O kernel overhead
        algorithmic:  algorithmicFactor,
    };

    return {
        cpuRatio,
        memRatio,
        algorithmicRatio,
        calibrationFactors,
        systemInfo: {
            platform:     process.platform,
            arch:         process.arch,
            benchmarkMs,
            timestamp:    new Date().toISOString(),
        },
    };
}

/** Cache key for VS Code globalState */
export const BENCHMARK_CACHE_KEY = 'code-green.benchmarkResult';

/** Re-run benchmark if cached result is older than this many days */
export const BENCHMARK_CACHE_DAYS = 7;

/** Check whether a cached result is still fresh */
export function isBenchmarkFresh(cached: BenchmarkResult | undefined): boolean {
    if (!cached) return false;
    const age = Date.now() - new Date(cached.systemInfo.timestamp).getTime();
    return age < BENCHMARK_CACHE_DAYS * 24 * 60 * 60 * 1000;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
