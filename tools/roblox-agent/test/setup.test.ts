import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { app as apiApp } from "../src/api.js";
import {
  app as bridgeApp,
  checkRailwaySetup,
  startBridge,
} from "../src/bridge.js";
import { validateBridgeEnvironment } from "../src/setup-bridge.js";

const environmentKeys = [
  "AGENT_API_URL",
  "AGENT_API_TOKEN",
  "GEMINI_API_KEY",
] as const;
const originalEnvironment = new Map(
  environmentKeys.map((key) => [key, process.env[key]]),
);
const originalFetch = globalThis.fetch;

before(() => {
  delete process.env["AGENT_API_URL"];
  delete process.env["AGENT_API_TOKEN"];
  delete process.env["GEMINI_API_KEY"];
});

after(() => {
  for (const key of environmentKeys) {
    const originalValue = originalEnvironment.get(key);
    if (originalValue === undefined) delete process.env[key];
    else process.env[key] = originalValue;
  }
  globalThis.fetch = originalFetch;
});

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function withServer(
  server: Server,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.once("listening", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  }
  const port = (server.address() as AddressInfo).port;
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await close(server);
  }
}

function mockFetch(implementation: typeof fetch): void {
  globalThis.fetch = implementation;
}

test("setup diagnostics identify missing and invalid Railway URL and token values", async () => {
  process.env["AGENT_API_TOKEN"] = "local-test-token";
  delete process.env["AGENT_API_URL"];
  let status = await checkRailwaySetup();
  assert.equal(status.ready, false);
  assert.match(status.message, /Set AGENT_API_URL/);

  process.env["AGENT_API_URL"] = "not a URL";
  status = await checkRailwaySetup();
  assert.equal(status.ready, false);
  assert.match(status.message, /not a valid URL/);

  process.env["AGENT_API_URL"] = "http://railway.example";
  status = await checkRailwaySetup();
  assert.equal(status.ready, false);
  assert.match(status.message, /secure https/);

  process.env["AGENT_API_URL"] = "https://railway.example";
  delete process.env["AGENT_API_TOKEN"];
  status = await checkRailwaySetup();
  assert.equal(status.ready, false);
  assert.match(status.message, /Set AGENT_API_TOKEN/);
});

test("guided bridge setup gives actionable advice for missing API and MCP settings", () => {
  const missingApi = validateBridgeEnvironment({}, "darwin");
  assert.match(missingApi.join("\n"), /Set AGENT_API_URL/);
  assert.match(missingApi.join("\n"), /Set AGENT_API_TOKEN/);

  const unsupportedPlatform = validateBridgeEnvironment(
    {
      AGENT_API_URL: "https://agent.example",
      AGENT_API_TOKEN: "configured-test-token",
    },
    "linux",
  );
  assert.match(unsupportedPlatform.join("\n"), /Set ROBLOX_MCP_COMMAND/);

  const invalidArgs = validateBridgeEnvironment(
    {
      AGENT_API_URL: "https://agent.example",
      AGENT_API_TOKEN: "configured-test-token",
      ROBLOX_MCP_COMMAND: "studio-mcp",
      ROBLOX_MCP_ARGS: "not-json",
    },
    "linux",
  );
  assert.match(invalidArgs.join("\n"), /ROBLOX_MCP_ARGS must be a JSON array/);
});

test("setup diagnostics report a rejected Railway token without exposing it", async () => {
  process.env["AGENT_API_URL"] = "https://railway.example";
  process.env["AGENT_API_TOKEN"] = "invalid-secret-for-test";
  mockFetch(
    async () =>
      new Response(JSON.stringify({ error: "Unauthorized." }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
  );

  const status = await checkRailwaySetup();
  assert.deepEqual(status, {
    ready: false,
    message:
      "Railway rejected AGENT_API_TOKEN. Make it match the Railway service variable.",
  });
  assert.equal(status.message.includes("invalid-secret-for-test"), false);
});

test("setup diagnostics report an unreachable Railway API", async () => {
  process.env["AGENT_API_URL"] = "https://railway.example";
  process.env["AGENT_API_TOKEN"] = "local-test-token";
  mockFetch(async () => {
    throw new TypeError("network unavailable");
  });

  const status = await checkRailwaySetup();
  assert.equal(status.ready, false);
  assert.match(status.message, /Can't reach Railway/);
});

test("Railway setup endpoint reports a missing server-side Gemini key", async () => {
  process.env["AGENT_API_TOKEN"] = "configured-test-token";
  delete process.env["GEMINI_API_KEY"];
  await withServer(apiApp.listen(), async (baseUrl) => {
    const response = await originalFetch(`${baseUrl}/api/setup-check`, {
      headers: { authorization: "Bearer configured-test-token" },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ready: false,
      error: "Add GEMINI_API_KEY to the Railway service variables.",
    });
  });
});

test("Gemini proxy returns safe errors for upstream failures and malformed responses", async () => {
  const savedToken = process.env["AGENT_API_TOKEN"];
  const savedApiKey = process.env["GEMINI_API_KEY"];
  const server = apiApp.listen();
  process.env["AGENT_API_TOKEN"] = "configured-test-token";
  process.env["GEMINI_API_KEY"] = "server-only-gemini-key";

  try {
    await withServer(server, async (baseUrl) => {
      const request = () =>
        originalFetch(`${baseUrl}/api/gemini/generate`, {
          method: "POST",
          headers: {
            authorization: "Bearer configured-test-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Hello" }] }] }),
        });

      mockFetch(
        async () =>
          new Response(
            JSON.stringify({ error: { message: "server-only-gemini-key was rejected" } }),
            { status: 429, headers: { "content-type": "application/json" } },
          ),
      );
      const upstreamError = await request();
      assert.equal(upstreamError.status, 429);
      assert.deepEqual(await upstreamError.json(), {
        error: "Gemini API returned HTTP 429.",
      });

      mockFetch(
        async () =>
          new Response("server-only-gemini-key is not JSON", {
            status: 200,
            headers: { "content-type": "text/plain" },
          }),
      );
      const nonJson = await request();
      assert.equal(nonJson.status, 502);
      assert.deepEqual(await nonJson.json(), {
        error: "Gemini returned an invalid response.",
      });

      mockFetch(async () => {
        throw new TypeError("network failed with server-only-gemini-key");
      });
      const networkFailure = await request();
      assert.equal(networkFailure.status, 502);
      assert.deepEqual(await networkFailure.json(), {
        error: "Could not reach the Gemini API.",
      });

      mockFetch(
        async () =>
          new Response(
            JSON.stringify({ unexpected: "server-only-gemini-key" }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      );
      const malformedJson = await request();
      assert.equal(malformedJson.status, 502);
      assert.deepEqual(await malformedJson.json(), {
        error: "Gemini returned an invalid response.",
      });

      mockFetch(
        async () =>
          new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: "server-only-gemini-key" }] } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      );
      const successfulResponse = await request();
      assert.equal(successfulResponse.status, 200);
      const successfulBody = await successfulResponse.text();
      assert.equal(successfulBody.includes("server-only-gemini-key"), false);
      assert.match(successfulBody, /\[redacted\]/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (savedToken === undefined) delete process.env["AGENT_API_TOKEN"];
    else process.env["AGENT_API_TOKEN"] = savedToken;
    if (savedApiKey === undefined) delete process.env["GEMINI_API_KEY"];
    else process.env["GEMINI_API_KEY"] = savedApiKey;
  }
});

test("bridge binds only to loopback and clearly reports disconnected Studio MCP", async () => {
  delete process.env["AGENT_API_URL"];
  const server = startBridge(0, false);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  assert.equal(address.address, "127.0.0.1");

  try {
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/api/setup-status`,
    );
    assert.equal(response.status, 200);
    const setup = (await response.json()) as {
      studioMcp: { connected: boolean; message: string };
    };
    assert.equal(setup.studioMcp.connected, false);
    assert.match(setup.studioMcp.message, /Enable Studio as an MCP server/);
  } finally {
    await close(server);
  }
});

test("bridge setup endpoint reflects missing Railway configuration", async () => {
  delete process.env["AGENT_API_URL"];
  const server = bridgeApp.listen(0, "127.0.0.1");
  await withServer(server, async (baseUrl) => {
    const response = await originalFetch(`${baseUrl}/api/setup-status`);
    const setup = (await response.json()) as {
      railway: { ready: boolean; message: string };
    };
    assert.equal(setup.railway.ready, false);
    assert.match(setup.railway.message, /Set AGENT_API_URL/);
  });
});

test("chat and approval reject bad tokens without starting Studio or consuming an approval", async () => {
  const environment = new Map(
    ["AGENT_API_URL", "AGENT_API_TOKEN", "ROBLOX_MCP_COMMAND", "ROBLOX_MCP_ARGS"]
      .map((key) => [key, process.env[key]]),
  );
  const originalFetchImplementation = globalThis.fetch;
  const tempDirectory = await mkdtemp(join(tmpdir(), "roblox-bridge-auth-"));
  const toolCallsPath = join(tempDirectory, "studio-tool-calls.txt");
  const mcpServer = `
    import { appendFileSync, writeFileSync } from "node:fs";
    import { Server } from "@modelcontextprotocol/sdk/server/index.js";
    import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
    import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
    const marker = ${JSON.stringify(toolCallsPath)};
    writeFileSync(marker + ".pid", String(process.pid));
    const server = new Server({ name: "auth-test-studio", version: "1.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: "write_script", description: "Write a Studio script", inputSchema: { type: "object", properties: {} } }],
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => {
      appendFileSync(marker, "called\\\\n");
      return { content: [{ type: "text", text: "written" }] };
    });
    await server.connect(new StdioServerTransport());
  `;
  let outboundFetches = 0;

  process.env["AGENT_API_URL"] = "https://railway.example";
  process.env["AGENT_API_TOKEN"] = "test-api-token";
  process.env["ROBLOX_MCP_COMMAND"] = process.execPath;
  process.env["ROBLOX_MCP_ARGS"] = JSON.stringify(["--input-type=module", "-e", mcpServer]);
  mockFetch(async () => {
    outboundFetches += 1;
    const content =
      outboundFetches === 1
        ? { role: "model", parts: [{ functionCall: { name: "write_script", args: {} } }] }
        : { role: "model", parts: [{ text: "The change was declined." }] };
    return new Response(JSON.stringify({ candidates: [{ content }] }), {
      headers: { "content-type": "application/json" },
    });
  });

  const server = bridgeApp.listen(0, "127.0.0.1");
  try {
    await withServer(server, async (baseUrl) => {
      const configResponse = await originalFetch(`${baseUrl}/api/bridge-config`);
      assert.equal(configResponse.status, 200);
      const config = (await configResponse.json()) as { bridgeToken: string };
      assert.equal(typeof config.bridgeToken, "string");
      assert.notEqual(config.bridgeToken.length, 0);

      const chatRequest = {
        path: "/api/chat",
        body: { message: "Make a change in Studio.", sessionId: "auth-regression-session" },
      };
      for (const authorization of [undefined, "Bearer incorrect-local-token"]) {
        const response = await originalFetch(`${baseUrl}${chatRequest.path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(authorization ? { authorization } : {}),
          },
          body: JSON.stringify(chatRequest.body),
        });
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: "Invalid local bridge token." });
      }
      assert.equal(outboundFetches, 0);
      await assert.rejects(readFile(`${toolCallsPath}.pid`), { code: "ENOENT" });
      let health = (await (await originalFetch(`${baseUrl}/healthz`)).json()) as {
        mcpConnected: boolean;
      };
      assert.equal(health.mcpConnected, false);

      const chatResponse = await originalFetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.bridgeToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(chatRequest.body),
      });
      assert.equal(chatResponse.status, 200);
      const pending = (await chatResponse.json()) as {
        needsApproval: boolean;
        pendingId: string;
      };
      assert.equal(pending.needsApproval, true);
      assert.equal(typeof pending.pendingId, "string");
      assert.equal(outboundFetches, 1);
      health = (await (await originalFetch(`${baseUrl}/healthz`)).json()) as {
        mcpConnected: boolean;
      };
      assert.equal(health.mcpConnected, true);

      for (const authorization of [undefined, "Bearer incorrect-local-token"]) {
        const response = await originalFetch(`${baseUrl}/api/approve`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(authorization ? { authorization } : {}),
          },
          body: JSON.stringify({ pendingId: pending.pendingId, approved: true }),
        });
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: "Invalid local bridge token." });
      }
      assert.equal(outboundFetches, 1);
      await assert.rejects(readFile(toolCallsPath), { code: "ENOENT" });

      const authorizedDecline = await originalFetch(`${baseUrl}/api/approve`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.bridgeToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ pendingId: pending.pendingId, approved: false }),
      });
      assert.equal(authorizedDecline.status, 200);
      assert.deepEqual(await authorizedDecline.json(), {
        sessionId: "auth-regression-session",
        answer: "The change was declined.",
      });
      assert.equal(outboundFetches, 2);
      await assert.rejects(readFile(toolCallsPath), { code: "ENOENT" });
    });
  } finally {
    try {
      const pid = Number(await readFile(`${toolCallsPath}.pid`, "utf8"));
      if (Number.isInteger(pid) && pid > 0) process.kill(pid, "SIGTERM");
    } catch {
      // The child never starts when the authorization guard rejects the request.
    }
    globalThis.fetch = originalFetchImplementation;
    for (const [key, value] of environment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
