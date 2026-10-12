import { route, ok, notFound } from "@/lib/api";
import { idParamSchema } from "@/lib/schemas";
import { deleteLeads, getLeadDetail } from "@/server/services/lead.service";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }) => {
  const { id } = idParamSchema.parse(params);
  return ok(await getLeadDetail(id));
});

export const DELETE = route(async (_req, { params }) => {
  const { id } = idParamSchema.parse(params);
  const deleted = await deleteLeads([id]);
  if (!deleted) throw notFound("Lead");
  return ok({ deleted });
});
