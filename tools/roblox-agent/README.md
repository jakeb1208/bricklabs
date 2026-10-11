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

From the repository root, create a Railway service using the repository. Set these commands:

- **Build:** `pnpm install --frozen-lockfile && pnpm --filter @workspace/roblox-agent run build`
- **Start:** `pnpm --filter @workspace/roblox-agent run start:api`
- **Health check path:** `/healthz`

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

Copy `tools/roblox-agent/.env.example` to `tools/roblox-agent/.env`. Set `AGENT_API_URL` to the public Railway service URL and set `AGENT_API_TOKEN` to the same value as the Railway variable. Then, from the repository root:

```sh
pnpm --filter @workspace/roblox-agent run dev:bridge
```

The bridge listens only on `127.0.0.1:4317`. Keep that terminal running. Check `http://127.0.0.1:4317/healthz`; it should report `mcpConnected: true` and a nonzero `toolCount`.

## 4. Install the Studio plugin

Install the [Rojo CLI](https://rojo.space/docs/) on your computer, then from this directory run:

```sh
rojo build -o RobloxStudioGameAgent.rbxmx default.project.json
```

In Studio, use **Plugins → Manage Plugins → Install from File** and select `RobloxStudioGameAgent.rbxmx`. Restart Studio if the toolbar button does not appear. The first local HTTP request may prompt you to grant the plugin permission to contact `127.0.0.1`; allow it to use the local bridge.

## Safety and setup notes

- The plugin only calls the local bridge. It never contains or sends the Gemini API key.
- The bridge only binds to loopback; do not change it to `0.0.0.0`.
- Editing scripts, executing Luau, inserting assets, changing play state, and other non-read-only actions require an explicit **Approve** click in the plugin.
- Treat approval prompts carefully: Roblox's MCP can modify the currently open place. Save a backup before large changes.
- Roblox Studio MCP is available for Windows and macOS. Other systems need a custom MCP command and are not auto-detected.
- This first version keeps sessions in local memory and does not include accounts, cloud chat history, usage analytics, or a public web chat.
