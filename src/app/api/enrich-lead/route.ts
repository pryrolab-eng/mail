/**
 * /api/enrich-lead
 *
 * Given a company name + website/domain, this route:
 * 1. Visits the company's website and scrapes real content
 * 2. Extracts real email addresses from the page
 * 3. Builds a rich company_context from their About/Home page
 * 4. Returns enriched lead data
 *
 * Called before email generation so the AI has real info to work with.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../supabase/server";
import { createServiceClient } from "../../../../supabase/service";

// ─── Email extraction ─────────────────────────────────────────────────────────

function extractEmails(html: string): string[] {
  // Match mailto: links first (most reliable)
  const mailtoMatches = [...html.matchAll(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi)];
  const mailtoEmails = mailtoMatches.map((m) => m[1].toLowerCase());

  // Then match plain email patterns in text
  const textMatches = [...html.matchAll(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g)];
  const textEmails = textMatches
    .map((m) => m[1].toLowerCase())
    .filter((e) => {
      // Filter out image/asset emails and common false positives
      const domain = e.split("@")[1];
      return (
        !e.includes("example.com") &&
        !e.includes("sentry.io") &&
        !e.includes("wixpress.com") &&
        !e.includes("squarespace.com") &&
        !e.includes("@2x") &&
        !domain?.startsWith("png") &&
        !domain?.startsWith("jpg") &&
        domain?.includes(".")
      );
    });

  // Combine, deduplicate, prioritise mailto
  const all = [...new Set([...mailtoEmails, ...textEmails])];

  // Score: prefer info/contact/hello over noreply/support
  const score = (email: string) => {
    const local = email.split("@")[0];
    if (["info", "contact", "hello", "hi", "sales", "team"].includes(local)) return 3;
    if (["support", "help", "admin", "office"].includes(local)) return 2;
    if (local.includes("noreply") || local.includes("no-reply")) return -1;
    return 1;
  };

  return all.sort((a, b) => score(b) - score(a)).slice(0, 5);
}

// ─── Text extraction ──────────────────────────────────────────────────────────

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMetaDescription(html: string): string {
  const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  return match?.[1]?.trim() ?? "";
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim() ?? "";
}

// ─── Website fetcher ──────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ─── Domain guesser ───────────────────────────────────────────────────────────

function guessDomain(companyName: string): string {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 30);
}

// ─── Build rich context from scraped content ──────────────────────────────────

function buildContext(
  companyName: string,
  title: string,
  metaDesc: string,
  bodyText: string,
  niche: string,
  location: string
): string {
  const parts: string[] = [];

  if (metaDesc && metaDesc.length > 20) {
    parts.push(metaDesc);
  }

  // Extract first meaningful paragraph from body (skip nav/header noise)
  const sentences = bodyText
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 300)
    .filter((s) => !s.toLowerCase().includes("cookie"))
    .filter((s) => !s.toLowerCase().includes("javascript"))
    .filter((s) => s.toLowerCase().includes(companyName.toLowerCase().split(" ")[0].toLowerCase()) || parts.length === 0);

  if (sentences.length > 0) {
    parts.push(sentences.slice(0, 2).join(". ") + ".");
  }

  if (parts.length === 0) {
    // Fallback: use title
    parts.push(`${companyName} — ${title || `a ${niche} business in ${location}`}.`);
  }

  return parts.join(" ").slice(0, 500);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      leadId,
      companyName,
      website,
      niche = "",
      location = "",
    }: {
      leadId?: string;
      companyName: string;
      website?: string;
      niche?: string;
      location?: string;
    } = body;

    if (!companyName) {
      return NextResponse.json({ error: "companyName is required" }, { status: 400 });
    }

    // ── Build list of URLs to try ────────────────────────────────────────────
    const urlsToTry: string[] = [];

    if (website) {
      // Normalise — ensure it has a protocol
      const normalised = website.startsWith("http") ? website : `https://${website}`;
      urlsToTry.push(normalised);
      // Also try /contact page
      try {
        const base = new URL(normalised).origin;
        urlsToTry.push(`${base}/contact`);
        urlsToTry.push(`${base}/about`);
        urlsToTry.push(`${base}/contact-us`);
      } catch {}
    } else {
      // Guess domain from company name
      const slug = guessDomain(companyName);
      urlsToTry.push(`https://www.${slug}.com`);
      urlsToTry.push(`https://${slug}.com`);
      urlsToTry.push(`https://www.${slug}.com/contact`);
    }

    // ── Fetch pages ──────────────────────────────────────────────────────────
    let foundEmails: string[] = [];
    let richContext = "";
    let pageTitle = "";
    let successUrl = "";

    for (const url of urlsToTry) {
      const html = await fetchPage(url);
      if (!html) continue;

      successUrl = url;
      const emails = extractEmails(html);
      if (emails.length > 0 && foundEmails.length === 0) {
        foundEmails = emails;
      }

      // Build context from home/about page (not contact page)
      if (!url.includes("/contact") && !richContext) {
        const text = extractText(html);
        const meta = extractMetaDescription(html);
        const title = extractTitle(html);
        pageTitle = title;
        richContext = buildContext(companyName, title, meta, text, niche, location);
      }

      // Stop if we have both email and context
      if (foundEmails.length > 0 && richContext) break;
    }

    // ── Determine best email ─────────────────────────────────────────────────
    const bestEmail = foundEmails[0] ?? null;

    // ── Update lead in DB if leadId provided ─────────────────────────────────
    if (leadId) {
      const service = createServiceClient();
      const updates: Record<string, string> = {};

      if (bestEmail) updates.email = bestEmail;
      if (richContext) updates.company_context = richContext;
      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        await service
          .from("leads")
          .update(updates)
          .eq("id", leadId)
          .eq("user_id", user.id);
      }
    }

    return NextResponse.json({
      success: true,
      email: bestEmail,
      allEmails: foundEmails,
      company_context: richContext || null,
      pageTitle,
      sourceUrl: successUrl || null,
      enriched: !!(bestEmail || richContext),
    });
  } catch (err) {
    console.error("[/api/enrich-lead]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
