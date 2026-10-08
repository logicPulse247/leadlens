import { z } from "zod";
import { route, parseBody, ok, tooManyRequests } from "@/lib/api";
import { idParamSchema, TONES } from "@/lib/schemas";
import { rateLimit } from "@/server/cache/cache";
import { generateDraft } from "@/server/services/outreach/outreach.service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ tone: z.enum(TONES) });

export const POST = route(async (req, { params }) => {
  const { id } = idParamSchema.parse(params);
  const limit = await rateLimit("outreach", 30, 60);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);
  const { tone } = await parseBody(req, bodySchema);
  return ok(await generateDraft(id, tone), 201);
});
