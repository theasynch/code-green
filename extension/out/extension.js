"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const child_process_1 = require("child_process");
const scanner_1 = require("./scanner");
const rules_1 = require("./rules");
let diagnosticCollection;
let statusBarItem;
let globalScore = 100;
let currentPanel = undefined;
// --- Dynamic Audit Terminal (Pseudoterminal) ---
class CodeGreenAuditor {
    constructor() {
        this.writeEmitter = new vscode.EventEmitter();
        this.onDidWrite = this.writeEmitter.event;
        this.closeEmitter = new vscode.EventEmitter();
        this.onDidClose = this.closeEmitter.event;
    }
    open() {
        this.log("\x1b[1;32m🌿 Code-Green Audit Console Initialized\x1b[0m\r\n");
    }
    close() { }
    log(message, dynamic = false) {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = `\x1b[90m[${timestamp}]\x1b[0m `;
        if (dynamic) {
            // Clear line, return to start, print, and NO newline
            this.writeEmitter.fire(`\x1b[2K\r${prefix}${message}`);
        }
        else {
            // Print message and start a new line
            this.writeEmitter.fire(`\r\n${prefix}${message}\r\n`);
        }
    }
    clear() {
        this.writeEmitter.fire('\x1b[2J\x1b[3J\x1b[H');
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
// --- Sidebar Summary Provider ---
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
                this.data = [
                    new SustainabilityItem("Sustainability Score", `${report.score}%`, new vscode.ThemeIcon('leaf')),
                    new SustainabilityItem("Energy Vampires", `${report.vampiresDetected}`, new vscode.ThemeIcon('zap')),
                    new SustainabilityItem("Carbon Recovery", `${report.carbonAlreadyRecovered}g`, new vscode.ThemeIcon('globe'))
                ];
            }
            else {
                this.data = [new SustainabilityItem("Status", "Audit Required", new vscode.ThemeIcon('info'))];
            }
        }
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        return this.data;
    }
}
const summaryProvider = new SustainabilitySummaryProvider();
async function activate(context) {
    console.log('Code-Green active 🌿');
    diagnosticCollection = vscode.languages.createDiagnosticCollection('code-green');
    context.subscriptions.push(diagnosticCollection);
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'code-green.openDashboard';
    context.subscriptions.push(statusBarItem);
    statusBarItem.show();
    // Register Sidebar View
    const treeView = vscode.window.createTreeView('code-green-status', { treeDataProvider: summaryProvider });
    treeView.onDidChangeVisibility(e => {
        if (e.visible) {
            vscode.commands.executeCommand('code-green.openDashboard');
        }
    });
    context.subscriptions.push(treeView);
    await scanWorkspace();
    vscode.workspace.onDidOpenTextDocument(doc => scanDocument(doc), null, context.subscriptions);
    vscode.workspace.onDidSaveTextDocument(() => {
        scanWorkspace();
    }, null, context.subscriptions);
    let scanCommand = vscode.commands.registerCommand('code-green.scan', () => {
        scanWorkspace();
        vscode.window.showInformationMessage('Code-Green: Manual scan complete!');
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
            }, null, context.subscriptions);
        }
    });
    context.subscriptions.push(scanCommand, dashboardCommand);
    getAuditorTerminal().show(true);
}
exports.activate = activate;
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
async function streamHistoryAudit(limit) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || !currentPanel)
        return;
    const rootPath = workspaceFolders[0].uri.fsPath;
    auditor.log(`\x1b[1;36m🔄 Initiating Time-Range Audit (Limit: ${limit === -1 ? 'MAX' : limit})\x1b[0m`);
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
        auditor.log(`\x1b[33m⏳ Auditing Commit [${commit.hash.substring(0, 7)}]:\x1b[0m ${commit.msg.substring(0, 40)}`, true);
        const fileList = await runGitCommand(`ls-tree -r --name-only ${commit.hash}`, rootPath);
        let commitVampires = 0;
        for (const filePath of fileList.split('\n')) {
            const ext = path.extname(filePath).toLowerCase().replace('.', '');
            if (supportedExtensions.includes(ext)) {
                const content = await runGitCommand(`show ${commit.hash}:${filePath}`, rootPath);
                if (content) {
                    const langId = Object.keys(rules_1.EXTENSION_MAP).find(k => rules_1.EXTENSION_MAP[k] === ext) || "javascript";
                    const diagnostics = (0, scanner_1.scanCode)(content, langId);
                    commitVampires += diagnostics.length;
                }
            }
        }
        currentPanel.webview.postMessage({
            type: 'historyPoint',
            data: { timestamp: commit.hash.substring(0, 7), score: Math.max(0, 100 - (commitVampires * 1.2)), commit: commit.msg }
        });
    }
    currentPanel.webview.postMessage({ type: 'historyComplete' });
    auditor.log(`\x1b[1;32m✅ Historical Evolution Streamed Successfully\x1b[0m\n`);
}
async function scanWorkspace() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders)
        return;
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Code-Green: Deep Analytics Audit",
        cancellable: false
    }, async (progress) => {
        progress.report({ message: "Calibrating sensors..." });
        const rootPath = workspaceFolders[0].uri.fsPath;
        const allFiles = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
        const supportedExtensions = Object.keys(rules_1.EXTENSION_MAP);
        const auditTargetFiles = [];
        allFiles.forEach(file => {
            const ext = path.extname(file.fsPath).toLowerCase().replace('.', '');
            if (supportedExtensions.includes(ext))
                auditTargetFiles.push(file);
        });
        auditor.log(`\x1b[1;36m🔎 Scanning Workspace Content (${auditTargetFiles.length} files)...\x1b[0m`);
        let totalVampires = 0;
        let totalPotentialSaving = 0;
        const vampireInstances = [];
        const languagesFound = new Set();
        for (let i = 0; i < auditTargetFiles.length; i++) {
            const file = auditTargetFiles[i];
            const fileName = path.basename(file.fsPath);
            auditor.log(`\x1b[33m⏳ Auditing ${i + 1}/${auditTargetFiles.length}:\x1b[0m ${fileName}`, true);
            const doc = await vscode.workspace.openTextDocument(file);
            const diagnostics = (0, scanner_1.scanCode)(doc.getText(), doc.languageId);
            diagnosticCollection.set(file, diagnostics);
            if (diagnostics.length > 0)
                languagesFound.add(doc.languageId);
            diagnostics.forEach(d => {
                const ruleId = d.code;
                const rulesForLang = [...(rules_1.LANGUAGE_RULES[doc.languageId] || []), ...rules_1.LANGUAGE_RULES["universal"]];
                const rule = rulesForLang.find((r) => r.id === ruleId);
                if (rule) {
                    totalVampires++;
                    totalPotentialSaving += rule.saving;
                    vampireInstances.push({
                        ruleId: rule.id, description: rule.description, saving: rule.saving, category: rule.category,
                        fileName: path.relative(rootPath, file.fsPath), fullPath: file.fsPath, line: d.range.start.line, character: d.range.start.character
                    });
                }
            });
        }
        globalScore = Math.max(0, 100 - (totalVampires * 1.2));
        const report = {
            projectName: workspaceFolders[0].name, lastUpdate: new Date().toISOString(),
            score: globalScore, vampiresDetected: totalVampires, carbonRecoveryPotential: totalPotentialSaving,
            carbonAlreadyRecovered: Math.round(globalScore * 5), vampireInstances: vampireInstances, languages: Array.from(languagesFound)
        };
        updateStatusBar(globalScore);
        summaryProvider.refresh();
        fs.writeFileSync(path.join(rootPath, 'code-green-report.json'), JSON.stringify(report, null, 2));
        auditor.log(`\x1b[1;${totalVampires > 0 ? '31' : '32'}m⭐ Audit Complete: ${totalVampires} Vampires Found | Score: ${globalScore}%\x1b[0m\n`);
        if (currentPanel)
            sendReportToWebview();
    });
}
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
function scanDocument(doc) {
    const supportedLanguages = Object.keys(rules_1.LANGUAGE_RULES).filter(k => k !== "universal");
    if (!supportedLanguages.includes(doc.languageId))
        return;
    const diagnostics = (0, scanner_1.scanCode)(doc.getText(), doc.languageId);
    diagnosticCollection.set(doc.uri, diagnostics);
    summaryProvider.refresh();
}
function updateStatusBar(score) {
    let icon = '$(leaf)';
    if (score < 50)
        icon = '$(zap)';
    else if (score < 80)
        icon = '$(alert)';
    statusBarItem.text = `${icon} Code-Green: ${score}%`;
}
function deactivate() {
    if (statusBarItem)
        statusBarItem.dispose();
    if (diagnosticCollection)
        diagnosticCollection.dispose();
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map