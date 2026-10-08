import type { CompletionRequest, LLMProvider } from "./provider";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async completeJson(req: CompletionRequest): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 1500,
        temperature: 0.2,
        system: `${req.system}\nRespond with a single JSON object and nothing else.`,
        // Prefilling "{" makes the model continue a JSON object rather than add prose.
        messages: [
          { role: "user", content: req.user },
          { role: "assistant", content: "{" },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Anthropic request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new Error("Anthropic returned no content");
    return `{${text}`;
  }
}
