"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const child_process_1 = require("child_process");
const scanner_1 = require("./scanner");
const rules_1 = require("./rules");
const energy_model_1 = require("./energy-model");
const benchmarker_1 = require("./benchmarker");
let diagnosticCollection;
let statusBarItem;
let globalScore = 100;
let currentPanel = undefined;
// ─── Dynamic Audit Terminal (Pseudoterminal) ──────────────────────────────────
class CodeGreenAuditor {
    constructor() {
        this.writeEmitter = new vscode.EventEmitter();
        this.onDidWrite = this.writeEmitter.event;
        this.closeEmitter = new vscode.EventEmitter();
        this.onDidClose = this.closeEmitter.event;
    }
    open() {
        this.log('[1;32m\ud83c\udf3f Code-Green Audit Console Initialized[0m');
    }
    close() { }
    log(message, dynamic = false) {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = '[90m[' + timestamp + '][0m ';
        if (dynamic) {
            this.writeEmitter.fire('[2K\r' + prefix + message);
        }
        else {
            this.writeEmitter.fire('\r\n' + prefix + message + '\r\n');
        }
    }
    clear() {
        this.writeEmitter.fire('[2J[3J[H');
    }
}
const auditor = new CodeGreenAuditor();
let auditTerminal;
function getAuditorTerminal() {
    if (!auditTerminal) {
        auditTerminal = vscode.window.createTerminal({ name: 'Code-Green Audit Console', pty: auditor });
    }
    return auditTerminal;
}
// ─── Sidebar Summary Provider ─────────────────────────────────────────────────
class SustainabilityItem extends vscode.TreeItem {
    constructor(label, value, iconPath) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.label = label;
        this.value = value;
        this.iconPath = iconPath;
        this.description = value;
    }
}
class SustainabilitySummaryProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.data = [];
        this.refresh();
    }
    refresh() {
        const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (rootPath) {
            const reportPath = path.join(rootPath, 'code-green-report.json');
            if (fs.existsSync(reportPath)) {
                const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
                const co2mg = ((report.totalCO2_grams_potential || 0) * 1000).toFixed(2);
                this.data = [
                    new SustainabilityItem("Sustainability Score", `${report.sustainabilityScore?.toFixed(1) ?? report.score}`, new vscode.ThemeIcon('leaf')),
                    new SustainabilityItem("Energy Vampires", `${report.vampiresDetected}`, new vscode.ThemeIcon('zap')),
                    new SustainabilityItem("CO₂ Recovery Potential", `${co2mg} mg`, new vscode.ThemeIcon('globe')),
                    new SustainabilityItem("Total ΔE", `${((report.totalDeltaE_joules || 0) * 1000).toFixed(3)} mJ`, new vscode.ThemeIcon('flame')),
                ];
            }
            else {
                this.data = [new SustainabilityItem("Status", "Audit Required", new vscode.ThemeIcon('info'))];
            }
        }
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) { return element; }
    getChildren() { return this.data; }
}
const summaryProvider = new SustainabilitySummaryProvider();
// ─── Extension Activation ─────────────────────────────────────────────────────
async function activate(context) {
    console.log('Code-Green active 🌿');
    diagnosticCollection = vscode.languages.createDiagnosticCollection('code-green');
    context.subscriptions.push(diagnosticCollection);
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'code-green.openDashboard';
    context.subscriptions.push(statusBarItem);
    statusBarItem.show();
    const treeView = vscode.window.createTreeView('code-green-status', { treeDataProvider: summaryProvider });
    treeView.onDidChangeVisibility(e => {
        if (e.visible) {
            vscode.commands.executeCommand('code-green.openDashboard');
        }
    });
    context.subscriptions.push(treeView);
    // ─ Run or load cached hardware benchmark ──────────────────────────────────
    await runOrLoadBenchmark(context);
    await scanWorkspace();
    vscode.workspace.onDidOpenTextDocument(doc => scanDocument(doc), null, context.subscriptions);
    vscode.workspace.onDidSaveTextDocument(() => { scanWorkspace(); }, null, context.subscriptions);
    let scanCommand = vscode.commands.registerCommand('code-green.scan', () => {
        scanWorkspace();
        vscode.window.showInformationMessage('Code-Green: Physics audit complete!');
    });
    let recalibrateCommand = vscode.commands.registerCommand('code-green.recalibrate', async () => {
        context.globalState.update(benchmarker_1.BENCHMARK_CACHE_KEY, undefined);
        await runOrLoadBenchmark(context);
        scanWorkspace();
        vscode.window.showInformationMessage('Code-Green: Hardware recalibration complete!');
    });
    let dashboardCommand = vscode.commands.registerCommand('code-green.openDashboard', () => {
        if (currentPanel) {
            currentPanel.reveal(vscode.ViewColumn.One);
        }
        else {
            currentPanel = vscode.window.createWebviewPanel('codeGreenDashboard', 'Code-Green Sustainability Dashboard', vscode.ViewColumn.One, {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'webview'))]
            });
            currentPanel.webview.html = getWebviewContent(currentPanel.webview, context.extensionUri);
            currentPanel.onDidDispose(() => { currentPanel = undefined; }, null, context.subscriptions);
            currentPanel.webview.onDidReceiveMessage(async (message) => {
                if (message.type === 'ready') {
                    sendReportToWebview();
                }
                else if (message.type === 'openFile') {
                    const { fullPath, line, character } = message.data;
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
                    const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
                    const pos = new vscode.Position(line, character);
                    editor.selection = new vscode.Selection(pos, pos);
                    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                }
                else if (message.type === 'requestHistory') {
                    await streamHistoryAudit(message.limit);
                }
                else if (message.type === 'auditNow') {
                    // Clear benchmark cache so recalibration always runs fresh
                    context.globalState.update(benchmarker_1.BENCHMARK_CACHE_KEY, undefined);
                    await runOrLoadBenchmark(context);
                    await scanWorkspace();
                }
            }, null, context.subscriptions);
        }
    });
    context.subscriptions.push(scanCommand, recalibrateCommand, dashboardCommand);
    getAuditorTerminal().show(true);
}
exports.activate = activate;
// ─── Webview Loader ───────────────────────────────────────────────────────────
function getWebviewContent(webview, extensionUri) {
    const webviewPath = path.join(extensionUri.fsPath, 'webview');
    const indexHtmlPath = path.join(webviewPath, 'index.html');
    let html = fs.readFileSync(indexHtmlPath, 'utf-8');
    const scriptRegex = /src="\.\/assets\/([^"]+)"/g;
    const styleRegex = /href="\.\/assets\/([^"]+)"/g;
    html = html.replace(scriptRegex, (m, src) => `src="${webview.asWebviewUri(vscode.Uri.file(path.join(webviewPath, 'assets', src)))}"`);
    html = html.replace(styleRegex, (m, href) => `href="${webview.asWebviewUri(vscode.Uri.file(path.join(webviewPath, 'assets', href)))}"`);
    return html;
}
// ─── Benchmarker ──────────────────────────────────────────────────────────────
async function runOrLoadBenchmark(context) {
    const cached = context.globalState.get(benchmarker_1.BENCHMARK_CACHE_KEY);
    if ((0, benchmarker_1.isBenchmarkFresh)(cached)) {
        (0, energy_model_1.setCalibrationFactors)(cached.calibrationFactors);
        const f = cached.calibrationFactors;
        auditor.log('\x1b[90m⚡ Hardware calibration loaded from cache '
            + `(CPU×${f.cpu.toFixed(2)} MEM×${f.memory.toFixed(2)} ALG×${f.algorithmic.toFixed(2)})\x1b[0m`);
        return;
    }
    statusBarItem.text = '$(loading~spin) Code-Green: Calibrating...';
    auditor.log('\x1b[1;36m🔬 Running hardware benchmark to calibrate energy weights...\x1b[0m');
    const result = await new Promise(resolve => setTimeout(() => resolve((0, benchmarker_1.runSystemBenchmark)()), 0));
    (0, energy_model_1.setCalibrationFactors)(result.calibrationFactors);
    context.globalState.update(benchmarker_1.BENCHMARK_CACHE_KEY, result);
    const f = result.calibrationFactors;
    auditor.log(`\x1b[1;32m✅ Calibration complete (${result.systemInfo.benchmarkMs}ms) `
        + `| CPU ratio: ${result.cpuRatio.toFixed(0)}× → W×${f.cpu.toFixed(2)} `
        + `| MEM ratio: ${result.memRatio.toFixed(1)}× → W×${f.memory.toFixed(2)} `
        + `| ALG ratio: ${result.algorithmicRatio.toFixed(1)}× → W×${f.algorithmic.toFixed(2)}\x1b[0m`);
}
// ─── Git Helpers ──────────────────────────────────────────────────────────────
function runGitCommand(cmd, cwd) {
    return new Promise((resolve) => {
        (0, child_process_1.exec)(`git ${cmd}`, { cwd }, (error, stdout) => {
            if (error)
                resolve('');
            else
                resolve(stdout.trim());
        });
    });
}
// ─── Historical Audit ─────────────────────────────────────────────────────────
async function streamHistoryAudit(limit) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || !currentPanel)
        return;
    const rootPath = workspaceFolders[0].uri.fsPath;
    auditor.log(`[1;36m🔄 Initiating Time-Range Audit (Limit: ${limit === -1 ? 'MAX' : limit})[0m`);
    const gitLog = await runGitCommand(`log ${limit !== -1 ? `-n ${limit}` : ''} --pretty=format:"%H|%s"`, rootPath);
    if (!gitLog) {
        currentPanel.webview.postMessage({ type: 'historyComplete' });
        return;
    }
    const commits = gitLog.split('\n').map(line => {
        const [hash, msg] = line.split('|');
        return { hash: hash.trim(), msg: msg.trim() };
    });
    const supportedExtensions = Object.keys(rules_1.EXTENSION_MAP);
    for (let i = commits.length - 1; i >= 0; i--) {
        const commit = commits[i];
        auditor.log(`[33m⏳ Auditing Commit [${commit.hash.substring(0, 7)}]:[0m ${commit.msg.substring(0, 40)}`, true);
        const fileList = await runGitCommand(`ls-tree -r --name-only ${commit.hash}`, rootPath);
        let commitHits = [];
        let commitLOC = 0;
        for (const filePath of fileList.split('\n')) {
            const ext = path.extname(filePath).toLowerCase().replace('.', '');
            if (supportedExtensions.includes(ext)) {
                const content = await runGitCommand(`show ${commit.hash}:${filePath}`, rootPath);
                if (content) {
                    const langId = rules_1.EXTENSION_MAP[ext] || 'javascript';
                    const loc = content.split('\n').length;
                    commitLOC += loc;
                    const { hits } = (0, scanner_1.scanCode)(content, langId, loc);
                    hits.forEach(h => commitHits.push({
                        severity: h.rule.severity,
                        energyWeight: h.rule.energyWeight,
                        effectiveW: (0, energy_model_1.getEffectiveW)(h.rule.energyWeight, h.rule.category),
                        deltaE_joules: h.energy.deltaE_joules,
                    }));
                }
            }
        }
        const commitScore = (0, energy_model_1.computeSustainabilityScore)(commitHits, Math.max(commitLOC, 10));
        currentPanel.webview.postMessage({
            type: 'historyPoint',
            data: {
                timestamp: commit.hash.substring(0, 7),
                score: Math.round(commitScore * 10) / 10,
                commit: commit.msg,
                deltaE_mj: commitHits.reduce((s, h) => s + h.deltaE_joules, 0) * 1000,
            }
        });
    }
    currentPanel.webview.postMessage({ type: 'historyComplete' });
    auditor.log(`[1;32m✅ Historical Evolution Streamed Successfully[0m
`);
}
// ─── Workspace Scan ───────────────────────────────────────────────────────────
async function scanWorkspace() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders)
        return;
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Code-Green: Physics Energy Audit",
        cancellable: false
    }, async (progress) => {
        progress.report({ message: "Initializing energy model..." });
        const rootPath = workspaceFolders[0].uri.fsPath;
        const allFiles = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
        const supportedExtensions = Object.keys(rules_1.EXTENSION_MAP);
        const auditTargetFiles = [];
        allFiles.forEach(file => {
            const ext = path.extname(file.fsPath).toLowerCase().replace('.', '');
            if (supportedExtensions.includes(ext))
                auditTargetFiles.push(file);
        });
        auditor.log(`[1;36m🔎 Physics Audit: ${auditTargetFiles.length} files | f=${energy_model_1.MODEL_CONSTANTS.F_CPU_HZ / 1e9}GHz TDP=${energy_model_1.MODEL_CONSTANTS.TDP_WATTS}W CI=${(energy_model_1.MODEL_CONSTANTS.CI_GRID_G_PER_JOULE * 3.6e6).toFixed(0)}g/kWh[0m`);
        // ── Aggregate values ───────────────────────────────────────────────────
        let totalVampires = 0;
        let totalDeltaE_joules = 0;
        let totalCO2_grams = 0;
        let totalLOC = 0;
        const allHits = [];
        const vampireInstances = [];
        const languagesFound = new Set();
        for (let i = 0; i < auditTargetFiles.length; i++) {
            const file = auditTargetFiles[i];
            const fileName = path.basename(file.fsPath);
            auditor.log(`[33m⏳ Auditing ${i + 1}/${auditTargetFiles.length}:[0m ${fileName}`, true);
            const doc = await vscode.workspace.openTextDocument(file);
            const text = doc.getText();
            const loc = doc.lineCount;
            totalLOC += loc;
            const { diagnostics, hits } = (0, scanner_1.scanCode)(text, doc.languageId, loc);
            diagnosticCollection.set(file, diagnostics);
            if (hits.length > 0)
                languagesFound.add(doc.languageId);
            hits.forEach(h => {
                totalVampires++;
                totalDeltaE_joules += h.energy.deltaE_joules;
                totalCO2_grams += h.energy.co2_grams;
                allHits.push({
                    severity: h.rule.severity,
                    energyWeight: h.rule.energyWeight,
                    effectiveW: (0, energy_model_1.getEffectiveW)(h.rule.energyWeight, h.rule.category),
                    deltaE_joules: h.energy.deltaE_joules,
                });
                vampireInstances.push({
                    ruleId: h.rule.id,
                    description: h.rule.description,
                    alternative: h.rule.alternative,
                    category: h.rule.category,
                    energyWeight: h.rule.energyWeight,
                    severity: h.rule.severity,
                    // Physics values
                    deltaE_joules: h.energy.deltaE_joules,
                    deltaE_millijoules: h.energy.deltaE_millijoules,
                    co2_grams: h.energy.co2_grams,
                    co2_micrograms: h.energy.co2_micrograms,
                    modelUsed: h.energy.modelUsed,
                    // Location
                    fileName: path.relative(rootPath, file.fsPath),
                    fullPath: file.fsPath,
                    line: h.diagnostic.range.start.line,
                    character: h.diagnostic.range.start.character,
                });
            });
        }
        // ── Sustainability Score — SS formula ──────────────────────────────────
        // SS = 100 − (Σ Severity_i × W_i) × log10(Lines of Code)
        const sustainabilityScore = (0, energy_model_1.computeSustainabilityScore)(allHits, Math.max(totalLOC, 10));
        globalScore = sustainabilityScore;
        // CO₂ that WOULD be recovered if all vampires were fixed
        const carbonRecoveredIfFixed = totalCO2_grams;
        const report = {
            projectName: workspaceFolders[0].name,
            lastUpdate: new Date().toISOString(),
            // ── Physics-computed values ────────────────────────────────────
            sustainabilityScore: Math.round(sustainabilityScore * 10) / 10,
            totalDeltaE_joules: Math.round(totalDeltaE_joules * 1e9) / 1e9,
            totalDeltaE_millijoules: Math.round(totalDeltaE_joules * 1e6) / 1e3,
            totalCO2_grams_potential: Math.round(totalCO2_grams * 1e9) / 1e9,
            totalCO2_mg_potential: Math.round(totalCO2_grams * 1e6 * 1000) / 1000,
            totalLinesOfCode: totalLOC,
            // ── Aggregates ─────────────────────────────────────────────────
            vampiresDetected: totalVampires,
            languages: Array.from(languagesFound),
            vampireInstances,
            // ── Legacy fields (kept for dashboard backward compat) ─────────
            score: Math.round(sustainabilityScore * 10) / 10,
            carbonRecoveryPotential: Math.round(totalCO2_grams * 1e6),
            carbonAlreadyRecovered: Math.round((100 - sustainabilityScore) / 100 * totalCO2_grams * 1e6),
            // ── Model constants used ───────────────────────────────────────
            modelConstants: {
                f_cpu_hz: energy_model_1.MODEL_CONSTANTS.F_CPU_HZ,
                tdp_watts: energy_model_1.MODEL_CONSTANTS.TDP_WATTS,
                activity_factor: energy_model_1.MODEL_CONSTANTS.ACTIVITY_FACTOR,
                t_gc_seconds: energy_model_1.MODEL_CONSTANTS.T_GC_SECONDS,
                ci_grid_g_per_kwh: 475,
                pue: energy_model_1.MODEL_CONSTANTS.PUE,
                scaling_factor_s: energy_model_1.MODEL_CONSTANTS.SCALING_FACTOR_S,
            },
        };
        updateStatusBar(globalScore);
        summaryProvider.refresh();
        fs.writeFileSync(path.join(rootPath, 'code-green-report.json'), JSON.stringify(report, null, 2));
        const deltaE_mj = (totalDeltaE_joules * 1000).toFixed(3);
        const co2_ug = (totalCO2_grams * 1e6).toFixed(2);
        auditor.log(`[1;${totalVampires > 0 ? '31' : '32'}m⭐ Audit Complete | ${totalVampires} Vampires | SS: ${sustainabilityScore.toFixed(1)} | ΔE: ${deltaE_mj}mJ | CO₂: ${co2_ug}μg[0m
`);
        if (currentPanel)
            sendReportToWebview();
    });
}
// ─── Report Sender ────────────────────────────────────────────────────────────
function sendReportToWebview() {
    if (!currentPanel)
        return;
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!rootPath)
        return;
    const reportPath = path.join(rootPath, 'code-green-report.json');
    if (fs.existsSync(reportPath)) {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        currentPanel.webview.postMessage({ type: 'updateReport', data: report });
    }
}
// ─── Single File Scan ─────────────────────────────────────────────────────────
function scanDocument(doc) {
    const supportedLanguages = Object.keys(rules_1.LANGUAGE_RULES).filter(k => k !== "universal");
    if (!supportedLanguages.includes(doc.languageId))
        return;
    const { diagnostics } = (0, scanner_1.scanCode)(doc.getText(), doc.languageId, doc.lineCount);
    diagnosticCollection.set(doc.uri, diagnostics);
    summaryProvider.refresh();
}
// ─── Status Bar ───────────────────────────────────────────────────────────────
function updateStatusBar(score) {
    let icon = '$(leaf)';
    if (score < 50)
        icon = '$(zap)';
    else if (score < 80)
        icon = '$(alert)';
    statusBarItem.text = `${icon} Code-Green SS: ${score.toFixed(1)}`;
}
// ─── Deactivation ─────────────────────────────────────────────────────────────
function deactivate() {
    if (statusBarItem)
        statusBarItem.dispose();
    if (diagnosticCollection)
        diagnosticCollection.dispose();
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map