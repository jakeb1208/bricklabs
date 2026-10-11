# Roblox Studio Game-Building Agent

A dockable Roblox Studio plugin that uses Roblox's local Studio MCP server and Gemini to help users build games. The Railway API proxy keeps the Gemini API key off the plugin; the local bridge connects Railway to the user's Studio session.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/roblox-agent run dev:api` — run the Gemini proxy API
- `pnpm --filter @workspace/roblox-agent run dev:bridge` — run the local Roblox MCP bridge
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Configure Gemini and API access in Railway; see `tools/roblox-agent/README.md`.
- Local bridge env is documented in `tools/roblox-agent/.env.example`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `tools/roblox-agent/src/api.ts` — Railway-hosted Gemini API proxy
- `tools/roblox-agent/src/bridge.ts` — local MCP client and approval-gated agent loop
- `tools/roblox-agent/src/Plugin.server.lua` — dockable Studio chat plugin
- `tools/roblox-agent/README.md` — Railway, local bridge, and plugin installation steps

## Architecture decisions

- Keep Roblox's official `stdio` MCP client on the user's computer; Railway cannot reach a local Studio process directly.
- Keep the Gemini API key in Railway variables, never inside the Studio plugin or bridge.
- Require explicit approval in Studio before any non-read-only MCP tool call.

## Product

The plugin provides an in-Studio chat surface for game-building requests. The local bridge supplies Roblox MCP tools to Gemini, and the Railway API proxy forwards authenticated Gemini requests without retaining chat history.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
