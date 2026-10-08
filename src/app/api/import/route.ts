import { route, parseBody, ok, badRequest } from "@/lib/api";
import { importBodySchema } from "@/lib/schemas";
import { enqueueEnrichment } from "@/server/queue/jobs";
import { importCompanies } from "@/server/services/import.service";
import { parseCsv, parsePastedList } from "@/server/sources/csv";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const body = await parseBody(req, importBodySchema);
  const parsed = body.mode === "csv" ? parseCsv(body.text) : parsePastedList(body.text);
  if (!parsed.companies.length) {
    throw badRequest(parsed.errors[0] ?? "No companies found in the input", { errors: parsed.errors });
  }
  const { createdIds, ...summary } = await importCompanies(parsed.companies, {
    source: body.mode === "csv" ? "CSV" : "MANUAL",
    icpId: body.icpId,
  });
  const queued = body.enrich && createdIds.length ? await enqueueEnrichment(createdIds, { icpId: body.icpId }) : null;
  return ok({ ...summary, skipped: summary.skipped + parsed.skipped, warnings: parsed.errors, jobId: queued?.jobId ?? null }, 201);
});
