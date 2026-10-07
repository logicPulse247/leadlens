import { route, parseBody, ok } from "@/lib/api";
import { bulkStatusBodySchema } from "@/lib/schemas";
import { setLeadStatus } from "@/server/services/lead.service";

export const dynamic = "force-dynamic";

export const PATCH = route(async (req) => {
  const { ids, status } = await parseBody(req, bulkStatusBodySchema);
  return ok({ updated: await setLeadStatus(ids, status) });
});
