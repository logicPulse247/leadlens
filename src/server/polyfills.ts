import { File as NodeFile } from "node:buffer";

/**
 * cheerio 1.x loads undici, which expects a global `File` (Node 20+).
 * Node 18.13+ ships the class in `node:buffer`, so we expose it to keep Node 18 working.
 * This module must be imported before cheerio.
 */
const g = globalThis as { File?: unknown };
if (typeof g.File === "undefined") g.File = NodeFile;
