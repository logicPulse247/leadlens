import type { ZodType, ZodTypeDef } from "zod";
import { getEnv } from "@/lib/env";
import { childLogger } from "@/lib/logger";

const log = childLogger("ai");

export type AiTask = "score" | "outreach";

export interface CompletionRequest {
  task: AiTask;
  system: string;
  user: string;
  /**
   * The structured data the prompt was built from. Hosted providers ignore it and read `user`;
   * the deterministic mock provider uses it so the app runs end to end without an API key.
   */
  input: unknown;
  maxTokens?: number;
}

/** Swap models or vendors by implementing this single method. Must return a JSON document as text. */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  completeJson(req: CompletionRequest): Promise<string>;
}

export class LlmValidationError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
  ) {
    super(message);
  }
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON object found in model output");
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Calls the provider and validates the reply against a zod schema.
 * On a malformed or schema-violating reply it retries once, telling the model what was wrong.
 */
export async function generateStructured<T>(provider: LLMProvider, req: CompletionRequest, schema: ZodType<T, ZodTypeDef, unknown>, maxAttempts = 2): Promise<T> {
  let lastRaw = "";
  let lastIssue = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const user = attempt === 1 ? req.user : `${req.user}\n\nYour previous reply was rejected: ${lastIssue}\nReply again with ONLY a valid JSON object that satisfies the schema.`;
    lastRaw = await provider.completeJson({ ...req, user });
    try {
      const parsed = schema.safeParse(extractJson(lastRaw));
      if (parsed.success) return parsed.data;
      lastIssue = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    } catch (err) {
      lastIssue = `invalid JSON (${(err as Error).message})`;
    }
    log.warn({ provider: provider.name, task: req.task, attempt, issue: lastIssue }, "LLM output failed validation");
  }
  throw new LlmValidationError(`Model output failed validation: ${lastIssue}`, lastRaw);
}

let cached: LLMProvider | undefined;

export async function getProvider(): Promise<LLMProvider> {
  if (cached) return cached;
  const env = getEnv();
  switch (env.LLM_PROVIDER) {
    case "openai": {
      if (!env.OPENAI_API_KEY) throw new Error("LLM_PROVIDER=openai but OPENAI_API_KEY is not set");
      const { OpenAIProvider } = await import("./openai");
      cached = new OpenAIProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL);
      break;
    }
    case "anthropic": {
      if (!env.ANTHROPIC_API_KEY) throw new Error("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
      const { AnthropicProvider } = await import("./anthropic");
      cached = new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
      break;
    }
    default: {
      const { MockProvider } = await import("./mock");
      cached = new MockProvider();
    }
  }
  return cached;
}

export function setProviderForTests(p: LLMProvider | undefined) {
  cached = p;
}
