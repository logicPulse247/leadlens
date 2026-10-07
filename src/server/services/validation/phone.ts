import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** Returns an E.164 string (e.g. "+16145551234") or null if the number is not valid. */
export function normalizePhone(input: string | null | undefined, defaultCountry: CountryCode = "US"): string | null {
  if (!input) return null;
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry);
  return parsed && parsed.isValid() ? parsed.number : null;
}

export function formatPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatNational() : e164;
}
