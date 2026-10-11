import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
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
