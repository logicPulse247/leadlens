import { route, ok } from "@/lib/api";
import { idParamSchema } from "@/lib/schemas";
import { removeSuppression } from "@/server/services/suppression.service";

export const dynamic = "force-dynamic";

export const DELETE = route(async (_req, { params }) => {
  const { id } = idParamSchema.parse(params);
  await removeSuppression(id);
  return ok({ deleted: true });
});
