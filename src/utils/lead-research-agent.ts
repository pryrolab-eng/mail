import { resolveMx } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  fetchGoogleHtml,
  parseGoogleHits,
  type SearchHit,
} from "@/utils/search-engine-fetch";
import { resolveGenerationModel } from "@/utils/email-prompts";
import { fetchWebpage } from "@/utils/website-email-scraper";
import { isSkillId, runSkill } from "@/utils/skill-registry";

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
]);

export type AgentSourceType =
  | "official_site"
  | "directory"
  | "social"
  | "search_result"
  | "unrelated";

export type AgentConfidence = "high" | "medium" | "low";
export type AgentRisk = "low" | "medium" | "high";
export type AgentRecommendedAction =
  | "auto_queue"
  | "draft"
  | "review"
  | "phone_only"
  | "rejected";

export type LeadResearchAgentEvidence = {
  title: string;
  url: string;
  snippet: string;
  sourceType: AgentSourceType;
  confidence: AgentConfidence;
  isOfficialCandidate: boolean;
  extractedFacts: {
    emails: string[];
    phones: string[];
    socials: string[];
    relationship?: string[];
    facts?: string[];
    businessFacts?: BusinessFact[];
  };
};

export type BusinessFactCategory =
  | "founder_background"
  | "team_size"
  | "services_offered"
  | "payment_model"
  | "location"
  | "contact"
  | "specializations"
  | "years_in_operation";

export type SalesRelevance = "high" | "medium" | "low";

export type BusinessFact = {
  fact: string;
  category: BusinessFactCategory;
  source: string;
  confidence: AgentConfidence;
  salesRelevance: SalesRelevance;
};

export type AgentContact = {
  type: "email" | "phone" | "social" | "website";
  value: string;
  sourceUrl?: string | null;
  sourceType?: AgentSourceType | null;
  verificationStatus: "verified" | "unverified" | "no_mx" | "suppressed" | "invalid";
  confidence: AgentConfidence;
  isBusinessOwned: boolean;
  isPrimary: boolean;
};

export type LeadResearchAgentDecision = {
  leadType: "email_ready" | "review" | "phone_only" | "rejected";
  officialWebsite: string | null;
  bestEmail: string | null;
  evidenceSummary: string;
  confidence: AgentConfidence;
  risk: AgentRisk;
  recommendedAction: AgentRecommendedAction;
  emailAngle: string;
  draftAllowed: boolean;
  autoSendAllowed: boolean;
  reason: string;
};

export type LeadResearchAgentResult = LeadResearchAgentDecision & {
  evidence: LeadResearchAgentEvidence[];
  contacts: AgentContact[];
  toolCalls: Array<{
    skillId?: string;
    tool: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    ok: boolean;
    confidence?: AgentConfidence;
    warnings?: string[];
    durationMs?: number;
  }>;
  modelUsed: string | null;
};

type AIProviderLike = {
  provider: string;
  api_key: string;
  active_model: string | null;
};

class AgentReasoningError extends Error {
  constructor(
    message: string,
    public status: number | null = null,
    public userMessage = message
  ) {
    super(message);
    this.name = "AgentReasoningError";
  }
}

type AgentSkillTrace = LeadResearchAgentResult["toolCalls"][number];

type AgentSkillResult<TOutput extends Record<string, unknown> = Record<string, unknown>> = {
  output: TOutput;
  confidence?: AgentConfidence;
  warnings?: string[];
};

async function runAgentSkill<TOutput extends Record<string, unknown>>(params: {
  traces: AgentSkillTrace[];
  name: string;
  input: Record<string, unknown>;
  run: () => Promise<AgentSkillResult<TOutput>> | AgentSkillResult<TOutput>;
}): Promise<TOutput> {
  if (isSkillId(params.name)) {
    const result = await runSkill({
      id: params.name,
      input: params.input,
      run: params.run,
    });
    params.traces.push({
      ...result.trace,
      confidence: result.trace.confidence as AgentConfidence | undefined,
    });
    if (!result.trace.ok) {
      throw new Error(String(result.trace.output.error ?? `Skill failed: ${params.name}`));
    }
    return result.output;
  }
  const started = Date.now();
  try {
    const result = await params.run();
    params.traces.push({
      skillId: undefined,
      tool: params.name,
      input: params.input,
      output: result.output,
      ok: true,
      confidence: result.confidence,
      warnings: result.warnings,
      durationMs: Date.now() - started,
    });
    return result.output;
  } catch (error) {
    params.traces.push({
      skillId: undefined,
      tool: params.name,
      input: params.input,
      output: { error: error instanceof Error ? error.message : String(error) },
      ok: false,
      confidence: "low",
      durationMs: Date.now() - started,
    });
    throw error;
  }
}

function recordAgentSkill(params: {
  traces: AgentSkillTrace[];
  name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  ok?: boolean;
  confidence?: AgentConfidence;
  warnings?: string[];
}): void {
  params.traces.push({
    skillId: isSkillId(params.name) ? params.name : undefined,
    tool: params.name,
    input: params.input,
    output: params.output,
    ok: params.ok ?? true,
    confidence: params.confidence,
    warnings: params.warnings,
    durationMs: 0,
  });
}

const decisionSchema = z.object({
  leadType: z.enum(["email_ready", "review", "phone_only", "rejected"]),
  officialWebsite: z.string().nullable(),
  bestEmail: z.string().nullable(),
  evidenceSummary: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
  risk: z.enum(["low", "medium", "high"]),
  recommendedAction: z.enum(["auto_queue", "draft", "review", "phone_only", "rejected"]),
  emailAngle: z.string().min(1),
  draftAllowed: z.boolean(),
  autoSendAllowed: z.boolean(),
  reason: z.string().min(1),
});

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function originFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
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
        ].includes(token)
    )
    .slice(0, 6);
}

function stripBranchQualifier(companyName: string): string {
  return companyName
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(branch|location|office|store|site|outlet)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function branchTokens(companyName: string): string[] {
  const matches = companyName.match(/\(([^)]*)\)/g) ?? [];
  const fromParens = matches
    .map((m) => m.replace(/[()]/g, ""))
    .join(" ");
  const fromName = "";
  return normalize(`${fromParens} ${fromName}`)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
}

function acronymForCompany(companyName: string): string | null {
  const words = stripBranchQualifier(companyName)
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word.length >= 3)
    .filter((word) => !/clinic|medical|dental|company|business/i.test(word));
  if (words.length < 2) return null;
  return words.map((word) => word[0]).join("").toUpperCase();
}

function buildAgentSearchQueries(input: {
  companyName: string;
  location?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
}): string[] {
  const city = sanitizeLocationForSearch(input.location);
  const baseName = stripBranchQualifier(input.companyName);
  const domain =
    hostFromUrl(input.website ?? "") ??
    input.email?.split("@")[1]?.toLowerCase() ??
    "";
  const cityPart = city ? ` ${city}` : "";
  return Array.from(
    new Set(
      [
        `"${input.companyName}"${cityPart}`,
        domain ? `"${input.companyName}"${cityPart} ${domain}` : "",
        `"${baseName}"${cityPart} services`,
        `"${baseName}"${cityPart} team`,
        input.phone ? `"${input.phone}"` : "",
        input.email ? `"${input.email}"` : "",
      ].filter(Boolean)
    )
  );
}

function sanitizeLocationForSearch(location?: string | null): string {
  if (!location) return "";
  const clean = location.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length > 140 || /[·]|open|closes|rating|reviews|\d\.\d\(\d+\)/i.test(clean)) {
    return "";
  }
  return clean.split(",")[0]?.slice(0, 80).trim() ?? "";
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;|&gt;|-->/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractUsefulFacts(text: string): string[] {
  const compact = text.replace(/\s+/g, " ").trim();
  const sentences = compact
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 260)
    .filter(
      (sentence) =>
        !/cookie|copyright|all rights reserved|powered by|lorem ipsum|javascript/i.test(sentence)
    );

  const factPatterns = [
    /welcome to|about us|who we are|what we do/i,
    /our vision|our mission|why us|values|approach/i,
    /service|solution|product|offering|category|special/i,
    /address|location|village|sector|cell|opposite|located|visit us/i,
    /working hours|opening hours|hours|mon|sat|sun|appointment/i,
    /founder|owner|director|manager|team|staff|specialist|professional/i,
    /customer|client|patient|family|care|treatment|support/i,
  ];

  const ranked = sentences
    .map((sentence) => ({
      sentence,
      score: factPatterns.reduce(
        (score, pattern) => score + (pattern.test(sentence) ? 1 : 0),
        0
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.sentence);

  return Array.from(new Set(ranked)).slice(0, 14);
}

function stripReviewText(text: string): string {
  return text
    .replace(/our happy clients[\s\S]*?(?:leave a message|working hours|contact|useful links|copyright|$)/gi, " ")
    .replace(/testimonials?[\s\S]*?(?:leave a message|working hours|contact|useful links|copyright|$)/gi, " ")
    .replace(/frequently asked questions[\s\S]*?(?:contact|book an appointment|copyright|$)/gi, " ")
    .replace(/explore our faqs[\s\S]*?(?:contact|book an appointment|copyright|$)/gi, " ")
    .replace(/["“][^"”]{20,260}["”]\s*(?:[A-Z][a-z]+)?\s*(?:Client|Customer|Patient)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanFactText(value: string): string {
  return value
    .replace(/&nbsp;?/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/-->/g, " ")
    .replace(/\b(skip to content|home|about us|services|gallery|news|contact us|book appointment)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addBusinessFact(
  facts: BusinessFact[],
  fact: string,
  category: BusinessFactCategory,
  source: string,
  salesRelevance: SalesRelevance,
  confidence: AgentConfidence = "high"
): void {
  const clean = cleanFactText(fact);
  if (clean.length < 20) return;
  if (/high[- ]quality|exceptional|friendly|top[- ]notch|happy clients|transformed my smile/i.test(clean)) {
    return;
  }
  facts.push({ fact: clean.slice(0, 360), category, source, confidence, salesRelevance });
}

function addStructuredContactFacts(
  facts: BusinessFact[],
  text: string,
  source: string
): void {
  const emails = extractContacts(text).emails.slice(0, 3);
  const phones = extractContacts(text).phones.slice(0, 4);
  if (emails.length) {
    addBusinessFact(
      facts,
      `lists email contact ${emails.join(", ")}`,
      "contact",
      source,
      "medium"
    );
  }
  if (phones.length) {
    addBusinessFact(
      facts,
      `lists phone contact ${phones.join(", ")}`,
      "contact",
      source,
      "medium"
    );
  }
}

function extractBusinessFactsFromPage(text: string, source: string): BusinessFact[] {
  const clean = stripReviewText(text);
  const facts: BusinessFact[] = [];
  addStructuredContactFacts(facts, clean, source);
  const sentences = clean
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => cleanFactText(sentence))
    .filter((sentence) => sentence.length >= 25 && sentence.length <= 260)
    .filter((sentence) => !/cookie|copyright|powered by|all rights reserved|javascript/i.test(sentence));

  for (const sentence of sentences) {
    if (/fee[- ]for[- ]service|payment|cash|insurance|billing|invoice/i.test(sentence)) {
      addBusinessFact(facts, sentence, "payment_model", source, "high");
    } else if (/opening hours|working hours|monday|tuesday|wednesday|thursday|friday|saturday|sunday|appointment/i.test(sentence)) {
      addBusinessFact(facts, sentence, "contact", source, "medium");
    } else if (
      /(?:offers?|provides?|service categories|our services|services offered|including)\b/i.test(sentence) &&
      /dentistry|surgery|orthodontics|endodontics|periodontics|prosthetics|screening|treatment/i.test(sentence) &&
      !/founder|chief|teaches|university|committed to|focuses on|experience/i.test(sentence)
    ) {
      addBusinessFact(facts, sentence, "services_offered", source, "high");
    } else if (/founder|founded|owner|director|head of|chief|surgeon|years/i.test(sentence)) {
      addBusinessFact(facts, sentence, "founder_background", source, "medium");
    } else if (
      /our team|doctors timetable|team roles|staff includes|mentions team roles|doctor consultations/i.test(sentence)
    ) {
      addBusinessFact(facts, sentence, "team_size", source, "high");
    } else if (/(?:\bphysical address\b|\baddress:\b|\blocated (?:at|in|near)\b|\bvillage\b|\bsector\b|\bcell\b|\bstreet\b|\bavenue\b|\broad\b|\bbuilding\b|\bfloor\b|\bsuite\b|\bKG\s*\d+\b)/i.test(sentence)) {
      addBusinessFact(facts, sentence, "location", source, "medium");
    } else if (/doctor|dermatologist|specialist|clinician|instructor|consultant|master'?s|doctorate/i.test(sentence)) {
      addBusinessFact(facts, sentence, "founder_background", source, "low", "medium");
    }
  }

  const servicesBlock = clean.match(
    /(?:service categories|our services|services offered|discover our services)\s+(.{40,650}?)(?:learn more|our team|contact|working hours|about|copyright|$)/i
  )?.[1];
  if (servicesBlock) {
    const services = Array.from(
      new Set(
        servicesBlock
          .split(/[,;|•·]|\s{2,}/)
          .map((item) => cleanFactText(item))
          .filter((item) => item.length >= 6 && item.length <= 50)
          .filter((item) => !/learn more|discover|service categories/i.test(item))
      )
    ).slice(0, 12);
    if (services.length >= 3) {
      addBusinessFact(
        facts,
        `offers ${services.length} service types including ${services.slice(0, 6).join(", ")}`,
        "services_offered",
        source,
        "high"
      );
    }
  }

  const teamRoles = Array.from(
    new Set(
      clean.match(/\b(?:Dental Surgeon|General Dental Surgeon|Conservative Dentistry Specialist|Registered Nurse|Patient Care Coordinator|Dental Therapist|Doctor|Dentist|Specialist)\b/gi) ?? []
    )
  ).slice(0, 8);
  if (teamRoles.length >= 2) {
    addBusinessFact(
      facts,
      `mentions team roles including ${teamRoles.join(", ")}`,
      "team_size",
      source,
      "high"
    );
  }

  const yearMatch = clean.match(/\b(over\s+)?(\d{2})\s+years?\b/i);
  if (yearMatch) {
    addBusinessFact(
      facts,
      `mentions ${yearMatch[0]} of experience`,
      "years_in_operation",
      source,
      "medium"
    );
  }

  return Array.from(new Map(facts.map((fact) => [`${fact.category}:${fact.fact.toLowerCase()}`, fact])).values()).slice(0, 16);
}

function sourcePathPriority(url: string): number {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (/services/.test(path)) return 0;
    if (/about/.test(path)) return 1;
    if (/team|doctor/.test(path)) return 2;
    if (/pricing|payment/.test(path)) return 3;
    if (/contact/.test(path)) return 4;
    if (path === "/" || path === "") return 5;
    return 6;
  } catch {
    return 9;
  }
}

function officialPageTitle(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (/services/.test(path)) return "Official services page";
    if (/about/.test(path)) return "Official about page";
    if (/team|doctor/.test(path)) return "Official team page";
    if (/pricing|payment/.test(path)) return "Official pricing/payment page";
    if (/contact/.test(path)) return "Official contact page";
    return "Official homepage";
  } catch {
    return "Official page";
  }
}

async function fetchTargetedPages(params: {
  officialWebsite: string;
  fallbackPages: string[];
  maxPages?: number;
}): Promise<{
  evidence: LeadResearchAgentEvidence[];
  contacts: ReturnType<typeof extractContacts>;
  fetchedUrls: string[];
  attemptedUrls: string[];
  skippedUrls: string[];
}> {
  const origin = new URL(params.officialWebsite).origin;
  const requiredPaths = [
    "/services/",
    "/about-us/",
    "/team/",
    "/our-team/",
    "/doctors/",
    "/pricing/",
    "/contact/",
    "/contact-us/",
  ];
  const fallbackPages = params.fallbackPages
    .filter((url) => hostFromUrl(url) === hostFromUrl(origin))
    .sort((a, b) => sourcePathPriority(a) - sourcePathPriority(b));
  const urls = Array.from(
    new Set([
      ...requiredPaths.map((path) => `${origin}${path}`),
      ...fallbackPages,
      origin,
    ])
  ).slice(0, params.maxPages ?? 10);

  let combinedText = "";
  let combinedRaw = "";
  const fetchedUrls: string[] = [];
  const skippedUrls: string[] = [];
  const evidence: LeadResearchAgentEvidence[] = [];

  for (const candidate of urls) {
    try {
      const html = await fetchWebpage(candidate, 8_000);
      if (!html) {
        skippedUrls.push(candidate);
        continue;
      }
      const text = htmlToText(html);
      if (text.length < 120 || /javascript is disabled/i.test(text.slice(0, 300))) {
        skippedUrls.push(candidate);
        continue;
      }
      fetchedUrls.push(candidate);
      combinedRaw += ` ${html}`;
      combinedText += ` ${text}`;
      const contacts = extractContacts(`${html} ${text}`);
      const businessFacts = extractBusinessFactsFromPage(text, candidate);
      const facts = businessFacts.map((fact) => fact.fact);
      evidence.push({
        title: officialPageTitle(candidate),
        url: candidate,
        snippet: facts.slice(0, 4).join(" "),
        sourceType: "official_site",
        confidence: "high",
        isOfficialCandidate: true,
        extractedFacts: {
          ...contacts,
          relationship: ["exact"],
          facts,
          businessFacts,
        },
      });
    } catch {
      skippedUrls.push(candidate);
    }
  }

  return {
    evidence,
    contacts: extractContacts(`${combinedRaw} ${combinedText}`),
    fetchedUrls,
    attemptedUrls: urls,
    skippedUrls,
  };
}

function evidenceRelationship(hit: SearchHit, companyName: string): "exact" | "related_branch" | "weak" | "unrelated" {
  const blob = normalize(`${hit.title} ${hit.snippet} ${hit.url}`);
  const exactTokens = companyTokens(companyName);
  const baseTokens = companyTokens(stripBranchQualifier(companyName));
  const branches = branchTokens(companyName);
  const exactHits = exactTokens.filter((token) => blob.includes(token)).length;
  const baseHits = baseTokens.filter((token) => blob.includes(token)).length;
  const branchHit = branches.some((token) => blob.includes(token));

  if (exactTokens.length > 0 && exactHits >= Math.min(2, exactTokens.length)) {
    return "exact";
  }
  if (baseTokens.length > 0 && baseHits >= Math.min(2, baseTokens.length)) {
    return branchHit ? "exact" : "related_branch";
  }
  if (baseTokens.length > 0 && baseHits >= 1) return "weak";
  return "unrelated";
}

function isGenericLocationOrReferenceHit(hit: SearchHit): boolean {
  const blob = normalize(`${hit.title} ${hit.snippet} ${hit.url}`);
  const host = hostFromUrl(hit.url) ?? "";
  return (
    /wikipedia\.org|wikidata\.org|britannica\.com/.test(host) ||
    /\b(capital|largest city|province-level|country|republic|population|geography)\b/.test(blob)
  );
}

export function classifySource(url: string): AgentSourceType {
  const host = hostFromUrl(url) ?? "";
  if (!host) return "unrelated";
  if (/facebook|instagram|linkedin|x\.com|twitter|tiktok/i.test(host)) {
    return "social";
  }
  return "search_result";
}

function relevantHit(hit: SearchHit, companyName: string, location: string): boolean {
  if (isGenericLocationOrReferenceHit(hit)) return false;
  const relationship = evidenceRelationship(hit, companyName);
  const locationTokens = normalize(location)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .slice(0, 4);
  const blob = normalize(`${hit.title} ${hit.snippet} ${hit.url}`);
  const hasLocation =
    locationTokens.length === 0 || locationTokens.some((token) => blob.includes(token));
  return relationship !== "unrelated" && hasLocation;
}

function isOfficialCandidate(hit: SearchHit, companyName: string): boolean {
  if (isGenericLocationOrReferenceHit(hit)) return false;
  if (classifySource(hit.url) !== "search_result") return false;
  if (/\.(pdf|docx?|xlsx?)(\?|$)/i.test(hit.url)) return false;
  const host = normalize(hostFromUrl(hit.url) ?? "");
  const relationship = evidenceRelationship(hit, companyName);
  const tokens = companyTokens(stripBranchQualifier(companyName));
  const hostMatches = tokens.some((token) => host.includes(token));
  return relationship !== "unrelated" && hostMatches;
}

function isDirectoryUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return classifySource(url) === "directory";
}

function emailDomainMatchesWebsite(email: string | null | undefined, website: string | null | undefined): boolean {
  const domain = email?.split("@")[1]?.toLowerCase();
  const host = website ? hostFromUrl(website) : null;
  return !!domain && !!host && (host === domain || host.endsWith(`.${domain}`) || domain.endsWith(host));
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

function extractContacts(text: string): {
  emails: string[];
  phones: string[];
  socials: string[];
} {
  const emails = Array.from(
    new Set(
      (text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? [])
        .map((email) => email.toLowerCase())
        .filter((email) => !/example\.com|sentry\.io|wixpress|placeholder/i.test(email))
    )
  );
  const phoneCandidates: string[] = [];
  for (const match of text.matchAll(/href=["']tel:([^"']+)["']/gi)) {
    phoneCandidates.push(match[1]);
  }
  const labeledPhone =
    /(?:phone|tel|telephone|mobile|whatsapp|call|emergency)[^+\d(]{0,35}((?:\+?\d|\(\d)[\d\s().-]{7,28}\d)/gi;
  for (const match of text.matchAll(labeledPhone)) {
    phoneCandidates.push(match[1]);
  }
  const phones = Array.from(
    new Set(
      phoneCandidates
        .map((phone) => phone.replace(/\s+/g, " ").trim())
        .filter(isPlausiblePhone)
    )
  );
  const socials = Array.from(
    new Set(
      (text.match(/https?:\/\/(?:www\.)?(?:facebook|instagram|linkedin|x|twitter)\.com\/[^\s"'<>]+/gi) ?? [])
        .map((url) => url.trim())
    )
  );
  return { emails, phones, socials };
}

function isPlausiblePhone(value: string): boolean {
  const clean = value.trim();
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return false;
  if (/[a-z]/i.test(value)) return false;
  if (/[.]/.test(value)) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){1,3}$/.test(value)) return false;
  if (/^\d+(?:[.\-]\d+)+$/.test(value) && !value.trim().startsWith("+")) return false;
  if (/^\d+$/.test(clean) && !clean.startsWith("0")) return false;
  if (/^\d+$/.test(clean) && clean.startsWith("0") && digits.length > 11) return false;
  if (!/^\+|\(\d{1,4}\)|^0/.test(clean)) return false;
  return true;
}

async function verifyEmail(
  email: string,
  sourceUrl: string | null,
  userId: string,
  supabase?: SupabaseClient,
  officialWebsite?: string | null
): Promise<AgentContact> {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const sourceHost = sourceUrl ? hostFromUrl(sourceUrl) : null;
  const officialHost = officialWebsite ? hostFromUrl(officialWebsite) : null;
  let verificationStatus: AgentContact["verificationStatus"] = "unverified";
  let confidence: AgentConfidence = "low";
  let isBusinessOwned = false;

  if (!domain || !email.includes("@")) {
    verificationStatus = "invalid";
  } else {
    try {
      const mx = await resolveMx(domain);
      verificationStatus = mx.length > 0 ? "verified" : "no_mx";
    } catch {
      verificationStatus = "no_mx";
    }
    isBusinessOwned =
      !FREE_EMAIL_DOMAINS.has(domain) &&
      !!officialHost &&
      (officialHost === domain || officialHost.endsWith(`.${domain}`) || domain.endsWith(officialHost));
    confidence =
      verificationStatus === "verified" && isBusinessOwned
        ? "high"
        : verificationStatus === "verified"
          ? "medium"
          : "low";
  }

  if (supabase && verificationStatus !== "invalid") {
    const { count } = await supabase
      .from("email_suppression_list")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("email", email.toLowerCase());
    if ((count ?? 0) > 0) {
      verificationStatus = "suppressed";
      confidence = "low";
      isBusinessOwned = false;
    }
  }

  return {
    type: "email",
    value: email.toLowerCase(),
    sourceUrl,
    sourceType: sourceUrl ? classifySource(sourceUrl) : null,
    verificationStatus,
    confidence,
    isBusinessOwned,
    isPrimary: false,
  };
}

function deterministicDecision(input: {
  officialWebsite: string | null;
  contacts: AgentContact[];
  evidence: LeadResearchAgentEvidence[];
  phone?: string | null;
}): LeadResearchAgentDecision {
  const bestEmail =
    input.contacts.find(
      (c) => c.type === "email" && c.verificationStatus === "verified" && c.isBusinessOwned
    )?.value ??
    input.contacts.find((c) => c.type === "email" && c.verificationStatus === "verified")?.value ??
    null;
  const hasPhone =
    !!input.phone || input.contacts.some((c) => c.type === "phone" && c.value.trim());
  const directoryOnly =
    input.evidence.length > 0 &&
    input.evidence.every((item) => item.sourceType === "directory" || item.sourceType === "social");

  const exactOfficialEvidence = input.evidence.some(
    (item) =>
      item.isOfficialCandidate &&
      item.extractedFacts.relationship?.includes("exact")
  );
  if (bestEmail && input.officialWebsite && exactOfficialEvidence) {
    return {
      leadType: "email_ready",
      officialWebsite: input.officialWebsite,
      bestEmail,
      evidenceSummary: "Verified business email with official/candidate website evidence.",
      confidence: "high",
      risk: "low",
      recommendedAction: "auto_queue",
      emailAngle: "Use operational evidence from the website and public listing.",
      draftAllowed: true,
      autoSendAllowed: true,
      reason: "Verified email and website/domain evidence are present.",
    };
  }
  if (bestEmail) {
    return {
      leadType: "review",
      officialWebsite: input.officialWebsite,
      bestEmail,
      evidenceSummary: input.officialWebsite
        ? "Verified email found with related official/candidate website evidence, but branch/exact-match risk remains."
        : "Verified email found, but official website evidence is weak.",
      confidence: "medium",
      risk: "medium",
      recommendedAction: "review",
      emailAngle: "Use public evidence carefully; mention the clinic generally and avoid assuming the exact branch.",
      draftAllowed: true,
      autoSendAllowed: false,
      reason: "Email/contact evidence needs human review before sending.",
    };
  }
  return {
    leadType: hasPhone ? "phone_only" : directoryOnly ? "review" : "rejected",
    officialWebsite: input.officialWebsite,
    bestEmail: null,
    evidenceSummary: input.evidence.length
      ? "Public evidence exists, but no verified business-owned email was found."
      : "No useful public evidence or verified contact was found.",
    confidence: input.evidence.length || hasPhone ? "low" : "low",
    risk: "high",
    recommendedAction: hasPhone ? "phone_only" : input.evidence.length ? "review" : "rejected",
    emailAngle: "Do not draft an email unless a safe email is added or found later.",
    draftAllowed: false,
    autoSendAllowed: false,
    reason: "No verified email suitable for automated outreach.",
  };
}

function safeDecision(
  decision: LeadResearchAgentDecision,
  contacts: AgentContact[],
  evidence: LeadResearchAgentEvidence[],
  phone?: string | null
): LeadResearchAgentDecision {
  const normalizedDecision: LeadResearchAgentDecision = {
    ...decision,
    officialWebsite: isDirectoryUrl(decision.officialWebsite)
      ? null
      : decision.officialWebsite,
  };
  const safeBusinessEmail = contacts.find(
    (contact) =>
      contact.type === "email" &&
      contact.value === normalizedDecision.bestEmail &&
      contact.verificationStatus === "verified" &&
      contact.isBusinessOwned
  );
  const anyVerifiedEmail = contacts.find(
    (contact) =>
      contact.type === "email" &&
      contact.value === normalizedDecision.bestEmail &&
      contact.verificationStatus === "verified"
  );
  const exactOfficialEvidence = evidence.some(
    (item) =>
      item.isOfficialCandidate &&
      item.sourceType === "official_site" &&
      item.extractedFacts.relationship?.includes("exact")
  );

  if (safeBusinessEmail && exactOfficialEvidence) {
    return normalizedDecision;
  }

  if (normalizedDecision.recommendedAction === "auto_queue" || normalizedDecision.autoSendAllowed) {
    return {
      ...normalizedDecision,
      leadType: anyVerifiedEmail ? "review" : phone ? "phone_only" : "review",
      bestEmail: anyVerifiedEmail?.value ?? null,
      confidence: anyVerifiedEmail ? "medium" : "low",
      risk: "high",
      recommendedAction: anyVerifiedEmail ? "review" : phone ? "phone_only" : "review",
      draftAllowed: !!anyVerifiedEmail,
      autoSendAllowed: false,
      reason:
        "Safety override: no exact official-site evidence with a verified business-owned email.",
    };
  }

  if (normalizedDecision.bestEmail && !anyVerifiedEmail) {
    return {
      ...normalizedDecision,
      bestEmail: null,
      confidence: decision.confidence === "high" ? "medium" : decision.confidence,
      risk: decision.risk === "low" ? "medium" : decision.risk,
      draftAllowed: false,
      autoSendAllowed: false,
      reason:
        "Safety override: selected email is not verified as business-owned or came from a directory.",
    };
  }

  return {
    ...normalizedDecision,
    autoSendAllowed: false,
  };
}

function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("No JSON object found");
  }
}

function truncateText(value: string | null | undefined, max = 240): string {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function collectBusinessFacts(evidence: LeadResearchAgentEvidence[]): BusinessFact[] {
  return Array.from(
    new Map(
      evidence
        .flatMap((item) => item.extractedFacts.businessFacts ?? [])
        .map((fact) => [`${fact.category}:${fact.fact.toLowerCase()}`, fact])
    ).values()
  );
}

function rankBusinessFactsForEmail(facts: BusinessFact[], maxFacts = 5): BusinessFact[] {
  const relevanceRank: Record<SalesRelevance, number> = { high: 0, medium: 1, low: 2 };
  const categoryRank: Record<BusinessFactCategory, number> = {
    payment_model: 0,
    services_offered: 1,
    team_size: 2,
    specializations: 3,
    founder_background: 4,
    years_in_operation: 5,
    contact: 6,
    location: 7,
  };
  return facts
    .filter((fact) => fact.salesRelevance === "high" || fact.salesRelevance === "medium")
    .sort(
      (a, b) =>
        relevanceRank[a.salesRelevance] - relevanceRank[b.salesRelevance] ||
        categoryRank[a.category] - categoryRank[b.category] ||
        a.fact.length - b.fact.length
    )
    .slice(0, maxFacts);
}

function compileEvidenceForLLM(params: {
  evidence: LeadResearchAgentEvidence[];
  contacts: AgentContact[];
  officialWebsite: string | null;
}): {
  officialWebsite: string | null;
  safety: {
    hasOfficialWebsite: boolean;
    hasVerifiedBusinessOwnedEmail: boolean;
    verifiedBusinessEmails: string[];
  };
  contacts: Array<{
    type: AgentContact["type"];
    value: string;
    verificationStatus: AgentContact["verificationStatus"];
    confidence: AgentConfidence;
    isBusinessOwned: boolean;
    sourceUrl?: string | null;
  }>;
  evidence: Array<{
    url: string;
    sourceType: AgentSourceType;
    confidence: AgentConfidence;
    isOfficialCandidate: boolean;
    relationship?: string[];
  }>;
  facts: BusinessFact[];
  incompleteResearch: boolean;
  missingFields: string[];
} {
  const verifiedBusinessEmails = params.contacts
    .filter(
      (contact) =>
        contact.type === "email" &&
        contact.verificationStatus === "verified" &&
        contact.isBusinessOwned
    )
    .map((contact) => contact.value)
    .slice(0, 5);

  const typedFacts = collectBusinessFacts(params.evidence);
  if (typeof (typedFacts as unknown) === "string") {
    throw new Error("compileLLMContext must return typed array, not raw text");
  }
  const rankedFacts = rankBusinessFactsForEmail(typedFacts, 5);
  const missingFields = [
    rankedFacts.some((fact) => fact.category === "payment_model") ? "" : "payment_model",
    rankedFacts.some((fact) => fact.category === "services_offered") ? "" : "services_offered",
  ].filter(Boolean);

  return {
    officialWebsite: params.officialWebsite,
    safety: {
      hasOfficialWebsite: !!params.officialWebsite,
      hasVerifiedBusinessOwnedEmail: verifiedBusinessEmails.length > 0,
      verifiedBusinessEmails,
    },
    contacts: params.contacts.slice(0, 12).map((contact) => ({
      type: contact.type,
      value: contact.value,
      verificationStatus: contact.verificationStatus,
      confidence: contact.confidence,
      isBusinessOwned: contact.isBusinessOwned,
      sourceUrl: contact.sourceUrl,
    })),
    evidence: params.evidence.slice(0, 6).map((item) => ({
      url: item.url,
      sourceType: item.sourceType,
      confidence: item.confidence,
      isOfficialCandidate: item.isOfficialCandidate,
      relationship: item.extractedFacts.relationship?.slice(0, 2),
    })),
    facts: rankedFacts.map((fact) => ({
      ...fact,
      fact: truncateText(fact.fact, 180),
    })),
    incompleteResearch: missingFields.length > 0,
    missingFields,
  };
}

async function reasonWithLLM(params: {
  provider: AIProviderLike;
  companyName: string;
  niche: string | null;
  location: string;
  officialWebsite: string | null;
  evidence: LeadResearchAgentEvidence[];
  contacts: AgentContact[];
}): Promise<{ decision: LeadResearchAgentDecision; model: string }> {
  if (!["groq", "openai"].includes(params.provider.provider)) {
    throw new Error("Agent reasoning supports Groq/OpenAI-compatible providers in v1.");
  }
  const model = resolveGenerationModel(params.provider.provider, params.provider.active_model);
  const url =
    params.provider.provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : "https://api.groq.com/openai/v1/chat/completions";
  const system = `You are a conservative lead research agent for cold outreach.
Return ONLY JSON matching:
leadType email_ready|review|phone_only|rejected,
officialWebsite string|null, bestEmail string|null, evidenceSummary string,
confidence high|medium|low, risk low|medium|high,
recommendedAction auto_queue|draft|review|phone_only|rejected,
emailAngle string, draftAllowed boolean, autoSendAllowed boolean, reason string.
Rules:
- Never treat directory/social pages as official websites.
- Never invent emails, domains, services, awards, staff, or revenue.
- Use the structured facts array for reasoning; do not rely on raw page text.
- Auto-send only if a verified business-owned email and official/candidate site evidence exist.
- Related branch evidence may allow drafting, but must be review-only unless the exact branch is confirmed.
- Directory/social/search evidence may support a draft, but risky leads need review.`;
  const compactEvidence = compileEvidenceForLLM({
    evidence: params.evidence,
    contacts: params.contacts,
    officialWebsite: params.officialWebsite,
  });
  let prompt = JSON.stringify(
    {
      companyName: params.companyName,
      niche: params.niche,
      location: params.location,
      ...compactEvidence,
    },
    null,
    2
  );
  if (prompt.length > 9_000) {
    prompt = prompt.slice(0, 8_950) + "\n}";
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.provider.api_key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 650,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    if (res.status === 413) {
      throw new AgentReasoningError(
        `Agent reasoning failed 413: ${text.slice(0, 180)}`,
        413,
        "Groq token limit hit: evidence was too large. Agent used deterministic fallback."
      );
    }
    if (res.status === 429) {
      throw new AgentReasoningError(
        `Agent reasoning failed 429: ${text.slice(0, 180)}`,
        429,
        "Groq rate limit hit. Job will retry later."
      );
    }
    throw new AgentReasoningError(
      `Agent reasoning failed ${res.status}: ${text.slice(0, 180)}`,
      res.status,
      `AI reasoning failed (${res.status}). Agent used deterministic fallback.`
    );
  }
  const data = await res.json();
  const parsed = decisionSchema.parse(extractJsonObject(data.choices[0].message.content));
  return { decision: parsed, model };
}

export async function runLeadResearchAgent(input: {
  userId: string;
  leadId?: string;
  companyName: string;
  location: string | null;
  niche: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  aiProvider?: AIProviderLike | null;
  supabase?: SupabaseClient;
}): Promise<LeadResearchAgentResult> {
  const toolCalls: LeadResearchAgentResult["toolCalls"] = [];
  const normalized = await runAgentSkill({
    traces: toolCalls,
    name: "normalizeInput",
    input: {
      companyName: input.companyName,
      location: input.location,
      website: input.website,
      email: input.email,
      phone: input.phone,
    },
    run: () => {
      const location = sanitizeLocationForSearch(input.location);
      const queries = buildAgentSearchQueries({
        companyName: input.companyName,
        location,
        website: input.website,
        phone: input.phone,
        email: input.email,
      });
      return {
        output: {
          companyName: input.companyName.trim(),
          location,
          website: input.website ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          queries,
        },
        confidence: "high" as AgentConfidence,
        warnings: location || !input.location ? [] : ["Location looked like listing text and was ignored."],
      };
    },
  });
  const location = String(normalized.location ?? "");
  const queries = normalized.queries as string[];
  console.log(`[lead-agent] start: ${input.companyName}`);
  console.log(`[lead-agent] search plan: ${queries.join(" | ")}`);

  const hits: SearchHit[] = [];
  for (const query of queries) {
    try {
      const google = await fetchGoogleHtml(query, location);
      const parsed = parseGoogleHits(google.html, 10);
      console.log(`[lead-agent] searchWeb google: "${query}" -> ${parsed.length} hit(s) via ${google.via}`);
      hits.push(...parsed);
      recordAgentSkill({
        traces: toolCalls,
        name: "searchWeb",
        input: { provider: "google", query },
        output: { hits: parsed.length, via: google.via, blocked: google.blocked },
        ok: true,
        confidence: parsed.length ? "high" : "low",
      });
    } catch (error) {
      console.warn(
        `[lead-agent] searchWeb google failed: "${query}" -> ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      recordAgentSkill({
        traces: toolCalls,
        name: "searchWeb",
        input: { provider: "google", query },
        output: { error: error instanceof Error ? error.message : String(error) },
        ok: false,
        confidence: "low",
        warnings: ["Google search failed; continuing with direct fetch if possible."],
      });
    }
    if (hits.length >= 16) break;
  }

  const evidence = dedupeHits(hits)
    .filter((hit) => relevantHit(hit, input.companyName, location))
    .slice(0, 10)
    .map((hit) => {
      const extractedFacts = extractContacts(`${hit.title} ${hit.snippet} ${hit.url}`);
      const sourceType = classifySource(hit.url);
      const official = isOfficialCandidate(hit, input.companyName);
      const relationship = evidenceRelationship(hit, input.companyName);
      const businessFacts =
        official && hit.snippet
          ? extractBusinessFactsFromPage(`${hit.title}. ${hit.snippet}`, hit.url)
          : [];
      return {
        title: hit.title,
        url: hit.url,
        snippet: hit.snippet,
        sourceType: official ? "official_site" : sourceType,
        confidence:
          official && relationship === "exact"
            ? "high"
            : official || relationship === "related_branch"
              ? "medium"
              : sourceType === "directory"
                ? "medium"
                : "low",
        isOfficialCandidate: official,
        extractedFacts: {
          ...extractedFacts,
          relationship: [relationship],
          facts: businessFacts.map((fact) => fact.fact),
          businessFacts,
        } as LeadResearchAgentEvidence["extractedFacts"],
      } satisfies LeadResearchAgentEvidence;
    });
  recordAgentSkill({
    traces: toolCalls,
    name: "classifySource",
    input: { hits: hits.length, companyName: input.companyName, location },
    output: {
      relevantEvidence: evidence.length,
      officialCandidates: evidence.filter((item) => item.isOfficialCandidate).length,
      sourceTypes: Array.from(new Set(evidence.map((item) => item.sourceType))),
    },
    confidence: evidence.some((item) => item.isOfficialCandidate) ? "medium" : "low",
  });

  const inputWebsite =
    input.website && !isDirectoryUrl(input.website) ? input.website : null;
  const officialCandidateUrl = evidence.find(
    (hit) => hit.isOfficialCandidate && !isDirectoryUrl(hit.url)
  )?.url;
  const officialWebsite =
    originFromUrl(inputWebsite) ||
    originFromUrl(officialCandidateUrl) ||
    null;
  const indexedPages = evidence
    .filter((item) => officialWebsite && hostFromUrl(item.url) === hostFromUrl(officialWebsite))
    .map((item) => item.url);

  if (officialWebsite) {
    try {
      const fetched = await fetchTargetedPages({
        officialWebsite,
        fallbackPages: indexedPages,
      });
      console.log(
        `[lead-agent] fetchTargetedPages: ${officialWebsite} -> ${
          fetched.evidence.length ? "usable" : "empty"
        } (${fetched.fetchedUrls.length} page(s), ${fetched.evidence.reduce(
          (sum, item) => sum + (item.extractedFacts.businessFacts?.length ?? 0),
          0
        )} fact(s))`
      );
      recordAgentSkill({
        traces: toolCalls,
        name: "fetchTargetedPages",
        input: { domain: hostFromUrl(officialWebsite), fallbackPages: indexedPages.slice(0, 6) },
        output: {
          usable: fetched.evidence.length > 0,
          attempted: fetched.attemptedUrls.length,
          pages: fetched.fetchedUrls,
          skipped: fetched.skippedUrls.length,
          evidenceItems: fetched.evidence.length,
          facts: fetched.evidence.reduce(
            (sum, item) => sum + (item.extractedFacts.businessFacts?.length ?? 0),
            0
          ),
          emails: fetched.contacts.emails.length,
          phones: fetched.contacts.phones.length,
        },
        ok: fetched.evidence.length > 0,
        confidence: fetched.evidence.length ? "high" : "low",
      });
      if (fetched.evidence.length) {
        evidence.unshift(...fetched.evidence);
        recordAgentSkill({
          traces: toolCalls,
          name: "extractBusinessFacts",
          input: { pages: fetched.fetchedUrls.length },
          output: {
            evidenceItems: fetched.evidence.length,
            facts: fetched.evidence.reduce(
              (sum, item) => sum + (item.extractedFacts.businessFacts?.length ?? 0),
              0
            ),
            typedFacts: collectBusinessFacts(fetched.evidence).slice(0, 10),
          },
          confidence: "high",
        });
      }
    } catch (error) {
      console.warn(
        `[lead-agent] fetchTargetedPages failed: ${officialWebsite} -> ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      recordAgentSkill({
        traces: toolCalls,
        name: "fetchTargetedPages",
        input: { domain: hostFromUrl(officialWebsite) },
        output: { error: error instanceof Error ? error.message : String(error) },
        ok: false,
        confidence: "low",
        warnings: ["Official candidate page could not be fetched."],
      });
    }
  }
  console.log(
    `[lead-agent] evidence: ${evidence.length} relevant, official candidate: ${
      officialWebsite ?? "none"
    }`
  );

  const contactSeeds = new Map<
    string,
    { value: string; sourceUrl: string | null; type: "email" | "phone" | "social" | "website" }
  >();
  if (input.email) {
    const emailDomain = input.email.split("@")[1]?.toLowerCase() ?? "";
    const officialHost = officialWebsite ? hostFromUrl(officialWebsite) : null;
    const emailSource =
      officialHost &&
      !isDirectoryUrl(officialWebsite) &&
      (officialHost === emailDomain ||
        officialHost.endsWith(`.${emailDomain}`) ||
        emailDomain.endsWith(officialHost))
        ? officialWebsite
        : null;
    contactSeeds.set(`email:${input.email.toLowerCase()}`, {
      type: "email",
      value: input.email,
      sourceUrl: emailSource,
    });
  }
  if (input.phone) contactSeeds.set(`phone:${input.phone}`, { type: "phone", value: input.phone, sourceUrl: null });
  for (const item of evidence) {
    for (const email of item.extractedFacts.emails) {
      contactSeeds.set(`email:${email}`, { type: "email", value: email, sourceUrl: item.url });
    }
    for (const phone of item.extractedFacts.phones) {
      contactSeeds.set(`phone:${phone}`, { type: "phone", value: phone, sourceUrl: item.url });
    }
    for (const social of item.extractedFacts.socials) {
      contactSeeds.set(`social:${social}`, { type: "social", value: social, sourceUrl: item.url });
    }
  }
  if (officialWebsite) {
    contactSeeds.set(`website:${officialWebsite}`, {
      type: "website",
      value: officialWebsite,
      sourceUrl: officialWebsite,
    });
  }
  recordAgentSkill({
    traces: toolCalls,
    name: "extractContacts",
    input: { evidenceItems: evidence.length, hadInputEmail: !!input.email, hadInputPhone: !!input.phone },
    output: {
      seeds: contactSeeds.size,
      emails: Array.from(contactSeeds.values()).filter((seed) => seed.type === "email").length,
      phones: Array.from(contactSeeds.values()).filter((seed) => seed.type === "phone").length,
      socials: Array.from(contactSeeds.values()).filter((seed) => seed.type === "social").length,
    },
    confidence: contactSeeds.size ? "medium" : "low",
  });

  const contacts: AgentContact[] = [];
  for (const seed of contactSeeds.values()) {
    if (seed.type === "email") {
      contacts.push(
        await verifyEmail(
          seed.value,
          seed.sourceUrl,
          input.userId,
          input.supabase,
          officialWebsite
        )
      );
    } else {
      contacts.push({
        type: seed.type,
        value: seed.value,
        sourceUrl: seed.sourceUrl,
        sourceType: seed.sourceUrl ? classifySource(seed.sourceUrl) : null,
        verificationStatus: "unverified",
        confidence: seed.type === "phone" ? "medium" : "low",
        isBusinessOwned: seed.type === "phone",
        isPrimary: false,
      });
    }
  }
  recordAgentSkill({
    traces: toolCalls,
    name: "verifyOwnership",
    input: { officialWebsite, contacts: contacts.length },
    output: {
      verifiedEmails: contacts.filter(
        (contact) => contact.type === "email" && contact.verificationStatus === "verified"
      ).length,
      businessOwnedEmails: contacts.filter(
        (contact) => contact.type === "email" && contact.isBusinessOwned
      ).length,
      phones: contacts.filter((contact) => contact.type === "phone").length,
    },
    confidence: contacts.some((contact) => contact.type === "email" && contact.isBusinessOwned)
      ? "high"
      : contacts.some((contact) => contact.type === "email")
        ? "medium"
        : "low",
  });

  let decision = deterministicDecision({
    officialWebsite,
    contacts,
    evidence,
    phone: input.phone,
  });
  decision = safeDecision(decision, contacts, evidence, input.phone);
  recordAgentSkill({
    traces: toolCalls,
    name: "decideAction",
    input: { mode: "deterministic", officialWebsite, evidence: evidence.length, contacts: contacts.length },
    output: {
      recommendedAction: decision.recommendedAction,
      confidence: decision.confidence,
      risk: decision.risk,
      draftAllowed: decision.draftAllowed,
      autoSendAllowed: decision.autoSendAllowed,
      reason: decision.reason,
    },
    confidence: decision.confidence,
  });
  let modelUsed: string | null = null;
  if (input.aiProvider?.api_key) {
    try {
      console.log(`[lead-agent] reasonWithLLM: ${input.aiProvider.provider}`);
      const compactContext = compileEvidenceForLLM({ evidence, contacts, officialWebsite });
      recordAgentSkill({
        traces: toolCalls,
        name: "compileLLMContext",
        input: { evidence: evidence.length, contacts: contacts.length },
        output: {
          evidence: compactContext.evidence.length,
          facts: compactContext.facts.length,
          contacts: compactContext.contacts.length,
          hasOfficialWebsite: compactContext.safety.hasOfficialWebsite,
          hasVerifiedBusinessOwnedEmail: compactContext.safety.hasVerifiedBusinessOwnedEmail,
          incompleteResearch: compactContext.incompleteResearch,
          missingFields: compactContext.missingFields,
        },
        confidence: compactContext.incompleteResearch ? "medium" : "high",
        warnings: compactContext.incompleteResearch
          ? [`Incomplete research facts: ${compactContext.missingFields.join(", ")}`]
          : [],
      });
      const reasoned = await reasonWithLLM({
        provider: input.aiProvider,
        companyName: input.companyName,
        niche: input.niche,
        location,
        officialWebsite,
        evidence,
        contacts,
      });
      decision = safeDecision(reasoned.decision, contacts, evidence, input.phone);
      modelUsed = reasoned.model;
      recordAgentSkill({
        traces: toolCalls,
        name: "reasonWithLLM",
        input: { provider: input.aiProvider.provider, model: modelUsed },
        output: {
          recommendedAction: decision.recommendedAction,
          confidence: decision.confidence,
          risk: decision.risk,
          autoSendAllowed: decision.autoSendAllowed,
        },
        confidence: decision.confidence,
      });
      console.log(
        `[lead-agent] decision: ${decision.recommendedAction} confidence=${decision.confidence} risk=${decision.risk}`
      );
    } catch (error) {
      const userMessage =
        error instanceof AgentReasoningError
          ? error.userMessage
          : "AI reasoning failed. Agent used deterministic fallback.";
      console.warn(
        `[lead-agent] reasonWithLLM failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      decision = {
        ...decision,
        autoSendAllowed: false,
        reason: `${userMessage} ${decision.reason}`.slice(0, 500),
      };
      recordAgentSkill({
        traces: toolCalls,
        name: "reasonWithLLM",
        input: { provider: input.aiProvider.provider },
        output: {
          error: error instanceof Error ? error.message : String(error),
          userMessage,
          status: error instanceof AgentReasoningError ? error.status : null,
        },
        ok: false,
        confidence: "low",
        warnings: [userMessage],
      });
    }
  }

  for (const contact of contacts) {
    contact.isPrimary =
      (contact.type === "email" && contact.value === decision.bestEmail) ||
      (!decision.bestEmail && contact.type === "phone" && !!input.phone && contact.value === input.phone);
  }

  const result: LeadResearchAgentResult = {
    ...decision,
    evidence,
    contacts,
    toolCalls,
    modelUsed,
  };

  if (input.supabase && input.leadId) {
    await saveLeadResearchAgentResult(input.supabase, input.userId, input.leadId, result, {
      companyName: input.companyName,
      location,
      niche: input.niche,
      email: input.email,
    });
  }

  return result;
}

export async function saveLeadResearchAgentResult(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
  result: LeadResearchAgentResult,
  input: Record<string, unknown>
): Promise<string | null> {
  const inputEmail = typeof input.email === "string" ? input.email.toLowerCase() : null;
  const inputEmailNotOwned =
    !!inputEmail && !emailDomainMatchesWebsite(inputEmail, result.officialWebsite);

  const { data: run, error: runError } = await supabase
    .from("agent_runs")
    .insert({
      user_id: userId,
      lead_id: leadId,
      run_type: "research",
      status: "completed",
      input,
      output: {
        leadType: result.leadType,
        officialWebsite: result.officialWebsite,
        bestEmail: result.bestEmail,
        evidenceSummary: result.evidenceSummary,
        confidence: result.confidence,
        risk: result.risk,
        recommendedAction: result.recommendedAction,
        emailAngle: result.emailAngle,
        draftAllowed: result.draftAllowed,
        autoSendAllowed: result.autoSendAllowed,
        reason: result.reason,
      },
      tool_calls: result.toolCalls,
      model_used: result.modelUsed,
      search_cost: result.toolCalls.filter((call) => call.tool === "searchWeb" && call.ok).length,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (runError) {
    console.warn("[lead-agent] failed to save run:", runError.message);
    return null;
  }
  const runId = run.id as string;

  if (result.evidence.length) {
    await supabase.from("lead_evidence").insert(
      result.evidence.map((item) => ({
        user_id: userId,
        lead_id: leadId,
        agent_run_id: runId,
        source_type: item.sourceType,
        source_url: item.url,
        title: item.title,
        snippet: item.snippet,
        extracted_facts: item.extractedFacts,
        confidence: item.confidence,
        is_official_candidate: item.isOfficialCandidate,
      }))
    );
  }

  await supabase
    .from("contact_points")
    .delete()
    .eq("user_id", userId)
    .eq("lead_id", leadId)
    .eq("contact_type", "phone");

  for (const contact of result.contacts) {
    if (contact.type === "phone" && !isPlausiblePhone(contact.value)) continue;
    await supabase.from("contact_points").upsert(
      {
        user_id: userId,
        lead_id: leadId,
        agent_run_id: runId,
        contact_type: contact.type === "website" ? "website" : contact.type,
        value: contact.value,
        source_url: contact.sourceUrl ?? null,
        source_type: contact.sourceType ?? null,
        verification_status: contact.verificationStatus,
        confidence: contact.confidence,
        is_business_owned: contact.isBusinessOwned,
        is_primary: contact.isPrimary,
      },
      { onConflict: "user_id,lead_id,contact_type,value" }
    );
  }

  const leadUpdates: Record<string, unknown> = {
    agent_confidence: result.confidence,
    agent_risk: result.risk,
    agent_recommended_action: result.recommendedAction,
    agent_email_angle: result.emailAngle,
    agent_draft_allowed: result.draftAllowed,
    agent_auto_send_allowed: result.autoSendAllowed,
    agent_last_run_at: new Date().toISOString(),
    automation_score:
      result.confidence === "high" ? 90 : result.confidence === "medium" ? 70 : 45,
    automation_fit_reason: result.reason,
    automation_risk: result.risk,
    automation_recommended_action: result.recommendedAction,
    automation_review_required: !result.autoSendAllowed,
    automation_last_scored_at: new Date().toISOString(),
    ...(result.officialWebsite ? { website: result.officialWebsite } : {}),
  };
  if (result.bestEmail) {
    leadUpdates.email = result.bestEmail;
    leadUpdates.email_confidence = result.confidence;
  } else if (inputEmailNotOwned) {
    leadUpdates.email = null;
    leadUpdates.email_confidence = "low";
  }

  await supabase
    .from("leads")
    .update(leadUpdates)
    .eq("id", leadId)
    .eq("user_id", userId);

  return runId;
}

export function serializeLeadResearchAgent(result: LeadResearchAgentResult): string {
  const businessFacts = rankBusinessFactsForEmail(
    collectBusinessFacts(result.evidence),
    8
  );
  const lines = [
    "[AGENT_RESEARCH]",
    `Official website: ${result.officialWebsite ?? "not found"}`,
    `Best email: ${result.bestEmail ?? "not found"}`,
    `Confidence: ${result.confidence}`,
    `Risk: ${result.risk}`,
    `Recommended action: ${result.recommendedAction}`,
    `Draft allowed: ${result.draftAllowed ? "yes" : "no"}`,
    `Auto-send allowed: ${result.autoSendAllowed ? "yes" : "no"}`,
    `Reason: ${result.reason}`,
  ];
  if (result.evidenceSummary) lines.push(`Summary: ${result.evidenceSummary}`);
  if (result.emailAngle) lines.push(`Email angle: ${result.emailAngle}`);
  if (businessFacts.length) {
    lines.push("Business facts:");
    lines.push(JSON.stringify(businessFacts, null, 2));
  }
  lines.push("[/AGENT_RESEARCH]");
  return lines.join("\n");
}
