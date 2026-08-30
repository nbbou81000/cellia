// scripts/gen-og.js
// Génère une page HTML légère par article dans dist/a/<id>.html
//
// Pourquoi : les robots d'aperçu (Facebook, WhatsApp, Discord, iMessage, Slack,
// Twitter/X, LinkedIn) n'exécutent PAS JavaScript. Sur article.html?id=…, ils
// lisent donc toujours les mêmes balises og:. Ces pages statiques portent les
// vraies métadonnées de chaque article ; un visiteur humain est redirigé vers
// le lecteur habituel.
//
// Aucune dépendance externe — Node.js 18+ natif.

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Le script est prévu pour vivre dans scripts/, mais on tolère la racine :
// on retient le premier emplacement où dist/articles.json existe réellement.
const CANDIDATES = [
  path.join(__dirname, '..'),   // scripts/gen-og.js  → racine du dépôt
  __dirname,                    // gen-og.js à la racine
  process.cwd(),                // lancé depuis ailleurs
];
const ROOT = CANDIDATES.find(dir => fs.existsSync(path.join(dir, 'dist', 'articles.json')))
          || path.join(__dirname, '..');

const FEED      = path.join(ROOT, 'dist', 'articles.json');
const OUT_DIR   = path.join(ROOT, 'dist', 'a');
const BASE      = 'https://nbbou81000.github.io/cellia';
const FALLBACK  = `${BASE}/og-image.png`;

// ─── Échappement HTML strict pour un contenu d'attribut ──────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Les robots rejettent souvent les URL d'image non absolues ou non https
function absoluteImage(url) {
  if (!url) return FALLBACK;
  const u = String(url).trim();
  if (u.startsWith('https://')) return u;
  if (u.startsWith('http://'))  return u.replace(/^http:/, 'https:');
  if (u.startsWith('//'))       return 'https:' + u;
  if (u.startsWith('/'))        return BASE + u;
  return FALLBACK;
}

function truncate(str, max) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/[\s,;:.!?-]+\S*$/, '') + '…';
}

function buildPage(a) {
  const url     = `${BASE}/a/${a.id}.html`;
  const reader  = `${BASE}/article.html?id=${encodeURIComponent(a.id)}`;
  const title   = truncate(a.title, 110);
  const desc    = truncate(a.summary || a.snippet || 'Veille tech réécrite par IA.', 200);
  const image   = absoluteImage(a.image);
  const cat     = esc(a.category || 'tech');
  const date    = a.date || new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — CelliA</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(reader)}">

<link rel="icon" href="${BASE}/favicon.svg" type="image/svg+xml">
<link rel="icon" href="${BASE}/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="${BASE}/favicon-192.png">

<!-- Open Graph -->
<meta property="og:type"           content="article">
<meta property="og:site_name"      content="CelliA">
<meta property="og:locale"         content="fr_FR">
<meta property="og:title"          content="${esc(title)}">
<meta property="og:description"    content="${esc(desc)}">
<meta property="og:url"            content="${esc(url)}">
<meta property="og:image"          content="${esc(image)}">
<meta property="og:image:secure_url" content="${esc(image)}">
<meta property="og:image:alt"      content="${esc(title)}">
<meta property="article:published_time" content="${esc(date)}">
<meta property="article:section"   content="${cat}">

<!-- Twitter / X -->
<meta name="twitter:card"          content="summary_large_image">
<meta name="twitter:title"         content="${esc(title)}">
<meta name="twitter:description"   content="${esc(desc)}">
<meta name="twitter:image"         content="${esc(image)}">
<meta name="twitter:image:alt"     content="${esc(title)}">

<!-- Données structurées : logo du site pour Google Discover / résultats enrichis -->
<script type="application/ld+json">
${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'NewsArticle',
  headline: title,
  description: desc,
  image: [image],
  datePublished: date,
  mainEntityOfPage: { '@type': 'WebPage', '@id': reader },
  publisher: {
    '@type': 'Organization',
    name: 'CelliA',
    logo: { '@type': 'ImageObject', url: `${BASE}/favicon-192.png` }
  }
}, null, 2)}
</script>

<!-- Un humain est renvoyé vers le lecteur ; les robots restent sur cette page -->
<meta http-equiv="refresh" content="0; url=${esc(reader)}">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#1a1c22;color:#f0f2f8;font-family:system-ui,-apple-system,sans-serif;
       text-align:center;padding:24px;}
  a{color:#ff5a4e;}
</style>
</head>
<body>
  <div>
    <p style="font-size:15px;font-weight:700;letter-spacing:-.02em">Celli<span style="color:#ff5a4e">A</span></p>
    <p style="font-size:13px;opacity:.6">Ouverture de l'article…</p>
    <p><a href="${esc(reader)}">Cliquer ici si rien ne se passe</a></p>
  </div>
  <script>location.replace(${JSON.stringify(reader)});</script>
</body>
</html>
`;
}

// ─── Main ────────────────────────────────────────────────────────────────────
if (!fs.existsSync(FEED)) {
  console.error('✗ dist/articles.json introuvable — lance fetch.js d\'abord.');
  process.exit(1);
}

const data     = JSON.parse(fs.readFileSync(FEED, 'utf-8'));
const articles = data.articles || [];

fs.mkdirSync(OUT_DIR, { recursive: true });

// Purger les pages dont l'article n'existe plus (articles expirés à 30 jours)
const validIds = new Set(articles.map(a => String(a.id)));
let purged = 0;
for (const file of fs.readdirSync(OUT_DIR)) {
  if (!file.endsWith('.html')) continue;
  if (!validIds.has(file.replace(/\.html$/, ''))) {
    fs.unlinkSync(path.join(OUT_DIR, file));
    purged++;
  }
}

let written = 0, skipped = 0;
for (const a of articles) {
  if (!a.id || !a.title) { skipped++; continue; }
  // Un id doit rester un nom de fichier sûr
  if (!/^[A-Za-z0-9._-]+$/.test(String(a.id))) { skipped++; continue; }
  fs.writeFileSync(path.join(OUT_DIR, `${a.id}.html`), buildPage(a), 'utf-8');
  written++;
}

const withImage = articles.filter(a => a.image).length;
console.log(`✓ ${written} pages d'aperçu écrites dans dist/a/`);
console.log(`  ${withImage}/${articles.length} avec image d'illustration`);
if (purged)  console.log(`  ${purged} pages obsolètes supprimées`);
if (skipped) console.log(`  ${skipped} articles ignorés (id ou titre manquant)`);
