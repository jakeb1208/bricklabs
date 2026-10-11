import express from "express";
import type { Request, Response, NextFunction } from "express";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODEL, type GeminiGenerateRequest } from "./shared.js";

export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

function requireAgentToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = process.env["AGENT_API_TOKEN"];
  if (!token) {
    res.status(503).json({
      error: "Add AGENT_API_TOKEN to the Railway service variables.",
    });
    return;
  }

  const authorization = req.header("authorization") ?? "";
  if (authorization !== `Bearer ${token}`) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  next();
}

app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    configured: Boolean(process.env["GEMINI_API_KEY"] && process.env["AGENT_API_TOKEN"]),
  });
});

app.get("/api/setup-check", requireAgentToken, (_req, res) => {
  if (!process.env["GEMINI_API_KEY"]) {
    res.status(503).json({
      ready: false,
      error: "Add GEMINI_API_KEY to the Railway service variables.",
    });
    return;
  }
  res.json({ ready: true });
});

app.post(
  "/api/gemini/generate",
  requireAgentToken,
  async (req: Request, res: Response): Promise<void> => {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
      res.status(503).json({ error: "Gemini is not configured on the server." });
      return;
    }

    const body = req.body as Partial<GeminiGenerateRequest>;
    if (
      !Array.isArray(body.contents) ||
      body.contents.length === 0 ||
      body.contents.length > 50
    ) {
      res.status(400).json({ error: "contents must contain between 1 and 50 turns." });
      return;
    }

    const model =
      process.env["GEMINI_MODEL"]?.trim() || DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
      if (!upstream.ok) {
        res.status(upstream.status).json({
          error: `Gemini API returned HTTP ${upstream.status}.`,
        });
        return;
      }

      const responseText = await upstream.text();
      let responseBody: unknown;
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        res.status(502).json({ error: "Gemini returned an invalid response." });
        return;
      }
      if (
        typeof responseBody !== "object" ||
        responseBody === null ||
        !Array.isArray((responseBody as { candidates?: unknown }).candidates)
      ) {
        res.status(502).json({ error: "Gemini returned an invalid response." });
        return;
      }

      const safeResponse = JSON.stringify(responseBody).replaceAll(apiKey, "[redacted]");
      res.status(200).type("application/json").send(safeResponse);
    } catch (error) {
      process.stderr.write("Gemini API request failed before a response was received.\n");
      res.status(502).json({ error: "Could not reach the Gemini API." });
    }
  },
);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: "Request body must be valid JSON." });
    return;
  }
  res.status(500).json({ error: "Unexpected server error." });
});

export function startApi(port = Number(process.env["PORT"] || 8080)) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be a valid TCP port.");
  }
  return app.listen(port, "0.0.0.0", () => {
    process.stdout.write(`Roblox agent API listening on ${port}\n`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startApi();
}
