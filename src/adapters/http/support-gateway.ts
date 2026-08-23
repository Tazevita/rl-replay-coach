import { supportRequestSchema, type SupportRequest } from "../../shared/contracts/support-request";

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
  return typeof body?.error === "string" ? body.error : "Could not send your message.";
}

export class HttpSupportGateway {
  constructor(private readonly request: typeof fetch = fetch) {}

  async send(input: SupportRequest): Promise<void> {
    const response = await this.request("/api/support-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(supportRequestSchema.parse(input)),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
  }
}
