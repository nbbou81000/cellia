import Parser  from 'rss-parser';
import fs      from 'fs/promises';
import path    from 'path';
import crypto  from 'crypto';
import { fileURLToPath } from 'url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const IS_DEV       = process.argv.includes('--dev');
const MAX_ARTICLES = IS_DEV ? 3 : 10;
const WINDOW_HOURS = 48;

// ─── Providers IA en cascade : Gemini → Mistral → Groq ───────────────────────
const PROVIDERS = [
  {
    name:   'Gemini',
    envKey: 'GEMINI_API_KEY',
    type:   'gemini',
    url:    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
  },
  {
    name:   'Mistral',
    envKey: 'MISTRAL_API_KEY',
    type:   'openai',
    url:    'https://api.mistral.ai/v1/chat/completions',
    model:  'mistral-small-latest',
  },
  {
    name:   'Groq',
    envKey: 'GROQ_API_KEY',
    type:   'openai',
    url:    'https://api.groq.com/openai/v1/chat/completions',
    model:  'llama-3.1-8b-instant',
  },
];

// ─── Mots-clés tech pour filtrer l'éphéméride Wikipedia ─────────────────────
const EPHEMERIS_KEYWORDS = [
  'computer', 'software', 'hardware', 'internet', 'video game', 'programming',
  'algorithm', 'processor', 'microchip', 'transistor', 'semiconductor',
  'operating system', 'artificial intelligence', 'robot', 'network', 'digital',
  'satellite', 'spacecraft', 'rocket', 'apple ', 'microsoft', 'google ',
  'ibm ', 'intel ', 'amd ', 'nvidia', 'atari', 'nintendo', 'playstation',
  'xbox', 'sega', 'linux', 'windows ', 'macintosh', 'iphone', 'android',
  'twitter', 'facebook', 'amazon', 'youtube', 'spotify', 'browser', 'email',
  'wi-fi', 'bluetooth', 'usb ', 'smartphone', 'hacker', 'virus', 'encryption',
  'console', 'arcade', 'graphics', 'database', 'server', 'cloud', 'mobile phone',
  'laser', 'fiber optic', 'cd-rom', 'dvd', 'floppy', 'modem', 'ethernet',
  'world wide web', 'hypertext', 'domain', 'podcast', 'streaming', 'pixel',
];

const MONTHS_FR = [
  'janvier','février','mars','avril','mai','juin',
  'juillet','août','septembre','octobre','novembre','décembre'
];

// ─── Logs colorés ANSI ───────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m',  blue:  '\x1b[34m', dim:    '\x1b[2m',
  bold: '\x1b[1m',  cyan:  '\x1b[36m',
};
const log  = msg => console.log(`${c.blue}▸${c.reset} ${msg}`);
const ok   = msg => console.log(`${c.green}✓${c.reset} ${msg}`);
const warn = msg => console.log(`${c.yellow}⚠${c.reset} ${msg}`);
const err  = msg => console.log(`${c.red}✗${c.reset} ${msg}`);
const dim  = msg => IS_DEV && console.log(`${c.dim}  ${msg}${c.reset}`);
const info = msg => console.log(`${c.cyan}  →${c.reset} ${msg}`);

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
  if (item['media:content']?.$.url) return item['media:content'].$.url;
  if (item.mediaThumbnail?.$.url)   return item.mediaThumbnail.$.url;
  if (item.enclosure?.url)          return item.enclosure.url;
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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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
  try { feed = await parser.parseURL(source.url); }
  catch (e) { warn(`Flux indisponible : ${source.url} — ${e.message}`); return []; }

  const now      = Date.now();
  const windowMs = WINDOW_HOURS * 3600 * 1000;
  const items    = [];

  for (const item of feed.items || []) {
    const pubDate = item.isoDate ? new Date(item.isoDate).getTime() : 0;
    if (pubDate && (now - pubDate) > windowMs) continue;
    const title = cleanText(item.title || '');
    const url   = item.link || item.url || '';
    if (!title || !url) continue;
    if (source.tech_only) {
      const excluded = (config.exclude_keywords || []).some(kw => title.toLowerCase().includes(kw));
      if (excluded) { dim(`  Exclu : ${title}`); continue; }
    }
    const rawContent = item['content:encoded'] || item.content || item.summary || '';
    const snippet    = cleanText(rawContent).slice(0, 800);
    const category   = source.category || detectCategory(`${title} ${snippet}`, keywords);
    items.push({
      id:       md5(url),
      title,
      url,
      source:   extractDomain(source.url),
      date:     item.isoDate || new Date().toISOString(),
      image:    extractImage(item)?.startsWith('http') ? extractImage(item) : null,
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
    setTimeout(() => controller.abort(), 5000);
    const res = await fetch(article.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CelliA-Bot/1.0)' }
    });
    if (!res.ok) return article.snippet;
    const html = await res.text();
    let container = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1]
      || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1]
      || html;
    const paragraphs = [];
    let m;
    const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m = re.exec(container)) !== null) {
      const text = cleanText(m[1]);
      if (text.length > 40) paragraphs.push(text);
      if (paragraphs.length >= 8) break;
    }
    const full = paragraphs.join(' ').slice(0, 2000);
    return full.length >= 200 ? full : article.snippet;
  } catch { return article.snippet; }
}

// ─── Prompts partagés ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu incarnes Korben (korben.info), le blogueur tech français culte depuis 20 ans. Ton style est immédiatement reconnaissable.

TON STYLE — RÈGLES ABSOLUES :
- Ton familier et complice, comme si tu parlais à des potes geeks autour d'une bière
- Phrases courtes. Percutantes. Avec du rythme. Pas de blabla.
- Tu utilises naturellement : "les gars", "bref", "du coup", "franchement", "clairement", "en gros", "au final"
- Des apartés entre parenthèses pour les blagues (comme ça, voilà)
- Tu donnes TON avis tranché — tu n'es pas neutre
- Humour sec et ironie légère — jamais lourd, jamais forcé
- Quand c'est impressionnant, tu le dis. Quand c'est du flan, tu le démontes.

JAMAIS :
- Jamais "Il convient de noter", "Dans le cadre de", "Il est important de souligner"
- Jamais de ton journalistique froid
- Jamais en anglais sauf noms propres techniques (GPU, CPU, API…)
- Jamais de conclusion bateau`;

function buildUserPrompt(article) {
  return `Réécris cet article dans le style de Korben.

RÈGLES :
- TRADUIS et réécris intégralement en français.
- Corps entre 220 et 320 mots.
- Balises HTML : <p>, <h2>, <strong> UNIQUEMENT.
- Termine TOUJOURS tes phrases.
- Le titre français doit être accrocheur, pas une traduction littérale.

FORMAT EXACT (rien en dehors) :
TITRE_FR: [titre percutant, max 90 caractères]
ACCROCHE: [1 phrase maximum, 20 mots max, punchy style Korben]
|||BODY|||
[corps complet en HTML]

ARTICLE SOURCE :
Titre : ${article.title}
Source : ${article.source}
Contenu : ${article.fullText || article.snippet}`;
}

// ─── Appel API selon le type de provider ─────────────────────────────────────
async function callProvider(provider, systemPrompt, userPrompt) {
  if (provider.type === 'gemini') {
    return fetch(`${provider.url}?key=${process.env[provider.envKey]}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 1400, topP: 0.95 },
      }),
    });
  }
  return fetch(provider.url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env[provider.envKey]}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.85,
      max_tokens:  1400,
    }),
  });
}

function extractText(provider, data) {
  if (provider.type === 'gemini') {
    if (data.error) throw new Error(data.error.message || 'Erreur Gemini');
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  }
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ─── Parsing de la réponse ────────────────────────────────────────────────────
function truncateToSentences(text, maxChars = 260) {
  if (!text || text.length <= maxChars) return text || '';
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  let out = '';
  for (const s of sentences) {
    if ((out + s).length > maxChars) break;
    out += s;
  }
  return out.trim() || text.slice(0, maxChars).trim() + '…';
}

function ensureParagraphs(html) {
  if (!html) return '';
  if (!html.includes('<p')) {
    return html.split(/\n\n+/).map(b => b.trim()).filter(Boolean).map(b => `<p>${b}</p>`).join('\n');
  }
  return html.replace(/^<strong>([\s\S]+)<\/strong>$/i, '$1').trim();
}

function parseResponse(text, article) {
  let titleFR = article.title;
  const titleMatch = text.match(/^TITRE_FR:\s*(.+)/m);
  if (titleMatch) titleFR = titleMatch[1].trim().replace(/^["«]|["»]$/g, '');

  let summary = article.snippet;
  let body    = `<p>${article.snippet}</p>`;

  if (text.includes('|||BODY|||')) {
    const parts    = text.split('|||BODY|||');
    const before   = parts[0];
    const rawBody  = parts[1]?.trim().replace(/```html?/g, '').replace(/```/g, '').trim() || '';
    body = ensureParagraphs(rawBody) || `<p>${article.snippet}</p>`;

    const accrocheMatch = before.match(/ACCROCHE:\s*([\s\S]+?)(?:\n{2,}|$)/);
    if (accrocheMatch) {
      summary = truncateToSentences(cleanText(accrocheMatch[1]));
    } else {
      const firstP = rawBody.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      if (firstP) summary = truncateToSentences(cleanText(firstP[1]));
    }
  } else {
    const clean = cleanText(text).replace(/^TITRE_FR:[^\n]+\n?/m, '').trim();
    summary = truncateToSentences(clean);
    body    = clean.split(/\n\n+/).filter(Boolean).map(b => `<p>${b}</p>`).join('\n')
              || `<p>${article.snippet}</p>`;
  }

  if (summary.length > 300) summary = summary.slice(0, 297) + '…';
  const wordCount   = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.round(wordCount / 200));
  return { title: titleFR, summary, body, readingTime };
}

// ─── Réécriture articles avec fallback Gemini → Mistral → Groq ───────────────
async function rewriteWithFallback(article) {
  const available = PROVIDERS.filter(p => process.env[p.envKey]);
  if (available.length === 0) {
    warn('Aucune clé API — fallback snippet');
    return { title: article.title, summary: article.snippet, body: `<p>${article.snippet}</p>`, readingTime: 1 };
  }

  for (const provider of PROVIDERS) {
    if (!process.env[provider.envKey]) { dim(`  ${provider.name} : clé absente`); continue; }
    try {
      info(`${provider.name}...`);
      const response = await callProvider(provider, SYSTEM_PROMPT, buildUserPrompt(article));
      if (response.status === 429) { warn(`  ${provider.name} : 429 → suivant`); continue; }
      if (!response.ok)            { warn(`  ${provider.name} : HTTP ${response.status} → suivant`); continue; }
      const data = await response.json();
      const text = extractText(provider, data);
      if (!text || text.length < 50) { warn(`  ${provider.name} : réponse vide → suivant`); continue; }
      ok(`  ${provider.name} ✓ — ${article.title.slice(0, 45)}`);
      return parseResponse(text, article);
    } catch (e) { warn(`  ${provider.name} : ${e.message} → suivant`); }
  }

  err(`Tous les providers ont échoué [${article.id}]`);
  return { title: article.title, summary: article.snippet, body: `<p>${article.snippet}</p>`, readingTime: 1 };
}

// ─── ÉPHÉMÉRIDE TECH ─────────────────────────────────────────────────────────
async function rewriteEphemerisEvent(event, dayNum, monthName) {
  const systemPrompt = `Tu incarnes Korben (korben.info), blogueur tech français, style direct, geek, complice et légèrement ironique.`;
  const userPrompt   = `Réécris cet événement tech historique dans le style de Korben pour une section "éphéméride tech du jour".

RÈGLES :
- 2 à 4 phrases maximum, en texte brut (pas de HTML)
- Commence par l'année : "En ${event.year}," ou "C'était en ${event.year},"
- Traduis intégralement en français
- Style Korben : direct, avec ton propre avis, une pointe d'humour si pertinent
- Donne du contexte si c'est une date importante

ÉVÉNEMENT : ${event.text}`;

  for (const provider of PROVIDERS) {
    if (!process.env[provider.envKey]) continue;
    try {
      const response = await callProvider(provider, systemPrompt, userPrompt);
      if (!response.ok) continue;
      const data = await response.json();
      const text = extractText(provider, data);
      if (text && text.length > 20) return text.trim();
    } catch { continue; }
  }
  return event.text; // fallback texte brut original
}

async function fetchEphemeris(dateStr) {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const month    = parseInt(monthStr);
  const day      = parseInt(dayStr);
  const monthFR  = MONTHS_FR[month - 1];
  const url      = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`;

  log(`Éphéméride tech : ${day} ${monthFR}...`);

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CelliA-Bot/1.0', 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);

    const data   = await res.json();
    const events = data.events || [];

    // Filtrer les événements tech
    const techEvents = events.filter(e => {
      if (!e.year || parseInt(e.year) >= parseInt(yearStr)) return false;
      const text = (e.text || '').toLowerCase();
      return EPHEMERIS_KEYWORDS.some(kw => text.includes(kw));
    });

    if (!techEvents.length) {
      warn('Éphéméride : aucun événement tech trouvé pour cette date');
      return null;
    }

    // Mélanger et prendre 2 événements max, préférer les plus anciens pour la variété
    const selected = techEvents
      .sort((a, b) => a.year - b.year) // plus vieux en premier
      .slice(0, 4)                      // pool de 4
      .sort(() => Math.random() - 0.5)  // mélange
      .slice(0, 2);                     // garder 2

    const items = [];
    for (const event of selected) {
      const summary     = await rewriteEphemerisEvent(event, day, monthFR);
      const wikiPage    = event.pages?.[0];
      const wikiUrl     = wikiPage?.content_urls?.desktop?.page || null;
      const wikiThumb   = wikiPage?.thumbnail?.source || null;
      items.push({
        year:          event.year,
        original:      event.text,
        summary,
        wikipedia_url: wikiUrl,
        thumbnail:     wikiThumb,
      });
      await sleep(2000);
    }

    ok(`Éphéméride : ${items.length} événement(s) — ${day} ${monthFR}`);
    return { date: dateStr, day, month, month_fr: monthFR, items };

  } catch (e) {
    warn(`Éphéméride : erreur — ${e.message}`);
    return null;
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${c.bold}${c.blue}━━━ CelliA — Veille Tech ━━━${c.reset}  ${IS_DEV ? c.yellow + '[DEV]' + c.reset : ''}\n`);

  const disponibles = PROVIDERS.filter(p => process.env[p.envKey]).map(p => p.name);
  log(`Providers : ${disponibles.join(' → ') || 'aucun !'}`);

  // 1. Config
  const configPath = path.join(__dirname, 'sources.json');
  const config     = JSON.parse(await fs.readFile(configPath, 'utf-8'));
  log(`${config.sources.length} sources configurées`);

  // 2. Cache
  const distPath   = path.join(__dirname, '..', 'dist', 'articles.json');
  let   cachedData = { articles: [], ephemeris: null };
  try {
    cachedData = JSON.parse(await fs.readFile(distPath, 'utf-8'));
    ok(`Cache : ${cachedData.articles?.length || 0} articles existants`);
  } catch { warn('Pas de cache existant'); }

  const cachedById = {};
  for (const a of (cachedData.articles || [])) {
    if (a.id && a.body?.length > 100) cachedById[a.id] = a;
  }

  // 3. Éphéméride (une seule fois par jour)
  const today = new Date().toISOString().slice(0, 10);
  let ephemeris = cachedData.ephemeris || null;
  if (!ephemeris || ephemeris.date !== today) {
    ephemeris = await fetchEphemeris(today);
  } else {
    ok(`Éphéméride du jour déjà en cache`);
  }

  // 4. RSS en parallèle
  log('Fetch des flux RSS...');
  const feedResults = await Promise.allSettled(
    config.sources.map(s => fetchFeed(s, config.keywords, config))
  );
  let allArticles = feedResults
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);
  ok(`${allArticles.length} articles bruts récupérés`);

  // 5. Dédupliquer
  const seenUrls = new Set();
  allArticles = allArticles.filter(a => { if (seenUrls.has(a.url)) return false; seenUrls.add(a.url); return true; });

  // 6. Trier + équilibrer
  allArticles.sort((a, b) => new Date(b.date) - new Date(a.date));
  const catCount = {};
  allArticles = allArticles.filter(a => { catCount[a.category] = (catCount[a.category]||0)+1; return catCount[a.category] <= 5; });
  allArticles = allArticles.slice(0, MAX_ARTICLES);
  log(`${allArticles.length} articles retenus`);

  // 7. fetchFullText en parallèle
  log('Extraction du texte complet...');
  await Promise.all(allArticles.map(async a => { a.fullText = await fetchFullText(a); }));

  // 8. Réécriture avec fallback
  log('Réécriture IA (Gemini → Mistral → Groq)...');
  let newCount = 0, cachedCount = 0;
  for (const article of allArticles) {
    if (cachedById[article.id]) {
      const cached        = cachedById[article.id];
      article.title       = cached.title;
      article.summary     = cached.summary;
      article.body        = cached.body;
      article.readingTime = cached.readingTime;
      cachedCount++;
      dim(`  Cache hit : ${article.title.slice(0, 55)}`);
    } else {
      const result        = await rewriteWithFallback(article);
      article.title       = result.title;
      article.summary     = result.summary;
      article.body        = result.body;
      article.readingTime = result.readingTime;
      newCount++;
      await sleep(5000);
    }
    delete article.fullText;
  }

  // 9. Images fallback
  for (const article of allArticles) {
    if (!article.image || !article.image.startsWith('http')) article.image = getUnsplashImage(article.category);
  }

  // 10. Fusion historique (90 jours)
  const cutoff      = Date.now() - 90 * 24 * 3600 * 1000;
  const newIds      = new Set(allArticles.map(a => a.id));
  const oldArticles = (cachedData.articles || []).filter(a => !newIds.has(a.id) && new Date(a.date).getTime() > cutoff);
  const finalArticles = [...allArticles, ...oldArticles];
  finalArticles.sort((a, b) => new Date(b.date) - new Date(a.date));

  // 11. Écriture JSON
  const output = {
    generated_at: new Date().toISOString(),
    count:        finalArticles.length,
    ephemeris:    ephemeris || null,
    articles:     finalArticles,
  };
  await fs.mkdir(path.join(__dirname, '..', 'dist'), { recursive: true });
  await fs.writeFile(distPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n${c.bold}━━━ Terminé ━━━${c.reset}`);
  ok(`${newCount} nouveaux | ${cachedCount} depuis cache | ${finalArticles.length} total`);
  if (ephemeris) ok(`Éphéméride : ${ephemeris.items.length} événement(s) — ${ephemeris.day} ${ephemeris.month_fr}`);
  ok(`Écrit : dist/articles.json`);
  console.log();
}

main().catch(e => { err(`Erreur fatale : ${e.message}`); console.error(e); process.exit(1); });
