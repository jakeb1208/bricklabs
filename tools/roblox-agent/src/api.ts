import express from "express";
import type { Request, Response, NextFunction } from "express";
import { DEFAULT_MODEL, type GeminiGenerateRequest } from "./shared.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

function requireAgentToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = process.env["AGENT_API_TOKEN"];
  if (!token) {
    res.status(503).json({ error: "Agent API is not configured." });
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
      const responseBody = await upstream.json().catch(() => ({
        error: { message: "Gemini returned a non-JSON response." },
      }));
      res.status(upstream.status).json(responseBody);
    } catch (error) {
      req.log?.error?.({ error }, "Gemini request failed");
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

const port = Number(process.env["PORT"] || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port.");
}

app.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Roblox agent API listening on ${port}\n`);
});
