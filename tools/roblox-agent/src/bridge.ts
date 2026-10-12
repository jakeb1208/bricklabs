import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  DEFAULT_MODEL,
  MAX_CHAT_TURNS,
  MAX_MESSAGE_LENGTH,
  MAX_TOOL_ROUNDS,
  getApiBaseUrl,
  getRequiredEnv,
  type GeminiContent,
} from "./shared.js";

type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: GeminiContent;
    finishReason?: string;
  }>;
  error?: { message?: string };
};

type PendingTurn = {
  sessionId: string;
  history: GeminiContent[];
  calls: Array<{ name: string; args: Record<string, unknown> }>;
};

export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
let bridgePort = Number(process.env["BRIDGE_PORT"] || 4317);

const sessions = new Map<string, GeminiContent[]>();
const pendingTurns = new Map<string, PendingTurn>();
let mcpClient: Client | null = null;
let toolDefinitions: ToolDefinition[] = [];
let connecting: Promise<void> | null = null;
let mcpConnectionError: string | null = null;
const localToken = process.env["BRIDGE_TOKEN"]?.trim() || randomUUID();

function authorizeLocalRequest(req: Request, res: Response): boolean {
  if ((req.header("authorization") ?? "") !== `Bearer ${localToken}`) {
    res.status(401).json({ error: "Invalid local bridge token." });
    return false;
  }
  return true;
}

function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64);
}

function geminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const type = schema["type"];
  const result: Record<string, unknown> = {};
  if (typeof type === "string") result["type"] = type.toUpperCase();
  if (typeof schema["description"] === "string") {
    result["description"] = schema["description"];
  }
  if (Array.isArray(schema["required"])) result["required"] = schema["required"];
  if (Array.isArray(schema["enum"])) result["enum"] = schema["enum"];
  const properties = schema["properties"];
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    result["properties"] = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [
        key,
        value && typeof value === "object" && !Array.isArray(value)
          ? geminiSchema(value as Record<string, unknown>)
          : { type: "STRING" },
      ]),
    );
  }
  const items = schema["items"];
  if (items && typeof items === "object" && !Array.isArray(items)) {
    result["items"] = geminiSchema(items as Record<string, unknown>);
  }
  return result;
}

function toGeminiTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: sanitizeToolName(tool.name),
        description: tool.description || tool.name,
        parameters: geminiSchema(tool.inputSchema),
      })),
    },
  ];
}

export function getDefaultMcpLaunchConfiguration(
  platform: NodeJS.Platform,
): { command: string; args: string[] } {
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      // cmd.exe needs the outer quote pair so the batch path still works when
      // LOCALAPPDATA contains spaces, as it commonly does in Windows usernames.
      args: ["/d", "/s", "/c", '""%LOCALAPPDATA%\\Roblox\\mcp.bat""'],
    };
  }
  if (platform === "darwin") {
    return {
      command: "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP",
      args: [],
    };
  }
  throw new Error(
    "Roblox Studio MCP auto-detection supports Windows and macOS. Set ROBLOX_MCP_COMMAND and ROBLOX_MCP_ARGS manually on this operating system.",
  );
}

async function connectMcp(): Promise<void> {
  if (mcpClient) return;
  if (connecting) return connecting;

  connecting = (async () => {
    let command = process.env["ROBLOX_MCP_COMMAND"]?.trim();
    let args: string[] = [];
    const rawArgs = process.env["ROBLOX_MCP_ARGS"]?.trim();
    if (rawArgs) {
      const parsed: unknown = JSON.parse(rawArgs);
      if (!Array.isArray(parsed) || parsed.some((arg) => typeof arg !== "string")) {
        throw new Error("ROBLOX_MCP_ARGS must be a JSON array of strings.");
      }
      args = parsed;
    }

    if (!command) {
      const defaults = getDefaultMcpLaunchConfiguration(process.platform);
      command = defaults.command;
      args = defaults.args;
    }

    const transport = new StdioClientTransport({
      command,
      args,
      stderr: "inherit",
    });
    const client = new Client({
      name: "roblox-studio-game-agent",
      version: "0.1.0",
    });
    await client.connect(transport);
    const listed = await client.listTools();
    toolDefinitions = listed.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
    mcpClient = client;
    mcpConnectionError = null;
  })().finally(() => {
    connecting = null;
  });

  return connecting.catch((error: unknown) => {
    mcpConnectionError =
      error instanceof Error ? error.message : "Unknown Roblox Studio MCP connection error.";
    throw error;
  });
}

type RailwaySetupStatus = {
  ready: boolean;
  message: string;
};

export async function checkRailwaySetup(): Promise<RailwaySetupStatus> {
  let apiUrl: string;
  try {
    apiUrl = getApiBaseUrl();
  } catch {
    return {
      ready: false,
      message: "Set AGENT_API_URL in tools/roblox-agent/.env to your Railway service URL.",
    };
  }

  const token = process.env["AGENT_API_TOKEN"]?.trim();
  if (!token) {
    return {
      ready: false,
      message: "Set AGENT_API_TOKEN in tools/roblox-agent/.env to match Railway.",
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(apiUrl);
  } catch {
    return { ready: false, message: "AGENT_API_URL is not a valid URL." };
  }
  if (parsedUrl.protocol !== "https:") {
    return { ready: false, message: "AGENT_API_URL must use the secure https:// Railway URL." };
  }

  try {
    const response = await fetch(`${apiUrl}/api/setup-check`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json().catch(() => ({}))) as {
      ready?: boolean;
      error?: string;
    };
    if (response.status === 401) {
      return {
        ready: false,
        message: "Railway rejected AGENT_API_TOKEN. Make it match the Railway service variable.",
      };
    }
    if (!response.ok) {
      return {
        ready: false,
        message:
          body.error ||
          `Railway setup check returned HTTP ${response.status}; verify the service deployment.`,
      };
    }
    return body.ready
      ? { ready: true, message: "Connected and configured." }
      : {
          ready: false,
          message: body.error || "Check GEMINI_API_KEY in Railway service variables.",
        };
  } catch {
    return {
      ready: false,
      message: "Can't reach Railway. Check AGENT_API_URL and confirm the Railway service is running.",
    };
  }
}

async function requestGemini(contents: GeminiContent[]): Promise<GeminiContent> {
  const apiUrl = getApiBaseUrl();
  const response = await fetch(`${apiUrl}/api/gemini/generate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${getRequiredEnv("AGENT_API_TOKEN")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents,
      tools: toGeminiTools(toolDefinitions),
      systemInstruction: {
        parts: [
          {
            text: [
              "You are a Roblox Studio game-building assistant.",
              "Use the connected Roblox Studio MCP tools to inspect and modify the user's currently open Studio project when needed.",
              "Before making broad or destructive changes, explain the impact and ask the user to confirm.",
              "Prefer small, reversible changes. Summarize the exact Studio actions you took.",
              "Use Luau conventions and Roblox APIs correctly.",
              `The selected Gemini model is ${process.env["GEMINI_MODEL"] || DEFAULT_MODEL}.`,
            ].join(" "),
          },
        ],
      },
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 2_048,
      },
    }),
    signal: AbortSignal.timeout(50_000),
  });

  const body = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (!response.ok) {
    const detail = body.error?.message || `Gemini API returned HTTP ${response.status}.`;
    throw new Error(detail);
  }

  const content = body.candidates?.[0]?.content;
  if (!content || !Array.isArray(content.parts)) {
    throw new Error(
      "Gemini returned no response content. The model may be rate-limited or unavailable on the current free tier.",
    );
  }
  return content;
}

function getFunctionCalls(content: GeminiContent): Array<{
  name: string;
  args: Record<string, unknown>;
}> {
  return content.parts.flatMap((part) => {
    const call = part["functionCall"];
    if (!call || typeof call !== "object") return [];
    const value = call as { name?: unknown; args?: unknown };
    if (typeof value.name !== "string") return [];
    return [
      {
        name: value.name,
        args:
          value.args && typeof value.args === "object"
            ? (value.args as Record<string, unknown>)
            : {},
      },
    ];
  });
}

function mcpToolName(geminiName: string): string | undefined {
  return toolDefinitions.find(
    (tool) => sanitizeToolName(tool.name) === geminiName,
  )?.name;
}

const READ_ONLY_TOOLS = new Set([
  "get_console_output",
  "get_studio_state",
  "http_get",
  "inspect_instance",
  "list_roblox_studios",
  "script_grep",
  "script_read",
  "script_search",
  "search_game_tree",
  "skill",
]);

function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

function toolResultForGemini(result: {
  [key: string]: unknown;
}): Record<string, unknown> {
  const content = Array.isArray(result["content"])
    ? (result["content"] as Array<{ type?: string; text?: string }>)
    : [];
  const output =
    result["structuredContent"] ??
    (content.length > 0
      ? content
      .map((item) => (item.type === "text" ? item.text ?? "" : `[${item.type} result omitted]`))
      .join("\n")
      : result["toolResult"] ?? "The tool returned no content.");
  const serialized = JSON.stringify(output);
  const bounded =
    serialized.length > 12_000
      ? `${serialized.slice(0, 12_000)}… [tool output truncated]`
      : output;
  return { result: bounded, isError: result["isError"] === true };
}

app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    mcpConnected: mcpClient !== null,
    toolCount: toolDefinitions.length,
  });
});

app.get("/api/bridge-config", (_req, res) => {
  res.json({
    apiBaseUrl: `http://127.0.0.1:${bridgePort}`,
    bridgeToken: localToken,
  });
});

app.get("/api/setup-status", async (_req, res): Promise<void> => {
  const railway = await checkRailwaySetup();
  const studioMcpConnected = mcpClient !== null;
  res.json({
    railway,
    studioMcp: {
      connected: studioMcpConnected,
      toolCount: toolDefinitions.length,
      message: studioMcpConnected
        ? `Connected (${toolDefinitions.length} tools).`
        : connecting
          ? "Connecting to Studio MCP…"
          : `Enable Studio as an MCP server in Studio, then restart the bridge.${mcpConnectionError ? ` Details: ${mcpConnectionError}` : ""}`,
    },
  });
});

app.post("/api/chat", async (req: Request, res: Response): Promise<void> => {
  if (!authorizeLocalRequest(req, res)) return;

  const message = req.body?.message;
  const sessionId =
    typeof req.body?.sessionId === "string" && req.body.sessionId.length <= 100
      ? req.body.sessionId
      : randomUUID();
  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Enter a message first." });
    return;
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    res.status(413).json({ error: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.` });
    return;
  }

  try {
    await connectMcp();
    const history = [...(sessions.get(sessionId) ?? [])];
    history.push({ role: "user", parts: [{ text: message.trim() }] });
    await continueTurn(history, sessionId, res);
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "The local agent failed unexpectedly.";
    res.status(502).json({ error: messageText });
  }
});

app.post("/api/approve", async (req: Request, res: Response): Promise<void> => {
  if (!authorizeLocalRequest(req, res)) return;
  const pendingId = req.body?.pendingId;
  const approved = req.body?.approved;
  if (typeof pendingId !== "string" || typeof approved !== "boolean") {
    res.status(400).json({ error: "pendingId and approved are required." });
    return;
  }

  const pending = pendingTurns.get(pendingId);
  if (!pending) {
    res.status(404).json({ error: "This approval request has expired or was already handled." });
    return;
  }
  pendingTurns.delete(pendingId);

  try {
    const responseParts: Array<Record<string, unknown>> = [];
    for (const call of pending.calls) {
      let response: Record<string, unknown>;
      if (!approved) {
        response = { denied: true, message: "The user declined this Studio action." };
      } else {
        const originalName = mcpToolName(call.name);
        if (!originalName || !mcpClient) {
          response = { error: "Tool is not available in this Studio session." };
        } else {
          const result = await mcpClient.callTool({
            name: originalName,
            arguments: call.args,
          });
          response = toolResultForGemini(result);
        }
      }
      responseParts.push({
        functionResponse: { name: call.name, response },
      });
    }
    pending.history.push({ role: "user", parts: responseParts });
    await continueTurn(pending.history, pending.sessionId, res);
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "The approved Studio action failed.";
    res.status(502).json({ error: messageText });
  }
});

async function continueTurn(
  history: GeminiContent[],
  sessionId: string,
  res: Response,
): Promise<void> {
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const modelContent = await requestGemini(history);
    history.push(modelContent);
    const calls = getFunctionCalls(modelContent);
    if (calls.length === 0) {
      const answer = modelContent.parts
        .map((part) => (typeof part["text"] === "string" ? part["text"] : ""))
        .filter(Boolean)
        .join("\n")
        .trim();
      sessions.set(sessionId, history.slice(-MAX_CHAT_TURNS * 2));
      res.json({ sessionId, answer });
      return;
    }

    const readCalls = calls.filter((call) => {
      const toolName = mcpToolName(call.name);
      return toolName !== undefined && isReadOnlyTool(toolName);
    });
    const writeCalls = calls.filter((call) => !readCalls.includes(call));
    const responseParts: Array<Record<string, unknown>> = [];

    for (const call of readCalls) {
      const originalName = mcpToolName(call.name);
      if (!originalName || !mcpClient) {
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: { error: "Tool is not available in this Studio session." },
          },
        });
        continue;
      }
      const result = await mcpClient.callTool({
        name: originalName,
        arguments: call.args,
      });
      responseParts.push({
        functionResponse: {
          name: call.name,
          response: toolResultForGemini(result),
        },
      });
    }

    if (responseParts.length > 0) {
      history.push({ role: "user", parts: responseParts });
    }

    if (writeCalls.length > 0) {
      const pendingId = randomUUID();
      pendingTurns.set(pendingId, {
        sessionId,
        history,
        calls: writeCalls,
      });
      res.json({
        sessionId,
        needsApproval: true,
        pendingId,
        toolCalls: writeCalls.map((call) => ({
          name: mcpToolName(call.name) ?? call.name,
          arguments: call.args,
        })),
      });
      return;
    }
  }

  sessions.set(sessionId, history.slice(-MAX_CHAT_TURNS * 2));
  res.json({
    sessionId,
    answer:
      "I reached the tool-call limit for this turn. Please ask me to continue or split the request into smaller steps.",
  });
}

export function startBridge(port = bridgePort, connectStudioMcp = true) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("BRIDGE_PORT must be a valid TCP port.");
  }
  const server = app.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const listeningPort = typeof address === "object" && address ? address.port : port;
    bridgePort = listeningPort;
    process.stdout.write(
      `Roblox local bridge listening on http://127.0.0.1:${listeningPort}\n`,
    );
    if (connectStudioMcp) {
      void connectMcp().catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Unknown Roblox MCP connection error.";
        process.stderr.write(`Roblox MCP connection unavailable: ${message}\n`);
        process.stderr.write(
          "In Roblox Studio, open Assistant → … → Manage MCP Servers and enable “Enable Studio as MCP server.” Keep Studio open, then restart the bridge. If it is already enabled, check your ROBLOX_MCP_COMMAND and ROBLOX_MCP_ARGS settings.\n",
        );
      });
    }
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startBridge();
}
