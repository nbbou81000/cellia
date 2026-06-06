import Parser  from 'rss-parser';
import fs      from 'fs/promises';
import path    from 'path';
import crypto  from 'crypto';
import { fileURLToPath } from 'url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const IS_DEV       = process.argv.includes('--dev');
const MAX_ARTICLES = IS_DEV ? 3 : 10;
const WINDOW_HOURS = 48;
const GROQ_MODEL   = 'llama-3.1-8b-instant';
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';

// ─── Logs colorés ANSI ───────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m',  blue:  '\x1b[34m', dim:    '\x1b[2m',  bold: '\x1b[1m'
};
const log  = msg => console.log(`${c.blue}▸${c.reset} ${msg}`);
const ok   = msg => console.log(`${c.green}✓${c.reset} ${msg}`);
const warn = msg => console.log(`${c.yellow}⚠${c.reset} ${msg}`);
const err  = msg => console.log(`${c.red}✗${c.reset} ${msg}`);
const dim  = msg => IS_DEV && console.log(`${c.dim}  ${msg}${c.reset}`);

// ─── Images Unsplash statiques ───────────────────────────────────────────────
const UNSPLASH_FALLBACK = {
  ai:       ['1677442135703-1787eea5ce01', '1620712943543-bcc4688e7485'],
  secu:     ['1526374965328-7f61d4dc18c5', '1510511459019-5dda7724fd87'],
  hardware: ['1518770660439-4636190af475', '1611532736597-de2d4265fba3'],
  maker:    ['1581092160562-f4e7ce8b3e29', '1518770660439-4636190af476'],
  web:      ['1461749280684-dccba630e2f6', '1516116216624-53ad0571bc4c'],
  science:  ['1559757175-0eb30cd8c063', '1446776811953-b23d57bd21aa'],
  auto:     ['1461749280684-dccba630e2f6', '1516116216624-53ad0571bc4c'],
};

function getUnsplashImage(category) {
  const ids = UNSPLASH_FALLBACK[category] || UNSPLASH_FALLBACK.web;
  const id  = ids[Math.floor(Math.random() * ids.length)];
  return `https://images.unsplash.com/photo-${id}?w=400&q=75&auto=format`;
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex').slice(0, 10);
}

function cleanText(html) {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function extractImage(item) {
  // media:content
  if (item['media:content']?.$.url) return item['media:content'].$.url;
  if (item.mediaThumbnail?.$.url)   return item.mediaThumbnail.$.url;
  if (item.enclosure?.url)          return item.enclosure.url;
  // regex dans content
  const content = item.content || item['content:encoded'] || '';
  const match   = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match) return match[1];
  return null;
}

function detectCategory(text, keywords) {
  const lower = text.toLowerCase();
  for (const [cat, words] of Object.entries(keywords)) {
    if (words.some(w => lower.includes(w))) return cat;
  }
  return 'web';
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

// ─── fetchFeed ────────────────────────────────────────────────────────────────
async function fetchFeed(source, keywords, config) {
  const parser = new Parser({
    timeout: 10000,
    headers: { 'User-Agent': 'CelliA-Bot/1.0 (+https://cellia.netlify.app)' },
    customFields: {
      item: [
        ['media:content', 'media:content', { keepArray: false }],
        ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
        ['content:encoded', 'content:encoded'],
      ]
    }
  });

  let feed;
  try {
    feed = await parser.parseURL(source.url);
  } catch (e) {
    warn(`Flux indisponible : ${source.url} — ${e.message}`);
    return [];
  }

  const now      = Date.now();
  const windowMs = WINDOW_HOURS * 3600 * 1000;
  const items    = [];

  for (const item of feed.items || []) {
    const pubDate = item.isoDate ? new Date(item.isoDate).getTime() : 0;
    if (pubDate && (now - pubDate) > windowMs) continue;

    const title = cleanText(item.title || '');
    const url   = item.link || item.url || '';
    if (!title || !url) continue;

    // Filtre tech_only : exclure si mot exclu présent dans le titre
    if (source.tech_only) {
      const lowerTitle = title.toLowerCase();
      const excluded   = (config.exclude_keywords || []).some(kw => lowerTitle.includes(kw));
      if (excluded) { dim(`  Exclu (non-tech) : ${title}`); continue; }
    }

    const rawContent = item['content:encoded'] || item.content || item.summary || '';
    const snippet    = cleanText(rawContent).slice(0, 800);
    const image      = extractImage(item);
    const catText    = `${title} ${snippet}`;
    const category   = source.category || detectCategory(catText, keywords);

    items.push({
      id:       md5(url),
      title,
      url,
      source:   extractDomain(source.url),
      date:     item.isoDate || new Date().toISOString(),
      image:    image && image.startsWith('http') ? image : null,
      snippet,
      category,
      lang:     source.lang || 'en',
    });
  }

  dim(`  ${source.url} → ${items.length} items`);
  return items;
}

// ─── fetchFullText ────────────────────────────────────────────────────────────
async function fetchFullText(article) {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(article.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CelliA-Bot/1.0)' }
    });
    clearTimeout(timeout);

    if (!res.ok) return article.snippet;
    const html = await res.text();

    // Extraire les <p> depuis <article> ou <main> ou body
    let container = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1]
      || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1]
      || html;

    const paragraphs = [];
    let   m;
    const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m = re.exec(container)) !== null) {
      const text = cleanText(m[1]);
      if (text.length > 40) paragraphs.push(text);
    }

    const full = paragraphs.join(' ').slice(0, 4000);
    return full.length >= 200 ? full : article.snippet;
  } catch {
    return article.snippet;
  }
}

// ─── rewriteWithGroq ─────────────────────────────────────────────────────────
async function rewriteWithGroq(article) {
  if (!process.env.GROQ_API_KEY) {
    warn('GROQ_API_KEY manquante — fallback snippet');
    return { summary: article.snippet, body: `<p>${article.snippet}</p>`, readingTime: 1 };
  }

  try {
    const response = await fetch(GROQ_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:    GROQ_MODEL,
        messages: [
          {
            role:    'system',
            content: `Tu es Korben, blogueur tech français. Style : direct, geek, complice, légèrement ironique. Jamais corporate. Toujours en français.`
          },
          {
            role:    'user',
            content: `Réécris cet article en FRANÇAIS dans le style de Korben.

RÈGLES ABSOLUES :
- Si la source est en anglais, TRADUIS et réécris intégralement en français.
- Tu RÉÉCRIS l'article complet. Le lecteur n'a pas besoin de lire l'original.
- Corps entre 200 et 350 mots.
- Utilise UNIQUEMENT les balises HTML <p>, <h2>, <strong>.
- IMPÉRATIF : termine toujours tes phrases. Ne t'arrête JAMAIS en pleine phrase.

FORMAT EXACT (respecte-le scrupuleusement) :
[phrase d'accroche résumant l'article, 1-2 phrases max]
|||BODY|||
[corps complet en HTML avec balises <p>, <h2>, <strong>]

ARTICLE SOURCE :
Titre : ${article.title}
Source : ${article.source}
Contenu : ${article.fullText || article.snippet}`
          }
        ],
        temperature: 0.8,
        max_tokens:  1200,
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status} — ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';

    let summary, body;
    if (text.includes('|||BODY|||')) {
      const parts = text.split('|||BODY|||');
      summary = parts[0].trim();
      body    = parts[1].trim().replace(/```html?/g, '').replace(/```/g, '').trim();
    } else {
      const firstDot = text.indexOf('. ');
      summary = firstDot > 0 ? text.slice(0, firstDot + 1).trim() : text.slice(0, 150);
      body    = text.slice(summary.length).trim() || text;
    }

    const wordCount  = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    const readingTime = Math.max(1, Math.round(wordCount / 200));

    return { summary, body, readingTime };
  } catch (e) {
    err(`Groq error [${article.id}] : ${e.message}`);
    return {
      summary:     article.snippet,
      body:        `<p>${article.snippet}</p>`,
      readingTime: 1,
    };
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${c.bold}${c.blue}━━━ CelliA — Veille Tech ━━━${c.reset}  ${IS_DEV ? c.yellow + '[DEV]' + c.reset : ''}\n`);

  // 1. Charger la config
  const configPath = path.join(__dirname, 'sources.json');
  const config     = JSON.parse(await fs.readFile(configPath, 'utf-8'));
  log(`${config.sources.length} sources configurées`);

  // 2. Charger le cache
  const distPath    = path.join(__dirname, '..', 'dist', 'articles.json');
  let   cachedData  = { articles: [] };
  try {
    cachedData = JSON.parse(await fs.readFile(distPath, 'utf-8'));
    ok(`Cache : ${cachedData.articles?.length || 0} articles existants`);
  } catch {
    warn('Pas de cache existant');
  }

  const cachedById = {};
  for (const a of (cachedData.articles || [])) {
    if (a.id && a.body?.length > 100) cachedById[a.id] = a;
  }

  // 3. Fetch tous les flux en parallèle
  log('Fetch des flux RSS...');
  const feedResults = await Promise.allSettled(
    config.sources.map(s => fetchFeed(s, config.keywords, config))
  );
  let allArticles = feedResults
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  ok(`${allArticles.length} articles bruts récupérés`);

  // 4. Dédupliquer par URL
  const seenUrls = new Set();
  allArticles = allArticles.filter(a => {
    if (seenUrls.has(a.url)) return false;
    seenUrls.add(a.url);
    return true;
  });

  // 5. Trier par date décroissante
  allArticles.sort((a, b) => new Date(b.date) - new Date(a.date));

  // 6. Équilibrer : max 5 par catégorie
  const catCount = {};
  allArticles = allArticles.filter(a => {
    catCount[a.category] = (catCount[a.category] || 0) + 1;
    return catCount[a.category] <= 5;
  });

  // 7. Garder les MAX_ARTICLES plus récents
  allArticles = allArticles.slice(0, MAX_ARTICLES);
  log(`${allArticles.length} articles retenus après équilibrage`);

  // 8. fetchFullText en parallèle
  log('Extraction du texte complet...');
  await Promise.all(allArticles.map(async a => {
    a.fullText = await fetchFullText(a);
  }));

  // 9. Réécriture Groq (avec cache)
  log('Réécriture avec Groq...');
  let newCount    = 0;
  let cachedCount = 0;

  for (const article of allArticles) {
    if (cachedById[article.id]) {
      const cached = cachedById[article.id];
      article.summary     = cached.summary;
      article.body        = cached.body;
      article.readingTime = cached.readingTime;
      cachedCount++;
      dim(`  Cache hit : ${article.title.slice(0, 50)}`);
    } else {
      const result = await rewriteWithGroq(article);
      article.summary     = result.summary;
      article.body        = result.body;
      article.readingTime = result.readingTime;
      newCount++;
      ok(`  Réécrit : ${article.title.slice(0, 50)}`);
      await sleep(1500);
    }
    delete article.fullText; // Pas besoin dans le JSON final
  }

  // 10. Images fallback Unsplash
  for (const article of allArticles) {
    if (!article.image || !article.image.startsWith('http')) {
      article.image = getUnsplashImage(article.category);
    }
  }

  // 11. Fusion historique : nouveaux + anciens cache (max 90 jours)
  const cutoff      = Date.now() - 90 * 24 * 3600 * 1000;
  const newIds      = new Set(allArticles.map(a => a.id));
  const oldArticles = (cachedData.articles || [])
    .filter(a => !newIds.has(a.id) && new Date(a.date).getTime() > cutoff);

  const finalArticles = [...allArticles, ...oldArticles];
  finalArticles.sort((a, b) => new Date(b.date) - new Date(a.date));

  // 12. Écrire dist/articles.json
  const output = {
    generated_at: new Date().toISOString(),
    count:        finalArticles.length,
    articles:     finalArticles,
  };

  await fs.mkdir(path.join(__dirname, '..', 'dist'), { recursive: true });
  await fs.writeFile(distPath, JSON.stringify(output, null, 2), 'utf-8');

  // 13. Résumé
  console.log(`\n${c.bold}━━━ Terminé ━━━${c.reset}`);
  ok(`${newCount} nouveaux | ${cachedCount} depuis cache | ${finalArticles.length} total`);
  ok(`Écrit : dist/articles.json`);
  console.log();
}

main().catch(e => {
  err(`Erreur fatale : ${e.message}`);
  console.error(e);
  process.exit(1);
});      
