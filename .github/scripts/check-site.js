/* בדיקת תקינות לאתר התבניות — רץ אוטומטית בכל העלאה (GitHub Actions), ואפשר גם ידנית:
   node .github/scripts/check-site.js index.html
   נכשל (exit 1) אם משהו נשבר: שגיאות JS, לשוניות ריקות/מקוננות, סכומים שלא הוחלפו, העתקה שלא עובדת ועוד. */
const path = require('path');
const { chromium, devices } = require('playwright');

const FILE = path.resolve(process.argv[2] || 'index.html');
/* מיכלי תוכן שחייבים להכיל לפחות כרטיס אחד, ולא להיות מקוננים זה בתוך זה */
const CONTAINERS = [
  'refund-panel-students', 'refund-panel-shorttrain', 'refund-panel-trum', 'refund-panel-claim', 'refund-panel-docs',
  'eiva-panel-terror', 'eiva-panel-family', 'eiva-panel-kids', 'eiva-panel-deptquery',
  'therapists', 'routing', 'consent', 'admin'
];
const MIN_CARDS = 40;

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  const profiles = [
    ['מחשב', { viewport: { width: 1440, height: 900 } }],
    ['נייד', { ...devices['iPhone 13'] }]
  ];
  for (const [name, opt] of profiles) {
    const ctx = await browser.newContext(opt);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + FILE);
    await page.waitForTimeout(2000);
    errs.forEach(e => problems.push(`[${name}] שגיאת JS: ${e}`));

    const r = await page.evaluate((CONTAINERS) => {
      const out = [];
      const cards = document.querySelectorAll('.card');
      const nested = document.querySelectorAll('.card .card');
      if (nested.length) out.push(`${nested.length} כרטיסים מקוננים בתוך כרטיס אחר (תגית סגירה חסרה?)`);
      const els = {};
      CONTAINERS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) { out.push(`מיכל חסר: #${id}`); return; }
        els[id] = el;
        if (!el.querySelector('.card')) out.push(`מיכל ריק (אין כרטיסים): #${id}`);
      });
      Object.keys(els).forEach(a => Object.keys(els).forEach(b => {
        if (a !== b && els[a].contains(els[b])) out.push(`#${b} נמצא בתוך #${a} (מבנה שבור)`);
      }));
      const ids = {};
      document.querySelectorAll('[id]').forEach(el => { ids[el.id] = (ids[el.id] || 0) + 1; });
      /* כפילות ידועה וותיקה, לא לחסום עליה */
      const KNOWN_DUP = ['refund-panel-eivarights'];
      Object.keys(ids).filter(k => ids[k] > 1 && KNOWN_DUP.indexOf(k) === -1).forEach(k => out.push(`id כפול: #${k}`));
      document.querySelectorAll('[onclick]').forEach(el => {
        const m = el.getAttribute('onclick').match(/(?:quickCopy|quickWa|quickMail|copyMsg|sendWhatsapp|sendEmail|sendFeedback|sendBetaFeedback)\('([^']+)'/);
        if (m && !document.getElementById(m[1])) out.push(`כפתור מפנה להודעה שלא קיימת: ${m[1]}`);
      });
      if (document.body.innerText.indexOf('{{') !== -1) {
        const t = document.body.innerText; const i = t.indexOf('{{');
        out.push('סכום שלא הוחלף מופיע בעמוד: ' + t.slice(i, i + 30));
      }
      if (typeof AMOUNTS === 'object') Object.keys(AMOUNTS).forEach(k => {
        const v = amtValue(k); if (typeof v !== 'number' || !isFinite(v) || v <= 0) out.push('סכום לא תקין במרכז הסכומים: ' + k);
      });
      if (typeof REFUND_DATA === 'object') {
        document.querySelectorAll('input[data-refund-tab]').forEach(c => { c.checked = true; });
        Object.keys(REFUND_DATA).forEach(t => {
          const txt = buildRefundText(t);
          if (!txt) out.push(`בונה הודעה מחזיר טקסט ריק: ${t}`);
          if (/undefined|NaN|\{\{|\$\{/.test(txt)) out.push(`בונה הודעה עם ערך שבור: ${t}`);
        });
      }
      return { out, cards: cards.length };
    }, CONTAINERS);
    r.out.forEach(p => problems.push(`[${name}] ${p}`));
    if (r.cards < MIN_CARDS) problems.push(`[${name}] רק ${r.cards} כרטיסים (מינימום ${MIN_CARDS}) — ייתכן שחלק מהתוכן נעלם`);

    /* העתקה עובדת בפועל (על כמה הודעות לדוגמה) */
    const copyFail = await page.evaluate(async () => {
      let last = null;
      try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { last = t; } }, configurable: true }); } catch (e) {}
      const bodies = [...document.querySelectorAll('.card:not([data-no-send]) .card-body[id]')].slice(0, 5);
      const bad = [];
      for (const b of bodies) {
        last = null;
        const btn = document.querySelector(`[onclick*="copyMsg('${b.id}'"]`) || document.createElement('button');
        try { await copyMsg(b.id, btn); } catch (e) { bad.push(b.id + ': ' + e.message); continue; }
        await new Promise(r => setTimeout(r, 50));
        if (!last || last.length < 10) bad.push(b.id);
      }
      return bad;
    });
    copyFail.forEach(id => problems.push(`[${name}] העתקה לא עבדה: ${id}`));

    /* חיפוש מחזיר תוצאות */
    const hits = await page.evaluate(() => { try { doSearch('קבלות'); } catch (e) { return -1; }
      const box = document.getElementById('searchResults'); return box ? box.querySelectorAll('*').length : -1; });
    if (hits <= 0) problems.push(`[${name}] החיפוש לא מחזיר תוצאות`);
    await ctx.close();
  }
  await browser.close();
  if (problems.length) {
    console.log('❌ נמצאו בעיות:\n' + problems.map(p => ' - ' + p).join('\n'));
    process.exit(1);
  }
  console.log('✅ האתר תקין: אין שגיאות, כל הלשוניות מלאות, העתקה וחיפוש עובדים (מחשב + נייד).');
})();
