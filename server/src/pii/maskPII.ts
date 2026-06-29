/**
 * PII masking — mandatory upstream of every AI provider call.
 * See ADR-0003 and CONTRIBUTING.md "Data-handling rules."
 *
 * MVP scope: mask emails, phone numbers, and credit-card-like number
 * sequences from raw ticket text before it is embedded or sent to an
 * AI provider for drafting. Extend patterns here as gaps are found in
 * QA — do not bypass this module from calling code.
 */

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_PATTERN = /\b\+?\d[\d\s().-]{7,}\d\b/g;
const CC_LIKE_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;

export interface MaskResult {
  maskedText: string;
  redactionCount: number;
}

export function maskPII(rawText: string): MaskResult {
  let redactionCount = 0;
  let maskedText = rawText;

  for (const pattern of [EMAIL_PATTERN, PHONE_PATTERN, CC_LIKE_PATTERN]) {
    maskedText = maskedText.replace(pattern, () => {
      redactionCount += 1;
      return "[REDACTED]";
    });
  }

  return { maskedText, redactionCount };
}
