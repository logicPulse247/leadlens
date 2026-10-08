import { describe, expect, it, vi } from "vitest";
import { classifyEmail, normalizeEmail, validateEmail, validateEmailSyntax, type MxResolver } from "@/server/services/validation/email";
import { normalizePhone } from "@/server/services/validation/phone";

describe("email syntax", () => {
  it.each(["info@acme.com", "first.last+tag@sub.acme.co.uk", "a_b-c@acme.io"])("accepts %s", (e) => {
    expect(validateEmailSyntax(e)).toBe(true);
  });

  it.each(["", "plain", "a@b", "a@@b.com", "a b@acme.com", ".lead@acme.com", "trail.@acme.com", "dou..ble@acme.com", "x@-bad.com", `${"a".repeat(65)}@acme.com`])(
    "rejects %j",
    (e) => {
      expect(validateEmailSyntax(e)).toBe(false);
    },
  );

  it("normalizes mailto links and case", () => {
    expect(normalizeEmail(" MAILTO:Info@Acme.COM?subject=Hi ")).toBe("info@acme.com");
  });
});

describe("email classification", () => {
  it("flags role mailboxes as generic and name-like ones as personal", () => {
    expect(classifyEmail("info@acme.com")).toBe("generic");
    expect(classifyEmail("sales@acme.com")).toBe("generic");
    expect(classifyEmail("john.smith@acme.com")).toBe("personal");
    expect(classifyEmail("jsmith@acme.com")).toBe("personal");
    expect(classifyEmail("x9@acme.com")).toBe("unknown");
  });
});

describe("validateEmail with MX lookup", () => {
  it("marks mail-capable domains valid", async () => {
    const mx: MxResolver = async () => true;
    expect(await validateEmail("Info@Acme.com", mx)).toMatchObject({ address: "info@acme.com", syntaxValid: true, mxValid: true, kind: "generic" });
  });

  it("marks domains without MX as invalid", async () => {
    const mx: MxResolver = async () => false;
    expect((await validateEmail("info@nomail.com", mx))?.mxValid).toBe(false);
  });

  it("keeps unknown MX results as null rather than failing the address", async () => {
    const mx: MxResolver = async () => null;
    expect((await validateEmail("info@flaky.com", mx))?.mxValid).toBeNull();
  });

  it("does not look up MX for syntactically invalid addresses", async () => {
    const mx = vi.fn(async (_domain: string): Promise<boolean | null> => true);
    const r = await validateEmail("not-an-email", mx);
    expect(r).toMatchObject({ syntaxValid: false, mxValid: false });
    expect(mx).not.toHaveBeenCalled();
  });
});

describe("phone normalization", () => {
  it("normalizes US formats to E.164", () => {
    expect(normalizePhone("(614) 555-0132")).toBe("+16145550132");
    expect(normalizePhone("614.555.0132")).toBe("+16145550132");
    expect(normalizePhone("+1 614 555 0132")).toBe("+16145550132");
  });

  it("rejects numbers that cannot be real", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("000-000-0000")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});
