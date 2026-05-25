async function main() {
  const q = encodeURIComponent('logistics Kigali Rwanda');
  const res = await fetch(`https://search.brave.com/search?q=${q}`, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(15_000),
  });
  const h = await res.text();
  console.log('status', res.status, 'len', h.length);
  console.log('snippet', h.includes('snippet'), 'result', h.includes('result'));
}

main().catch(console.error);
