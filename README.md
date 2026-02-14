# VibeStation

A custom VS Code extension for portrait/vertical monitor coding with deep Claude AI integration.

## Features

### Layout
- **Portrait Mode (F7)** - Terminal top 2/3, tools bottom 1/3
- **Landscape Mode** - Traditional layout with hidden activity bar
- Activity bar hidden, sidebar hidden, clean minimal UI

### Panel Tabs
| Tab | Description |
|-----|-------------|
| **Tools** | Source Control + File Explorer + Notes (split views) |
| **CLAUDE HISTORY** | Session table with search, resume, and export to Markdown |
| **TODO** | Microsoft To-Do style task manager (per-project) |
| **SNIPPETS** | Prompt templates & code snippets with paste-to-terminal |
| **BOOKMARKS** | Quick file access with per-project storage |
| **DASHBOARD** | Project stats: files, lines, git info, file type chart |

### Status Bar
| Item | Description |
|------|-------------|
| **Context** | Claude context usage with color coding (green/yellow/orange/red) |
| **Tokens** | Input/output token counter |
| **Cost** | Session cost estimate (Sonnet 4.5 pricing) |
| **Pomodoro** | Focus timer - 25min work / 5min break (F8) |
| **Claude Status** | System status from claude.com API |

### Other
- **Image drag-drop** - Drag images to terminal, file path auto-pasted
- **Session resume** - Click any session in history to resume with correct working directory
- **Session export** - Export Claude conversations to Markdown
- Files always open as tabs (never splits)
- Per-project storage for Notes, TODO, Snippets, Bookmarks

## Installation

1. Copy `package.json` and `extension.js` to:
   ```
   ~/.vscode/extensions/custom.vibecoding-layout-7.0.0/
   ```
2. Reload VS Code (`Ctrl+Shift+P` > `Reload Window`)
3. Press **F7** to activate portrait mode

### Quick Install (Windows)
```powershell
$dest = "$env:USERPROFILE\.vscode\extensions\custom.vibecoding-layout-7.0.0"
New-Item -ItemType Directory -Force -Path $dest
Copy-Item package.json, extension.js -Destination $dest
```

### Quick Install (Mac/Linux)
```bash
dest="$HOME/.vscode/extensions/custom.vibecoding-layout-7.0.0"
mkdir -p "$dest"
cp package.json extension.js "$dest/"
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **F7** | Activate Portrait Layout |
| **F8** | Toggle Pomodoro Timer |

## Commands (Ctrl+Shift+P)

- `VibeCoding_Layout: Activate Portrait Mode`
- `VibeCoding_Layout: Reset to Default`
- `VibeCoding: Bookmark Current File`
- `VibeCoding: Claude System Status`
- `VibeCoding: Export Claude Session to Markdown`
- `VibeCoding: Layout - Portrait Mode`
- `VibeCoding: Layout - Landscape Mode`

## License

MIT
