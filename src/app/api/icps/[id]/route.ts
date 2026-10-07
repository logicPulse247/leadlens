import { route, parseBody, ok } from "@/lib/api";
import { icpInputSchema, idParamSchema } from "@/lib/schemas";
import { deleteIcp, getIcp, updateIcp } from "@/server/services/icp.service";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }) => {
  const { id } = idParamSchema.parse(params);
  return ok(await getIcp(id));
});

export const PUT = route(async (req, { params }) => {
  const { id } = idParamSchema.parse(params);
  const input = await parseBody(req, icpInputSchema);
  return ok(await updateIcp(id, input));
});

export const DELETE = route(async (_req, { params }) => {
  const { id } = idParamSchema.parse(params);
  await deleteIcp(id);
  return ok({ deleted: true });
});
