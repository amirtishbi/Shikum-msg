/* בדיקת קישורים חודשית — עובר על כל הקישורים החיצוניים שבאתר ובודק שהם עדיין עובדים.
   node .github/scripts/check-links.js index.html [report.md]
   כותב דוח Markdown, ויוצא עם קוד 2 אם נמצאו קישורים שבורים בוודאות (404/410/דומיין שלא קיים). */
const fs = require('fs');

const FILE = process.argv[2] || 'index.html';
const REPORT = process.argv[3] || 'link-report.md';
const SKIP = [/umami\.is/, /fonts\.(googleapis|gstatic)\.com/, /cdn(js)?\./, /jsdelivr/, /unpkg/, /^https?:\/\/wa\.me/,
  /api\.whatsapp\.com/, /schemas?\./, /w3\.org/, /example\.com/, /localhost/,
  /^http:\/\/x\//, /calendar\.google\.com/, /\$\{/];

const html = fs.readFileSync(FILE, 'utf8');
const raw = html.match(/https?:\/\/[^\s"'<>`\\)\]]+/g) || [];
const urls = [...new Set(raw.map(u => u.replace(/[.,;:!?»”]+$/, '').replace(/&amp;/g, '&')))]
  .filter(u => !SKIP.some(r => r.test(u)))
  .filter(u => { try { new URL(u); return true; } catch (e) { return false; } });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function probe(u) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(u, { method: 'GET', redirect: 'follow', signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'he,en;q=0.8' } });
    try { await res.body?.cancel(); } catch (e) {}
    return { status: res.status };
  } catch (e) {
    const code = (e.cause && e.cause.code) || e.name || 'ERR';
    return { status: 0, err: code };
  } finally { clearTimeout(t); }
}

function classify(r) {
  if (r.status >= 200 && r.status < 400) return 'ok';
  if (r.status === 404 || r.status === 410) return 'broken';
  if (r.status === 0 && /ENOTFOUND|EAI_AGAIN_NOPE/.test(r.err || '')) return 'broken';
  return 'unsure'; /* 403/429/5xx/timeout — הרבה אתרי ממשלה חוסמים בוטים; לבדוק ידנית */
}

(async () => {
  const results = [];
  const queue = urls.slice();
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const u = queue.shift();
      let r = await probe(u);
      if (classify(r) !== 'ok') { await new Promise(s => setTimeout(s, 3000)); r = await probe(u); }
      results.push({ u, ...r, kind: classify(r) });
    }
  });
  await Promise.all(workers);

  const broken = results.filter(r => r.kind === 'broken');
  const unsure = results.filter(r => r.kind === 'unsure');
  const line = r => `- ${r.u} — ${r.status || r.err}`;
  const md = [
    `נבדקו ${results.length} קישורים חיצוניים באתר.`,
    '',
    broken.length ? `### ❌ קישורים שבורים (${broken.length}) — צריך לתקן` : '### ✅ אין קישורים שבורים',
    ...broken.map(line),
    '',
    unsure.length ? `### ⚠️ לא הצלחתי לבדוק (${unsure.length}) — כדאי לפתוח ידנית` : '',
    unsure.length ? 'בדרך כלל אלה אתרים שחוסמים בדיקות אוטומטיות (למשל אתרי ממשלה), ולא בהכרח שבורים.' : '',
    ...unsure.map(line)
  ].join('\n');
  fs.writeFileSync(REPORT, md);
  console.log(md);
  process.exit(broken.length ? 2 : 0);
})();
