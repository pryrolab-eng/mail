export type SkillId =
  | "planResearch"
  | "searchWeb"
  | "fetchTargetedPages"
  | "extractBusinessFacts"
  | "extractOwnerName"
  | "extractContacts"
  | "verifyOwnership"
  | "compileLLMContext"
  | "reasonWithLLM"
  | "decideAction"
  | "writeEmail"
  | "validateOutput"
  | "reviewEmailSafety";

export type SkillConfidence = "high" | "medium" | "low";

export type SkillMetadata = {
  id: SkillId;
  name: string;
  version: string;
  description: string;
  trigger: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  rules: string[];
  enabled: boolean;
};

export type SkillTrace = {
  skillId: SkillId;
  tool: SkillId;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  ok: boolean;
  confidence?: SkillConfidence;
  warnings?: string[];
  durationMs: number;
};

export type SkillRunResult<TOutput extends Record<string, unknown>> = {
  output: TOutput;
  confidence?: SkillConfidence;
  warnings?: string[];
};

const objectSchema = (properties: Record<string, unknown> = {}) => ({
  type: "object",
  properties,
});

export const BUILT_IN_SKILLS: SkillMetadata[] = [
  {
    id: "planResearch",
    name: "Plan Research",
    version: "1.0.0",
    description: "Build an explicit lead research plan from available lead inputs and safety gates.",
    trigger: "research_start",
    inputSchema: objectSchema({ companyName: { type: "string" }, location: { type: "string" } }),
    outputSchema: objectSchema({ goal: { type: "string" }, steps: { type: "array" } }),
    rules: ["Prefer official evidence.", "Skip tools only when their inputs are unavailable.", "Record safety gates before LLM reasoning."],
    enabled: true,
  },
  {
    id: "searchWeb",
    name: "Search Web",
    version: "1.0.0",
    description: "Find official domains, indexed pages, and public snippets using Google-first discovery.",
    trigger: "research_start",
    inputSchema: objectSchema({ companyName: { type: "string" }, location: { type: "string" } }),
    outputSchema: objectSchema({ hits: { type: "number" }, officialCandidates: { type: "number" } }),
    rules: ["Use Google first.", "Prefer official domains over directories.", "Search snippets are evidence, not truth."],
    enabled: true,
  },
  {
    id: "fetchTargetedPages",
    name: "Fetch Targeted Pages",
    version: "1.0.0",
    description: "Fetch high-value official pages such as services, about, team, doctors, pricing, and contact.",
    trigger: "after_domain_found",
    inputSchema: objectSchema({ officialWebsite: { type: "string" }, fallbackPages: { type: "array" } }),
    outputSchema: objectSchema({ pages: { type: "array" }, evidenceItems: { type: "number" } }),
    rules: ["Never stop at only the homepage.", "Skip empty or blocked pages.", "Do not pass raw page text to email writing."],
    enabled: true,
  },
  {
    id: "extractBusinessFacts",
    name: "Extract Business Facts",
    version: "1.0.0",
    description: "Convert fetched page content into typed, sourced, sales-ranked facts.",
    trigger: "after_page_fetch",
    inputSchema: objectSchema({ pages: { type: "array" } }),
    outputSchema: objectSchema({ businessFacts: { type: "array" } }),
    rules: ["Every fact needs a source.", "Reject reviews, FAQ filler, and generic marketing.", "Use typed categories only."],
    enabled: true,
  },
  {
    id: "extractOwnerName",
    name: "Extract Owner Name",
    version: "1.0.0",
    description: "Find a named owner, founder, doctor, director, or primary decision maker from trusted evidence.",
    trigger: "after_fetchTargetedPages",
    inputSchema: objectSchema({ evidenceItems: { type: "number" } }),
    outputSchema: objectSchema({ ownerName: { type: "string" }, confidence: { type: "string" } }),
    rules: ["Never extract from reviews or testimonials.", "Never guess names.", "Missing or unverified names block auto-send."],
    enabled: true,
  },
  {
    id: "extractContacts",
    name: "Extract Contacts",
    version: "1.0.0",
    description: "Extract emails, labeled phones, social links, and official website contact points.",
    trigger: "after_evidence_collection",
    inputSchema: objectSchema({ evidenceItems: { type: "number" } }),
    outputSchema: objectSchema({ emails: { type: "number" }, phones: { type: "number" }, socials: { type: "number" } }),
    rules: ["Only accept labeled or tel: phone numbers.", "Filter markup number noise.", "Do not invent contacts."],
    enabled: true,
  },
  {
    id: "verifyOwnership",
    name: "Verify Ownership",
    version: "1.0.0",
    description: "Verify email ownership and auto-send eligibility using MX and domain matching.",
    trigger: "after_contact_extraction",
    inputSchema: objectSchema({ officialWebsite: { type: "string" }, contacts: { type: "number" } }),
    outputSchema: objectSchema({ verifiedEmails: { type: "number" }, businessOwnedEmails: { type: "number" } }),
    rules: ["Official-domain verified email is required for auto-send.", "Free emails are review-only.", "Suppression overrides AI."],
    enabled: true,
  },
  {
    id: "compileLLMContext",
    name: "Compile LLM Context",
    version: "1.0.0",
    description: "Rank and compress typed evidence before any reasoning or writing step.",
    trigger: "before_llm",
    inputSchema: objectSchema({ evidence: { type: "number" }, contacts: { type: "number" } }),
    outputSchema: objectSchema({ facts: { type: "number" }, missingFields: { type: "array" } }),
    rules: ["Return typed arrays only.", "Max 5 facts for email writing.", "Never pass raw page text."],
    enabled: true,
  },
  {
    id: "reasonWithLLM",
    name: "Reason With LLM",
    version: "1.0.0",
    description: "Ask Groq/OpenAI-compatible models for structured lead decisions while deterministic rules retain final authority.",
    trigger: "after_context_compile",
    inputSchema: objectSchema({ provider: { type: "string" }, model: { type: "string" } }),
    outputSchema: objectSchema({ recommendedAction: { type: "string" }, risk: { type: "string" } }),
    rules: ["Strict JSON only.", "LLM cannot authorize unsafe auto-send.", "413/429 fall back safely."],
    enabled: true,
  },
  {
    id: "decideAction",
    name: "Decide Action",
    version: "1.0.0",
    description: "Apply deterministic gates for auto_queue, review, phone_only, or rejected.",
    trigger: "after_verification",
    inputSchema: objectSchema({ evidence: { type: "number" }, contacts: { type: "number" } }),
    outputSchema: objectSchema({ recommendedAction: { type: "string" }, autoSendAllowed: { type: "boolean" } }),
    rules: ["Safety beats LLM recommendation.", "Low-confidence leads are review-only.", "No verified official-domain email means no auto-send."],
    enabled: true,
  },
  {
    id: "writeEmail",
    name: "Write Email",
    version: "1.0.0",
    description: "Write concise outreach from typed evidence only, then route through validation.",
    trigger: "after_research_approval",
    inputSchema: objectSchema({ evidence: { type: "array" }, senderProfile: { type: "object" } }),
    outputSchema: objectSchema({ subject: { type: "string" }, body: { type: "string" }, warnings: { type: "array" } }),
    rules: ["Use only typed businessFacts.", "No generic praise.", "Use escaped line breaks in JSON.", "3-5 short paragraphs."],
    enabled: true,
  },
  {
    id: "validateOutput",
    name: "Validate Output",
    version: "1.0.0",
    description: "Run deterministic email checks before repair, safety review, and routing.",
    trigger: "after_write_email",
    inputSchema: objectSchema({ subject: { type: "string" }, body: { type: "string" } }),
    outputSchema: objectSchema({ passed: { type: "boolean" }, failures: { type: "array" } }),
    rules: ["Reject Hi there.", "Reject forbidden claims and phrases.", "Repair once before human review."],
    enabled: true,
  },
  {
    id: "reviewEmailSafety",
    name: "Review Email Safety",
    version: "1.0.0",
    description: "Block unsupported claims, invented facts, vague praise, and unsafe assumptions before approval.",
    trigger: "after_write_email",
    inputSchema: objectSchema({ subject: { type: "string" }, body: { type: "string" }, facts: { type: "array" } }),
    outputSchema: objectSchema({ passed: { type: "boolean" }, failures: { type: "array" } }),
    rules: ["Recovered parser output still needs review.", "Unsupported claims go to review.", "Never bypass validation."],
    enabled: true,
  },
];

export function listSkills(): SkillMetadata[] {
  return BUILT_IN_SKILLS;
}

export function getSkill(id: string): SkillMetadata {
  const skill = BUILT_IN_SKILLS.find((item) => item.id === id);
  if (!skill) throw new Error(`Unknown skill: ${id}`);
  return skill;
}

export function isSkillId(id: string): id is SkillId {
  return BUILT_IN_SKILLS.some((item) => item.id === id);
}

export async function runSkill<TOutput extends Record<string, unknown>>(params: {
  id: SkillId;
  input: Record<string, unknown>;
  run: () => Promise<SkillRunResult<TOutput>> | SkillRunResult<TOutput>;
}): Promise<{ output: TOutput; trace: SkillTrace }> {
  getSkill(params.id);
  const started = Date.now();
  try {
    const result = await params.run();
    return {
      output: result.output,
      trace: {
        skillId: params.id,
        tool: params.id,
        input: params.input,
        output: result.output,
        ok: true,
        confidence: result.confidence,
        warnings: result.warnings,
        durationMs: Date.now() - started,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      output: { error: message } as unknown as TOutput,
      trace: {
        skillId: params.id,
        tool: params.id,
        input: params.input,
        output: { error: message },
        ok: false,
        confidence: "low",
        warnings: [message],
        durationMs: Date.now() - started,
      },
    };
  }
}
