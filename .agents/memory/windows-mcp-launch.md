---
name: Windows Roblox MCP launcher
description: Preserve safe cmd.exe quoting when launching Roblox Studio's MCP batch file on Windows.
---

When launching Roblox Studio's MCP batch file through `cmd.exe /c`, quote the command string with the outer double-quote pair so Windows profile paths containing spaces remain a single executable path.

**Why:** A Windows profile path such as `C:\Users\First Last\...` was split at the space by the unquoted default command, so `cmd.exe` tried to execute only the first path segment.

**How to apply:** Keep the quoted `cmd.exe /d /s /c` argument in the default bridge launcher and preserve regression coverage for paths with spaces when changing MCP process startup.
