import { VampireCategory } from './energy-model';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnergyRule {
    id: string;
    description: string;
    alternative: string;
    category: VampireCategory;

    // ── Physics fields ──────────────────────────────────────────────────────

    /**
     * Heuristic energy weight W from spec §4.
     * Used in Sustainability Score: SS = 100 − (Σ severity_i × W_i) × log10(LOC)
     *
     * Canonical values from spec:
     *   O(n²) Algorithmic  → 8.5
     *   Redundant I/O      → 7.0
     *   Large Object Copy  → 5.5
     *   String Concat CPU  → 4.2
     */
    energyWeight: number;

    /**
     * Severity ordinal (1–3).
     *   1 = Minor inefficiency
     *   2 = Significant waste
     *   3 = Critical / exponential scaling
     */
    severity: 1 | 2 | 3;

    /**
     * CPU model: ratio of vampire CPU cycles to optimized cycles.
     * ΔC = (deltaC_ratio − 1) × baseline_cycles
     * Only used when category === 'CPU'.
     * e.g. 1000 means the vampire code is 1000× more expensive in cycles.
     */
    deltaC_ratio: number;

    /**
     * Memory model: how many more GC triggers the vampire causes vs. optimal.
     * Only used when category === 'Memory'.
     * e.g. 10 means vampire triggers GC 10× more often.
     */
    freqGC_ratio: number;

    /**
     * I/O model: number of small calls made where 1 bulk call would suffice.
     * Only used when category === 'I/O'.
     * e.g. 100 means 100 tiny I/O ops instead of 1 bulk op.
     */
    ioCallMultiplier: number;

    /** Pattern to match in source code */
    regex: RegExp;

    /**
     * @deprecated Legacy field kept for dashboard backward compat only.
     * Use deltaE_joules from EnergyResult instead.
     */
    saving: number;
}

// ─── Language Rules ───────────────────────────────────────────────────────────

export const LANGUAGE_RULES: Record<string, EnergyRule[]> = {

    // ── C-Style / Managed Languages ──────────────────────────────────────────

    "java": [
        {
            id: 'java-linked-list',
            description: 'LinkedList detected. ArrayList gives O(1) access vs O(n) traversal.',
            alternative: 'ArrayList',
            category: 'Memory',
            energyWeight: 5.5,      // Large Object Copy class
            severity: 2,
            deltaC_ratio: 1,        // N/A for Memory model
            freqGC_ratio: 8,        // LinkedList's node allocations trigger GC ~8× more
            ioCallMultiplier: 1,    // N/A
            regex: /new\s+LinkedList\s*(<.*?>)?\s*\(\s*\)/g,
            saving: 15,
        },
        {
            id: 'java-string-concat',
            description: 'String += in loop creates O(n²) intermediate allocations.',
            alternative: 'StringBuilder',
            category: 'CPU',
            energyWeight: 4.2,      // String Concat CPU class
            severity: 2,
            deltaC_ratio: 1000,     // 10⁶ cycles (vampire) vs 10³ cycles (StringBuilder)
            freqGC_ratio: 1,        // N/A
            ioCallMultiplier: 1,    // N/A
            regex: /(for|while)\s*\(.*?\)\s*\{[\s\S]*?\w+\s*\+=\s*.*?;[\s\S]*?\}/g,
            saving: 25,
        },
    ],

    "csharp": [
        {
            id: 'cs-list-to-array',
            description: 'ToList() in a loop creates redundant heap allocations.',
            alternative: 'Use existing collection directly',
            category: 'Memory',
            energyWeight: 5.5,
            severity: 2,
            deltaC_ratio: 1,
            freqGC_ratio: 6,        // Repeated ToList() triggers GC ~6× more
            ioCallMultiplier: 1,
            regex: /(for|foreach)\s*\(.*?\)\s*\{[\s\S]*?\.ToList\(\)[\s\S]*?\}/g,
            saving: 12,
        },
        {
            id: 'cs-linq-heavy',
            description: 'Heavy LINQ (Where/Select/OrderBy) inside hot loops.',
            alternative: 'Simple for/foreach with manual logic',
            category: 'CPU',
            energyWeight: 4.2,
            severity: 2,
            deltaC_ratio: 50,       // LINQ has ~50× overhead from delegate + iterator machinery
            freqGC_ratio: 1,
            ioCallMultiplier: 1,
            regex: /(for|foreach)\s*\(.*?\)\s*\{[\s\S]*?\.(Where|Select|OrderBy)[\s\S]*?\}/g,
            saving: 18,
        },
    ],

    "javascript": [
        {
            id: 'js-foreach-slow',
            description: 'Array.forEach prevents V8 loop optimizations (JIT deopt).',
            alternative: 'for...of or traditional for(i=0)',
            category: 'CPU',
            energyWeight: 4.2,
            severity: 1,
            deltaC_ratio: 5,        // ~5× overhead from closure + prototype chain in tight loops
            freqGC_ratio: 1,
            ioCallMultiplier: 1,
            regex: /\.forEach\s*\(\s*.*?\s*=>/g,
            saving: 5,
        },
        {
            id: 'js-delete',
            description: '"delete" on object properties de-optimizes the V8 hidden class.',
            alternative: 'Set property to undefined or null',
            category: 'CPU',
            energyWeight: 4.2,
            severity: 2,
            deltaC_ratio: 200,      // Causes V8 to deoptimize entire object, ~200× cycle overhead
            freqGC_ratio: 1,
            ioCallMultiplier: 1,
            regex: /delete\s+\w+\[.*?\]|delete\s+\w+\.\w+/g,
            saving: 20,
        },
    ],

    "typescript": [
        {
            id: 'ts-any',
            description: 'Using "any" bypasses type narrowing, causing unoptimized runtime checks.',
            alternative: 'Use strict types or unknown with guards',
            category: 'CPU',
            energyWeight: 4.2,
            severity: 1,
            deltaC_ratio: 3,        // ~3× extra cycle overhead from missed type-based JIT paths
            freqGC_ratio: 1,
            ioCallMultiplier: 1,
            regex: /:\s*any/g,
            saving: 3,
        },
    ],

    // ── Systems Languages ─────────────────────────────────────────────────────

    "cpp": [
        {
            id: 'cpp-endl',
            description: 'std::endl in loop forces a buffer flush on every iteration.',
            alternative: '"\\n" — flushes only when buffer is full',
            category: 'I/O',
            energyWeight: 7.0,      // Redundant I/O class
            severity: 2,
            deltaC_ratio: 1,
            freqGC_ratio: 1,
            ioCallMultiplier: 100,  // Assume 100-iteration loop → 100 flushes vs 1
            regex: /(for|while)\s*\(.*?\)\s*\{[\s\S]*?std::endl[\s\S]*?\}/g,
            saving: 40,
        },
        {
            id: 'cpp-vector-reserve',
            description: 'push_back without reserve() causes repeated reallocation.',
            alternative: 'vector.reserve(n) before filling',
            category: 'Memory',
            energyWeight: 5.5,
            severity: 2,
            deltaC_ratio: 1,
            freqGC_ratio: 12,       // ~log₂(n) reallocs for typical n=4096, modelled as 12×
            ioCallMultiplier: 1,
            regex: /(?<!\.reserve\(.*?\);[\s\S]*?)(for|while)\s*\(.*?\)\s*\{[\s\S]*?\.push_back\([\s\S]*?\}/g,
            saving: 18,
        },
    ],

    "rust": [
        {
            id: 'rust-clone',
            description: 'Excessive .clone() on large objects copies data unnecessarily.',
            alternative: 'Borrow with & instead of cloning',
            category: 'Memory',
            energyWeight: 5.5,
            severity: 1,
            deltaC_ratio: 1,
            freqGC_ratio: 4,        // Each clone triggers allocator, ~4× GC-equivalent pressure
            ioCallMultiplier: 1,
            regex: /\.clone\(\)/g,
            saving: 10,
        },
        {
            id: 'rust-unwrap',
            description: '.unwrap() in loops can trigger expensive panic paths.',
            alternative: 'match or if let for zero-cost error handling',
            category: 'CPU',
            energyWeight: 4.2,
            severity: 1,
            deltaC_ratio: 10,       // Panic path includes stack unwind overhead ~10× cycles
            freqGC_ratio: 1,
            ioCallMultiplier: 1,
            regex: /(for|loop|while)[\s\S]*?\.unwrap\(\)/g,
            saving: 5,
        },
    ],

    "go": [
        {
            id: 'go-slice-realloc',
            description: 'Appending to a slice without capacity hint causes repeated reallocation.',
            alternative: 'make([]T, 0, estimatedCap)',
            category: 'Memory',
            energyWeight: 5.5,
            severity: 2,
            deltaC_ratio: 1,
            freqGC_ratio: 10,       // Go GC pressure from repeated slice doubling
            ioCallMultiplier: 1,
            regex: /append\(\w+,\s*.*?\)/g,
            saving: 15,
        },
    ],

    // ── Scripting Languages ───────────────────────────────────────────────────

    "python": [
        {
            id: 'python-range-len',
            description: 'range(len()) anti-pattern: creates a throw-away index object.',
            alternative: 'enumerate() — O(1) index, zero extra allocation',
            category: 'CPU',
            energyWeight: 4.2,
            severity: 1,
            deltaC_ratio: 8,        // Extra int construction + len() call on each iteration
            freqGC_ratio: 1,
            ioCallMultiplier: 1,
            regex: /for\s+\w+\s+in\s+range\s*\(\s*len\s*\(.*?\)\s*\)\s*:/g,
            saving: 10,
        },
        {
            id: 'python-global',
            description: 'Global variable access in hot loop: LOAD_GLOBAL is ~2× slower than LOAD_FAST.',
            alternative: 'Cache global in a local variable before the loop',
            category: 'CPU',
            energyWeight: 4.2,
            severity: 1,
            deltaC_ratio: 2,        // LOAD_GLOBAL ≈ 2× LOAD_FAST in CPython bytecode
            freqGC_ratio: 1,
            ioCallMultiplier: 1,
            regex: /global\s+.*?\n[\s\S]*?for.*?in.*?:\s*[\s\S]*?\w+/g,
            saving: 8,
        },
    ],

    "ruby": [
        {
            id: 'ruby-each-slow',
            description: 'Block-form .each{} has interpreter dispatch overhead per iteration.',
            alternative: 'Symbol#to_proc shorthand: .each(&:method)',
            category: 'CPU',
            energyWeight: 4.2,
            severity: 1,
            deltaC_ratio: 4,        // Block dispatch ~4× heavier than Symbol#to_proc path
            freqGC_ratio: 1,
            ioCallMultiplier: 1,
            regex: /\.each\s*\{\s*\|\w+\|\s*\w+\.\w+\s*\}/g,
            saving: 7,
        },
    ],

    "php": [
        {
            id: 'php-count-loop',
            description: 'count() called on every loop iteration — recomputed each time.',
            alternative: 'Cache count value before loop: $len = count($arr)',
            category: 'CPU',
            energyWeight: 4.2,
            severity: 1,
            deltaC_ratio: 15,       // count() on large array is O(1) in PHP but triggers VM ops ~15×
            freqGC_ratio: 1,
            ioCallMultiplier: 1,
            regex: /for\s*\(\s*.*?;s*\w+\s*<\s*count\s*\(.*?\);/g,
            saving: 15,
        },
    ],

    // ── Specialized ───────────────────────────────────────────────────────────

    "sql": [
        {
            id: 'sql-select-star',
            description: 'SELECT * retrieves all columns — unnecessary data transferred over wire.',
            alternative: 'Specify only needed columns',
            category: 'I/O',
            energyWeight: 7.0,
            severity: 2,
            deltaC_ratio: 1,
            freqGC_ratio: 1,
            ioCallMultiplier: 10,   // Typically 10× more data transferred than necessary
            regex: /SELECT\s+\*\s+FROM/gi,
            saving: 30,
        },
        {
            id: 'sql-n-plus-one',
            description: 'N+1 query pattern: one query per row instead of a single JOIN.',
            alternative: 'JOIN or WHERE IN clause',
            category: 'I/O',
            energyWeight: 7.0,
            severity: 3,
            deltaC_ratio: 1,
            freqGC_ratio: 1,
            ioCallMultiplier: 100,  // N=100 rows → 100 queries vs 1
            regex: /SELECT\s+.*?\s+FROM\s+.*?\s+WHERE\s+\w+\s*=\s*\?/gi,
            saving: 50,
        },
    ],

    "shellscript": [
        {
            id: 'sh-cat-grep',
            description: 'Useless use of cat: spawns extra process for file reading.',
            alternative: 'grep pattern file — single process, no pipe overhead',
            category: 'I/O',
            energyWeight: 7.0,
            severity: 1,
            deltaC_ratio: 1,
            freqGC_ratio: 1,
            ioCallMultiplier: 2,    // cat spawns extra process: 2 I/O-bound processes vs 1
            regex: /cat\s+.*?\s*\|\s*grep/g,
            saving: 10,
        },
    ],

    // ── Universal Fallback ────────────────────────────────────────────────────

    "universal": [
        {
            id: 'uni-nested-loop',
            description: 'Triple-nested loop detected — O(n³) complexity. Exponential energy scaling.',
            alternative: 'Restructure algorithm — hash maps, memoization, or divide-and-conquer',
            category: 'Algorithmic',
            energyWeight: 8.5,      // O(n²)/Algorithmic class — highest weight in spec
            severity: 3,
            deltaC_ratio: 1,        // Algorithmic uses heuristic model, not CPU formula
            freqGC_ratio: 1,
            ioCallMultiplier: 1,
            regex: /(for|while|foreach)[\s\S]*?(for|while|foreach)[\s\S]*?(for|while|foreach)/g,
            saving: 45,
        },
    ],
};

// ─── Extension Map ────────────────────────────────────────────────────────────

/** Maps file extensions to VS Code language IDs */
export const EXTENSION_MAP: Record<string, string> = {
    "java": "java",
    "py": "python",
    "js": "javascript",
    "ts": "typescript",
    "cpp": "cpp",
    "cc": "cpp",
    "cxx": "cpp",
    "cs": "csharp",
    "go": "go",
    "rs": "rust",
    "swift": "swift",
    "php": "php",
    "rb": "ruby",
    "kt": "kotlin",
    "sql": "sql",
    "sh": "shellscript",
    "pl": "perl",
    "lua": "lua",
    "jl": "julia",
    "hs": "haskell",
    "r": "r",
    "dart": "dart",
    "scala": "scala",
    "gro": "groovy",
    "sol": "solidity",
    "m": "matlab",
    "f90": "fortran",
    "ex": "elixir",
};
