import { describe, expect, it } from "vitest";
import { findMergeCandidates, levenshtein, nameSimilarity, normalizeCompanyName } from "@/server/services/dedupe/match";
import { normalizeDomain } from "@/server/services/validation/domain";

describe("domain normalization", () => {
  it.each([
    ["https://www.Acme-Plumbing.com/about?x=1", "acme-plumbing.com"],
    ["HTTP://acme.com:8080/path#frag", "acme.com"],
    ["www2.acme.com", "acme.com"],
    ["info@acme.com", "acme.com"],
    ["acme.com.", "acme.com"],
    ["  ACME.co.uk ", "acme.co.uk"],
  ])("normalizes %s -> %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each(["", "not a domain", "localhost", "http://", "a..b.com", "-bad.com"])("rejects %j", (input) => {
    expect(normalizeDomain(input)).toBeNull();
  });
});

describe("company name normalization and similarity", () => {
  it("drops legal suffixes, punctuation and case", () => {
    expect(normalizeCompanyName("Acme Plumbing, L.L.C.")).toBe("acme plumbing");
    expect(normalizeCompanyName("The Smith & Sons Co.")).toBe("smith and sons");
  });

  it("computes Levenshtein distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });

  it("scores suffix and ampersand variants as identical", () => {
    expect(nameSimilarity("Granite Graphics & Print", "Granite Graphics and Print LLC")).toBe(1);
  });

  it("scores unrelated names low", () => {
    expect(nameSimilarity("Summit Roofing", "Lakeshore Dental")).toBeLessThan(0.4);
  });
});

describe("findMergeCandidates", () => {
  const leads = [
    { id: "1", name: "Sunrise Roofing", domain: "sunriseroofing.com", location: "Columbus, OH" },
    { id: "2", name: "SUNRISE ROOFING LLC", domain: "sunrise-roofing-columbus.com", location: "Columbus, OH" },
    { id: "3", name: "Sunrise Roofing", domain: "sunrise-roofing-tx.com", location: "Austin, TX" },
    { id: "4", name: "Lakeshore Dental", domain: "lakeshoredental.com", location: "Madison, WI" },
    { id: "5", name: "Lakeshore Dental Care", domain: "lakeshoredental.com", location: "Madison, WI" },
    { id: "6", name: "Totally Different Co", domain: null, location: null },
  ];

  it("finds same-domain pairs with similarity 1", () => {
    const pairs = findMergeCandidates(leads);
    const p = pairs.find((x) => [x.aId, x.bId].sort().join() === "4,5");
    expect(p).toMatchObject({ reason: "DOMAIN", similarity: 1 });
  });

  it("finds fuzzy name matches in the same state", () => {
    const pairs = findMergeCandidates(leads);
    expect(pairs.some((x) => [x.aId, x.bId].sort().join() === "1,2" && x.reason === "FUZZY_NAME")).toBe(true);
  });

  it("does not merge same-named businesses in different states", () => {
    const pairs = findMergeCandidates(leads);
    expect(pairs.some((x) => [x.aId, x.bId].sort().join() === "1,3")).toBe(false);
    expect(pairs.some((x) => [x.aId, x.bId].sort().join() === "2,3")).toBe(false);
  });

  it("does not report unrelated leads, and each pair appears once", () => {
    const pairs = findMergeCandidates(leads);
    expect(pairs.some((x) => x.aId === "6" || x.bId === "6")).toBe(false);
    const keys = pairs.map((p) => `${p.aId}|${p.bId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("respects the threshold", () => {
    expect(findMergeCandidates([{ id: "a", name: "Acme Heating", domain: null }, { id: "b", name: "Acme Heating Inc", domain: null }], 1)).toHaveLength(1);
    expect(findMergeCandidates([{ id: "a", name: "Acme Heating", domain: null }, { id: "b", name: "Acme Cooling", domain: null }], 0.95)).toHaveLength(0);
  });
});
