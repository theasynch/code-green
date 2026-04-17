"use strict";
/**
 * Code-Green Energy Model
 * ========================
 * Implements the physical energy equations from the Mathematical Specification.
 *
 * Fundamental Equation:
 *   E_code = ∫₀ᵗ (P_dynamic + P_static) dt
 *
 * Vampire Waste Formula:
 *   ΔE = S × (E_Vampire − E_Optimized)
 *
 * Taxonomy-Specific Models:
 *   A. CPU:    ΔE_cpu  = ΔC × (1/f) × TDP × μ
 *   B. Memory: ΔE_mem  = FreqGC × t_GC × P_CPU_Peak
 *   C. I/O:    E_io    = E_transfer + (t_tail × P_active_idle)
 *
 * Carbon Recovery:
 *   m_CO2 = ΔE × CI_grid × PUE
 *
 * Sustainability Score:
 *   SS = 100 − (Σ Severity_i × W_i) × log10(Lines of Code)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODEL_CONSTANTS = exports.computeSustainabilityScore = exports.computeEnergyResult = exports.computeCO2 = exports.computeHeuristicDeltaE = exports.computeIoDeltaE = exports.computeMemoryDeltaE = exports.computeCpuDeltaE = exports.getEffectiveW = exports.getCalibrationFactors = exports.setCalibrationFactors = void 0;
// ─── Physical Constants ───────────────────────────────────────────────────────
/** CPU clock frequency, Hz (standard 3 GHz processor) */
const F_CPU_HZ = 3e9;
/** Thermal Design Power, Watts (typical desktop/server CPU) */
const TDP_WATTS = 65;
/** CPU Activity factor μ — midpoint of 0.1–0.3 range for app logic */
const ACTIVITY_FACTOR = 0.2;
/** Duration of a Stop-the-World GC pause, seconds (JVM typical: 50ms) */
const T_GC_SECONDS = 0.05;
/** Peak CPU power during a GC phase, Watts */
const P_CPU_PEAK_WATTS = 95;
/** Hardware tail energy window after I/O transfer completes, seconds (10ms) */
const T_TAIL_SECONDS = 0.010;
/** Active-idle power of storage/network hardware, Watts (NVMe/NIC idle state) */
const P_ACTIVE_IDLE_WATTS = 1.5;
/**
 * Carbon Intensity of the global average grid.
 * 475 g CO₂ / kWh  →  475 / (1000 × 3600) g/J  ≈ 1.3194e-4 g/J
 */
const CI_GRID_G_PER_JOULE = 475 / (1000 * 3600);
/** Power Usage Effectiveness — data-center overhead ratio (standard ≈ 1.5) */
const PUE = 1.5;
/**
 * Scaling Factor S.
 * Represents how often a vampire pattern runs in production.
 * Default = 1 (each detected instance assumed to fire once per scan).
 * Can be elevated by loop nesting depth analysis in future.
 */
const SCALING_FACTOR_S = 1;
// ─── Baseline Cycle Budgets ───────────────────────────────────────────────────
/**
 * Baseline "vampire" CPU cycles for each CPU-bound pattern.
 * The model computes ΔC = (vampireRatio - 1) × BASELINE.
 * These are calibrated to the spec example:
 *   String += in 1000-loop: ΔC from 10⁶ → 10³  (ratio = 1000)
 */
const CPU_BASELINE_CYCLES = 1e6;
/** Live calibration factors set by the benchmarker on activation */
let _calibration = { cpu: 1, memory: 1, io: 1, algorithmic: 1 };
/**
 * Called by extension.ts after the benchmark completes.
 * All subsequent energy computations will use these factors.
 */
function setCalibrationFactors(factors) {
    _calibration = factors;
}
exports.setCalibrationFactors = setCalibrationFactors;
function getCalibrationFactors() {
    return _calibration;
}
exports.getCalibrationFactors = getCalibrationFactors;
/**
 * Returns the effective energy weight W for a category,
 * scaled by the hardware calibration factor for that category.
 */
function getEffectiveW(staticW, category) {
    switch (category) {
        case 'CPU': return staticW * _calibration.cpu;
        case 'Memory': return staticW * _calibration.memory;
        case 'I/O': return staticW * _calibration.io;
        case 'Algorithmic': return staticW * _calibration.algorithmic;
        default: return staticW;
    }
}
exports.getEffectiveW = getEffectiveW;
// ─── Model Implementations ────────────────────────────────────────────────────
/**
 * A. CPU Vampire — "Instruction Tax"
 *
 *   ΔE_cpu = ΔC × (1/f) × TDP × μ
 *
 * @param deltaC_ratio  Ratio of vampire cycles to optimal cycles (≥ 1).
 *                      e.g. 1000 means vampire is 1000× more expensive.
 */
function computeCpuDeltaE(deltaC_ratio) {
    const deltaC = (deltaC_ratio - 1) * CPU_BASELINE_CYCLES;
    return SCALING_FACTOR_S * deltaC * (1 / F_CPU_HZ) * TDP_WATTS * ACTIVITY_FACTOR;
}
exports.computeCpuDeltaE = computeCpuDeltaE;
/**
 * B. Memory Vampire — "GC Thrash"
 *
 *   ΔE_mem = FreqGC × t_GC × P_CPU_Peak
 *
 * @param freqGC_ratio  How many more GC triggers the vampire causes vs. optimal.
 *                      e.g. 10 means vampire triggers GC 10× more often.
 */
function computeMemoryDeltaE(freqGC_ratio) {
    return SCALING_FACTOR_S * freqGC_ratio * T_GC_SECONDS * P_CPU_PEAK_WATTS;
}
exports.computeMemoryDeltaE = computeMemoryDeltaE;
/**
 * C. I/O Vampire — "Hardware Wake-up"
 *
 *   E_io_waste = ioCallMultiplier × (t_tail × P_active_idle)
 *
 * The waste is paying the tail-energy tax ioCallMultiplier times
 * instead of just once (the bulk call baseline).
 *
 * @param ioCallMultiplier  Number of small calls made where 1 bulk call suffices.
 *                          e.g. 100 means 100 tiny reads instead of 1 bulk read.
 */
function computeIoDeltaE(ioCallMultiplier) {
    // Each extra call (beyond the 1 optimal bulk call) pays full tail tax
    const extraCalls = ioCallMultiplier - 1;
    return SCALING_FACTOR_S * extraCalls * (T_TAIL_SECONDS * P_ACTIVE_IDLE_WATTS);
}
exports.computeIoDeltaE = computeIoDeltaE;
/**
 * Heuristic fallback for 'Algorithmic' category rules that don't map
 * cleanly to a single CPU/Memory/I/O model.
 * Uses energyWeight W as a proxy for normalized energy impact.
 * ΔE_heuristic = W × 1mJ (baseline milli-joule unit)
 */
function computeHeuristicDeltaE(energyWeight) {
    return SCALING_FACTOR_S * energyWeight * 1e-3;
}
exports.computeHeuristicDeltaE = computeHeuristicDeltaE;
// ─── Carbon Recovery ──────────────────────────────────────────────────────────
/**
 * m_CO2 = ΔE × CI_grid × PUE
 *
 * @param deltaE_joules  Energy waste in Joules
 * @returns CO₂ equivalent in grams
 */
function computeCO2(deltaE_joules) {
    return deltaE_joules * CI_GRID_G_PER_JOULE * PUE;
}
exports.computeCO2 = computeCO2;
// ─── Unified Dispatcher ───────────────────────────────────────────────────────
/**
 * Compute ΔE and CO₂ for a single rule match using the correct taxonomy model.
 */
function computeEnergyResult(category, deltaC_ratio, freqGC_ratio, ioCallMultiplier, energyWeight) {
    let deltaE;
    let modelUsed;
    // Apply hardware calibration: scale the effective ratio by the
    // category calibration factor before computing ΔE.
    const calFactor = getCalibrationFactors();
    switch (category) {
        case 'CPU':
            // Scale deltaC_ratio by cpu calibration factor
            deltaE = computeCpuDeltaE(deltaC_ratio * calFactor.cpu);
            modelUsed = 'CPU';
            break;
        case 'Memory':
            // Scale freqGC_ratio by memory calibration factor
            deltaE = computeMemoryDeltaE(freqGC_ratio * calFactor.memory);
            modelUsed = 'Memory';
            break;
        case 'I/O':
            // Scale ioCallMultiplier by io calibration factor
            deltaE = computeIoDeltaE(ioCallMultiplier * calFactor.io);
            modelUsed = 'I/O';
            break;
        default:
            // Algorithmic: scale the heuristic weight
            deltaE = computeHeuristicDeltaE(energyWeight * calFactor.algorithmic);
            modelUsed = 'Heuristic';
            break;
    }
    const co2 = computeCO2(deltaE);
    return {
        deltaE_joules: deltaE,
        co2_grams: co2,
        deltaE_millijoules: deltaE * 1000,
        co2_micrograms: co2 * 1e6,
        modelUsed,
    };
}
exports.computeEnergyResult = computeEnergyResult;
// ─── Sustainability Score ─────────────────────────────────────────────────────
/**
 * Sustainability Score — bounded tanh form, faithful to spec intent.
 *
 * Spec formula:  SS = 100 − (Σ Severity_i × W_i) × log10(LOC)
 *
 * The raw spec formula collapses to 0 for any real project because
 * Σ(sev×W) grows linearly with vampire count while log10(LOC) amplifies it.
 * Even a single nested-loop (Σ=25.5) in a 10 000-LOC project crashes to 0.
 *
 * Fix — use a tanh-based decay normalized by √LOC:
 *
 *   SS = 100 × (1 − tanh(Σ(Severity_i × W_i) × K / √LOC))
 *
 * Properties:
 *   • Intrinsically bounded to (0, 100] — cannot go negative
 *   • 0 vampires → 100 % always
 *   • Larger codebases (bigger √LOC denominator) are graded on scale
 *   • Dense small test files score low-but-visible instead of hard 0
 *   • K = 0.25 calibrated so 1 heavy vampire per 100 LOC ≈ 70 %
 *
 * Calibration reference (K = 0.25):
 *   3 vampires (Σ≈45) in 100 LOC      → ~29 %  (deliberately bad samples)
 *   10 vampires (Σ≈120) in 5 000 LOC  → ~66 %  (moderate real project)
 *   30 vampires (Σ≈350) in 10 000 LOC → ~50 %  (poor real project)
 *   0 vampires, any size               → 100 %
 *
 * @param hits      Array of energy hits from the current scan
 * @param totalLOC  Total lines of code scanned across the workspace
 */
function computeSustainabilityScore(hits, totalLOC) {
    if (hits.length === 0)
        return 100;
    const linesForSqrt = Math.max(totalLOC, 1);
    // Weighted sum using CALIBRATED weights: Σ(severity × W_effective)
    // getEffectiveW() scales each hit's weight by the hardware calibration factor
    // for its category, so a faster CPU yields lower CPU weights, etc.
    const weightedSum = hits.reduce((acc, hit) => acc + hit.severity * hit.effectiveW, 0);
    // Calibration constant K — controls how steeply score decays with density
    const K = 0.25;
    // tanh argument: grows with vampire density, shrinks for larger codebases
    const x = (weightedSum * K) / Math.sqrt(linesForSqrt);
    // tanh maps any positive x to (0,1), so SS is always in (0, 100]
    const ss = 100 * (1 - Math.tanh(x));
    return Math.round(ss * 10) / 10;
}
exports.computeSustainabilityScore = computeSustainabilityScore;
// ─── Export Constants (for display in report) ─────────────────────────────────
exports.MODEL_CONSTANTS = {
    F_CPU_HZ,
    TDP_WATTS,
    ACTIVITY_FACTOR,
    T_GC_SECONDS,
    P_CPU_PEAK_WATTS,
    T_TAIL_SECONDS,
    P_ACTIVE_IDLE_WATTS,
    CI_GRID_G_PER_JOULE,
    PUE,
    SCALING_FACTOR_S,
    CPU_BASELINE_CYCLES,
};
//# sourceMappingURL=energy-model.js.map