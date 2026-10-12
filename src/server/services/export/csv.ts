const NUMERIC_OR_PHONE = /^[+-]?[\d\s().-]+$/;

/**
 * Neutralises spreadsheet formula injection (CSV cells starting with = + - @ are executed by Excel/Sheets)
 * while leaving real phone numbers and negative numbers untouched.
 */
export function neutraliseFormula(value: string): string {
  if (!/^[=+\-@\t\r]/.test(value)) return value;
  if (NUMERIC_OR_PHONE.test(value)) return value;
  return `'${value}`;
}

export function escapeCell(raw: unknown): string {
  if (raw == null) return "";
  const s = neutraliseFormula(String(raw));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<Row>(columns: { header: string; value: (row: Row) => unknown }[], rows: Row[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => escapeCell(c.value(row))).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
