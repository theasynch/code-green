"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanCode = void 0;
const vscode = require("vscode");
const rules_1 = require("./rules");
const energy_model_1 = require("./energy-model");
// ─── Scanner ──────────────────────────────────────────────────────────────────
/**
 * Scans source code text for energy vampire patterns.
 * Returns both VS Code Diagnostics (for editor decoration) and
 * enriched VampireHit objects carrying the physics-computed ΔE and CO₂.
 *
 * @param text        Full source code text
 * @param languageId  VS Code language identifier
 * @param lineCount   Total lines in the file (used for SS formula denominator)
 */
function scanCode(text, languageId, lineCount) {
    const diagnostics = [];
    const hits = [];
    // Merge language-specific rules with universal fallback
    const rules = [
        ...(rules_1.LANGUAGE_RULES[languageId] || []),
        ...rules_1.LANGUAGE_RULES["universal"],
    ];
    for (const rule of rules) {
        // Reset regex state (required for /g flag)
        rule.regex.lastIndex = 0;
        let match;
        while ((match = rule.regex.exec(text)) !== null) {
            const startOffset = match.index;
            const endOffset = match.index + match[0].length;
            const startPos = getPositionAt(text, startOffset);
            const endPos = getPositionAt(text, endOffset);
            const range = new vscode.Range(startPos, endPos);
            // ── Compute physics-based energy cost ────────────────────────────
            const energy = (0, energy_model_1.computeEnergyResult)(rule.category, rule.deltaC_ratio, rule.freqGC_ratio, rule.ioCallMultiplier, rule.energyWeight);
            // ── Build diagnostic message with real units ───────────────────
            const mj = energy.deltaE_millijoules.toFixed(3);
            const mg_co2 = energy.co2_micrograms.toFixed(2);
            const message = `⚡ ${rule.description} ` +
                `| Fix: ${rule.alternative} ` +
                `| ΔE: ${mj} mJ | CO₂: ${mg_co2} μg`;
            const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
            diagnostic.code = rule.id;
            diagnostic.source = 'Code-Green';
            diagnostics.push(diagnostic);
            hits.push({ rule, diagnostic, energy });
        }
    }
    return { diagnostics, hits };
}
exports.scanCode = scanCode;
// ─── Utility ──────────────────────────────────────────────────────────────────
/** Converts a character offset into a VS Code Position (line + character) */
function getPositionAt(text, offset) {
    let line = 0;
    let character = 0;
    for (let i = 0; i < offset; i++) {
        if (text[i] === '\n') {
            line++;
            character = 0;
        }
        else {
            character++;
        }
    }
    return new vscode.Position(line, character);
}
//# sourceMappingURL=scanner.js.map