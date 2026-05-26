import {
  fetchBingHtml,
  fetchDdgHtml,
  parseBingHits,
  parseDdgHits,
  type SearchHit,
} from "@/utils/search-engine-fetch";

const DIRECTORY_HOSTS = [
  "africabizinfo.com",
  "rwandayp.com",
  "yellowpages.com",
  "medpages.info",
  "zoea.africa",
  "cybo.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "google.com",
  "maps.google",
  "zoominfo.com",
  "rocketreach.co",
  "apollo.io",
];

export type LeadResearchAgentEvidence = {
  title: string;
  url: string;
  snippet: string;
  sourceType: "official_site" | "directory" | "social" | "search_result";
};

export type LeadResearchAgentResult = {
  officialWebsite: string | null;
  evidence: LeadResearchAgentEvidence[];
  summary: string;
  confidence: "high" | "medium" | "low";
  recommendedAction: "draft" | "review" | "phone_only";
};

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function classifyHit(url: string): LeadResearchAgentEvidence["sourceType"] {
  const host = hostFromUrl(url) ?? "";
  if (/facebook|instagram|linkedin/i.test(host)) return "social";
  if (DIRECTORY_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) {
    return "directory";
  }
  return "search_result";
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function companyTokens(companyName: string): string[] {
  return normalize(companyName)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .filter(
      (token) =>
        ![
          "ltd",
          "limited",
          "clinic",
          "company",
          "business",
          "official",
          "website",
          "contact",
          "rwanda",
          "kigali",
        ].includes(token)
    )
    .slice(0, 6);
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const host = hostFromUrl(hit.url);
    const key = host ? `${host}|${hit.title}` : `${hit.url}|${hit.title}`;
    if (!hit.title || !hit.url || seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

function relevantHit(hit: SearchHit, companyName: string, location: string): boolean {
  const blob = normalize(`${hit.title} ${hit.snippet} ${hit.url}`);
  const tokens = companyTokens(companyName);
  const tokenHits = tokens.filter((token) => blob.includes(token)).length;
  const hasLocation = /rwanda|kigali/i.test(location)
    ? /rwanda|kigali|\.rw\b/i.test(`${hit.title} ${hit.snippet} ${hit.url}`)
    : true;
  return tokenHits >= Math.min(2, Math.max(1, tokens.length)) && hasLocation;
}

function isOfficialCandidate(hit: SearchHit, companyName: string): boolean {
  const type = classifyHit(hit.url);
  if (type !== "search_result") return false;
  if (/\.(pdf|docx?|xlsx?)(\?|$)/i.test(hit.url)) return false;
  const host = normalize(hostFromUrl(hit.url) ?? "");
  return companyTokens(companyName).some((token) => host.includes(token));
}

export async function runLeadResearchAgent(input: {
  companyName: string;
  location: string | null;
  niche: string | null;
  website?: string | null;
  phone?: string | null;
}): Promise<LeadResearchAgentResult> {
  const location = input.location || "Kigali, Rwanda";
  const city = location.split(",")[0]?.trim() || location;
  const queries = [
    `"${input.companyName}" "${city}" Rwanda`,
    `"${input.companyName}" contact phone email`,
    `"${input.companyName}" official website Rwanda`,
  ];

  const hits: SearchHit[] = [];
  for (const query of queries) {
    try {
      const bing = await fetchBingHtml(query, location);
      hits.push(...parseBingHits(bing.html, 8));
    } catch {
      /* continue with DDG */
    }
    try {
      const ddg = await fetchDdgHtml(query);
      hits.push(...parseDdgHits(ddg.html, ddg.via).slice(0, 8));
    } catch {
      /* next query */
    }
    if (hits.length >= 12) break;
  }

  const evidence = dedupeHits(hits)
    .filter((hit) => relevantHit(hit, input.companyName, location))
    .slice(0, 8)
    .map((hit) => ({
      title: hit.title,
      url: hit.url,
      snippet: hit.snippet,
      sourceType: classifyHit(hit.url),
    }));

  const official = evidence.find((hit) =>
    isOfficialCandidate(hit, input.companyName)
  );
  const officialWebsite = input.website || official?.url || null;
  const directoryEvidence = evidence.filter((hit) => hit.sourceType === "directory");
  const confidence =
    officialWebsite || evidence.length >= 3
      ? "medium"
      : evidence.length > 0 || input.phone
        ? "low"
        : "low";
  const recommendedAction = officialWebsite
    ? "draft"
    : input.phone || directoryEvidence.length > 0
      ? "review"
      : "phone_only";

  const facts = [
    input.phone ? `Phone listed: ${input.phone}` : null,
    officialWebsite ? `Official/candidate website: ${officialWebsite}` : null,
    evidence.length
      ? `Public evidence: ${evidence
          .slice(0, 4)
          .map((hit) => `${hit.title} (${hit.sourceType})`)
          .join("; ")}`
      : null,
  ].filter(Boolean);

  return {
    officialWebsite,
    evidence,
    summary: facts.join(". "),
    confidence,
    recommendedAction,
  };
}

export function serializeLeadResearchAgent(result: LeadResearchAgentResult): string {
  const lines = [
    "[AGENT_RESEARCH]",
    `Official website: ${result.officialWebsite ?? "not found"}`,
    `Confidence: ${result.confidence}`,
    `Recommended action: ${result.recommendedAction}`,
  ];
  if (result.summary) lines.push(`Summary: ${result.summary}`);
  if (result.evidence.length) {
    lines.push("Evidence:");
    for (const item of result.evidence.slice(0, 6)) {
      lines.push(`- ${item.title} | ${item.sourceType} | ${item.url}`);
      if (item.snippet) lines.push(`  ${item.snippet.slice(0, 220)}`);
    }
  }
  lines.push("[/AGENT_RESEARCH]");
  return lines.join("\n");
}
