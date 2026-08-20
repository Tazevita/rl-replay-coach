let handler;

export default async function replayApi(request, response) {
  try {
    handler ??= import("./_bundle.mjs").then(module => module.default);
    return await (await handler)(request, response);
  } catch (error) {
    console.error("Could not load the replay API bundle.", error);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Replay API bundle failed to load." }));
    }
  }
}
