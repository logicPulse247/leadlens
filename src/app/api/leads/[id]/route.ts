import { route, ok } from "@/lib/api";
import { idParamSchema } from "@/lib/schemas";
import { getLeadDetail } from "@/server/services/lead.service";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }) => {
  const { id } = idParamSchema.parse(params);
  return ok(await getLeadDetail(id));
});
