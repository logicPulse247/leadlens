import { z } from "zod";
import { route, parseBody, ok, notFound } from "@/lib/api";
import { idParamSchema } from "@/lib/schemas";
import { prisma } from "@/server/db/prisma";
import { dismissCandidate, mergeLeads } from "@/server/services/dedupe/dedupe.service";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("merge"), keepId: z.string().min(1) }),
]);

export const POST = route(async (req, { params }) => {
  const { id } = idParamSchema.parse(params);
  const body = await parseBody(req, bodySchema);
  const candidate = await prisma.mergeCandidate.findUnique({ where: { id } });
  if (!candidate) throw notFound("Merge candidate");
  if (body.action === "dismiss") {
    await dismissCandidate(id);
    return ok({ dismissed: true });
  }
  if (body.keepId !== candidate.leadAId && body.keepId !== candidate.leadBId) {
    throw notFound("Lead in this pair");
  }
  const dropId = body.keepId === candidate.leadAId ? candidate.leadBId : candidate.leadAId;
  await mergeLeads(body.keepId, dropId);
  return ok({ merged: true, keepId: body.keepId });
});
