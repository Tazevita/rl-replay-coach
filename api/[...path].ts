import { createServerlessReplayApi } from "../src/server/http/serverless-replay-api";
import type { IncomingMessage, ServerResponse } from "node:http";

let handler: ReturnType<typeof createServerlessReplayApi> | undefined;

export default async function replayApi(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    handler ??= createServerlessReplayApi();
    await handler(request, response);
  } catch (error) {
    console.error("Replay API invocation failed.", error);
    if (response.headersSent) {
      response.end();
      return;
    }
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      error: error instanceof Error ? error.message : "Replay API initialization failed.",
    }));
  }
}
