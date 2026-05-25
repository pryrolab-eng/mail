/**
 * Batch AI Email Generator
 * Generates emails for multiple leads in a SINGLE API call.
 * This avoids Groq's 30 req/min rate limit entirely.
 */

interface LeadInput {
  id: string;
  company_name: string;
  niche: string | null;
  location: string | null;
  company_context: string | null;
  email: string | null;
}

interface BatchEmailResult {
  lead_id: string;
  subject: string;
  body: string;
}

interface BatchGenerationParams {
  leads: LeadInput[];
  yourCompany: string;
  yourService: string;
  tone: 'Direct' | 'Aggressive' | 'Surgical';
  customPainPoint?: string;
  userId: string;
}

const TONE_INSTRUCTIONS = {
  Direct: `TONE: HARD DIRECT. No greetings. No "reaching out". No fluff.
STRUCTURE per email (80-120 words):
- Subject: specific problem they face
- Line 1: state the problem immediately
- Line 2: one sentence on what ${'{yourService}'} does
- Line 3: one concrete result/timeframe
- Line 4: direct CTA — "15-minute call this week?"`,

  Aggressive: `TONE: HIGH URGENCY. Pattern-interrupting. Creates FOMO.
STRUCTURE per email (120-160 words):
- Subject: bold provocative problem statement
- Open with a costly problem + quantify it (time/money wasted)
- Show how ${'{yourService}'} solves it specifically
- Create urgency: limited availability or deadline
- CTA: "Are you open to a 20-minute call this week — yes or no?"`,

  Surgical: `TONE: HYPER-PERSONALIZED. Proves you did your homework.
STRUCTURE per email (150-200 words):
- Subject: reference something specific about their business
- Open referencing their specific context or industry challenge
- Connect to a challenge that naturally follows
- Explain how ${'{yourService}'} addresses that exact challenge
- Consultative CTA — feels like a natural next step`,
};

/**
 * Generate emails for up to 60 leads in a single API call.
 * Falls back to per-lead generation if batch fails.
 */
export async function generateEmailsBatch(
  params: BatchGenerationParams
): Promise<BatchEmailResult[]> {
  const { leads, yourCompany, yourService, tone, customPainPoint, userId } = params;

  // Fetch AI provider once
  const providerRes = await fetch(`/api/ai-provider?userId=${userId}`);
  if (!providerRes.ok) {
    throw new Error('No active AI provider configured. Please set up AI in Settings.');
  }
  const aiProvider = await providerRes.json();

  const toneGuide = TONE_INSTRUCTIONS[tone]
    .replace(/\$\{['"]?yourService['"]?\}/g, yourService);

  // Build a compact lead list for the prompt
  const leadList = leads.map((l, i) => {
    const web = (l as { website?: string }).website;
    return `[${i + 1}] id:${l.id} | company:${l.company_name} | niche:${l.niche || 'unknown'} | location:${l.location || 'unknown'}${web ? ` | website:${web}` : ''} | research:${(l.company_context || '').slice(0, 200)}`;
  }).join('\n');

  const prompt = `You are an elite B2B cold email copywriter. Generate one personalized cold email per lead below.

=== SENDER ===
Company: ${yourCompany}
Service: ${yourService}
${customPainPoint ? `Pain point to address: ${customPainPoint}` : ''}

=== TONE INSTRUCTIONS ===
${toneGuide}

=== LEADS (${leads.length} total) ===
${leadList}

=== CRITICAL RULES ===
- Write exactly ${leads.length} emails, one per lead
- Use ONLY facts from each lead's research line — never invent awards, posts, or metrics
- Open with a specific observation or honest industry question (90–120 words per body)
- Explain ${yourCompany} as ERP/business software replacing spreadsheets and scattered tools
- NO "I hope this email finds you well", NO "reaching out", NO "I came across"
- One soft CTA: 10-minute call

=== OUTPUT FORMAT (strict JSON, no extra text) ===
Return a JSON array with exactly ${leads.length} objects:
[
  {
    "lead_id": "<exact id from lead list>",
    "subject": "<subject line>",
    "body": "<email body with \\n for line breaks>"
  },
  ...
]`;

  let rawResponse = '';

  try {
    if (aiProvider.provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aiProvider.api_key}`,
        },
        body: JSON.stringify({
          model: aiProvider.active_model || 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a B2B cold email copywriter. Always respond with valid JSON only — no markdown, no explanation.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.75,
          max_tokens: 200 * leads.length, // ~200 tokens per email
        }),
      });
      if (!res.ok) throw new Error(`OpenAI error: ${res.statusText}`);
      const data = await res.json();
      rawResponse = data.choices[0].message.content;

    } else if (aiProvider.provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': aiProvider.api_key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: aiProvider.active_model || 'claude-3-5-sonnet-20241022',
          max_tokens: 200 * leads.length,
          system: 'You are a B2B cold email copywriter. Always respond with valid JSON only — no markdown, no explanation.',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`Anthropic error: ${res.statusText}`);
      const data = await res.json();
      rawResponse = data.content[0].text;

    } else if (aiProvider.provider === 'groq') {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aiProvider.api_key}`,
        },
        body: JSON.stringify({
          model: aiProvider.active_model || 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'You are a B2B cold email copywriter. Always respond with valid JSON only — no markdown, no explanation, no code fences.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.75,
          max_tokens: Math.min(8000, 150 * leads.length), // Groq has token limits
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        if (res.status === 429) throw new Error('rate_limit');
        throw new Error(`Groq error (${res.status}): ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      rawResponse = data.choices[0].message.content;

    } else {
      throw new Error(`Unsupported AI provider: ${aiProvider.provider}`);
    }

    // Parse JSON response
    const parsed = parseEmailBatch(rawResponse, leads);
    return parsed;

  } catch (err: any) {
    if (err.message === 'rate_limit') throw err; // Let caller handle
    console.error('Batch generation error:', err);
    throw err;
  }
}

/**
 * Parse the AI's JSON response into structured results.
 * Handles common issues like markdown code fences.
 */
function parseEmailBatch(raw: string, leads: LeadInput[]): BatchEmailResult[] {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  let parsed: any[];
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to extract JSON array from the response
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('AI returned invalid JSON — could not parse email batch');
    parsed = JSON.parse(match[0]);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('AI returned non-array response');
  }

  // Validate and fill in any missing entries
  const results: BatchEmailResult[] = [];
  const parsedById = new Map(parsed.map(p => [p.lead_id, p]));

  for (const lead of leads) {
    const entry = parsedById.get(lead.id);
    if (entry && entry.subject && entry.body) {
      results.push({
        lead_id: lead.id,
        subject: String(entry.subject).trim(),
        body: String(entry.body).trim(),
      });
    } else {
      // Fallback for any lead the AI missed
      results.push({
        lead_id: lead.id,
        subject: `Quick question about ${lead.company_name}`,
        body: `Hi,\n\nI noticed ${lead.company_name} in ${lead.location || 'your area'} and wanted to reach out.\n\nWe help ${lead.niche || 'businesses'} with ${'{yourService}'}.\n\nWould you be open to a quick call?\n\nBest,\n${'{yourCompany}'}`,
      });
    }
  }

  return results;
}

/**
 * Split leads into chunks that fit within Groq's token limit.
 * Groq: ~8k output tokens max → ~50 emails per batch safely.
 */
export function chunkLeads(leads: LeadInput[], chunkSize = 20): LeadInput[][] {
  const chunks: LeadInput[][] = [];
  for (let i = 0; i < leads.length; i += chunkSize) {
    chunks.push(leads.slice(i, i + chunkSize));
  }
  return chunks;
}
