import { z } from "zod";
import { route, parseBody, ok, badRequest, tooManyRequests } from "@/lib/api";
import { rateLimit } from "@/server/cache/cache";
import { enqueueEnrichment, selectLeadIds } from "@/server/queue/jobs";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    leadIds: z.array(z.string().min(1)).min(1).max(2000).optional(),
    scope: z.enum(["new", "failed"]).optional(),
    force: z.boolean().default(false),
    icpId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => !!v.leadIds || !!v.scope, { message: "Provide leadIds or a scope" });

export const POST = route(async (req) => {
  const limit = await rateLimit("enrich", 30, 60);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const body = await parseBody(req, bodySchema);
  const ids = body.leadIds ?? (await selectLeadIds(body.scope!));
  if (!ids.length) throw badRequest("No leads match that selection");
  return ok(await enqueueEnrichment(ids, { force: body.force, icpId: body.icpId }), 202);
});
