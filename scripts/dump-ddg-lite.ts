import { writeFileSync } from 'fs';

async function main() {
  const q = 'pizza Kigali';
  const html = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122' },
  }).then((r) => r.text());
  writeFileSync('ddg-lite-sample.html', html);
  console.log('written', html.length, 'rows', (html.match(/class="result"/g) || []).length);
}

main();
