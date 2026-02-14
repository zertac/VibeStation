<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-Extension-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white" alt="VS Code Extension" />
  <img src="https://img.shields.io/badge/Claude%20AI-Integrated-FF6B35?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude AI" />
  <img src="https://img.shields.io/badge/Platform-Win%20%7C%20Mac%20%7C%20Linux-4ade80?style=for-the-badge" alt="Cross Platform" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="MIT License" />
</p>

<h1 align="center">VibeStation</h1>

<p align="center">
  <strong>Your AI-Powered Coding Workstation for VS Code</strong><br/>
  A custom VS Code extension that transforms your editor into a focused, portrait-mode coding environment with deep Claude AI integration, built-in productivity tools, and real-time session tracking.
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> &bull;
  <a href="#-features">Features</a> &bull;
  <a href="#-layout">Layout</a> &bull;
  <a href="#-ai-integration">AI Integration</a> &bull;
  <a href="#-productivity-tools">Tools</a> &bull;
  <a href="#-commands">Commands</a>
</p>

---

## Why VibeStation?

Modern AI-assisted development with tools like **Claude Code** demands a different workflow. Traditional editor layouts waste space and break your flow. VibeStation reimagines your VS Code as a **purpose-built cockpit** for vibe coding:

- **Portrait monitor optimized** — Terminal on top, tools on bottom. No wasted pixels.
- **Claude AI native** — Track context, tokens, costs, session history, and resume conversations in one click.
- **Zero distraction** — No activity bar, no sidebar clutter. Just you, your terminal, and your tools.
- **Everything in one place** — Notes, TODOs, snippets, bookmarks, file explorer, source control, dashboard — all as panel tabs.

---

## Quick Start

### Installation

```bash
git clone https://github.com/zertac/VibeStation.git
```

**Windows (PowerShell):**
```powershell
$dest = "$env:USERPROFILE\.vscode\extensions\custom.vibecoding-layout-7.0.0"
New-Item -ItemType Directory -Force -Path $dest
Copy-Item VibeStation\package.json, VibeStation\extension.js -Destination $dest
```

**Mac / Linux:**
```bash
dest="$HOME/.vscode/extensions/custom.vibecoding-layout-7.0.0"
mkdir -p "$dest"
cp VibeStation/package.json VibeStation/extension.js "$dest/"
```

Then reload VS Code (`Ctrl+Shift+P` > `Reload Window`) and press **F7**.

---

## Features

### Layout Modes

| Mode | Shortcut | Description |
|------|----------|-------------|
| **Portrait** | `F7` | Terminal top 2/3, panel tabs bottom 1/3. Built for vertical monitors. |
| **Landscape** | Command Palette | Clean layout with hidden activity bar for horizontal screens. |
| **Reset** | Command Palette | Restore VS Code to its default layout. |

**Portrait mode includes:**
- Activity bar and sidebar completely hidden
- Terminal opens in the editor area (not the panel)
- Files always open as tabs — never as splits
- Source Control, Explorer, and Notes merged into a single panel tab
- Image drag-drop to terminal auto-pastes the file path

---

### AI Integration

VibeStation is built around the **Claude Code** workflow:

#### Session Tracker (Status Bar)
| Indicator | What It Shows |
|-----------|---------------|
| `Ctx: 45.2K/200K (23%)` | Context window usage with color coding — green < 50%, yellow < 75%, orange < 90%, red > 90% |
| `In: 120.5K Out: 45.2K` | Total input/output tokens for the active session |
| `$0.842` | Real-time cost estimate based on Claude Sonnet 4.5 pricing |
| `Claude: Operational` | Live system status from the Claude API (checked every 2 min) |

#### Session History Panel
- **Modern table view** with columns: When, Date, Folder, Content, ID
- **Search & filter** across all sessions
- **One-click resume** — opens a new terminal in the correct working directory and runs `claude --resume`
- **Export to Markdown** — save any conversation as a `.md` file for documentation
- Displays relative time (e.g., "3h ago", "2d ago")

---

### Productivity Tools

All tools store data as files in `.vscode/` — portable across machines and syncable via git.

#### Panel Tabs

| Tab | Description |
|-----|-------------|
| **Tools** | Source Control + File Explorer + Notes — your core workspace in a single split view |
| **CLAUDE HISTORY** | Session browser with search, resume, and export |
| **TODO** | Microsoft To-Do inspired task manager. Add, complete, delete tasks. Per-project. |
| **SNIPPETS** | Save prompt templates, code blocks, or CLI commands. Paste to terminal or copy to clipboard with one click. Supports tags. |
| **BOOKMARKS** | Pin frequently used files for quick access. Add via Command Palette (`Ctrl+Shift+P` > "Bookmark Current File"). |
| **DASHBOARD** | Project overview — file count, estimated lines of code, git branch & commit count, file type distribution chart, recently modified files, total Claude sessions. |

#### Pomodoro Timer (Status Bar)

| State | Display | Action |
|-------|---------|--------|
| Stopped | `▶ Pomodoro` | Click or press `F8` to start |
| Working | `🔥 24:13` | 25-minute focus session. Click to stop. |
| Break | `☕ 4:45` | 5-minute break. Click to skip. |

Notifications at the end of each work/break cycle. Tracks completed pomodoro count.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **F7** | Activate Portrait Layout |
| **F8** | Toggle Pomodoro Timer |

---

## Commands

Open with `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac):

| Command | Description |
|---------|-------------|
| `VibeCoding_Layout: Activate Portrait Mode` | Activate the portrait coding layout |
| `VibeCoding_Layout: Reset to Default` | Restore VS Code defaults |
| `VibeCoding: Bookmark Current File` | Add the active file to bookmarks |
| `VibeCoding: Claude System Status` | View detailed Claude component status |
| `VibeCoding: Export Claude Session to Markdown` | Export a session as `.md` |
| `VibeCoding: Layout - Portrait Mode` | Same as F7 |
| `VibeCoding: Layout - Landscape Mode` | Horizontal screen layout |
| `VibeCoding: Refresh Dashboard` | Refresh project statistics |
| `VibeCoding: Toggle Pomodoro Timer` | Same as F8 |

---

## Data Storage

VibeStation stores all user data as **local files** in your project's `.vscode/` folder:

| File | Content |
|------|---------|
| `.vscode/vibestation-notes.md` | Your project notes (Markdown) |
| `.vscode/vibestation-todo.json` | Your TODO tasks |
| `.vscode/vibestation-snippets.json` | Your saved snippets & templates |
| `.vscode/vibestation-bookmarks.json` | Your bookmarked files |

**Benefits:**
- Works across machines — just sync via git
- No cloud dependency, no accounts
- Human-readable formats (Markdown, JSON)
- Survives extension reinstalls

**Privacy:** Add this to your project's `.gitignore` if you don't want to commit personal data:
```gitignore
.vscode/vibestation-*.json
.vscode/vibestation-*.md
```

---

## Cross-Platform Support

VibeStation works on **Windows**, **macOS**, and **Linux** with no configuration needed. All paths, environment variables, and APIs are platform-agnostic.

| Feature | Windows | macOS | Linux |
|---------|---------|-------|-------|
| Portrait Layout | Yes | Yes | Yes |
| Claude Session Tracking | Yes | Yes | Yes |
| Session Resume | Yes | Yes | Yes |
| File-based Storage | Yes | Yes | Yes |
| Pomodoro Timer | Yes | Yes | Yes |
| Status Bar Items | Yes | Yes | Yes |

---

## Tech Stack

- **Runtime:** VS Code Extension API
- **Language:** JavaScript (Node.js)
- **UI:** Webview (HTML/CSS/JS) with VS Code theme variables
- **Storage:** File-based (`.vscode/` folder)
- **AI Integration:** Claude Code CLI + Claude Status API
- **Zero dependencies** — no `node_modules`, no build step

---

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with <strong>Claude AI</strong> for the vibe coding community.<br/>
  <sub>If you find VibeStation useful, give it a star!</sub>
</p>
