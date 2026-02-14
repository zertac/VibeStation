const vscode = require('vscode');
const https = require('https');
const fs = require('fs');
const path = require('path');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// Claude Status Checker
// ============================================
const STATUS_URL = 'https://status.claude.com/api/v2/status.json';
const COMPONENTS_URL = 'https://status.claude.com/api/v2/components.json';
const CHECK_INTERVAL = 120000;

let statusBarItem;
let statusInterval;

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchJson(res.headers.location).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function checkClaudeStatus() {
    if (!statusBarItem) return;
    try {
        const result = await fetchJson(STATUS_URL);
        const indicator = result.status.indicator;
        const description = result.status.description;

        if (indicator === 'none') {
            statusBarItem.text = '$(check) Claude: Operational';
            statusBarItem.backgroundColor = undefined;
            statusBarItem.color = '#4ade80';
        } else if (indicator === 'minor') {
            statusBarItem.text = '$(warning) Claude: Degraded';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            statusBarItem.color = undefined;
        } else if (indicator === 'major') {
            statusBarItem.text = '$(error) Claude: Major Outage';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            statusBarItem.color = undefined;
        } else if (indicator === 'critical') {
            statusBarItem.text = '$(error) Claude: Critical Outage';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            statusBarItem.color = undefined;
        } else {
            statusBarItem.text = '$(question) Claude: Unknown';
            statusBarItem.color = '#94a3b8';
            statusBarItem.backgroundColor = undefined;
        }
        statusBarItem.tooltip = description + '\n(Click for details)';
    } catch (e) {
        statusBarItem.text = '$(cloud-offline) Claude: Offline';
        statusBarItem.color = '#94a3b8';
        statusBarItem.backgroundColor = undefined;
        statusBarItem.tooltip = 'Could not reach status API';
    }
}

async function showDetailedStatus() {
    try {
        const result = await fetchJson(COMPONENTS_URL);
        const components = result.components || [];
        const lines = components
            .filter(c => !c.group_id || c.group_id === null)
            .map(c => {
                const statusText = c.status.replace(/_/g, ' ');
                return `${c.name}: ${statusText}`;
            });

        await vscode.window.showQuickPick(lines, {
            title: 'Claude System Status',
            placeHolder: 'Component statuses'
        });
    } catch (e) {
        vscode.window.showErrorMessage('Could not fetch Claude status: ' + e.message);
    }
}

// ============================================
// Claude Session Tracker
// ============================================
const CONTEXT_LIMIT = 200000;
const SESSION_CHECK_INTERVAL = 15000;

// Claude Sonnet 4.5 pricing (per million tokens)
const PRICING = {
    input: 3.00,
    output: 15.00,
    cacheCreate: 3.75,
    cacheRead: 0.30
};

let contextBarItem;
let tokenBarItem;
let costBarItem;
let sessionInterval;

function findActiveSession() {
    const home = process.env.USERPROFILE || process.env.HOME;
    const projectsDir = path.join(home, '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) return null;

    let newest = null;
    let newestTime = 0;

    try {
        const dirs = fs.readdirSync(projectsDir);
        for (const dir of dirs) {
            const fullDir = path.join(projectsDir, dir);
            if (!fs.statSync(fullDir).isDirectory()) continue;
            const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.jsonl'));
            for (const file of files) {
                const fullPath = path.join(fullDir, file);
                const stat = fs.statSync(fullPath);
                if (stat.mtimeMs > newestTime) {
                    newestTime = stat.mtimeMs;
                    newest = fullPath;
                }
            }
        }
    } catch (e) {}
    return newest;
}

function parseSessionTokens(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n');

        let lastContext = 0;
        let totalInput = 0;
        let totalOutput = 0;
        let totalCacheCreate = 0;
        let totalCacheRead = 0;

        for (const line of lines) {
            try {
                const d = JSON.parse(line);
                if (d.type === 'assistant' && d.message && d.message.usage) {
                    const u = d.message.usage;
                    const inp = u.input_tokens || 0;
                    const cc = u.cache_creation_input_tokens || 0;
                    const cr = u.cache_read_input_tokens || 0;
                    const out = u.output_tokens || 0;
                    totalInput += inp;
                    totalCacheCreate += cc;
                    totalCacheRead += cr;
                    totalOutput += out;
                    lastContext = inp + cc + cr;
                }
            } catch (e) {}
        }

        return {
            lastContext,
            totalInput,
            totalCacheCreate,
            totalCacheRead,
            totalOutput,
            totalAll: totalInput + totalCacheCreate + totalCacheRead + totalOutput
        };
    } catch (e) {
        return null;
    }
}

function formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

function calculateCost(data) {
    const inputCost = (data.totalInput / 1000000) * PRICING.input;
    const outputCost = (data.totalOutput / 1000000) * PRICING.output;
    const cacheCreateCost = (data.totalCacheCreate / 1000000) * PRICING.cacheCreate;
    const cacheReadCost = (data.totalCacheRead / 1000000) * PRICING.cacheRead;
    return {
        input: inputCost,
        output: outputCost,
        cacheCreate: cacheCreateCost,
        cacheRead: cacheReadCost,
        total: inputCost + outputCost + cacheCreateCost + cacheReadCost
    };
}

function updateSessionInfo() {
    if (!contextBarItem || !tokenBarItem || !costBarItem) return;

    const sessionFile = findActiveSession();
    if (!sessionFile) {
        contextBarItem.text = '$(symbol-ruler) Ctx: --';
        tokenBarItem.text = '$(dashboard) Tokens: --';
        costBarItem.text = '$(credit-card) $--';
        contextBarItem.tooltip = 'No active Claude session found';
        tokenBarItem.tooltip = 'No active Claude session found';
        costBarItem.tooltip = 'No active Claude session found';
        return;
    }

    const data = parseSessionTokens(sessionFile);
    if (!data) {
        contextBarItem.text = '$(symbol-ruler) Ctx: --';
        tokenBarItem.text = '$(dashboard) Tokens: --';
        costBarItem.text = '$(credit-card) $--';
        return;
    }

    // Context
    const usedPct = Math.round((data.lastContext / CONTEXT_LIMIT) * 100);
    const remaining = CONTEXT_LIMIT - data.lastContext;
    contextBarItem.text = `$(symbol-ruler) Ctx: ${formatTokens(data.lastContext)}/${formatTokens(CONTEXT_LIMIT)} (${usedPct}%)`;
    contextBarItem.tooltip = `Context Used: ${data.lastContext.toLocaleString()} / ${CONTEXT_LIMIT.toLocaleString()} tokens\nRemaining: ${remaining.toLocaleString()} tokens (${100 - usedPct}%)`;

    if (usedPct < 50) {
        contextBarItem.color = '#4ade80';
    } else if (usedPct < 75) {
        contextBarItem.color = '#facc15';
    } else if (usedPct < 90) {
        contextBarItem.color = '#fb923c';
    } else {
        contextBarItem.color = '#f87171';
    }

    // Tokens
    tokenBarItem.text = `$(dashboard) In: ${formatTokens(data.totalInput + data.totalCacheCreate + data.totalCacheRead)} Out: ${formatTokens(data.totalOutput)}`;
    tokenBarItem.tooltip = `Input tokens: ${data.totalInput.toLocaleString()}\nCache creation: ${data.totalCacheCreate.toLocaleString()}\nCache read: ${data.totalCacheRead.toLocaleString()}\nOutput tokens: ${data.totalOutput.toLocaleString()}\n─────────────\nTotal: ${data.totalAll.toLocaleString()} tokens`;
    tokenBarItem.color = '#94a3b8';

    // Cost
    const cost = calculateCost(data);
    costBarItem.text = `$(credit-card) $${cost.total.toFixed(3)}`;
    costBarItem.tooltip = `Session Cost (Sonnet 4.5 pricing)\n─────────────\nInput: $${cost.input.toFixed(4)}\nOutput: $${cost.output.toFixed(4)}\nCache Write: $${cost.cacheCreate.toFixed(4)}\nCache Read: $${cost.cacheRead.toFixed(4)}\n─────────────\nTotal: $${cost.total.toFixed(4)}`;
    costBarItem.color = cost.total < 0.5 ? '#4ade80' : cost.total < 2 ? '#facc15' : '#f87171';
}

// ============================================
// Pomodoro Timer
// ============================================
const WORK_DURATION = 25 * 60; // 25 min
const BREAK_DURATION = 5 * 60; // 5 min

let pomodoroBarItem;
let pomodoroInterval;
let pomodoroState = 'stopped'; // stopped, work, break
let pomodoroSeconds = WORK_DURATION;
let pomodoroCount = 0;

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function updatePomodoroDisplay() {
    if (!pomodoroBarItem) return;

    if (pomodoroState === 'stopped') {
        pomodoroBarItem.text = `$(play) Pomodoro`;
        pomodoroBarItem.tooltip = `Click to start (${pomodoroCount} completed today)\nF8 to toggle`;
        pomodoroBarItem.color = '#94a3b8';
        pomodoroBarItem.backgroundColor = undefined;
    } else if (pomodoroState === 'work') {
        pomodoroBarItem.text = `$(flame) ${formatTime(pomodoroSeconds)}`;
        pomodoroBarItem.tooltip = `Working... (${pomodoroCount} completed)\nClick to pause`;
        pomodoroBarItem.color = '#f87171';
        pomodoroBarItem.backgroundColor = undefined;
    } else if (pomodoroState === 'break') {
        pomodoroBarItem.text = `$(coffee) ${formatTime(pomodoroSeconds)}`;
        pomodoroBarItem.tooltip = `Break time! (${pomodoroCount} completed)\nClick to skip`;
        pomodoroBarItem.color = '#4ade80';
        pomodoroBarItem.backgroundColor = undefined;
    }
}

function pomodoroTick() {
    if (pomodoroState === 'stopped') return;

    pomodoroSeconds--;
    if (pomodoroSeconds <= 0) {
        if (pomodoroState === 'work') {
            pomodoroCount++;
            pomodoroState = 'break';
            pomodoroSeconds = BREAK_DURATION;
            vscode.window.showInformationMessage(`Pomodoro #${pomodoroCount} done! Take a 5 min break.`);
        } else if (pomodoroState === 'break') {
            pomodoroState = 'work';
            pomodoroSeconds = WORK_DURATION;
            vscode.window.showInformationMessage('Break over! Time to focus.');
        }
    }
    updatePomodoroDisplay();
}

function togglePomodoro() {
    if (pomodoroState === 'stopped') {
        pomodoroState = 'work';
        pomodoroSeconds = WORK_DURATION;
        if (pomodoroInterval) clearInterval(pomodoroInterval);
        pomodoroInterval = setInterval(pomodoroTick, 1000);
    } else if (pomodoroState === 'work') {
        pomodoroState = 'stopped';
        if (pomodoroInterval) { clearInterval(pomodoroInterval); pomodoroInterval = null; }
    } else if (pomodoroState === 'break') {
        pomodoroState = 'work';
        pomodoroSeconds = WORK_DURATION;
        if (!pomodoroInterval) pomodoroInterval = setInterval(pomodoroTick, 1000);
    }
    updatePomodoroDisplay();
}

// ============================================
// Claude History Provider (Webview)
// ============================================
class ClaudeHistoryProvider {
    constructor() {
        this._view = undefined;
    }

    refresh() {
        if (this._view) {
            this._view.webview.html = this._getHtml();
        }
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._getHtml();

        webviewView.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'resume') {
                vscode.commands.executeCommand('vibecoding-layout.resumeSession', msg.sessionId, msg.cwd);
            } else if (msg.type === 'export') {
                vscode.commands.executeCommand('vibecoding-layout.exportSession', msg.sessionId, msg.filePath);
            }
        });
    }

    _getSessions() {
        const home = process.env.USERPROFILE || process.env.HOME;
        const projectsDir = path.join(home, '.claude', 'projects');
        if (!fs.existsSync(projectsDir)) return [];

        const sessions = [];
        try {
            const dirs = fs.readdirSync(projectsDir);
            for (const dir of dirs) {
                const fullDir = path.join(projectsDir, dir);
                try { if (!fs.statSync(fullDir).isDirectory()) continue; } catch (e) { continue; }
                const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.jsonl'));
                for (const file of files) {
                    const fullPath = path.join(fullDir, file);
                    try {
                        const stat = fs.statSync(fullPath);
                        sessions.push({
                            sessionId: file.replace('.jsonl', ''),
                            filePath: fullPath,
                            projectDir: dir,
                            mtime: stat.mtimeMs,
                            size: stat.size
                        });
                    } catch (e) {}
                }
            }
        } catch (e) {}

        sessions.sort((a, b) => b.mtime - a.mtime);

        return sessions.slice(0, 25).map(s => {
            const info = this._getSessionInfo(s.filePath);
            return { ...s, ...info };
        });
    }

    _getSessionInfo(filePath) {
        const result = { preview: null, cwd: null };
        try {
            const fd = fs.openSync(filePath, 'r');
            const buf = Buffer.alloc(8192);
            const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
            fs.closeSync(fd);
            const chunk = buf.toString('utf-8', 0, bytesRead);
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const d = JSON.parse(line);
                    if (d.cwd && !result.cwd) result.cwd = d.cwd;
                    if (!result.preview && d.type === 'user' && d.message && d.message.content) {
                        let text = typeof d.message.content === 'string'
                            ? d.message.content : JSON.stringify(d.message.content);
                        if (text.length > 60) text = text.substring(0, 57) + '...';
                        result.preview = text;
                    }
                    if (result.preview && result.cwd) break;
                } catch (e) {}
            }
        } catch (e) {}
        return result;
    }

    _getHtml() {
        const sessions = this._getSessions();
        const sessionsJson = JSON.stringify(sessions).replace(/</g, '\\u003c').replace(/'/g, '\\u0027');

        return `<!DOCTYPE html>
<html>
<head>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        background: transparent;
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        height: 100vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    .toolbar {
        display: flex;
        align-items: center;
        padding: 6px 8px;
        gap: 8px;
        border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
    }
    .toolbar input {
        flex: 1;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 12px;
        font-family: var(--vscode-font-family);
        outline: none;
    }
    .toolbar input:focus { border-color: var(--vscode-focusBorder); }
    .toolbar input::placeholder { color: var(--vscode-input-placeholderForeground); }
    .toolbar .count {
        font-size: 11px;
        opacity: 0.5;
        white-space: nowrap;
    }
    .table-wrap {
        flex: 1;
        overflow-y: auto;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
    }
    thead th {
        position: sticky;
        top: 0;
        background: var(--vscode-editor-background);
        text-align: left;
        padding: 5px 8px;
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        opacity: 0.6;
        border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
        white-space: nowrap;
    }
    tbody tr {
        cursor: pointer;
        transition: background 0.1s;
    }
    tbody tr:hover {
        background: var(--vscode-list-hoverBackground);
    }
    tbody td {
        padding: 6px 8px;
        border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.05));
        vertical-align: top;
    }
    .col-ago { white-space: nowrap; color: var(--vscode-textLink-foreground); font-weight: 500; min-width: 70px; }
    .col-date { white-space: nowrap; opacity: 0.5; font-size: 11px; min-width: 90px; }
    .col-folder { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.7; font-size: 11px; }
    .col-preview { word-break: break-word; line-height: 1.3; }
    .col-id { font-family: var(--vscode-editor-font-family); font-size: 10px; opacity: 0.35; white-space: nowrap; }
    .col-actions { white-space: nowrap; }
    .col-actions button {
        background: none; border: none; color: var(--vscode-textLink-foreground); cursor: pointer;
        font-size: 11px; padding: 2px 4px; opacity: 0.6;
    }
    .col-actions button:hover { opacity: 1; text-decoration: underline; }
    .empty { padding: 20px; text-align: center; opacity: 0.4; font-size: 13px; }
</style>
</head>
<body>
    <div class="toolbar">
        <input type="text" id="search" placeholder="Search sessions..." />
        <span class="count" id="count"></span>
    </div>
    <div class="table-wrap">
        <table>
            <thead>
                <tr>
                    <th>When</th>
                    <th>Date</th>
                    <th>Folder</th>
                    <th>Content</th>
                    <th>ID</th>
                    <th></th>
                </tr>
            </thead>
            <tbody id="tbody"></tbody>
        </table>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const sessions = ${sessionsJson};

        function timeAgo(ms) {
            const sec = Math.floor((Date.now() - ms) / 1000);
            if (sec < 60) return sec + 's ago';
            const min = Math.floor(sec / 60);
            if (min < 60) return min + 'm ago';
            const hr = Math.floor(min / 60);
            if (hr < 24) return hr + 'h ago';
            const day = Math.floor(hr / 24);
            if (day < 30) return day + 'd ago';
            const mon = Math.floor(day / 30);
            return mon + 'mo ago';
        }

        function escHtml(s) {
            if (!s) return '';
            return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }

        function folderName(cwd, dir) {
            if (cwd) {
                const parts = cwd.replace(/\\\\/g, '/').split('/');
                return parts[parts.length - 1] || parts[parts.length - 2] || cwd;
            }
            return dir;
        }

        function render(filter) {
            const f = (filter || '').toLowerCase();
            const filtered = f
                ? sessions.filter(s =>
                    (s.preview || '').toLowerCase().includes(f) ||
                    (s.cwd || s.projectDir || '').toLowerCase().includes(f) ||
                    s.sessionId.toLowerCase().includes(f))
                : sessions;

            document.getElementById('count').textContent = filtered.length + ' sessions';

            if (filtered.length === 0) {
                document.getElementById('tbody').innerHTML =
                    '<tr><td colspan="6" class="empty">No sessions found</td></tr>';
                return;
            }

            document.getElementById('tbody').innerHTML = filtered.map(s => {
                const d = new Date(s.mtime);
                const dateStr = d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', {hour:'2-digit',minute:'2-digit'});
                const ago = timeAgo(s.mtime);
                const folder = escHtml(folderName(s.cwd, s.projectDir));
                const preview = escHtml(s.preview || '\\u2014');
                const shortId = s.sessionId.substring(0, 8);

                return '<tr>'
                    + '<td class="col-ago">' + ago + '</td>'
                    + '<td class="col-date">' + dateStr + '</td>'
                    + '<td class="col-folder" title="' + escHtml(s.cwd || s.projectDir) + '">' + folder + '</td>'
                    + '<td class="col-preview">' + preview + '</td>'
                    + '<td class="col-id" title="' + s.sessionId + '">' + shortId + '</td>'
                    + '<td class="col-actions">'
                    + '<button data-action="resume" data-sid="' + s.sessionId + '" data-cwd="' + escHtml(s.cwd || '') + '">Resume</button> '
                    + '<button data-action="export" data-sid="' + s.sessionId + '" data-path="' + escHtml(s.filePath) + '">Export</button>'
                    + '</td>'
                    + '</tr>';
            }).join('');
        }

        document.getElementById('search').addEventListener('input', (e) => render(e.target.value));

        document.getElementById('tbody').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const action = btn.dataset.action;
            if (action === 'resume') {
                vscode.postMessage({ type: 'resume', sessionId: btn.dataset.sid, cwd: btn.dataset.cwd || null });
            } else if (action === 'export') {
                vscode.postMessage({ type: 'export', sessionId: btn.dataset.sid, filePath: btn.dataset.path });
            }
        });

        render();
    </script>
</body>
</html>`;
    }
}

// ============================================
// Export Claude Session to Markdown
// ============================================
async function exportSession(sessionId, filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        vscode.window.showErrorMessage('Session file not found');
        return;
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n');
        let md = `# Claude Session: ${sessionId}\n\n`;
        md += `**Exported:** ${new Date().toLocaleString()}\n\n---\n\n`;

        for (const line of lines) {
            try {
                const d = JSON.parse(line);
                if (d.type === 'user' && d.message && d.message.content) {
                    const text = typeof d.message.content === 'string'
                        ? d.message.content : JSON.stringify(d.message.content, null, 2);
                    md += `## User\n\n${text}\n\n---\n\n`;
                } else if (d.type === 'assistant' && d.message && d.message.content) {
                    const blocks = Array.isArray(d.message.content) ? d.message.content : [d.message.content];
                    md += `## Assistant\n\n`;
                    for (const block of blocks) {
                        if (typeof block === 'string') {
                            md += block + '\n\n';
                        } else if (block.type === 'text') {
                            md += (block.text || '') + '\n\n';
                        } else if (block.type === 'tool_use') {
                            md += `**Tool:** \`${block.name}\`\n\`\`\`json\n${JSON.stringify(block.input, null, 2)}\n\`\`\`\n\n`;
                        }
                    }
                    md += `---\n\n`;
                }
            } catch (e) {}
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.env.USERPROFILE || '',
                `claude-session-${sessionId.substring(0, 8)}.md`
            )),
            filters: { 'Markdown': ['md'] }
        });

        if (uri) {
            fs.writeFileSync(uri.fsPath, md, 'utf-8');
            vscode.window.showInformationMessage(`Session exported to ${path.basename(uri.fsPath)}`);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: true });
        }
    } catch (e) {
        vscode.window.showErrorMessage('Export failed: ' + e.message);
    }
}

// ============================================
// File Explorer Tree Provider
// ============================================
class FileExplorerProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this._debounceTimer = null;
    }

    refresh() {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            this._onDidChangeTreeData.fire(undefined);
        }, 400);
    }

    getTreeItem(element) {
        return element;
    }

    async getChildren(element) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            const item = new vscode.TreeItem('Open a folder to see files');
            item.iconPath = new vscode.ThemeIcon('folder-opened');
            return [item];
        }

        if (!element && folders.length > 1) {
            return folders.map(folder => {
                const item = new vscode.TreeItem(
                    folder.uri,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                item.label = folder.name;
                item.iconPath = new vscode.ThemeIcon('root-folder');
                item.tooltip = folder.uri.fsPath;
                return item;
            });
        }

        const dirUri = element ? element.resourceUri : folders[0].uri;

        try {
            const entries = await vscode.workspace.fs.readDirectory(dirUri);

            entries.sort((a, b) => {
                const aIsDir = (a[1] & vscode.FileType.Directory) !== 0;
                const bIsDir = (b[1] & vscode.FileType.Directory) !== 0;
                if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
                return a[0].localeCompare(b[0]);
            });

            return entries.map(([name, type]) => {
                const childUri = vscode.Uri.joinPath(dirUri, name);
                const isDir = (type & vscode.FileType.Directory) !== 0;

                const item = new vscode.TreeItem(
                    childUri,
                    isDir
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None
                );

                item.tooltip = vscode.workspace.asRelativePath(childUri);
                item.contextValue = isDir ? 'folder' : 'file';

                if (!isDir) {
                    item.command = {
                        command: 'vibecoding-layout.openFile',
                        arguments: [childUri],
                        title: 'Open File'
                    };
                }

                return item;
            });
        } catch (err) {
            return [];
        }
    }
}

// ============================================
// Notes Webview Provider (file-based, per-project)
// ============================================
class NotesViewProvider {
    constructor(context) {
        this._context = context;
        this._view = undefined;
    }

    _getFilePath() {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            return path.join(folders[0].uri.fsPath, '.vscode', 'vibestation-notes.md');
        }
        return null;
    }

    _ensureDir(filePath) {
        const dir = path.dirname(filePath);
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        } catch (e) {}
    }

    _loadNotes() {
        const filePath = this._getFilePath();
        if (!filePath) return '';
        try {
            if (fs.existsSync(filePath)) {
                return fs.readFileSync(filePath, 'utf-8');
            }
        } catch (e) {}
        return '';
    }

    _saveNotes(text) {
        const filePath = this._getFilePath();
        if (!filePath) return;
        try {
            this._ensureDir(filePath);
            fs.writeFileSync(filePath, text, 'utf-8');
        } catch (e) {}
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };

        const savedNotes = this._loadNotes();
        webviewView.webview.html = this._getHtml(savedNotes);

        webviewView.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'save') {
                this._saveNotes(msg.text);
            }
        });

        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            if (this._view) {
                const notes = this._loadNotes();
                this._view.webview.html = this._getHtml(notes);
            }
        });
    }

    _getHtml(savedNotes) {
        const escaped = savedNotes
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        return `<!DOCTYPE html>
<html>
<head>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        background: transparent;
        font-family: var(--vscode-font-family);
        height: 100vh;
        display: flex;
        flex-direction: column;
    }
    textarea {
        flex: 1;
        width: 100%;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        border: none;
        outline: none;
        padding: 8px;
        font-size: var(--vscode-editor-font-size);
        font-family: var(--vscode-editor-font-family);
        resize: none;
        line-height: 1.5;
    }
    textarea::placeholder {
        color: var(--vscode-input-placeholderForeground);
    }
</style>
</head>
<body>
    <textarea id="notes" placeholder="Write your notes here...">${escaped}</textarea>
    <script>
        const vscode = acquireVsCodeApi();
        const ta = document.getElementById('notes');
        let timer;
        ta.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                vscode.postMessage({ type: 'save', text: ta.value });
            }, 500);
        });
    </script>
</body>
</html>`;
    }
}

// ============================================
// TODO Webview Provider (file-based, per-project)
// ============================================
class TodoViewProvider {
    constructor(context) {
        this._context = context;
        this._view = undefined;
    }

    _getFilePath() {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            return path.join(folders[0].uri.fsPath, '.vscode', 'vibestation-todo.json');
        }
        return null;
    }

    _ensureDir(filePath) {
        const dir = path.dirname(filePath);
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        } catch (e) {}
    }

    _loadTodos() {
        const filePath = this._getFilePath();
        if (!filePath) return [];
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                const parsed = JSON.parse(content);
                return Array.isArray(parsed) ? parsed : [];
            }
        } catch (e) {}
        return [];
    }

    _saveTodos(todos) {
        const filePath = this._getFilePath();
        if (!filePath) return;
        try {
            this._ensureDir(filePath);
            fs.writeFileSync(filePath, JSON.stringify(todos, null, 2), 'utf-8');
        } catch (e) {}
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };

        const todos = this._loadTodos();
        webviewView.webview.html = this._getHtml(todos);

        webviewView.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'save') {
                this._saveTodos(msg.todos);
            }
        });

        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            if (this._view) {
                const todos = this._loadTodos();
                this._view.webview.html = this._getHtml(todos);
            }
        });
    }

    _getHtml(todos) {
        const todosJson = JSON.stringify(todos).replace(/</g, '\\u003c');
        return `<!DOCTYPE html>
<html>
<head>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        background: transparent;
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        height: 100vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    .input-row {
        display: flex;
        padding: 8px;
        gap: 6px;
        border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
    }
    .input-row input {
        flex: 1;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
        border-radius: 4px;
        padding: 6px 10px;
        font-size: 13px;
        font-family: var(--vscode-font-family);
        outline: none;
    }
    .input-row input:focus { border-color: var(--vscode-focusBorder); }
    .input-row input::placeholder { color: var(--vscode-input-placeholderForeground); }
    .input-row button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 4px;
        padding: 6px 12px;
        font-size: 13px;
        cursor: pointer;
        white-space: nowrap;
    }
    .input-row button:hover { background: var(--vscode-button-hoverBackground); }
    .todo-list { flex: 1; overflow-y: auto; padding: 4px 0; }
    .todo-item {
        display: flex;
        align-items: center;
        padding: 5px 8px;
        gap: 8px;
        cursor: pointer;
        transition: background 0.1s;
    }
    .todo-item:hover { background: var(--vscode-list-hoverBackground); }
    .todo-item input[type="checkbox"] {
        width: 16px; height: 16px;
        accent-color: var(--vscode-button-background);
        cursor: pointer; flex-shrink: 0;
    }
    .todo-item .text { flex: 1; font-size: 13px; line-height: 1.4; word-break: break-word; }
    .todo-item.done .text { text-decoration: line-through; opacity: 0.5; }
    .todo-item .delete-btn {
        opacity: 0; background: none; border: none;
        color: var(--vscode-errorForeground, #f44);
        cursor: pointer; font-size: 16px; padding: 0 4px; flex-shrink: 0;
    }
    .todo-item:hover .delete-btn { opacity: 0.7; }
    .todo-item .delete-btn:hover { opacity: 1; }
    .footer {
        padding: 6px 10px; font-size: 11px; opacity: 0.6;
        border-top: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
        display: flex; justify-content: space-between;
    }
    .footer a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
    .empty { padding: 20px; text-align: center; opacity: 0.4; font-size: 13px; }
</style>
</head>
<body>
    <div class="input-row">
        <input type="text" id="newTodo" placeholder="Add a task..." />
        <button id="addBtn">Add</button>
    </div>
    <div class="todo-list" id="list"></div>
    <div class="footer" id="footer"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let todos = ${todosJson};

        function render() {
            const list = document.getElementById('list');
            const footer = document.getElementById('footer');

            if (todos.length === 0) {
                list.innerHTML = '<div class="empty">No tasks yet</div>';
                footer.innerHTML = '';
                return;
            }

            const pending = todos.filter(t => !t.done).length;
            const total = todos.length;

            list.innerHTML = todos.map((t, i) =>
                '<div class="todo-item ' + (t.done ? 'done' : '') + '" data-i="' + i + '">' +
                    '<input type="checkbox" ' + (t.done ? 'checked' : '') + ' data-i="' + i + '" />' +
                    '<span class="text">' + escapeHtml(t.text) + '</span>' +
                    '<button class="delete-btn" data-i="' + i + '">\\u00d7</button>' +
                '</div>'
            ).join('');

            footer.innerHTML = pending + ' of ' + total + ' remaining &nbsp;|&nbsp; <a id="clearDone">Clear done</a>';

            const clearBtn = document.getElementById('clearDone');
            if (clearBtn) clearBtn.onclick = () => { todos = todos.filter(t => !t.done); save(); render(); };
        }

        function escapeHtml(s) {
            return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }

        function save() {
            vscode.postMessage({ type: 'save', todos });
        }

        function addTodo() {
            const input = document.getElementById('newTodo');
            const text = input.value.trim();
            if (!text) return;
            todos.unshift({ text, done: false, created: Date.now() });
            input.value = '';
            save();
            render();
        }

        document.getElementById('addBtn').onclick = addTodo;
        document.getElementById('newTodo').onkeydown = (e) => { if (e.key === 'Enter') addTodo(); };

        document.getElementById('list').onclick = (e) => {
            const i = parseInt(e.target.dataset.i);
            if (isNaN(i)) return;
            if (e.target.type === 'checkbox') {
                todos[i].done = !todos[i].done;
                save(); render();
            } else if (e.target.classList.contains('delete-btn')) {
                todos.splice(i, 1);
                save(); render();
            }
        };

        render();
    </script>
</body>
</html>`;
    }
}

// ============================================
// Snippets Webview Provider (file-based, per-project)
// ============================================
class SnippetsViewProvider {
    constructor(context) {
        this._context = context;
        this._view = undefined;
    }

    _getFilePath() {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            return path.join(folders[0].uri.fsPath, '.vscode', 'vibestation-snippets.json');
        }
        return null;
    }

    _ensureDir(filePath) {
        const dir = path.dirname(filePath);
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        } catch (e) {}
    }

    _loadSnippets() {
        const filePath = this._getFilePath();
        if (!filePath) return [];
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                const parsed = JSON.parse(content);
                return Array.isArray(parsed) ? parsed : [];
            }
        } catch (e) {}
        return [];
    }

    _saveSnippets(snippets) {
        const filePath = this._getFilePath();
        if (!filePath) return;
        try {
            this._ensureDir(filePath);
            fs.writeFileSync(filePath, JSON.stringify(snippets, null, 2), 'utf-8');
        } catch (e) {}
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };

        const snippets = this._loadSnippets();
        webviewView.webview.html = this._getHtml(snippets);

        webviewView.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'save') {
                this._saveSnippets(msg.snippets);
            } else if (msg.type === 'paste') {
                const terminal = vscode.window.activeTerminal;
                if (terminal) {
                    terminal.sendText(msg.text, false);
                    terminal.show(false);
                } else {
                    vscode.window.showWarningMessage('No active terminal');
                }
            } else if (msg.type === 'copy') {
                vscode.env.clipboard.writeText(msg.text);
                vscode.window.showInformationMessage('Copied to clipboard');
            }
        });

        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            if (this._view) {
                const snippets = this._loadSnippets();
                this._view.webview.html = this._getHtml(snippets);
            }
        });
    }

    _getHtml(snippets) {
        const snippetsJson = JSON.stringify(snippets).replace(/</g, '\\u003c');
        return `<!DOCTYPE html>
<html>
<head>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        background: transparent;
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        height: 100vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    .add-form {
        padding: 8px;
        border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .add-form.collapsed .form-body { display: none; }
    .add-form .toggle-btn {
        background: none; border: none;
        color: var(--vscode-textLink-foreground);
        cursor: pointer; font-size: 12px;
        text-align: left; padding: 2px 0;
    }
    .add-form .toggle-btn:hover { text-decoration: underline; }
    .add-form input, .add-form textarea {
        width: 100%;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
        border-radius: 4px;
        padding: 6px 8px;
        font-size: 12px;
        font-family: var(--vscode-font-family);
        outline: none;
    }
    .add-form input:focus, .add-form textarea:focus { border-color: var(--vscode-focusBorder); }
    .add-form textarea {
        min-height: 60px;
        resize: vertical;
        font-family: var(--vscode-editor-font-family);
    }
    .add-form .btn-row { display: flex; gap: 6px; justify-content: flex-end; }
    .add-form .btn-row button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none; border-radius: 4px;
        padding: 5px 12px; font-size: 12px; cursor: pointer;
    }
    .add-form .btn-row button:hover { background: var(--vscode-button-hoverBackground); }
    .snippet-list { flex: 1; overflow-y: auto; padding: 4px 0; }
    .snippet {
        padding: 8px;
        border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.05));
        transition: background 0.1s;
    }
    .snippet:hover { background: var(--vscode-list-hoverBackground); }
    .snippet .header {
        display: flex; align-items: center; gap: 6px;
        margin-bottom: 4px;
    }
    .snippet .name {
        flex: 1; font-weight: 600; font-size: 13px;
        color: var(--vscode-textLink-foreground);
    }
    .snippet .tag {
        font-size: 10px; padding: 1px 6px;
        border-radius: 8px; opacity: 0.6;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
    }
    .snippet .actions { display: flex; gap: 4px; }
    .snippet .actions button {
        background: none; border: none;
        color: var(--vscode-editor-foreground);
        cursor: pointer; font-size: 13px;
        opacity: 0; padding: 2px 4px;
        transition: opacity 0.1s;
    }
    .snippet:hover .actions button { opacity: 0.5; }
    .snippet .actions button:hover { opacity: 1; }
    .snippet .preview {
        font-size: 11px; opacity: 0.6;
        font-family: var(--vscode-editor-font-family);
        white-space: pre-wrap;
        max-height: 40px;
        overflow: hidden;
        line-height: 1.3;
    }
    .empty { padding: 20px; text-align: center; opacity: 0.4; font-size: 13px; }
</style>
</head>
<body>
    <div class="add-form collapsed" id="addForm">
        <button class="toggle-btn" id="toggleAdd">+ New Snippet</button>
        <div class="form-body">
            <input type="text" id="snippetName" placeholder="Snippet name..." />
            <input type="text" id="snippetTag" placeholder="Tag (optional: prompt, code, command...)" />
            <textarea id="snippetContent" placeholder="Content..."></textarea>
            <div class="btn-row">
                <button id="saveBtn">Save</button>
            </div>
        </div>
    </div>
    <div class="snippet-list" id="list"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let snippets = ${snippetsJson};

        function escHtml(s) {
            return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }

        function render() {
            const list = document.getElementById('list');
            if (snippets.length === 0) {
                list.innerHTML = '<div class="empty">No snippets yet.<br>Add prompt templates, code snippets, or commands.</div>';
                return;
            }
            list.innerHTML = snippets.map((s, i) => {
                const preview = escHtml(s.content.length > 80 ? s.content.substring(0, 77) + '...' : s.content);
                const tag = s.tag ? '<span class="tag">' + escHtml(s.tag) + '</span>' : '';
                return '<div class="snippet" data-i="' + i + '">'
                    + '<div class="header">'
                    + '<span class="name">' + escHtml(s.name) + '</span>'
                    + tag
                    + '<div class="actions">'
                    + '<button title="Paste to terminal" data-action="paste" data-i="' + i + '">$(terminal)</button>'
                    + '<button title="Copy" data-action="copy" data-i="' + i + '">$(copy)</button>'
                    + '<button title="Delete" data-action="delete" data-i="' + i + '">$(trash)</button>'
                    + '</div></div>'
                    + '<div class="preview">' + preview + '</div>'
                    + '</div>';
            }).join('');
        }

        function save() {
            vscode.postMessage({ type: 'save', snippets });
        }

        document.getElementById('toggleAdd').onclick = () => {
            document.getElementById('addForm').classList.toggle('collapsed');
        };

        document.getElementById('saveBtn').onclick = () => {
            const name = document.getElementById('snippetName').value.trim();
            const content = document.getElementById('snippetContent').value.trim();
            const tag = document.getElementById('snippetTag').value.trim();
            if (!name || !content) return;
            snippets.unshift({ name, content, tag, created: Date.now() });
            document.getElementById('snippetName').value = '';
            document.getElementById('snippetContent').value = '';
            document.getElementById('snippetTag').value = '';
            document.getElementById('addForm').classList.add('collapsed');
            save(); render();
        };

        document.getElementById('list').onclick = (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const i = parseInt(btn.dataset.i);
            const action = btn.dataset.action;
            if (isNaN(i)) return;
            if (action === 'paste') {
                vscode.postMessage({ type: 'paste', text: snippets[i].content });
            } else if (action === 'copy') {
                vscode.postMessage({ type: 'copy', text: snippets[i].content });
            } else if (action === 'delete') {
                snippets.splice(i, 1);
                save(); render();
            }
        };

        render();
    </script>
</body>
</html>`;
    }
}

// ============================================
// Bookmarks Webview Provider (file-based, per-project)
// ============================================
class BookmarksViewProvider {
    constructor(context) {
        this._context = context;
        this._view = undefined;
    }

    _getFilePath() {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            return path.join(folders[0].uri.fsPath, '.vscode', 'vibestation-bookmarks.json');
        }
        return null;
    }

    _ensureDir(filePath) {
        const dir = path.dirname(filePath);
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        } catch (e) {}
    }

    _loadBookmarks() {
        const filePath = this._getFilePath();
        if (!filePath) return [];
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                const parsed = JSON.parse(content);
                return Array.isArray(parsed) ? parsed : [];
            }
        } catch (e) {}
        return [];
    }

    _saveBookmarks(bookmarks) {
        const filePath = this._getFilePath();
        if (!filePath) return;
        try {
            this._ensureDir(filePath);
            fs.writeFileSync(filePath, JSON.stringify(bookmarks, null, 2), 'utf-8');
        } catch (e) {}
    }

    addBookmark(filePath) {
        const bookmarks = this._loadBookmarks();
        if (bookmarks.some(b => b.path === filePath)) {
            vscode.window.showInformationMessage('Already bookmarked');
            return;
        }
        bookmarks.unshift({
            path: filePath,
            name: path.basename(filePath),
            added: Date.now()
        });
        this._saveBookmarks(bookmarks);
        if (this._view) {
            this._view.webview.html = this._getHtml(bookmarks);
        }
        vscode.window.showInformationMessage(`Bookmarked: ${path.basename(filePath)}`);
    }

    removeBookmark(filePath) {
        let bookmarks = this._loadBookmarks();
        bookmarks = bookmarks.filter(b => b.path !== filePath);
        this._saveBookmarks(bookmarks);
        if (this._view) {
            this._view.webview.html = this._getHtml(bookmarks);
        }
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };

        const bookmarks = this._loadBookmarks();
        webviewView.webview.html = this._getHtml(bookmarks);

        webviewView.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'open') {
                const uri = vscode.Uri.file(msg.path);
                vscode.commands.executeCommand('vibecoding-layout.openFile', uri);
            } else if (msg.type === 'remove') {
                this.removeBookmark(msg.path);
            }
        });

        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            if (this._view) {
                const bookmarks = this._loadBookmarks();
                this._view.webview.html = this._getHtml(bookmarks);
            }
        });
    }

    _getHtml(bookmarks) {
        const bookmarksJson = JSON.stringify(bookmarks).replace(/</g, '\\u003c');
        return `<!DOCTYPE html>
<html>
<head>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        background: transparent;
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        height: 100vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    .info {
        padding: 8px;
        font-size: 11px;
        opacity: 0.5;
        border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
    }
    .bookmark-list { flex: 1; overflow-y: auto; padding: 4px 0; }
    .bookmark {
        display: flex;
        align-items: center;
        padding: 6px 8px;
        gap: 8px;
        cursor: pointer;
        transition: background 0.1s;
    }
    .bookmark:hover { background: var(--vscode-list-hoverBackground); }
    .bookmark .icon { opacity: 0.6; font-size: 14px; flex-shrink: 0; }
    .bookmark .name {
        flex: 1; font-size: 13px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .bookmark .path {
        font-size: 10px; opacity: 0.4;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        max-width: 150px;
    }
    .bookmark .remove-btn {
        opacity: 0; background: none; border: none;
        color: var(--vscode-errorForeground, #f44);
        cursor: pointer; font-size: 14px; padding: 0 4px; flex-shrink: 0;
    }
    .bookmark:hover .remove-btn { opacity: 0.6; }
    .bookmark .remove-btn:hover { opacity: 1; }
    .empty { padding: 20px; text-align: center; opacity: 0.4; font-size: 13px; }
</style>
</head>
<body>
    <div class="info">Bookmark files with Ctrl+Shift+P > "VibeCoding: Bookmark Current File"</div>
    <div class="bookmark-list" id="list"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let bookmarks = ${bookmarksJson};

        function escHtml(s) {
            return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }

        function getExt(name) {
            const dot = name.lastIndexOf('.');
            return dot > 0 ? name.substring(dot + 1).toLowerCase() : '';
        }

        function getIcon(name) {
            const ext = getExt(name);
            const icons = {
                js: '$(symbol-method)', ts: '$(symbol-method)',
                json: '$(json)', md: '$(markdown)',
                py: '$(symbol-method)', html: '$(globe)',
                css: '$(paintcan)', scss: '$(paintcan)',
                png: '$(file-media)', jpg: '$(file-media)', svg: '$(file-media)',
                cs: '$(symbol-class)', java: '$(symbol-class)',
                yml: '$(settings-gear)', yaml: '$(settings-gear)',
            };
            return icons[ext] || '$(file)';
        }

        function shortenPath(p) {
            const parts = p.replace(/\\\\/g, '/').split('/');
            if (parts.length > 3) return '.../' + parts.slice(-3).join('/');
            return p;
        }

        function render() {
            const list = document.getElementById('list');
            if (bookmarks.length === 0) {
                list.innerHTML = '<div class="empty">No bookmarks yet.<br>Use Command Palette to bookmark files.</div>';
                return;
            }
            list.innerHTML = bookmarks.map((b, i) =>
                '<div class="bookmark" data-i="' + i + '" data-path="' + escHtml(b.path) + '">'
                + '<span class="icon">' + getIcon(b.name) + '</span>'
                + '<span class="name">' + escHtml(b.name) + '</span>'
                + '<span class="path" title="' + escHtml(b.path) + '">' + escHtml(shortenPath(b.path)) + '</span>'
                + '<button class="remove-btn" data-action="remove" data-i="' + i + '" title="Remove">\\u00d7</button>'
                + '</div>'
            ).join('');
        }

        document.getElementById('list').onclick = (e) => {
            const removeBtn = e.target.closest('[data-action="remove"]');
            if (removeBtn) {
                const i = parseInt(removeBtn.dataset.i);
                vscode.postMessage({ type: 'remove', path: bookmarks[i].path });
                bookmarks.splice(i, 1);
                render();
                return;
            }
            const item = e.target.closest('.bookmark');
            if (item) {
                vscode.postMessage({ type: 'open', path: item.dataset.path });
            }
        };

        render();
    </script>
</body>
</html>`;
    }
}

// ============================================
// Dashboard Webview Provider
// ============================================
class DashboardViewProvider {
    constructor(context) {
        this._context = context;
        this._view = undefined;
    }

    refresh() {
        if (this._view) {
            this._generateHtml().then(html => {
                if (this._view) this._view.webview.html = html;
            });
        }
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        this._generateHtml().then(html => {
            if (this._view) this._view.webview.html = html;
        });
    }

    async _generateHtml() {
        const stats = await this._gatherStats();
        const statsJson = JSON.stringify(stats).replace(/</g, '\\u003c');

        return `<!DOCTYPE html>
<html>
<head>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        background: transparent;
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        height: 100vh;
        overflow-y: auto;
        padding: 12px;
    }
    .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-bottom: 16px;
    }
    .card {
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
        border-radius: 6px;
        padding: 12px;
    }
    .card.full { grid-column: 1 / -1; }
    .card .label {
        font-size: 10px;
        text-transform: uppercase;
        opacity: 0.5;
        margin-bottom: 4px;
        letter-spacing: 0.5px;
    }
    .card .value {
        font-size: 22px;
        font-weight: 700;
        color: var(--vscode-textLink-foreground);
        line-height: 1.2;
    }
    .card .sub {
        font-size: 11px;
        opacity: 0.5;
        margin-top: 2px;
    }
    h3 {
        font-size: 11px;
        text-transform: uppercase;
        opacity: 0.5;
        margin: 12px 0 8px 0;
        letter-spacing: 0.5px;
    }
    .file-list {
        font-size: 12px;
    }
    .file-row {
        display: flex;
        justify-content: space-between;
        padding: 3px 0;
        opacity: 0.7;
    }
    .file-row .time {
        font-size: 11px;
        opacity: 0.5;
    }
    .bar-chart {
        display: flex;
        align-items: flex-end;
        gap: 3px;
        height: 40px;
        margin-top: 6px;
    }
    .bar-chart .bar {
        flex: 1;
        background: var(--vscode-textLink-foreground);
        border-radius: 2px 2px 0 0;
        min-height: 2px;
        opacity: 0.7;
    }
    .bar-labels {
        display: flex;
        gap: 3px;
        margin-top: 2px;
    }
    .bar-labels span {
        flex: 1;
        text-align: center;
        font-size: 9px;
        opacity: 0.4;
    }
</style>
</head>
<body>
    <script>
        const stats = ${statsJson};

        function escHtml(s) {
            return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }

        function timeAgo(ms) {
            const sec = Math.floor((Date.now() - ms) / 1000);
            if (sec < 60) return sec + 's ago';
            const min = Math.floor(sec / 60);
            if (min < 60) return min + 'm ago';
            const hr = Math.floor(min / 60);
            if (hr < 24) return hr + 'h ago';
            const day = Math.floor(hr / 24);
            return day + 'd ago';
        }

        let html = '<div class="grid">';

        // Files count
        html += '<div class="card"><div class="label">Files</div><div class="value">'
            + stats.fileCount + '</div><div class="sub">' + stats.folderCount + ' folders</div></div>';

        // Lines
        html += '<div class="card"><div class="label">Lines of Code</div><div class="value">'
            + (stats.lineCount || '...').toLocaleString() + '</div><div class="sub">'
            + (stats.avgLines || 0) + ' avg per file</div></div>';

        // Git branch
        if (stats.gitBranch) {
            html += '<div class="card"><div class="label">Git Branch</div><div class="value" style="font-size:16px">'
                + escHtml(stats.gitBranch) + '</div><div class="sub">'
                + stats.gitCommitCount + ' commits</div></div>';
        }

        // Claude sessions
        html += '<div class="card"><div class="label">Claude Sessions</div><div class="value">'
            + stats.claudeSessions + '</div><div class="sub">total sessions</div></div>';

        // Top extensions
        if (stats.extensions && stats.extensions.length > 0) {
            html += '<div class="card full"><div class="label">File Types</div>';
            html += '<div class="bar-chart">';
            const maxExt = Math.max(...stats.extensions.map(e => e.count));
            stats.extensions.forEach(e => {
                const h = Math.max(4, Math.round((e.count / maxExt) * 36));
                html += '<div class="bar" style="height:' + h + 'px" title="' + e.ext + ': ' + e.count + '"></div>';
            });
            html += '</div><div class="bar-labels">';
            stats.extensions.forEach(e => {
                html += '<span>' + e.ext + '</span>';
            });
            html += '</div></div>';
        }

        html += '</div>';

        // Recently modified
        if (stats.recentFiles && stats.recentFiles.length > 0) {
            html += '<h3>Recently Modified</h3><div class="file-list">';
            stats.recentFiles.forEach(f => {
                html += '<div class="file-row"><span>' + escHtml(f.name) + '</span><span class="time">'
                    + timeAgo(f.mtime) + '</span></div>';
            });
            html += '</div>';
        }

        document.body.innerHTML = html;
    </script>
</body>
</html>`;
    }

    async _gatherStats() {
        const stats = {
            fileCount: 0,
            folderCount: 0,
            lineCount: 0,
            avgLines: 0,
            gitBranch: null,
            gitCommitCount: 0,
            claudeSessions: 0,
            extensions: [],
            recentFiles: []
        };

        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) return stats;

        const rootPath = folders[0].uri.fsPath;

        // Count files and collect recent files
        const extCounts = {};
        const recentFiles = [];

        try {
            await this._walkDir(rootPath, (filePath, isDir, stat) => {
                if (isDir) {
                    stats.folderCount++;
                    return;
                }
                stats.fileCount++;
                const ext = path.extname(filePath).toLowerCase();
                if (ext) {
                    extCounts[ext] = (extCounts[ext] || 0) + 1;
                }
                recentFiles.push({
                    name: path.relative(rootPath, filePath).replace(/\\/g, '/'),
                    mtime: stat.mtimeMs
                });
            }, 0);
        } catch (e) {}

        // Top file extensions
        const sortedExts = Object.entries(extCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([ext, count]) => ({ ext: ext.replace('.', ''), count }));
        stats.extensions = sortedExts;

        // Recent files (top 8)
        recentFiles.sort((a, b) => b.mtime - a.mtime);
        stats.recentFiles = recentFiles.slice(0, 8);

        // Line count (sample first 50 files for speed)
        let sampleLines = 0;
        let sampleCount = 0;
        const textExts = ['.js', '.ts', '.py', '.cs', '.java', '.html', '.css', '.json', '.md', '.yml', '.yaml', '.jsx', '.tsx', '.vue', '.rb', '.go', '.rs', '.cpp', '.c', '.h'];

        for (const f of recentFiles.slice(0, 50)) {
            const fullPath = path.join(rootPath, f.name);
            const ext = path.extname(fullPath).toLowerCase();
            if (!textExts.includes(ext)) continue;
            try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                sampleLines += content.split('\n').length;
                sampleCount++;
            } catch (e) {}
        }

        if (sampleCount > 0) {
            stats.avgLines = Math.round(sampleLines / sampleCount);
            const textFileCount = Object.entries(extCounts)
                .filter(([ext]) => textExts.includes(ext))
                .reduce((sum, [, count]) => sum + count, 0);
            stats.lineCount = Math.round((sampleLines / sampleCount) * textFileCount);
        }

        // Git info
        try {
            const headFile = path.join(rootPath, '.git', 'HEAD');
            if (fs.existsSync(headFile)) {
                const head = fs.readFileSync(headFile, 'utf-8').trim();
                if (head.startsWith('ref: refs/heads/')) {
                    stats.gitBranch = head.replace('ref: refs/heads/', '');
                } else {
                    stats.gitBranch = head.substring(0, 8);
                }

                // Count commits from log (simple approach)
                const logDir = path.join(rootPath, '.git', 'logs', 'HEAD');
                if (fs.existsSync(logDir)) {
                    const logContent = fs.readFileSync(logDir, 'utf-8');
                    stats.gitCommitCount = logContent.trim().split('\n').length;
                }
            }
        } catch (e) {}

        // Claude sessions count
        try {
            const home = process.env.USERPROFILE || process.env.HOME;
            const projectsDir = path.join(home, '.claude', 'projects');
            if (fs.existsSync(projectsDir)) {
                const dirs = fs.readdirSync(projectsDir);
                let total = 0;
                for (const dir of dirs) {
                    const fullDir = path.join(projectsDir, dir);
                    try {
                        if (fs.statSync(fullDir).isDirectory()) {
                            total += fs.readdirSync(fullDir).filter(f => f.endsWith('.jsonl')).length;
                        }
                    } catch (e) {}
                }
                stats.claudeSessions = total;
            }
        } catch (e) {}

        return stats;
    }

    async _walkDir(dirPath, callback, depth) {
        if (depth > 4) return; // Max depth
        const skipDirs = ['node_modules', '.git', '.next', 'dist', 'build', 'bin', 'obj', '.vs', '.vscode', '__pycache__', '.claude'];

        try {
            const entries = fs.readdirSync(dirPath);
            for (const entry of entries) {
                if (skipDirs.includes(entry)) continue;
                const fullPath = path.join(dirPath, entry);
                try {
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        callback(fullPath, true, stat);
                        await this._walkDir(fullPath, callback, depth + 1);
                    } else {
                        callback(fullPath, false, stat);
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }
}

// ============================================
// Layout Presets
// ============================================
async function applyLandscapeLayout() {
    try {
        const config = vscode.workspace.getConfiguration('workbench');
        await config.update('activityBar.location', 'hidden', vscode.ConfigurationTarget.Global);

        const gitConfig = vscode.workspace.getConfiguration('git');
        await gitConfig.update('openDiffOnClick', false, vscode.ConfigurationTarget.Global);

        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await delay(200);

        // Terminal in panel (bottom)
        await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
        await delay(300);

        // Open sidebar with our explorer
        await vscode.commands.executeCommand('vibecoding-files.focus');
        await delay(200);

        layoutActive = true;
        vscode.window.showInformationMessage('VibeCoding Landscape Mode activated!');
    } catch (err) {
        vscode.window.showErrorMessage('Layout error: ' + err.message);
    }
}

// ============================================
// Layout (Portrait - Default)
// ============================================
async function activateLayout() {
    try {
        // 1. Activity Bar gizle
        const config = vscode.workspace.getConfiguration('workbench');
        await config.update('activityBar.location', 'hidden', vscode.ConfigurationTarget.Global);

        const gitConfig = vscode.workspace.getConfiguration('git');
        await gitConfig.update('openDiffOnClick', false, vscode.ConfigurationTarget.Global);

        const editorConfig = vscode.workspace.getConfiguration('workbench.editor');
        await editorConfig.update('splitOnDragAndDrop', false, vscode.ConfigurationTarget.Global);
        const windowConfig = vscode.workspace.getConfiguration('window');
        await windowConfig.update('openFilesInNewWindow', 'off', vscode.ConfigurationTarget.Global);
        await delay(200);

        // 2. Editorleri kapat
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await delay(300);

        // 3. Source Control'u panel'deki markers container'a tasi
        try {
            await vscode.commands.executeCommand('vscode.moveViews', {
                viewIds: ['workbench.scm'],
                destinationId: 'workbench.panel.markers'
            });
            await delay(300);
        } catch (e) {}

        // 4. Explorer view'ini AYNI container'a tasi
        try {
            await vscode.commands.executeCommand('vscode.moveViews', {
                viewIds: ['vibecoding-files'],
                destinationId: 'workbench.panel.markers'
            });
            await delay(300);
        } catch (e) {}

        // 4b. Notes view'ini de ayni container'a tasi
        try {
            await vscode.commands.executeCommand('vscode.moveViews', {
                viewIds: ['vibecoding-notes'],
                destinationId: 'workbench.panel.markers'
            });
            await delay(300);
        } catch (e) {}

        // 4c. Problems panelini bos kalan vibecoding-panel'e tasi
        try {
            await vscode.commands.executeCommand('vscode.moveViews', {
                viewIds: ['workbench.panel.markers.view'],
                destinationId: 'vibecoding-panel'
            });
            await delay(200);
        } catch (e) {}

        // 4d. Sidebar'i kapat
        await vscode.commands.executeCommand('workbench.action.closeSidebar');
        await delay(100);

        // 5. Terminal editor alaninda ac
        const mainTerminal = vscode.window.createTerminal({
            name: 'Terminal',
            location: { viewColumn: vscode.ViewColumn.One }
        });
        await delay(400);

        // 6. Sidebar gizle
        await vscode.commands.executeCommand('workbench.action.closeSidebar');

        // 7. Panel'i ac
        try {
            await vscode.commands.executeCommand('workbench.panel.markers.view.focus');
        } catch (e) {
            try {
                await vscode.commands.executeCommand('vibecoding-files.focus');
            } catch (e2) {
                await vscode.commands.executeCommand('workbench.action.focusPanel');
            }
        }
        await delay(200);

        // 8. Terminal'e fokus
        mainTerminal.show(false);

        // 9. Sidebar ve auxiliary bar kesinlikle kapat
        await delay(300);
        await vscode.commands.executeCommand('workbench.action.closeSidebar');
        await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');

        layoutActive = true;
        vscode.window.showInformationMessage('VibeCoding_Layout activated! F7');
    } catch (err) {
        vscode.window.showErrorMessage('VibeCoding_Layout error: ' + err.message);
    }
}

async function resetLayout() {
    layoutActive = false;
    try {
        const config = vscode.workspace.getConfiguration('workbench');
        await config.update('activityBar.location', 'default', vscode.ConfigurationTarget.Global);

        const gitConfig = vscode.workspace.getConfiguration('git');
        await gitConfig.update('openDiffOnClick', true, vscode.ConfigurationTarget.Global);

        const editorConfig = vscode.workspace.getConfiguration('workbench.editor');
        await editorConfig.update('splitOnDragAndDrop', undefined, vscode.ConfigurationTarget.Global);
        const windowConfig = vscode.workspace.getConfiguration('window');
        await windowConfig.update('openFilesInNewWindow', undefined, vscode.ConfigurationTarget.Global);

        try {
            await vscode.commands.executeCommand('vscode.moveViews', {
                viewIds: ['workbench.scm'],
                destinationId: 'workbench.view.scm'
            });
        } catch (e) {}
        await delay(200);

        try {
            await vscode.commands.executeCommand('vscode.moveViews', {
                viewIds: ['vibecoding-files'],
                destinationId: 'vibecoding-panel'
            });
        } catch (e) {}
        try {
            await vscode.commands.executeCommand('vscode.moveViews', {
                viewIds: ['vibecoding-notes'],
                destinationId: 'vibecoding-panel'
            });
        } catch (e) {}
        try {
            await vscode.commands.executeCommand('vscode.moveViews', {
                viewIds: ['workbench.panel.markers.view'],
                destinationId: 'workbench.panel.markers'
            });
        } catch (e) {}
        try {
            await vscode.commands.executeCommand('vscode.moveViews', {
                viewIds: ['claude-history'],
                destinationId: 'claude-history-panel'
            });
        } catch (e) {}
        await delay(200);

        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await delay(200);
        await vscode.commands.executeCommand('workbench.action.editorLayoutSingle');
        await vscode.commands.executeCommand('workbench.view.explorer');

        vscode.window.showInformationMessage('VibeCoding_Layout reset.');
    } catch (err) {
        vscode.window.showErrorMessage('Reset error: ' + err.message);
    }
}

// ============================================
// Drag-drop: resim dosyalarini terminale yol olarak yapistir
// ============================================
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif'];
let _internalOpen = false;

function isImageFile(fsPath) {
    const lower = fsPath.toLowerCase();
    return IMAGE_EXTS.some(ext => lower.endsWith(ext));
}

// ============================================
// Extension Lifecycle
// ============================================
let layoutActive = false;

function activate(context) {
    const fileProvider = new FileExplorerProvider();

    const treeView = vscode.window.createTreeView('vibecoding-files', {
        treeDataProvider: fileProvider,
        showCollapseAll: true
    });

    // Notes webview provider
    const notesProvider = new NotesViewProvider(context);
    const notesRegistration = vscode.window.registerWebviewViewProvider('vibecoding-notes', notesProvider);

    // TODO webview provider
    const todoProvider = new TodoViewProvider(context);
    const todoRegistration = vscode.window.registerWebviewViewProvider('vibecoding-todo', todoProvider);

    // Claude History provider (webview)
    const historyProvider = new ClaudeHistoryProvider();
    const historyRegistration = vscode.window.registerWebviewViewProvider('claude-history', historyProvider);

    // Snippets webview provider
    const snippetsProvider = new SnippetsViewProvider(context);
    const snippetsRegistration = vscode.window.registerWebviewViewProvider('vibecoding-snippets', snippetsProvider);

    // Bookmarks webview provider
    const bookmarksProvider = new BookmarksViewProvider(context);
    const bookmarksRegistration = vscode.window.registerWebviewViewProvider('vibecoding-bookmarks', bookmarksProvider);

    // Dashboard webview provider
    const dashboardProvider = new DashboardViewProvider(context);
    const dashboardRegistration = vscode.window.registerWebviewViewProvider('vibecoding-dashboard', dashboardProvider);

    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    watcher.onDidCreate(() => fileProvider.refresh());
    watcher.onDidDelete(() => fileProvider.refresh());

    // Explorer'dan dosya acma komutu
    const openFileCmd = vscode.commands.registerCommand('vibecoding-layout.openFile', async (uri) => {
        _internalOpen = true;
        await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: vscode.ViewColumn.One });
        setTimeout(() => { _internalOpen = false; }, 500);
    });

    // Layout aktifken, baska grupta acilan dosyalari ilk gruba tasi
    const editorListener = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (!layoutActive) return;
        if (_internalOpen) return;
        if (editor && editor.viewColumn && editor.viewColumn !== vscode.ViewColumn.One) {
            await vscode.commands.executeCommand('workbench.action.moveEditorToFirstGroup');
        }
    });

    // Drag-drop: suruklenen resim dosyalarini terminale yol olarak yapistir
    const tabListener = vscode.window.tabGroups.onDidChangeTabs(async (event) => {
        if (!layoutActive) return;
        if (_internalOpen) return;

        for (const tab of event.opened) {
            let uri;
            if (tab.input instanceof vscode.TabInputText) {
                uri = tab.input.uri;
            } else if (tab.input instanceof vscode.TabInputCustom) {
                uri = tab.input.uri;
            }

            if (uri && isImageFile(uri.fsPath)) {
                try {
                    await vscode.window.tabGroups.close(tab);
                } catch (e) {}
                const terminal = vscode.window.activeTerminal;
                if (terminal) {
                    terminal.sendText(uri.fsPath, false);
                }
            }
        }
    });

    // ============================================
    // Status Bar Items
    // ============================================

    // Claude System Status
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    statusBarItem.command = 'vibecoding-layout.claudeStatus';
    statusBarItem.text = '$(sync~spin) Claude: Checking...';
    statusBarItem.show();
    checkClaudeStatus();
    statusInterval = setInterval(checkClaudeStatus, CHECK_INTERVAL);

    // Context tracker
    contextBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 54);
    contextBarItem.text = '$(symbol-ruler) Ctx: --';
    contextBarItem.show();

    // Token tracker
    tokenBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 53);
    tokenBarItem.text = '$(dashboard) Tokens: --';
    tokenBarItem.show();

    // Cost tracker
    costBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 52);
    costBarItem.text = '$(credit-card) $--';
    costBarItem.tooltip = 'Session cost estimate';
    costBarItem.show();

    // Pomodoro timer
    pomodoroBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 51);
    pomodoroBarItem.command = 'vibecoding-layout.togglePomodoro';
    updatePomodoroDisplay();
    pomodoroBarItem.show();

    updateSessionInfo();
    sessionInterval = setInterval(updateSessionInfo, SESSION_CHECK_INTERVAL);

    // ============================================
    // Commands
    // ============================================
    const claudeStatusCmd = vscode.commands.registerCommand('vibecoding-layout.claudeStatus', showDetailedStatus);

    const resumeSessionCmd = vscode.commands.registerCommand('vibecoding-layout.resumeSession', async (sessionId, cwd) => {
        if (!sessionId) return;
        const terminalOptions = {
            name: 'Claude Resume',
            location: { viewColumn: vscode.ViewColumn.One }
        };
        if (cwd && fs.existsSync(cwd)) {
            terminalOptions.cwd = cwd;
        }
        const newTerminal = vscode.window.createTerminal(terminalOptions);
        newTerminal.show(false);
        await delay(500);
        newTerminal.sendText(`claude --resume ${sessionId}`);
    });

    const refreshHistoryCmd = vscode.commands.registerCommand('vibecoding-layout.refreshHistory', () => {
        historyProvider.refresh();
    });

    const togglePomodoroCmd = vscode.commands.registerCommand('vibecoding-layout.togglePomodoro', togglePomodoro);

    const exportSessionCmd = vscode.commands.registerCommand('vibecoding-layout.exportSession', exportSession);

    const addBookmarkCmd = vscode.commands.registerCommand('vibecoding-layout.addBookmark', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            bookmarksProvider.addBookmark(editor.document.uri.fsPath);
        } else {
            vscode.window.showWarningMessage('No active file to bookmark');
        }
    });

    const removeBookmarkCmd = vscode.commands.registerCommand('vibecoding-layout.removeBookmark', (filePath) => {
        bookmarksProvider.removeBookmark(filePath);
    });

    const refreshDashboardCmd = vscode.commands.registerCommand('vibecoding-layout.refreshDashboard', () => {
        dashboardProvider.refresh();
    });

    const layoutPortraitCmd = vscode.commands.registerCommand('vibecoding-layout.layoutPortrait', activateLayout);
    const layoutLandscapeCmd = vscode.commands.registerCommand('vibecoding-layout.layoutLandscape', applyLandscapeLayout);

    context.subscriptions.push(
        treeView,
        historyRegistration,
        notesRegistration,
        todoRegistration,
        snippetsRegistration,
        bookmarksRegistration,
        dashboardRegistration,
        watcher,
        editorListener,
        tabListener,
        openFileCmd,
        statusBarItem,
        contextBarItem,
        tokenBarItem,
        costBarItem,
        pomodoroBarItem,
        claudeStatusCmd,
        resumeSessionCmd,
        refreshHistoryCmd,
        togglePomodoroCmd,
        exportSessionCmd,
        addBookmarkCmd,
        removeBookmarkCmd,
        refreshDashboardCmd,
        layoutPortraitCmd,
        layoutLandscapeCmd,
        vscode.commands.registerCommand('vibecoding-layout.activate', activateLayout),
        vscode.commands.registerCommand('vibecoding-layout.reset', resetLayout),
        vscode.commands.registerCommand('vibecoding-layout.refreshExplorer', () => fileProvider.refresh())
    );
}

function deactivate() {
    if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
    }
    if (sessionInterval) {
        clearInterval(sessionInterval);
        sessionInterval = null;
    }
    if (pomodoroInterval) {
        clearInterval(pomodoroInterval);
        pomodoroInterval = null;
    }
}

module.exports = { activate, deactivate };
