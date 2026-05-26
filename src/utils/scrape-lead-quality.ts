/**
 * Filters junk scrape results (directory pages, search titles, platform emails, wrong geography).
 */

const JUNK_COMPANY_PATTERNS = [
  /^list of /i,
  /^top \d+/i,
  /^best \d+/i,
  /^\d+ (best|top|leading)/i,
  /^\d+ types of /i,
  /types of warehouses/i,
  /complete guide/i,
  /what is a warehouse/i,
  /by regions in /i,
  /in supply chain management/i,
  /creating your own/i,
  /alternate history map/i,
  /^(all|the) /i,
  /businesses in /i,
  /find emails and phone/i,
  /warehouse for rent/i,
  /for rent in/i,
  /^contact us$/i,
  /^contact$/i,
  /^europe$/i,
  / - wikipedia$/i,
  /^https?:\/\//i,
  /\| .+(page|site|web)/i,
  /operativess in /i,
  /warehousing and storage in /i,
  /logistics by regions/i,
  /companies in serbia/i,
  /in belgrade/i,
  /surroundings/i,
];

/** Domains that are directories/platforms — not the business itself */
const JUNK_EMAIL_DOMAINS = [
  "courierslist.com",
  "zoominfo.com",
  "africabizinfo.com",
  "yellowpages.com",
  "yelp.com",
  "hotfrog.com",
  "bbb.org",
  "facebook.com",
  "linkedin.com",
  "google.com",
  "wikipedia.org",
  "hunter.io",
  "rocketreach.co",
  "apollo.io",
  "lusha.com",
  "datanyze.com",
  "crunchbase.com",
  "cybo.com",
  "aeroleads.com",
  "inboundlogistics.com",
  "mapchart.net",
  "keyslogistics.com",
  "tejassoftware.com",
  "blog.mapchart.net",
  "cbre.com",
];

const JUNK_WEBSITE_DOMAINS = [
  ...JUNK_EMAIL_DOMAINS,
  "bing.com",
  "duckduckgo.com",
];

const FREE_PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

/** If the search targets this region, reject pages mentioning these places (unless local tokens also match) */
const FOREIGN_PLACE_HINTS = [
  "serbia",
  "belgrade",
  "central serbia",
  "europe",
  "united states",
  "uk ",
  " united kingdom",
  "germany",
  "france",
  "india",
  "china",
  "australia",
  "canada",
  "mexico",
  "brazil",
];

const RWANDA_LOCAL_HINTS = [
  "kigali",
  "rwanda",
  "gikondo",
  "nyarugenge",
  "kicukiro",
  "remera",
  "gasabo",
  "kimihurura",
  "magerwa",
  "dp world",
];

/** Bing/Google titles — articles, guides, directory pages — not a business name */
export function isSearchResultTitle(name: string): boolean {
  const lower = name.toLowerCase().trim();
  if (lower.length < 3) return true;
  if (JUNK_COMPANY_PATTERNS.some((p) => p.test(lower))) return true;
  if (/\d+\s+types?\s+of/i.test(lower)) return true;
  if (/complete guide|what is a |what are the|how to /i.test(lower)) return true;
  if (/:\s*.+(uses|guide|management|regions)/i.test(lower)) return true;
  if (/\|/.test(name) && !/kigali|rwanda/i.test(lower)) return true;
  if ((lower.match(/\s+/g) ?? []).length >= 9) return true;
  const foreignInTitle = FOREIGN_PLACE_HINTS.some((p) => lower.includes(p));
  const localInTitle =
    /kigali|rwanda|gikondo|magerwa|\.rw\b/i.test(lower);
  if (foreignInTitle && !localInTitle) return true;
  return false;
}

export function isJunkCompanyName(name: string): boolean {
  return isSearchResultTitle(name);
}

function hostnameFromUrl(url: string): string | null {
  try {
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    return new URL(normalized).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Maps / search result links are stored in source_url — not the business site */
const NON_BUSINESS_WEBSITE_HOSTS = new Set(["maps.google.com"]);

/** System/automated local-parts — not useful for cold outreach */
const JUNK_EMAIL_PREFIXES = [
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'bounce',
  'mailer-daemon',
  'postmaster',
  'daemon',
  'automated',
  'notification',
  'notifications',
  'newsletter',
  'marketing',
  'promo',
  'promotions',
  'billing',
  'invoice',
  'receipts',
  'orders',
];

export function isJunkEmail(email: string): boolean {
  const lower = email.toLowerCase().trim();
  const prefix = lower.split('@')[0] ?? '';
  const domain = lower.split('@')[1] ?? '';
  if (!domain) return true;

  if (
    JUNK_EMAIL_PREFIXES.some(
      (p) => prefix === p || prefix.startsWith(`${p}.`) || prefix.startsWith(p)
    )
  ) {
    return true;
  }

  return JUNK_EMAIL_DOMAINS.some(
    (d) => domain === d || domain.endsWith(`.${d}`)
  );
}

export function isJunkWebsite(url: string | undefined | null): boolean {
  if (!url) return false;
  const host = hostnameFromUrl(url);
  if (!host || NON_BUSINESS_WEBSITE_HOSTS.has(host)) return false;
  return JUNK_WEBSITE_DOMAINS.some(
    (d) => host === d || host.endsWith(`.${d}`)
  );
}

/** Reject null, undefined, or very short company names */
export function isValidCompanyName(name: string | null | undefined): boolean {
  const trimmed = (name ?? "").trim();
  return trimmed.length >= 3;
}

/** Parse "Kigali, Rwanda" → ["kigali", "rwanda"] */
export function parseLocationTokens(targetLocation: string): string[] {
  return targetLocation
    .toLowerCase()
    .split(/[,;|/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

function emailMatchesWebsiteDomain(
  email: string,
  website: string | undefined
): boolean {
  if (!website) return true;
  const emailDomain = email.split("@")[1]?.toLowerCase();
  const host = hostnameFromUrl(website)?.replace(/^www\./, "");
  if (!emailDomain || !host) return true;
  return (
    host === emailDomain ||
    host.endsWith(`.${emailDomain}`) ||
    emailDomain.endsWith(host)
  );
}

function isFreePersonalEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && FREE_PERSONAL_EMAIL_DOMAINS.has(domain);
}

/**
 * Require scraped businesses to plausibly be in the target city/country.
 * Bing/DDG often return global articles even when the query includes "Kigali".
 */
export function leadMatchesTargetLocation(
  targetLocation: string,
  fields: {
    company_name: string;
    business_address?: string;
    source_snippet?: string;
    website?: string;
    email?: string;
  }
): boolean {
  const tokens = parseLocationTokens(targetLocation);
  if (tokens.length === 0) return true;

  const blob = [
    fields.company_name,
    fields.business_address,
    fields.source_snippet,
    fields.website,
    fields.email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const isRwandaSearch = tokens.some(
    (t) => t.includes("rwanda") || t.includes("kigali")
  );

  if (isRwandaSearch) {
    const hasLocal =
      tokens.some((t) => blob.includes(t)) ||
      RWANDA_LOCAL_HINTS.some((h) => blob.includes(h)) ||
      /\.rw\b/i.test(blob) ||
      /@([a-z0-9-]+\.)*rw\b/i.test(blob);

    const hasForeign = FOREIGN_PLACE_HINTS.some((p) => blob.includes(p));
    if (hasForeign && !hasLocal) return false;
    if (!hasLocal) return false;
  } else {
    const hasToken = tokens.some((t) => blob.includes(t));
    if (!hasToken) {
      const hasForeign = FOREIGN_PLACE_HINTS.some((p) => blob.includes(p));
      if (hasForeign) return false;
    }
  }

  return true;
}

/**
 * Validate the lead's `location` field against the search target (not Maps pin / query echo alone).
 */
export function scrapedLeadLocationFieldMatchesTarget(
  targetLocation: string,
  leadLocation: string,
  fields: {
    company_name: string;
    business_address?: string;
    source_snippet?: string;
    website?: string;
    email?: string;
  }
): boolean {
  const loc = (leadLocation ?? "").trim();
  if (!loc || loc === "Not in search area") return false;

  const targetNorm = targetLocation.trim().toLowerCase();
  const locNorm = loc.toLowerCase();

  const addr = fields.business_address?.trim() ?? "";
  const hasConcreteAddress =
    addr.length > 3 && addr.toLowerCase() !== targetNorm;

  if (locNorm === targetNorm && !hasConcreteAddress) {
    return leadMatchesTargetLocation(targetLocation, {
      company_name: fields.company_name,
      business_address: addr || undefined,
      source_snippet: fields.source_snippet,
      website: fields.website,
      email: fields.email,
    });
  }

  return leadMatchesTargetLocation(targetLocation, {
    company_name: fields.company_name,
    business_address: loc,
    source_snippet: fields.source_snippet,
    website: fields.website,
    email: fields.email,
  });
}

/** Set `location` to business address or validated display — not the raw search query on every row */
export function normalizeScrapedLeadLocation(
  fields: {
    business_address?: string;
    source_snippet?: string;
    company_name: string;
    website?: string;
    email?: string;
  },
  searchLocation: string
): string {
  const addr = fields.business_address?.trim();
  if (addr && addr.length > 3) {
    if (
      scrapedLeadLocationFieldMatchesTarget(searchLocation, addr, {
        company_name: fields.company_name,
        business_address: addr,
        source_snippet: fields.source_snippet,
        website: fields.website,
        email: fields.email,
      })
    ) {
      return addr;
    }
  }

  const display = getLeadDisplayLocation(
    {
      location: searchLocation,
      business_address: addr,
      company_name: fields.company_name,
    },
    searchLocation
  );
  if (display === "Not in search area") return display;

  if (
    scrapedLeadLocationFieldMatchesTarget(searchLocation, display, {
      company_name: fields.company_name,
      business_address: addr,
      source_snippet: fields.source_snippet,
      website: fields.website,
      email: fields.email,
    })
  ) {
    return display;
  }

  return "Not in search area";
}

export type ScrapedLeadQualityInput = {
  company_name: string;
  email?: string;
  phone?: string;
  website?: string;
  source_url?: string;
  business_address?: string;
  source_snippet?: string;
  location?: string;
  phoneOnly?: boolean;
  company_context?: string;
  niche?: string;
};

/** Normalize location + drop invalid leads before emit/insert */
export function finalizeScrapedLead<T extends ScrapedLeadQualityInput>(
  lead: T,
  searchLocation: string
): (T & { location: string }) | null {
  if (!isValidCompanyName(lead.company_name)) return null;
  if (!lead.email?.trim() || lead.email === "pending@local") return null;

  const location = normalizeScrapedLeadLocation(
    {
      business_address: lead.business_address,
      source_snippet: lead.source_snippet,
      company_name: lead.company_name,
      website: lead.website,
      email: lead.email,
    },
    searchLocation
  );

  if (location === "Not in search area") return null;

  return { ...lead, location };
}

/** Maps / scrape row with phone but no email — CRM call_list lane */
export function finalizePhoneOnlyScrapeLead<T extends ScrapedLeadQualityInput>(
  lead: T,
  searchLocation: string
): (T & { location: string; phoneOnly: true; email: string }) | null {
  if (!isValidCompanyName(lead.company_name)) return null;
  const phone = lead.phone?.trim();
  if (!phone || phone.length < 6) return null;
  if (lead.email?.trim() && lead.email !== 'pending@local') return null;

  const location = normalizeScrapedLeadLocation(
    {
      business_address: lead.business_address,
      source_snippet: lead.source_snippet,
      company_name: lead.company_name,
      website: lead.website,
      email: lead.email,
    },
    searchLocation
  );

  if (location === 'Not in search area') return null;
  if (isJunkCompanyName(lead.company_name)) return null;
  if (isJunkWebsite(lead.website)) return null;

  return {
    ...lead,
    location,
    phoneOnly: true,
    email: '',
    company_context:
      lead.source_snippet?.trim() ||
      `${lead.company_name.trim()} — phone contact from Maps (no email found yet).`,
  };
}

export function isJunkScrapeLead(
  lead: ScrapedLeadQualityInput,
  targetLocation: string
): boolean {
  if (!isValidCompanyName(lead.company_name)) return true;
  if (isJunkCompanyName(lead.company_name)) return true;
  if (lead.phoneOnly) {
    if (isJunkWebsite(lead.website)) return true;
  } else {
    if (!lead.email?.trim() || isJunkEmail(lead.email)) return true;
    if (isJunkWebsite(lead.website)) return true;
    if (
      !emailMatchesWebsiteDomain(lead.email, lead.website) &&
      !isFreePersonalEmail(lead.email)
    ) {
      return true;
    }
  }

  const leadLocation =
    lead.location?.trim() ||
    normalizeScrapedLeadLocation(
      {
        business_address: lead.business_address,
        source_snippet: lead.source_snippet,
        company_name: lead.company_name,
        website: lead.website,
        email: lead.email,
      },
      targetLocation
    );

  if (
    !scrapedLeadLocationFieldMatchesTarget(targetLocation, leadLocation, {
      company_name: lead.company_name,
      business_address: lead.business_address,
      source_snippet: lead.source_snippet,
      website: lead.website,
      email: lead.email,
    })
  ) {
    return true;
  }

  return false;
}

/** What to show in the Location column (not the search query on every row). */
export function getLeadDisplayLocation(
  lead: {
    location: string;
    business_address?: string;
    company_name: string;
  },
  searchLocation: string
): string {
  const addr = lead.business_address?.trim();
  if (addr && addr.length > 3) return addr;

  const name = lead.company_name.toLowerCase();
  const tokens = parseLocationTokens(searchLocation);
  const localInName =
    tokens.some((t) => name.includes(t)) ||
    RWANDA_LOCAL_HINTS.some((h) => name.includes(h));
  const foreignInName = FOREIGN_PLACE_HINTS.some((p) => name.includes(p));
  if (foreignInName && !localInName) return "Not in search area";
  return searchLocation;
}
