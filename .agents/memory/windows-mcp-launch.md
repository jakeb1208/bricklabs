---
name: Windows Roblox MCP launcher
description: Preserve safe cmd.exe quoting when launching Roblox Studio's MCP batch file on Windows.
---

When launching Roblox Studio's MCP batch file through `cmd.exe /c`, use exactly one pair of quotes around the path and do not use `/s`; this preserves the quoted path when `LOCALAPPDATA` contains spaces.

**Why:** A Windows profile path such as `C:\Users\First Last\...` was split at the space by the unquoted default command, so `cmd.exe` tried to execute only the first path segment.

**How to apply:** Keep the `cmd.exe /d /c` argument with one quoted batch path and preserve regression coverage for profile paths with spaces when changing MCP process startup.
