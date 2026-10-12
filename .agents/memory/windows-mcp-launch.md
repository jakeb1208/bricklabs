---
name: Windows Roblox MCP launcher
description: Preserve safe cmd.exe quoting when launching Roblox Studio's MCP batch file on Windows.
---

When launching Roblox Studio's MCP batch file from Node on Windows, keep the quoted batch path inside a `.cmd` wrapper rather than passing embedded quotes through `cmd.exe` arguments. Node's Windows argument escaping can leave backslash-quote sequences literal for `cmd.exe`.

**Why:** A Windows profile path such as `C:\Users\First Last\...` was split at the space by the unquoted default command, so `cmd.exe` tried to execute only the first path segment.

**How to apply:** Keep the wrapper call as `call "%LOCALAPPDATA%\\Roblox\\mcp.bat"` and launch the wrapper with simple `cmd.exe /d /c` arguments; cover its path quoting in tests.
