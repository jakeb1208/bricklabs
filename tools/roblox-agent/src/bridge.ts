import { randomUUID } from "node:crypto";
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

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

const sessions = new Map<string, GeminiContent[]>();
let mcpClient: Client | null = null;
let toolDefinitions: ToolDefinition[] = [];
let connecting: Promise<void> | null = null;
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

function toGeminiTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: sanitizeToolName(tool.name),
        description: tool.description || tool.name,
        parameters: tool.inputSchema,
      })),
    },
  ];
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
      if (process.platform === "win32") {
        command = "cmd.exe";
        args = ["/c", "%LOCALAPPDATA%\\Roblox\\mcp.bat"];
      } else if (process.platform === "darwin") {
        command = "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP";
      } else {
        throw new Error(
          "Roblox Studio MCP auto-detection supports Windows and macOS. Set ROBLOX_MCP_COMMAND and ROBLOX_MCP_ARGS manually on this operating system.",
        );
      }
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
  })().finally(() => {
    connecting = null;
  });

  return connecting;
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

app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    mcpConnected: mcpClient !== null,
    toolCount: toolDefinitions.length,
  });
});

app.get("/api/bridge-config", (_req, res) => {
  res.json({
    apiBaseUrl: `http://127.0.0.1:${port}`,
    bridgeToken: localToken,
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
    const history = sessions.get(sessionId) ?? [];
    history.push({ role: "user", parts: [{ text: message.trim() }] });

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

      for (const call of calls) {
        const originalName = mcpToolName(call.name);
        if (!originalName || !mcpClient) {
          history.push({
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: call.name,
                  response: { error: "Tool is not available in this Studio session." },
                },
              },
            ],
          });
          continue;
        }

        const result = await mcpClient.callTool({
          name: originalName,
          arguments: call.args,
        });
        history.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: call.name,
                response: {
                  content: result.content,
                  isError: result.isError === true,
                },
              },
            },
          ],
        });
      }
    }

    sessions.set(sessionId, history.slice(-MAX_CHAT_TURNS * 2));
    res.json({
      sessionId,
      answer:
        "I reached the tool-call limit for this turn. Please ask me to continue or split the request into smaller steps.",
    });
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "The local agent failed unexpectedly.";
    res.status(502).json({ error: messageText });
  }
});

const port = Number(process.env["BRIDGE_PORT"] || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("BRIDGE_PORT must be a valid TCP port.");
}

app.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `Roblox local bridge listening on http://127.0.0.1:${port}\nBridge token: ${localToken}\n`,
  );
  void connectMcp().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown Roblox MCP connection error.";
    process.stderr.write(`Roblox MCP connection unavailable: ${message}\n`);
  });
});
