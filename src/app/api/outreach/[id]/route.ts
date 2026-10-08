import { route, parseBody, ok } from "@/lib/api";
import { idParamSchema } from "@/lib/schemas";
import { draftEditSchema, updateDraft } from "@/server/services/outreach/outreach.service";

export const dynamic = "force-dynamic";

export const PUT = route(async (req, { params }) => {
  const { id } = idParamSchema.parse(params);
  const body = await parseBody(req, draftEditSchema);
  return ok(await updateDraft(id, body));
});
