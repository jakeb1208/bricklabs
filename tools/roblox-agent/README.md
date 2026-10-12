# Roblox Studio Game-Building Agent

A dockable Roblox Studio chat plugin backed by Roblox's official local Studio MCP server, a local bridge, and a small Gemini API proxy intended to run on Railway.

## How the pieces connect

```text
Roblox Studio docked plugin
   └─ HTTP over loopback → local bridge
                            ├─ stdio → Roblox Studio MCP (on this computer)
                            └─ HTTPS → Railway API → Gemini API
```

Roblox Studio's MCP server is a local `stdio` process, so the Railway service never connects to your computer or Studio directly. The Gemini key stays on Railway; the local bridge sends prompts to the proxy using a separate bearer token. Studio-changing MCP tool calls pause for your approval in the plugin before they run. Read-only tools can run without a prompt.

## 1. Deploy the Gemini proxy to Railway

From the repository root, create a Railway service using the repository. Set its build command to:

- **Build:** `pnpm --filter @workspace/roblox-agent run build`
- **Health check path:** `/healthz`

Railpack detects the root `start` script, which launches the API with `pnpm --filter @workspace/roblox-agent run start:api`. If your Railway service has a manual start-command override, set it to that same command. Railpack detects pnpm from the workspace lockfile and installs dependencies before the build command.

Add these variables in Railway's service variables UI:

- `GEMINI_API_KEY` — your Gemini API key. Do not paste it into chat, the plugin, or a committed file.
- `AGENT_API_TOKEN` — a long, randomly generated bearer token. For example, generate one with `openssl rand -hex 32`; use the same value in your local `.env`.
- `GEMINI_MODEL` — optional; defaults to `gemini-2.5-flash`. Select a model currently available to your Gemini API account. Model access and free-tier quotas vary by account and can change.

The API only forwards model requests to Google. It does not save conversations. The local bridge keeps the current chat sessions in memory until it exits.

## 2. Enable Roblox Studio MCP

In Roblox Studio, open **Assistant → … → Manage MCP Servers** and turn on **Enable Studio as MCP server**. Keep Studio open while using the plugin. Roblox documents these local launch commands:

- Windows: `%LOCALAPPDATA%\Roblox\mcp.bat` (the bridge launches it through `cmd.exe`)
- macOS: `/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP`

This bridge uses those documented defaults. For a custom installation, set `ROBLOX_MCP_COMMAND` and `ROBLOX_MCP_ARGS` in `.env`; `ROBLOX_MCP_ARGS` must be a JSON string array.

## 3. Start the local bridge

Copy `tools/roblox-agent/.env.example` to `tools/roblox-agent/.env`. Set `AGENT_API_URL` to the public Railway service URL and set `AGENT_API_TOKEN` to the same value as the Railway variable. Enable **Assistant → … → Manage MCP Servers → Enable Studio as MCP server** in Roblox Studio, keep Studio open, then run this one guided setup command from the repository root:

```sh
pnpm --filter @workspace/roblox-agent run setup:bridge
```

The command checks that `.env` exists, validates the Railway URL and token, and checks any custom MCP command settings before starting. It prints a specific fix when configuration is missing or invalid. On Windows and macOS, the bridge uses Roblox's documented Studio MCP command by default; other operating systems need `ROBLOX_MCP_COMMAND` (and optionally `ROBLOX_MCP_ARGS`) in `.env`. If Studio MCP cannot connect, the terminal points you to the Studio MCP switch and the plugin shows the connection status.

The bridge listens only on `127.0.0.1:4317`. Keep that terminal running. Open the plugin to run its setup check; it reports whether Railway is reachable and configured, the local bridge is running, and Studio MCP is connected. To check manually, open `http://127.0.0.1:4317/healthz` for the MCP connection state. The bridge setup check at `http://127.0.0.1:4317/api/setup-status` tests the Railway URL and token without returning either secret.

### Run setup diagnostics tests

From the repository root, run:

```sh
pnpm --filter @workspace/roblox-agent run test
```

These tests exercise the Railway URL/token diagnostics, missing server-side Gemini configuration, unreachable API handling, and the bridge's loopback-only binding and disconnected Studio MCP status.

## 4. Install the Studio plugin

Install the [Rojo CLI](https://rojo.space/docs/) once on your computer. From this directory, run the packaging command:

```sh
pnpm run plugin:build
```

This creates `RobloxStudioGameAgent.rbxmx` in `tools/roblox-agent/`. To install this local build, copy the file into `%LOCALAPPDATA%\Roblox\Plugins\` (use **Plugins → Plugins Folder** to open that destination). Do not double-click the `.rbxmx` file, and do not use **Manage Plugins**; that window is for Creator Store plugins. Fully close and reopen Studio. The plugin should add a **Studio Game Agent** button to the Plugins ribbon.

If the button still does not appear, enable **Plugin Debugging Enabled** in **File → Studio Settings → Studio**, then inspect `PluginDebugService` in Explorer and the Output window for a plugin load error. The first local HTTP request may prompt you to grant the plugin permission to contact `127.0.0.1`; allow it to use the local bridge.

If the plugin says **Bridge offline**, start the bridge from step 3. If **Railway** is not ready, check `AGENT_API_URL` and `AGENT_API_TOKEN` in the local `.env`, then check `GEMINI_API_KEY` and `AGENT_API_TOKEN` in Railway's service variables. If **Studio MCP** is not connected, enable **Assistant → … → Manage MCP Servers → Enable Studio as MCP server**, leave Studio open, and restart the bridge.

## Safety and setup notes

- The plugin only calls the local bridge. It never contains or sends the Gemini API key.
- The bridge only binds to loopback; do not change it to `0.0.0.0`.
- Editing scripts, executing Luau, inserting assets, changing play state, and other non-read-only actions require an explicit **Approve** click in the plugin.
- Treat approval prompts carefully: Roblox's MCP can modify the currently open place. Save a backup before large changes.
- Roblox Studio MCP is available for Windows and macOS. Other systems need a custom MCP command and are not auto-detected.
- This first version keeps sessions in local memory and does not include accounts, cloud chat history, usage analytics, or a public web chat.
