import { z } from "zod";
import { route, parseBody, ok, badRequest, tooManyRequests } from "@/lib/api";
import { rateLimit } from "@/server/cache/cache";
import { enqueueScoring, selectLeadIds } from "@/server/queue/jobs";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    icpId: z.string().min(1),
    leadIds: z.array(z.string().min(1)).min(1).max(5000).optional(),
    scope: z.enum(["all", "unscored"]).optional(),
    force: z.boolean().default(false),
  })
  .refine((v) => !!v.leadIds || !!v.scope, { message: "Provide leadIds or a scope" });

export const POST = route(async (req) => {
  const limit = await rateLimit("score", 30, 60);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const body = await parseBody(req, bodySchema);
  const icp = await prisma.icp.findUnique({ where: { id: body.icpId }, select: { id: true } });
  if (!icp) throw badRequest("ICP not found");
  const ids = body.leadIds ?? (await selectLeadIds(body.scope!));
  if (!ids.length) throw badRequest("No leads match that selection");
  return ok(await enqueueScoring(ids, body.icpId, { force: body.force }), 202);
});
