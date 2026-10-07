import { route, parseBody, ok, badRequest } from "@/lib/api";
import { discoverBodySchema } from "@/lib/schemas";
import { getSource, listSources } from "@/server/sources";
import { importCompanies } from "@/server/services/import.service";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const sources = await Promise.all(
    listSources().map(async (s) => ({ id: s.id, label: s.label, description: s.description, facets: s.facets ? await s.facets() : null })),
  );
  return ok({ sources });
});

export const POST = route(async (req) => {
  const body = await parseBody(req, discoverBodySchema);
  const source = getSource(body.sourceId);
  if (!source) throw badRequest(`Unknown lead source "${body.sourceId}"`);
  const companies = await source.discover({ industries: body.industries, limit: body.limit });
  const summary = await importCompanies(companies, { source: "SEED", icpId: body.icpId });
  return ok(summary, 201);
});
