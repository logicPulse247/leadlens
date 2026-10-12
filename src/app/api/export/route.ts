import { route, parseBody, tooManyRequests } from "@/lib/api";
import { exportBodySchema } from "@/lib/schemas";
import { rateLimit } from "@/server/cache/cache";
import { collectExport, renderCsv, renderJson } from "@/server/services/export/export.service";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const limit = await rateLimit("export", 20, 60);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const body = await parseBody(req, exportBodySchema);
  const result = await collectExport({ ids: body.ids, filters: body.filters });
  const stamp = new Date().toISOString().slice(0, 10);
  const isCsv = body.format === "csv";

  return new Response(isCsv ? renderCsv(result.rows) : renderJson(result.rows), {
    headers: {
      "Content-Type": isCsv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="leadlens-leads-${stamp}.${body.format}"`,
      "Cache-Control": "no-store",
      "X-Exported-Count": String(result.rows.length),
      "X-Suppressed-Leads": String(result.suppressedLeads),
      "X-Suppressed-Emails": String(result.suppressedEmails),
      "X-Export-Truncated": String(result.truncated),
      "Access-Control-Expose-Headers": "Content-Disposition, X-Exported-Count, X-Suppressed-Leads, X-Suppressed-Emails, X-Export-Truncated",
    },
  });
});
