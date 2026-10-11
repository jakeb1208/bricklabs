import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startBridge } from "./bridge.js";

type BridgeEnvironment = Record<string, string | undefined>;

export function validateBridgeEnvironment(
  env: BridgeEnvironment,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const problems: string[] = [];
  const apiUrl = env["AGENT_API_URL"]?.trim();

  if (!apiUrl || /your-service|replace-with/i.test(apiUrl)) {
    problems.push(
      "Set AGENT_API_URL in tools/roblox-agent/.env to your deployed Railway HTTPS service URL.",
    );
  } else {
    try {
      if (new URL(apiUrl).protocol !== "https:") {
        problems.push("AGENT_API_URL must use an https:// Railway service URL.");
      }
    } catch {
      problems.push("AGENT_API_URL must be a valid HTTPS URL.");
    }
  }

  const token = env["AGENT_API_TOKEN"]?.trim();
  if (!token || /replace-with/i.test(token)) {
    problems.push(
      "Set AGENT_API_TOKEN in tools/roblox-agent/.env to the same token configured in Railway.",
    );
  }

  const rawCommand = env["ROBLOX_MCP_COMMAND"];
  const command = rawCommand?.trim();
  const rawArgs = env["ROBLOX_MCP_ARGS"]?.trim();
  if (rawArgs) {
    try {
      const args: unknown = JSON.parse(rawArgs);
      if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
        throw new Error("not a string array");
      }
    } catch {
      problems.push("ROBLOX_MCP_ARGS must be a JSON array of strings, for example [\"--stdio\"].");
    }
  }
  if (rawCommand && !command) {
    problems.push("ROBLOX_MCP_COMMAND must contain the path or name of an MCP executable.");
  } else if (!command && platform !== "win32" && platform !== "darwin") {
    problems.push(
      "Studio MCP is auto-detected only on Windows and macOS. Set ROBLOX_MCP_COMMAND and, if needed, ROBLOX_MCP_ARGS in tools/roblox-agent/.env.",
    );
  }

  return problems;
}

export function runGuidedBridgeSetup(): boolean {
  if (!existsSync(resolve(process.cwd(), ".env"))) {
    process.stderr.write(
      "Could not find tools/roblox-agent/.env. From the repository root, copy tools/roblox-agent/.env.example to tools/roblox-agent/.env, fill in AGENT_API_URL and AGENT_API_TOKEN, then run this command again.\n",
    );
    return false;
  }

  const problems = validateBridgeEnvironment(process.env);
  if (problems.length > 0) {
    process.stderr.write(
      `Bridge setup needs attention:\n${problems.map((problem) => `- ${problem}`).join("\n")}\n`,
    );
    process.stderr.write(
      "Edit tools/roblox-agent/.env and run `pnpm --filter @workspace/roblox-agent run setup:bridge` again.\n",
    );
    return false;
  }

  process.stdout.write(
    "Local settings look valid. Starting the bridge on 127.0.0.1. In Roblox Studio, enable Assistant → … → Manage MCP Servers → “Enable Studio as MCP server” and keep Studio open.\n",
  );
  startBridge();
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!runGuidedBridgeSetup()) process.exitCode = 1;
}
