/**
 * Diagnose Bing / DDG HTML fetch + parsing.
 * npx tsx scripts/test-bing-ddg.ts
 */

const ua =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function testBing(query: string) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=50`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': ua,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15_000),
  });
  const html = await res.text();
  const blocks =
    html.match(/<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>[\s\S]*?<\/li>/gi) ?? [];
  const blocked =
    /captcha|challenges\.bing|verify you are human|unusual traffic/i.test(html);
  console.log('\n--- Bing ---');
  console.log('status:', res.status, 'bytes:', html.length);
  console.log('b_algo blocks:', blocks.length, 'blocked signals:', blocked);
  if (blocks[0]) {
    const title = blocks[0].match(/<h2[^>]*>.*?<a[^>]*>(.*?)<\/a>/i)?.[1];
    console.log('first title:', title?.replace(/<[^>]+>/g, '').trim().slice(0, 80));
  } else {
    console.log('no b_algo — snippet:', html.slice(0, 400).replace(/\s+/g, ' '));
  }
}

async function testDdg(query: string) {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'User-Agent': ua,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html',
    },
    body: `q=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(15_000),
  });
  const html = await res.text();
  const ok = res.status === 200 && html.includes('result__a');
  const blocks =
    html.match(/<div class="result[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi) ?? [];
  console.log('\n--- DDG html ---');
  console.log('status:', res.status, 'bytes:', html.length, 'result__a:', ok);
  console.log('result blocks:', blocks.length);
  if (!ok) console.log('snippet:', html.slice(0, 400).replace(/\s+/g, ' '));

  const lite = await fetch(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(15_000) }
  );
  const liteHtml = await lite.text();
  const liteRows = liteHtml.match(/<tr class="result">[\s\S]*?<\/tr>/gi) ?? [];
  console.log('\n--- DDG lite ---');
  console.log('status:', lite.status, 'bytes:', liteHtml.length, 'rows:', liteRows.length);
}

async function main() {
  const queries = process.argv[2]
    ? [process.argv[2]]
    : [
        'logistics company Kigali Rwanda contact email',
        'logistics Kigali Rwanda',
        'restaurant Nyarugenge Kigali',
      ];
  for (const query of queries) {
    console.log('\n======== Query:', query);
    await testBing(query);
    await testDdg(query);
  }
}

main().catch(console.error);
