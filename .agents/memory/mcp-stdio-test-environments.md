---
name: MCP stdio test environments
description: Notes on environment inheritance when testing the Roblox bridge's stdio MCP child processes.
---

The MCP SDK's stdio client transport does not pass arbitrary parent-process environment variables to spawned server processes by default. It inherits a limited safe-variable allowlist unless an explicit environment is provided.

**Why:** A test fixture that expects a custom parent environment variable may silently receive `undefined`, causing confusing behavior or leaked child processes.

**How to apply:** In bridge tests, pass needed fixture values through command arguments or configure the transport's child environment explicitly; always terminate spawned test servers during cleanup.
