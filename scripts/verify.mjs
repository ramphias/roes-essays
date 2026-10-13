#!/usr/bin/env node
// ROES Essays — limited verification.
// Against dist/ and source-manifest.json:
//   1. integrity: every listed source file is byte-identical to its
//      approved sha256 (split: zh+en per approved snapshot; bilingual: file)
//   2. the 5 expected pages exist
//   3. per page: html lang, canonical, hreflang alternates, <title>,
//      description, og:url / og:image / og:type / published_time,
//      viewport, no noindex
//   4. language purity: English essay bodies contain no Han ideographs;
//      Chinese bodies contain Han
//   5. verbatim order-preserving inclusion: every source block of the
//      page's language appears in the rendered body, words unchanged
//      (emphasis markers and list numbers are structural, stripped on
//      both sides; whitespace/punctuation-adjacent normalized)
//   6. split-mode strong parity: every source **span** renders as
//      <strong>span</strong> in the page, counts match exactly, the
//      paragraph positions of the spans are identical across zh/en, and
//      the English page has no fully-bolded paragraph
//   7. links: every internal <a href> resolves to a file in dist/;
//      every external href is on the roes.pro allow-list (or the contact
//      mailto); no tracking query strings
// Exits non-zero on any failure; prints exact counts.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const SITE_BASE = 'https://ramphias.github.io/roes-essays';
const ROES = 'https://roes.pro';

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

let pass = 0;
let fail = 0;
const failures = [];
function check(ok, label) {
  if (ok) { pass += 1; console.log(`  ok  ${label}`); }
  else { fail += 1; failures.push(label); console.log(`  FAIL ${label}`); }
}

// --- helpers ----------------------------------------------------------------

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}
const CJK_CLASS = '\\u3400-\\u9fff\\uf900-\\ufaff\\u3000-\\u303f\\uff00-\\uffef';
const norm = (s) => s
  .split('\n')
  .map((l) => l.replace(/^\d+\.\s+/, ''))
  .join(' ')
  .replace(/\*\*/g, '')
  .replace(/\*/g, '')
  .replace(/\s+/g, ' ')
  // Tag boundaries sit where markdown markers sat (zero width): “</strong>，”
  // or “称为<strong>递归…” would otherwise compare with a phantom space. The
  // same normalizations apply to BOTH sides.
  .replace(/\s+([.,;:!?。，？！；：、）】》」』…%])/g, '$1')
  .replace(/([（【《「『([])\s+/g, '$1')
  .replace(new RegExp(`([${CJK_CLASS}]) (?=[${CJK_CLASS}])`, 'g'), '$1')
  .trim();

// Blocks with lines preserved (same semantics as scripts/build.mjs).
function parseBlocks(markdown) {
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      const text = para.join('\n').trim();
      blocks.push({ type: 'p', lang: HAN.test(text) ? 'zh' : 'en', text, lines: para.slice() });
      para = [];
    }
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (/^---\s*$/.test(line)) { flush(); blocks.push({ type: 'hr' }); continue; }
    if (line.startsWith('# ')) { flush(); blocks.push({ type: 'h1', lang: HAN.test(line) ? 'zh' : 'en', text: line.slice(2).trim() }); continue; }
    if (line.startsWith('## ')) { flush(); blocks.push({ type: 'h2', lang: 'zh', text: line.slice(3).trim() }); continue; }
    para.push(line);
  }
  flush();
  return blocks;
}

function essayBody(html) {
  const m = html.match(/<div class="essay-body">([\s\S]*?)<\/div>/);
  return m ? m[1] : '';
}

// --- run --------------------------------------------------------------------

const manifest = JSON.parse(readFileSync(join(ROOT, 'source-manifest.json'), 'utf8'));

console.log('[1] manuscript integrity (approved snapshots, byte-identical)');
const articles = [];
for (const a of manifest.articles) {
  if (a.mode === 'split') {
    for (const lang of ['zh', 'en']) {
      const digest = sha256(readFileSync(join(ROOT, a.files[lang])));
      check(digest === a.sha256[lang], `${a.files[lang]} sha256 ${digest === a.sha256[lang] ? 'match' : `MISMATCH ${digest}`}`);
    }
    const zhBlocks = parseBlocks(readFileSync(join(ROOT, a.files.zh), 'utf8'));
    const enBlocks = parseBlocks(readFileSync(join(ROOT, a.files.en), 'utf8'));
    articles.push({
      mode: 'split',
      dated: a.slug,
      date: a.date,
      zhTitle: a.zh_title,
      enTitle: (enBlocks.find((b) => b.type === 'h1') || {}).text || '',
      zhBlocks,
      enBlocks,
    });
  } else {
    const digest = sha256(readFileSync(join(ROOT, a.file)));
    check(digest === a.sha256, `${a.file} sha256 ${digest === a.sha256 ? 'match' : `MISMATCH ${digest}`}`);
    const blocks = parseBlocks(readFileSync(join(ROOT, a.file), 'utf8'));
    articles.push({
      mode: 'bilingual',
      dated: a.slug,
      date: a.date,
      zhTitle: (blocks.find((b) => b.type === 'h1' && b.lang === 'zh') || {}).text || '',
      enTitle: (blocks.find((b) => b.type === 'h1' && b.lang === 'en') || {}).text || '',
      blocks,
    });
  }
}

console.log('[2] expected pages exist');
const pagePaths = ['index.html', ...articles.flatMap((a) => [`${a.dated}/index.html`, `en/${a.dated}/index.html`])];
for (const p of pagePaths) check(existsSync(join(DIST, p)), `dist/${p} exists`);

const ALLOWED_EXTERNAL = new Set([
  'https://roes.pro/',
  'https://roes.pro/about/blog',
  'https://roes.pro/about/blog/en',
  ...articles.map((a) => `${ROES}/about/blog/${a.dated}`),
  ...articles.map((a) => `${ROES}/about/blog/en/${a.dated}`),
  'mailto:evolve@roes.pro',
]);

function resolveInternal(fromDistPath, href) {
  const dirParts = fromDistPath.split('/').slice(0, -1);
  const hrefParts = href.split('/').filter((x) => x !== '' && x !== '.');
  for (const part of hrefParts) {
    if (part === '..') dirParts.pop();
    else dirParts.push(part);
  }
  let p = dirParts.join('/');
  if (p === '') p = 'index.html';
  else if (!p.endsWith('.html')) p = `${p}/index.html`;
  return normalize(p).split(sep).join('/');
}

function checkLinks(fromDistPath, html) {
  const hrefs = [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]);
  for (const href of hrefs) {
    if (href.startsWith('mailto:')) {
      check(ALLOWED_EXTERNAL.has(href), `${fromDistPath}: mailto allowed (${href})`);
      continue;
    }
    if (/^https?:/.test(href)) {
      check(ALLOWED_EXTERNAL.has(href), `${fromDistPath}: external href allowed (${href})`);
      continue;
    }
    const resolved = resolveInternal(fromDistPath, href);
    check(existsSync(join(DIST, resolved)), `${fromDistPath}: internal ${href} -> dist/${resolved}`);
  }
}

for (const a of articles) {
  for (const lang of ['zh', 'en']) {
    const distPath = lang === 'zh' ? `${a.dated}/index.html` : `en/${a.dated}/index.html`;
    const html = readFileSync(join(DIST, distPath), 'utf8');
    const title = lang === 'zh' ? a.zhTitle : a.enTitle;
    const canonical = lang === 'zh' ? `${ROES}/about/blog/${a.dated}` : `${ROES}/about/blog/en/${a.dated}`;
    const pageUrl = `${SITE_BASE}/${lang === 'zh' ? `${a.dated}/` : `en/${a.dated}/`}`;
    console.log(`[3-${lang}] ${distPath}`);

    check((html.match(/<html[^>]*lang="([^"]*)"/) || [])[1] === (lang === 'zh' ? 'zh-Hans' : 'en'), 'html lang');
    check((html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1] === canonical, `canonical = ${canonical}`);
    const altZh = (html.match(/hreflang="zh-Hans" href="([^"]*)"/) || [])[1];
    const altEn = (html.match(/hreflang="en" href="([^"]*)"/) || [])[1];
    check(altZh === `${SITE_BASE}/${a.dated}/`, `hreflang zh-Hans -> ${altZh}`);
    check(altEn === `${SITE_BASE}/en/${a.dated}/`, `hreflang en -> ${altEn}`);
    const pageTitle = (html.match(/<title>([^<]*)<\/title>/) || [])[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    check(pageTitle === `${title} · ROES Essays`, `<title> = ${title} · ROES Essays`);
    check(/<meta name="description" content="[^"]{20,}"/.test(html), 'description present (>=20 chars)');
    check((html.match(/property="og:url" content="([^"]*)"/) || [])[1] === pageUrl, `og:url = ${pageUrl}`);
    check((html.match(/property="og:image" content="([^"]*)"/) || [])[1] === 'https://roes.pro/og.png', 'og:image = https://roes.pro/og.png');
    check((html.match(/property="og:type" content="([^"]*)"/) || [])[1] === 'article', 'og:type = article');
    check((html.match(/property="article:published_time" content="([^"]*)"/) || [])[1] === a.date, `article:published_time = ${a.date}`);
    check(!/name="robots"/i.test(html), 'no robots meta (indexable, canonical consistent)');
    check(/<meta name="viewport" content="width=device-width/.test(html), 'viewport meta');

    const body = essayBody(html);
    const bodyText = norm(stripTags(body));
    const hanCount = (bodyText.match(HAN) || []).length;
    if (lang === 'en') check(hanCount === 0, `english body free of Han ideographs (found ${hanCount})`);
    else check(hanCount > 0, `chinese body contains Han (${hanCount})`);

    console.log(`[4-${lang}] verbatim inclusion (${distPath})`);
    const h1 = (html.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1];
    check(norm(stripTags(h1)) === norm(title), 'h1 = language title');
    const source = a.mode === 'split'
      ? (lang === 'zh' ? a.zhBlocks : a.enBlocks)
      : a.blocks;
    let cursor = -1;
    let ordered = true;
    const missing = [];
    for (const b of source) {
      if (b.type !== 'p') continue;
      if (a.mode === 'bilingual' && b.lang !== lang) continue;
      const want = norm(b.text);
      const at = bodyText.indexOf(want);
      if (at === -1) { missing.push(want.slice(0, 40)); continue; }
      if (at < cursor) ordered = false;
      cursor = at;
    }
    check(missing.length === 0, `all ${lang} paragraph blocks present verbatim${missing.length ? ` — MISSING: ${missing.join(' | ')}` : ''}`);
    check(ordered, 'blocks appear in source order');

    if (a.mode === 'split') {
      console.log(`[5-${lang}] strong parity vs approved snapshot (${distPath})`);
      const spans = [];
      let pOrdinal = -1;
      source.forEach((b) => {
        if (b.type !== 'p') return;
        pOrdinal += 1;
        for (const m of b.text.matchAll(/\*\*([^*]+)\*\*/g)) spans.push({ text: m[1], pos: pOrdinal });
      });
      const strongs = [...body.matchAll(/<strong>([\s\S]*?)<\/strong>/g)].map((m) => m[1]);
      check(strongs.length === spans.length, `strong count = source span count (${strongs.length} vs ${spans.length})`);
      const wanted = spans.map((s) => norm(s.text));
      const got = strongs.map((s) => norm(s));
      for (const w of wanted) check(got.includes(w), `strong present: ${w.slice(0, 44)}`);
      if (lang === 'en') {
        check(!/<p><strong>[^<]*<\/strong><\/p>/.test(body), 'no fully-bolded english paragraph');
        a._enSpanPositions = spans.map((s) => s.pos);
        if (a._zhSpanPositions) {
          check(JSON.stringify(a._enSpanPositions) === JSON.stringify(a._zhSpanPositions),
            `span paragraph positions identical across zh/en (zh ${JSON.stringify(a._zhSpanPositions)} vs en ${JSON.stringify(a._enSpanPositions)})`);
        }
      } else {
        a._zhSpanPositions = spans.map((s) => s.pos);
      }
    }

    console.log(`[6-${lang}] links (${distPath})`);
    checkLinks(distPath, html);
  }
}

console.log('[3-index] dist/index.html');
const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8');
check((indexHtml.match(/<html[^>]*lang="([^"]*)"/) || [])[1] === 'en', 'index html lang = en (English-first root)');
const indexTitle = (indexHtml.match(/<title>([^<]*)<\/title>/) || [])[1];
check(indexTitle === 'ROES Essays', 'index <title> = ROES Essays');
check((indexHtml.match(/property="og:title" content="([^"]*)"/) || [])[1] === 'ROES Essays', 'index og:title = ROES Essays');
check((indexHtml.match(/<link rel="canonical" href="([^"]*)"/) || [])[1] === `${SITE_BASE}/`, 'index self-canonical (root URL unchanged)');
check((indexHtml.match(/property="og:url" content="([^"]*)"/) || [])[1] === `${SITE_BASE}/`, 'index og:url');
for (const a of articles) {
  check(indexHtml.includes(`href="en/${a.dated}/"`), `index primary english reading en/${a.dated}/`);
  check(indexHtml.includes(`href="${a.dated}/"`), `index chinese entry reachable ${a.dated}/`);
  check(indexHtml.includes(`${ROES}/about/blog/en/${a.dated}`), `index links english original ${a.dated}`);
}
const byDateDesc = [...articles].sort((x, y) => y.date.localeCompare(x.date));
for (let i = 0; i + 1 < byDateDesc.length; i += 1) {
  check(indexHtml.indexOf(`en/${byDateDesc[i].dated}/`) < indexHtml.indexOf(`en/${byDateDesc[i + 1].dated}/`),
    `index ordering newest-first: ${byDateDesc[i].date} before ${byDateDesc[i + 1].date}`);
}
console.log('[6-index] links');
checkLinks('index.html', indexHtml);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('FAILED checks:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
