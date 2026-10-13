#!/usr/bin/env node
// ROES Essays — static site builder.
// Source of truth is source-manifest.json. Two article modes:
//
//   split     — per-language source files (essays/<slug>.zh.md / .en.md);
//               zh verbatim, en with four semantic bolds at the same
//               paragraph positions as zh, no full-paragraph bolding.
//   bilingual — one interleaved manuscript (essays/<slug>.md) where blocks
//               containing Han ideographs render on the zh page and pure-
//               Latin blocks on the en page (the official blog's split
//               semantics).
//
// The build refuses to run unless every listed file matches its recorded
// sha256 (integrity gate). Rendering never rewrites words: it selects
// blocks by language, converts markdown emphasis markers (** -> <strong>,
// * -> <em>) and renders numbered lines as <ol>/<li> (list numbers are
// structural markers, re-provided by the browser like the official blog).
//
// Article canonical URLs point at the corresponding-language roes.pro
// original (dated URL form); the site is a reading mirror served from
// https://ramphias.github.io/roes-essays/ (relative links, base-path
// agnostic). Build is deterministic: no timestamps, no env-dependent text.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ESSAYS_DIR = join(ROOT, 'essays');
const DIST_DIR = join(ROOT, 'dist');

const SITE_BASE = 'https://ramphias.github.io/roes-essays';
const OG_IMAGE = 'https://roes.pro/og.png';
const ROES_HOME = 'https://roes.pro/';
const ROES_BLOG_ZH = 'https://roes.pro/about/blog';
const ROES_BLOG_EN = 'https://roes.pro/about/blog/en';
const CONTACT = 'evolve@roes.pro';

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;
const LIST_ITEM = /^\d+\.\s+(.*)$/;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// Split paragraphs into lines so numbered runs can become <ol>.
function parseLines(markdown) {
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) { out.push(para); para = []; }
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (/^---\s*$/.test(line)) { flush(); out.push(['\u0000HR']); continue; }
    if (line.startsWith('## ')) { flush(); out.push(['\u0000H2', line.slice(3).trim()]); continue; }
    if (line.startsWith('# ')) { flush(); out.push(['\u0000H1', line.slice(2).trim()]); continue; }
    para.push(line);
  }
  flush();
  return out;
}

// Bilingual manuscript: one interleaved markdown (official blog semantics).
function parseEssay(markdown) {
  const blocks = [];
  let zhTitle = '';
  let enTitle = '';
  for (const group of parseLines(markdown)) {
    if (group[0] === '\u0000HR') { blocks.push({ type: 'hr', lang: null }); continue; }
    if (group[0] === '\u0000H1') {
      const text = group[1];
      if (HAN.test(text) && !zhTitle) zhTitle = text;
      else if (!HAN.test(text) && !enTitle) enTitle = text;
      blocks.push({ type: 'h1', lang: HAN.test(text) ? 'zh' : 'en', text });
      continue;
    }
    if (group[0] === '\u0000H2') { blocks.push({ type: 'h2', lang: 'zh', text: group[1] }); continue; }
    const text = group.join('\n').trim();
    blocks.push({ type: 'p', lang: HAN.test(text) ? 'zh' : 'en', text, lines: group });
  }
  return { blocks, zhTitle, enTitle };
}

// Per-language approved file (split mode).
function parseBody(markdown) {
  const blocks = [];
  let h1 = '';
  for (const group of parseLines(markdown)) {
    if (group[0] === '\u0000HR') { blocks.push({ type: 'hr' }); continue; }
    if (group[0] === '\u0000H1') { h1 = group[1]; blocks.push({ type: 'h1', text: group[1] }); continue; }
    if (group[0] === '\u0000H2') { blocks.push({ type: 'h2', text: group[1] }); continue; }
    blocks.push({ type: 'p', text: group.join('\n').trim(), lines: group });
  }
  return { blocks, h1 };
}

// ---------------------------------------------------------------------------
// Inline rendering (markers only; words untouched)
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// Bilingual-mode en paragraphs are bold-wrapped as a source convention; the
// wrapper is a language marker, not emphasis — strip it (even when the inner
// text still carries its own emphasis), then render inner emphasis.
const fullWrapper = (text) => text.length > 4 && text.startsWith('**') && text.endsWith('**');
const stripWrapper = (text) => (fullWrapper(text) ? text.slice(2, -2) : text);

// A bilingual-mode en block that translates a zh `##` heading: fully
// bold-wrapped, no sentence punctuation, no arrows, few words, after the
// first `##`. Content like “**Who owns the intelligence delta?**” stays a
// paragraph.
function isEnSectionTitle(block, seenH2) {
  if (!seenH2 || block.type !== 'p' || block.lang !== 'en' || !fullWrapper(block.text)) return false;
  const inner = block.text.slice(2, -2);
  if (/[.?!…]/.test(inner) || inner.includes('→')) return false;
  return inner.split(/\s+/).length <= 6;
}

// Render one paragraph block: non-list lines -> <p>, consecutive numbered
// lines -> <ol><li> (numbers are structural markers, not words).
function renderParagraphBlock(block, lang, splitMode) {
  const parts = [];
  let listRun = [];
  const flushList = () => {
    if (listRun.length) {
      parts.push(`<ol>${listRun.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
      listRun = [];
    }
  };
  for (const line of block.lines) {
    const m = line.match(LIST_ITEM);
    if (m) { listRun.push(m[1]); continue; }
    flushList();
    const text = (!splitMode && lang === 'en') ? stripWrapper(line) : line;
    parts.push(`<p>${inline(text)}</p>`);
  }
  flushList();
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

const T = {
  zh: {
    htmlLang: 'zh-Hans',
    back: '返回文章目录',
    published: '原始发布',
    original: '官网原文',
    switchLabel: '语言',
    langZh: '中文',
    langEn: 'EN',
    essayKicker: '文章',
  },
  en: {
    htmlLang: 'en',
    back: 'Back to all essays',
    published: 'First published',
    original: 'Original on roes.pro',
    switchLabel: 'Language',
    langZh: '中文',
    langEn: 'EN',
    essayKicker: 'ESSAY',
  },
};
const MIRROR_NOTE = {
  zh: '本站是 ROES 公开文章的阅读镜像：文章原文与规范地址（canonical）属于 roes.pro，原稿完整保存于本仓库 essays/ 目录。',
  en: 'This site is a reading mirror of ROES public essays: roes.pro remains the original publication and canonical location; the source manuscripts are preserved verbatim under essays/ in this repository.',
};

const CSS = `:root{--paper:#f6f7f8;--surface:#fff;--ink:#171a20;--text-2:#4f5560;--muted:#737986;--line:#e5e7eb;--border-strong:#d6d9de;--violet:#6251d7;--violet-hover:#5946ca;--font-display:"Source Serif 4","Noto Serif SC","Source Han Serif SC","Noto Serif CJK SC","Songti SC","SimSun",Georgia,serif;--font-body:Inter,"Noto Sans SC","Source Han Sans SC","Noto Sans CJK SC","PingFang SC","Microsoft YaHei","Segoe UI",Arial,sans-serif;--font-mono:"IBM Plex Mono","Noto Sans Mono CJK SC",ui-monospace,Consolas,monospace}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--font-body);font-size:16px;line-height:1.75;overflow-wrap:break-word}
a{color:var(--violet);text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
a:hover{color:var(--violet-hover)}
a:focus-visible{outline:2px solid var(--violet);outline-offset:2px;border-radius:2px}
.wrap{max-width:42rem;margin:0 auto;padding:0 1.25rem}
.site-head{border-bottom:1px solid var(--line);background:var(--surface)}
.site-head .wrap{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;align-items:baseline;justify-content:space-between;padding-top:1rem;padding-bottom:1rem}
.wordmark{font-family:var(--font-mono);font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ink);text-decoration:none}
.wordmark:hover{color:var(--ink);text-decoration:underline}
.site-head nav{display:flex;gap:1rem;font-family:var(--font-mono);font-size:12px}
.site-head nav a[aria-current="page"]{color:var(--ink);font-weight:600;text-decoration:none;cursor:default}
.back{margin:2rem 0 0;font-family:var(--font-mono);font-size:12px}
article{padding:0 0 3rem}
.kicker{font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:2.25rem 0 .75rem}
h1{font-family:var(--font-display);font-size:clamp(26px,5.2vw,32px);font-weight:600;line-height:1.25;letter-spacing:-.01em;margin:0 0 1rem}
.meta{list-style:none;display:flex;flex-wrap:wrap;gap:.375rem 1.5rem;margin:0 0 2.5rem;padding:.875rem 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-family:var(--font-mono);font-size:12px;color:var(--muted)}
.meta time{color:var(--text-2)}
.essay-body h2{font-family:var(--font-display);font-size:22px;font-weight:600;line-height:1.3;letter-spacing:-.005em;margin:2.75rem 0 .875rem}
.essay-body p{margin:0 0 1.375rem;color:var(--ink)}
.essay-body ol{margin:0 0 1.375rem;padding-left:1.5rem}
.essay-body li{margin:0 0 .75rem}
.essay-body hr{border:0;border-top:1px solid var(--line);margin:3rem 0}
.essay-foot{margin-top:3rem;padding-top:1.25rem;border-top:1px solid var(--line);font-family:var(--font-mono);font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:.375rem 1.5rem}
.site-foot{border-top:1px solid var(--line);background:var(--surface);margin-top:2rem}
.site-foot .wrap{padding-top:1.5rem;padding-bottom:2.5rem;font-family:var(--font-mono);font-size:12px;color:var(--muted)}
.site-foot .links{display:flex;flex-wrap:wrap;gap:.375rem 1.25rem;margin:0 0 .75rem}
.site-foot .note{margin:0;max-width:42rem;line-height:1.7}
.index-intro{margin:2.5rem 0 0}
.index-intro p{margin:0 0 1rem;color:var(--text-2)}
.index-intro p[lang="zh-Hans"]{color:var(--muted)}
.essay-list{list-style:none;margin:2.5rem 0 3.5rem;padding:0}
.essay-list li{padding:2rem 0;border-top:1px solid var(--line)}
.essay-list li:last-child{border-bottom:1px solid var(--line)}
.essay-list .date{font-family:var(--font-mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 .625rem}
.essay-list h2{font-family:var(--font-display);font-size:22px;font-weight:600;line-height:1.3;margin:0 0 .25rem}
.essay-list h2 a{color:var(--ink);text-decoration:none}
.essay-list h2 a:hover{color:var(--violet);text-decoration:underline}
.essay-list .alt-title{font-family:var(--font-display);font-size:16px;font-weight:400;color:var(--muted);margin:0 0 1rem}
.essay-list .links{font-family:var(--font-mono);font-size:12px;display:flex;flex-wrap:wrap;gap:.375rem 1.25rem}
@media (max-width:640px){.meta{gap:.25rem 1rem}.essay-body h2{font-size:20px;margin-top:2.5rem}.essay-body hr{margin:2.5rem 0}}`;

function head({ title, description, canonical, alternates, og }) {
  const alt = alternates
    .map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}">`)
    .join('');
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
${alt}
<meta property="og:site_name" content="ROES Essays">
<meta property="og:title" content="${escapeHtml(og.title)}">
<meta property="og:description" content="${escapeHtml(og.description)}">
<meta property="og:type" content="${og.type}">
<meta property="og:url" content="${og.url}">
<meta property="og:image" content="${OG_IMAGE}">
${og.publishedTime ? `<meta property="article:published_time" content="${og.publishedTime}">` : ''}
<style>${CSS}</style>`;
}

function siteFooter() {
  return `<footer class="site-foot">
  <div class="wrap">
    <p class="links"><a href="${ROES_HOME}">ROES · roes.pro</a><a href="${ROES_BLOG_ZH}" lang="zh-Hans">中文目录</a><a href="${ROES_BLOG_EN}" lang="en">English</a><a href="mailto:${CONTACT}">${CONTACT}</a></p>
    <p class="note" lang="zh-Hans">© 2026 ROES · ${MIRROR_NOTE.zh}</p>
    <p class="note" lang="en" style="margin-top:.375rem">© 2026 ROES · ${MIRROR_NOTE.en}</p>
  </div>
</footer>`;
}

function bodyHtml(article, lang) {
  const splitMode = article.mode === 'split';
  const blocks = splitMode
    ? (lang === 'zh' ? article.zhBlocks : article.enBlocks)
    : article.blocks;

  if (splitMode) {
    return blocks
      .filter((b) => b.type !== 'h1')
      .map((b) => {
        if (b.type === 'hr') return '<hr>';
        if (b.type === 'h2') return `<h2>${inline(b.text)}</h2>`;
        return renderParagraphBlock(b, lang, true);
      })
      .filter(Boolean)
      .join('\n');
  }

  let seenH2 = false;
  return blocks
    .filter((b) => b.type !== 'h1')
    .map((b) => {
      if (b.type === 'hr') return '<hr>';
      if (b.type === 'h2') { seenH2 = true; return b.lang === lang ? `<h2>${inline(b.text)}</h2>` : null; }
      if (b.lang !== lang) return null;
      if (lang === 'en' && isEnSectionTitle(b, seenH2)) return `<h2>${inline(stripWrapper(b.text))}</h2>`;
      return renderParagraphBlock(b, lang, false);
    })
    .filter(Boolean)
    .join('\n');
}

function articlePage(article, lang) {
  const t = T[lang];
  const other = lang === 'zh' ? 'en' : 'zh';
  const title = lang === 'zh' ? article.zhTitle : article.enTitle;
  const pagePath = lang === 'zh' ? `${article.dated}/` : `en/${article.dated}/`;
  const otherPath = other === 'zh' ? `${article.dated}/` : `en/${article.dated}/`;
  const toRoot = lang === 'zh' ? '../' : '../../';
  const zhPath = `${article.dated}/`;
  const enPath = `en/${article.dated}/`;
  const canonical = lang === 'zh'
    ? `${ROES_BLOG_ZH}/${article.dated}`
    : `${ROES_BLOG_EN}/${article.dated}`;
  const description = lang === 'zh'
    ? `《${article.zhTitle}》——原文发布于 ${article.date}（roes.pro）。本页为 ROES Essays 阅读镜像的中文版；原稿完整保存于本仓库。`
    : `"${article.enTitle}" — originally published ${article.date} on roes.pro. This page is the English reading edition of the ROES Essays mirror; the source manuscripts are preserved in this repository.`;

  const body = bodyHtml(article, lang);

  return `<!DOCTYPE html>
<html lang="${t.htmlLang}">
<head>
${head({
    title: `${title} · ROES Essays`,
    description,
    canonical,
    alternates: [
      { hreflang: 'zh-Hans', href: `${SITE_BASE}/${zhPath}` },
      { hreflang: 'en', href: `${SITE_BASE}/${enPath}` },
    ],
    og: { title, description, type: 'article', url: `${SITE_BASE}/${pagePath}`, publishedTime: article.date },
  })}
</head>
<body>
<header class="site-head">
  <div class="wrap">
    <a class="wordmark" href="${toRoot}">ROES · Essays</a>
    <nav aria-label="${t.switchLabel}"><a href="${toRoot}${zhPath}"${lang === 'zh' ? ' aria-current="page"' : ''}>${t.langZh}</a><a href="${toRoot}${enPath}"${lang === 'en' ? ' aria-current="page"' : ''}>${t.langEn}</a></nav>
  </div>
</header>
<main class="wrap">
  <p class="back"><a href="${toRoot}">← ${t.back}</a></p>
  <article>
    <p class="kicker">${t.essayKicker} · <time datetime="${article.date}">${article.date}</time></p>
    <h1>${inline(title)}</h1>
    <ul class="meta">
      <li>${t.published}: <time datetime="${article.date}">${article.date}</time></li>
      <li>${t.original}: <a href="${canonical}">roes.pro${canonical.slice('https://roes.pro'.length)}</a></li>
      <li lang="${other === 'zh' ? 'zh-Hans' : 'en'}"><a href="${toRoot}${otherPath}">${other === 'zh' ? t.langZh : 'EN'}</a></li>
    </ul>
    <div class="essay-body">
${body}
    </div>
    <p class="essay-foot"><a href="${toRoot}">← ${t.back}</a><a href="${toRoot}${otherPath}">${other === 'zh' ? '中文' : 'English'}</a><a href="${ROES_HOME}">ROES · roes.pro</a></p>
  </article>
</main>
${siteFooter()}
</body>
</html>
`;
}

function indexPage(articles) {
  const items = [...articles]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((a) => `      <li>
        <p class="date"><time datetime="${a.date}">${a.date}</time></p>
        <h2><a href="en/${a.dated}/">${escapeHtml(a.enTitle)}</a></h2>
        <p class="alt-title" lang="zh-Hans"><a href="${a.dated}/">${escapeHtml(a.zhTitle)}</a></p>
        <p class="links"><a href="en/${a.dated}/" lang="en">Read in English</a><a href="${ROES_BLOG_EN}/${a.dated}">Original on ROES</a><a href="${a.dated}/" lang="zh-Hans">中文</a></p>
      </li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
${head({
    title: 'ROES Essays',
    description: 'Essays on recursive intelligence evolution, intelligence ownership, and the economics of AI. Originally published on roes.pro; this is a reading mirror offering English and Chinese reading pages.',
    canonical: `${SITE_BASE}/`,
    alternates: [],
    og: {
      title: 'ROES Essays',
      description: 'Essays on recursive intelligence evolution, intelligence ownership, and the economics of AI. Originally published on roes.pro.',
      type: 'website',
      url: `${SITE_BASE}/`,
    },
  })}
</head>
<body>
<header class="site-head">
  <div class="wrap">
    <a class="wordmark" href="./" aria-current="page">ROES · Essays</a>
    <nav aria-label="Index"><a href="${ROES_BLOG_EN}" lang="en">ROES blog</a><a href="${ROES_BLOG_ZH}" lang="zh-Hans">中文目录</a></nav>
  </div>
</header>
<main class="wrap">
  <div class="index-intro">
    <p lang="en">Essays on recursive intelligence evolution, intelligence ownership, and the economics of AI. Originally published on <a href="${ROES_HOME}">roes.pro</a>; this mirror offers English and Chinese reading pages, with the source manuscripts preserved in this repository.</p>
    <p lang="zh-Hans">中文阅读入口见各篇。原文发布于 <a href="${ROES_HOME}">roes.pro</a>；原稿完整保存于本仓库。</p>
  </div>
  <ul class="essay-list">
${items}
  </ul>
</main>
${siteFooter()}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function gate(entry) {
  const buf = readFileSync(join(ROOT, entry.path));
  const digest = sha256(buf);
  if (digest !== entry.expect) {
    console.error(`integrity gate FAILED: ${entry.path}\n  expected ${entry.expect}\n  actual   ${digest}`);
    process.exit(1);
  }
  console.log(`integrity ok: ${entry.path} ${digest.slice(0, 12)}…`);
}

function main() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'source-manifest.json'), 'utf8'));

  const articles = [];
  for (const a of manifest.articles) {
    if (a.mode === 'split') {
      gate({ path: a.files.zh, expect: a.sha256.zh });
      gate({ path: a.files.en, expect: a.sha256.en });
      const zh = parseBody(readFileSync(join(ROOT, a.files.zh), 'utf8'));
      const en = parseBody(readFileSync(join(ROOT, a.files.en), 'utf8'));
      articles.push({
        mode: 'split',
        date: a.date,
        dated: a.slug,
        zhTitle: a.zh_title,
        enTitle: en.h1,
        zhBlocks: zh.blocks,
        enBlocks: en.blocks,
      });
    } else {
      gate({ path: a.file, expect: a.sha256 });
      const parsed = parseEssay(readFileSync(join(ROOT, a.file), 'utf8'));
      articles.push({
        mode: 'bilingual',
        date: a.date,
        dated: a.slug,
        zhTitle: parsed.zhTitle,
        enTitle: parsed.enTitle,
        blocks: parsed.blocks,
      });
    }
  }

  rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(DIST_DIR, { recursive: true });

  writeFileSync(join(DIST_DIR, 'index.html'), indexPage(articles));
  for (const a of articles) {
    mkdirSync(join(DIST_DIR, a.dated), { recursive: true });
    mkdirSync(join(DIST_DIR, 'en', a.dated), { recursive: true });
    writeFileSync(join(DIST_DIR, a.dated, 'index.html'), articlePage(a, 'zh'));
    writeFileSync(join(DIST_DIR, 'en', a.dated, 'index.html'), articlePage(a, 'en'));
  }

  const pages = ['index.html', ...articles.flatMap((a) => [`${a.dated}/index.html`, `en/${a.dated}/index.html`])];
  console.log(`built ${pages.length} pages into dist/:`);
  for (const p of pages) console.log(`  dist/${p}`);
}

main();
