import * as vscode from 'vscode';
import { LANGUAGE_RULES, EnergyRule } from './rules';
import { computeEnergyResult, EnergyResult } from './energy-model';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VampireHit {
    /** The matched rule */
    rule: EnergyRule;
    /** VS Code diagnostic for the editor gutter */
    diagnostic: vscode.Diagnostic;
    /** Physics-computed energy result for this specific hit */
    energy: EnergyResult;
}

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
export function scanCode(
    text: string,
    languageId: string,
    lineCount?: number
): { diagnostics: vscode.Diagnostic[]; hits: VampireHit[] } {
    const diagnostics: vscode.Diagnostic[] = [];
    const hits: VampireHit[] = [];

    // Merge language-specific rules with universal fallback
    const rules: EnergyRule[] = [
        ...(LANGUAGE_RULES[languageId] || []),
        ...LANGUAGE_RULES["universal"],
    ];

    for (const rule of rules) {
        // Reset regex state (required for /g flag)
        rule.regex.lastIndex = 0;

        let match: RegExpExecArray | null;
        while ((match = rule.regex.exec(text)) !== null) {
            const startOffset = match.index;
            const endOffset = match.index + match[0].length;

            const startPos = getPositionAt(text, startOffset);
            const endPos = getPositionAt(text, endOffset);
            const range = new vscode.Range(startPos, endPos);

            // ── Compute physics-based energy cost ────────────────────────────
            const energy = computeEnergyResult(
                rule.category,
                rule.deltaC_ratio,
                rule.freqGC_ratio,
                rule.ioCallMultiplier,
                rule.energyWeight
            );

            // ── Build diagnostic message with real units ───────────────────
            const mj = energy.deltaE_millijoules.toFixed(3);
            const mg_co2 = energy.co2_micrograms.toFixed(2);
            const message =
                `⚡ ${rule.description} ` +
                `| Fix: ${rule.alternative} ` +
                `| ΔE: ${mj} mJ | CO₂: ${mg_co2} μg`;

            const diagnostic = new vscode.Diagnostic(
                range,
                message,
                vscode.DiagnosticSeverity.Warning
            );
            diagnostic.code = rule.id;
            diagnostic.source = 'Code-Green';

            diagnostics.push(diagnostic);
            hits.push({ rule, diagnostic, energy });
        }
    }

    return { diagnostics, hits };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Converts a character offset into a VS Code Position (line + character) */
function getPositionAt(text: string, offset: number): vscode.Position {
    let line = 0;
    let character = 0;
    for (let i = 0; i < offset; i++) {
        if (text[i] === '\n') {
            line++;
            character = 0;
        } else {
            character++;
        }
    }
    return new vscode.Position(line, character);
}
