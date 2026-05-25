/**
 * Post-generation checks for generic / low-quality cold email copy.
 */

const GENERIC_PATTERNS = [
  /\b(?:businesses|companies|operators)\s+(?:often|usually|typically)\b/i,
  /\b(?:in|across)\s+your\s+industry\b/i,
  /\bcompanies\s+like\s+yours\b/i,
  /\bi\s+(?:noticed|came\s+across)\b/i,
  /\bi\s+hope\s+this\s+email\s+finds\s+you\s+well\b/i,
  /\breaching\s+out\b/i,
  /\btouching\s+base\b/i,
  /\bgame[- ]?changer\b/i,
  /\bsynergy\b/i,
  /\bleverage\b/i,
];

export interface EmailQualityResult {
  score: number;
  isGeneric: boolean;
  issues: string[];
}

export function scoreEmailQuality(
  subject: string,
  body: string,
  companyName: string
): EmailQualityResult {
  const issues: string[] = [];
  const text = `${subject}\n${body}`;
  const nameToken = companyName.split(/\s+/)[0]?.toLowerCase() ?? "";

  for (const pat of GENERIC_PATTERNS) {
    if (pat.test(text)) issues.push(`Generic phrase: ${pat.source.slice(0, 40)}…`);
  }

  const mentionsCompany =
    body.toLowerCase().includes(companyName.toLowerCase()) ||
    (nameToken.length > 3 && body.toLowerCase().includes(nameToken));

  if (!mentionsCompany) {
    issues.push("Body does not mention the company name");
  }

  const wordCount = body.split(/\s+/).filter(Boolean).length;
  if (wordCount < 50) issues.push("Body too short");
  if (wordCount > 180) issues.push("Body too long");

  let score = 10;
  score -= issues.length * 2;
  if (!mentionsCompany) score -= 2;

  const isGeneric = issues.some((i) => i.startsWith("Generic phrase")) || score < 6;

  return {
    score: Math.max(1, Math.min(10, score)),
    isGeneric,
    issues,
  };
}
