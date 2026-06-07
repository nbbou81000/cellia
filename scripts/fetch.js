import Parser  from 'rss-parser';
import fs      from 'fs/promises';
import path    from 'path';
import crypto  from 'crypto';
import { fileURLToPath } from 'url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const IS_DEV       = process.argv.includes('--dev');
const IS_PAID      = process.env.USE_PAID_GEMINI === 'true';
const MAX_ARTICLES = IS_DEV ? 3 : 10;
const WINDOW_HOURS = 48;

// ─── Providers IA ─────────────────────────────────────────────────────────────
// Déclaré en `let` — overridé en mode payant dans main()
let PROVIDERS = [
  {
    name:      'Gemini',
    envKey:    'GEMINI_API_KEY',
    type:      'gemini',
    url:       'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    maxTokens: 1400,
  },
  {
    name:      'Mistral',
    envKey:    'MISTRAL_API_KEY',
    type:      'openai',
    url:       'https://api.mistral.ai/v1/chat/completions',
    model:     'mistral-small-latest',
    maxTokens: 1400,
  },
  {
    name:      'Groq',
    envKey:    'GROQ_API_KEY',
    type:      'openai',
    url:       'https://api.groq.com/openai/v1/chat/completions',
    model:     'llama-3.1-8b-instant',
    maxTokens: 1400,
  },
];

const PAID_PROVIDER = {
  name:      'Gemini-Payant',
  envKey:    'GEMINI_PAID_API_KEY',
  type:      'gemini',
  url:       'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  maxTokens: 6000,
};

// ─── Mots-clés éphéméride Wikipedia ──────────────────────────────────────────
const EPHEMERIS_KEYWORDS = [
  'computer','processor','microchip','transistor','semiconductor','microprocessor',
  'integrated circuit','circuit','chip','ram','hard disk','floppy','cd-rom','dvd',
  'usb','gpu','cpu','software','operating system','programming','algorithm','browser',
  'internet','world wide web','hypertext','email','domain','server','database',
  'encryption','open source','network','ethernet','modem','fiber optic','wi-fi',
  'bluetooth','mobile phone','smartphone','telephone','telegraph','radio','satellite',
  'spacecraft','rocket','orbit','artificial intelligence','robot','automation',
  'machine learning','apple','microsoft','google','ibm','intel','amd','nvidia',
  'amazon','facebook','twitter','youtube','spotify','netflix','atari','nintendo',
  'playstation','xbox','sega','linux','windows','macintosh','iphone','android','ipad',
  'digital','electronic','laser','pixel','display','graphics','video game','console',
  'arcade','streaming','podcast','hacker','virus','malware','cybersecurity',
  'inventor','invention','patent','laboratory','engineer','cloud','hardware',
];

const MONTHS_FR = [
  'janvier','février','mars','avril','mai','juin',
  'juillet','août','septembre','octobre','novembre','décembre',
];

// ─── Logs ANSI ────────────────────────────────────────────────────────────────
const c = {
  reset:'\x1b[0m', green:'\x1b[32m', yellow:'\x1b[33m', red:'\x1b[31m',
  blue:'\x1b[34m', dim:'\x1b[2m',    bold:'\x1b[1m',    cyan:'\x1b[36m',
};
const log  = msg => console.log(`${c.blue}▸${c.reset} ${msg}`);
const ok   = msg => console.log(`${c.green}✓${c.reset} ${msg}`);
const warn = msg => console.log(`${c.yellow}⚠${c.reset} ${msg}`);
const err  = msg => console.log(`${c.red}✗${c.reset} ${msg}`);
const dim  = msg => IS_DEV && console.log(`${c.dim}  ${msg}${c.reset}`);
const info = msg => console.log(`${c.cyan}  →${c.reset} ${msg}`);

// ─── Images Unsplash ──────────────────────────────────────────────────────────
const UNSPLASH_FALLBACK = {
  ai:       ['1677442135703-1787eea5ce01','1620712943543-bcc4688e7485'],
  secu:     ['1526374965328-7f61d4dc18c5','1510511459019-5dda7724fd87'],
  hardware: ['1518770660439-4636190af475','1611532736597-de2d4265fba3'],
  maker:    ['1581092160562-f4e7ce8b3e29','1518770660439-4636190af476'],
  web:      ['1461749280684-dccba630e2f6','1516116216624-53ad0571bc4c'],
  science:  ['1559757175-0eb30cd8c063','1446776811953-b23d57bd21aa'],
  auto:     ['1461749280684-dccba630e2f6','1516116216624-53ad0571bc4c'],
};
const getUnsplashImage = cat => {
  const ids = UNSPLASH_FALLBACK[cat] || UNSPLASH_FALLBACK.web;
  return `https://images.unsplash.com/photo-${ids[Math.floor(Math.random()*ids.length)]}?w=400&q=75&auto=format`;
};

const md5 = str => crypto.createHash('md5').update(str).digest('hex').slice(0,10);

function cleanText(html) {
  return (html||'')
    .replace(/<[^>]+>/g,' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/\s+/g,' ').trim();
}

function extractImage(item) {
  if (item['media:content']?.$.url) return item['media:content'].$.url;
  if (item.mediaThumbnail?.$.url)   return item.mediaThumbnail.$.url;
  if (item.enclosure?.url)          return item.enclosure.url;
  const m = (item.content||item['content:encoded']||'').match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

const detectCategory = (text, kws) => {
  const l = text.toLowerCase();
  for (const [cat, words] of Object.entries(kws)) if (words.some(w => l.includes(w))) return cat;
  return 'web';
};

const extractDomain = url => { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return url; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── fetchWithTimeout (Promise.race — fiable même si AbortController échoue) ─
function fetchWithTimeout(url, opts, ms) {
  return Promise.race([
    fetch(url, opts),
    new Promise((_,reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

// ─── fetchFeed via proxy rss2json (pour sites qui bloquent GitHub Actions) ────
async function fetchFeedRss2Json(source, keywords, config) {
  const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.url)}&count=30`;
  try {
    const res = await fetchWithTimeout(apiUrl, {
      headers: { 'User-Agent': 'CelliA-Bot/1.0', 'Accept': 'application/json' }
    }, 10000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(`API: ${data.message || 'erreur inconnue'}`);

    const now = Date.now(), windowMs = WINDOW_HOURS * 3600 * 1000, items = [];
    for (const item of data.items || []) {
      const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : 0;
      if (pubDate && (now - pubDate) > windowMs) continue;
      const title = cleanText(item.title || '');
      const url   = item.link || '';
      if (!title || !url) continue;
      if (source.tech_only) {
        if ((config.exclude_keywords || []).some(kw => title.toLowerCase().includes(kw))) continue;
      }
      const snippet  = cleanText(item.description || item.content || '').slice(0, 800);
      const category = source.category || detectCategory(`${title} ${snippet}`, keywords);
      const image    = item.thumbnail && item.thumbnail.startsWith('http') ? item.thumbnail : null;
      items.push({
        id:       md5(url),
        title, url,
        source:   extractDomain(source.url),
        date:     item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        image, snippet, category,
        lang:     source.lang || 'fr',
      });
    }
    dim(`  [proxy] ${source.url} → ${items.length} items`);
    return items;
  } catch (e) {
    warn(`Proxy rss2json échoué : ${source.url} — ${e.message}`);
    return [];
  }
}

// ─── fetchFeed ────────────────────────────────────────────────────────────────
async function fetchFeed(source, keywords, config) {
  const ua = source.userAgent || 'CelliA-Bot/1.0 (+https://cellia.netlify.app)';
  const parser = new Parser({
    timeout: 10000,
    headers: {
      'User-Agent':      ua,
      'Accept':          'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      'Cache-Control':   'no-cache',
    },
    customFields: { item: [
      ['media:content','media:content',{keepArray:false}],
      ['media:thumbnail','mediaThumbnail',{keepArray:false}],
      ['content:encoded','content:encoded'],
    ]},
  });
  let feed;
  try { feed = await parser.parseURL(source.url); }
  catch(e) { warn(`Flux indisponible : ${source.url} — ${e.message}`); return []; }

  const now = Date.now(), windowMs = WINDOW_HOURS*3600*1000, items = [];
  for (const item of feed.items||[]) {
    const pubDate = item.isoDate ? new Date(item.isoDate).getTime() : 0;
    if (pubDate && (now-pubDate) > windowMs) continue;
    const title = cleanText(item.title||''), url = item.link||item.url||'';
    if (!title||!url) continue;
    if (source.tech_only) {
      if ((config.exclude_keywords||[]).some(kw => title.toLowerCase().includes(kw))) continue;
    }
    const rawContent = item['content:encoded']||item.content||item.summary||'';
    const snippet    = cleanText(rawContent).slice(0,800);
    const img        = extractImage(item);
    items.push({
      id:       md5(url),
      title, url,
      source:   extractDomain(source.url),
      date:     item.isoDate||new Date().toISOString(),
      image:    img?.startsWith('http') ? img : null,
      snippet,
      category: source.category||detectCategory(`${title} ${snippet}`, keywords),
      lang:     source.lang||'en',
    });
  }
  dim(`  ${source.url} → ${items.length} items`);
  return items;
}

// ─── fetchFullText ────────────────────────────────────────────────────────────
async function fetchFullText(article) {
  try {
    const res = await fetchWithTimeout(
      article.url,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CelliA-Bot/1.0)' } },
      5000
    );
    if (!res.ok) return article.snippet;
    const html = await res.text();
    let container = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1]
      || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1]
      || html;
    const paragraphs=[]; let m;
    const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m=re.exec(container))!==null) {
      const t=cleanText(m[1]); if (t.length>40) paragraphs.push(t);
      if (paragraphs.length>=8) break;
    }
    const full=paragraphs.join(' ').slice(0,2000);
    return full.length>=200 ? full : article.snippet;
  } catch { return article.snippet; }
}

// ─── Prompts ──────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu incarnes Korben (korben.info), le blogueur tech français culte depuis 20 ans.

STYLE :
- Familier et complice, comme si tu parlais à des potes geeks — mais pas vulgaire
- Mélange les longueurs de phrases : quelques courtes percutantes, des moyennes, des plus développées. Jamais dix phrases ultra-courtes d'affilée.
- Évite les locutions isolées en rafale : "Clair.", "La loose.", "Voilà.", "Beau boulot." seuls sur une ligne — c'est une technique à utiliser avec parcimonie, pas systématiquement
- "les gars", "bref", "du coup", "franchement", "clairement", "en gros" : utilise-les naturellement, pas à chaque phrase
- Apartés entre parenthèses pour les blagues ou précisions (comme ça)
- Avis tranché et personnel — tu n'es pas neutre
- Humour sec et ironie légère, jamais lourd ni forcé
- Quand c'est impressionnant tu le dis, quand c'est du flan tu le démontes

TUTOIEMENT INTERDIT :
- N'utilise JAMAIS "tu", "te", "ton", "ta", "tes" pour t'adresser au lecteur
- Utilise "vous" ou reformule sans pronom direct ("les gars, vous voyez le truc ?", "on peut se demander si...")
- Le "tu" ne s'adresse qu'aux personnes citées dans l'article (un développeur, une entreprise), jamais au lecteur

JAMAIS :
- "Il convient de noter", "Dans le cadre de", "Il est important de souligner"
- Ton journalistique froid et neutre
- Anglais sauf noms propres tech (GPU, CPU, API…)
- Conclusion bateau type "En conclusion, nous pouvons dire que…"`;

// Prompt mode GRATUIT — format texte avec |||BODY|||
function buildFreePrompt(article) {
  return `Réécris cet article dans le style de Korben.

RÈGLES :
- Traduis et réécris intégralement en français
- Corps : 220 à 320 mots
- HTML : <p>, <h2>, <strong> UNIQUEMENT
- Termine toujours tes phrases

FORMAT EXACT :
TITRE_FR: [titre percutant, max 90 caractères]
ACCROCHE: [1 phrase max, 20 mots, punchy]
|||BODY|||
[corps HTML complet]

SOURCE :
Titre : ${article.title}
Source : ${article.source}
Contenu : ${article.fullText||article.snippet}`;
}

// Prompt mode PAYANT — format JSON (bien plus fiable)
function buildPaidPrompt(article) {
  return `Réécris cet article INTÉGRALEMENT dans le style de Korben.

RÈGLES :
- Traduis et réécris en français, style Korben : direct, geek, complice, phrases courtes, avis tranché
- Le "body" doit faire entre 250 et 350 mots — article complet, pas un résumé
- HTML pour le body : <p>, <h2>, <strong> uniquement. Pas d'autres balises.
- L'accroche : une seule phrase, max 25 mots
- Le titre : accrocheur, en français, max 90 caractères

FORMAT JSON — CRITIQUE :
- Réponds UNIQUEMENT avec un objet JSON valide (sans backticks, sans texte avant ou après)
- La valeur "body" DOIT être sur une seule ligne sans vrai retour à la ligne — les paragraphes sont séparés par les balises <p></p> directement collées, sans \\n entre elles
- N'utilise AUCUN \\n ni \\r dans les valeurs JSON
- Format exact sur une seule ligne : {"titre_fr":"...","accroche":"...","body":"<p>texte</p><p>texte</p>"}

SOURCE :
Titre : ${article.title}
Source : ${article.source}
Contenu : ${article.fullText||article.snippet}`;
}

// ─── callProvider ─────────────────────────────────────────────────────────────
async function callProvider(provider, systemPrompt, userPrompt) {
  if (provider.type === 'gemini') {
    return fetchWithTimeout(
      `${provider.url}?key=${process.env[provider.envKey]}`,
      {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          system_instruction: { parts:[{text:systemPrompt}] },
          contents:           [{ parts:[{text:userPrompt}] }],
          generationConfig: {
            temperature:     0.85,
            maxOutputTokens: provider.maxTokens||1400,
            topP:            0.95,
          },
        }),
      },
      30000
    );
  }
  return fetchWithTimeout(
    provider.url,
    {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env[provider.envKey]}`},
      body: JSON.stringify({
        model:       provider.model,
        messages:    [{role:'system',content:systemPrompt},{role:'user',content:userPrompt}],
        temperature: 0.85,
        max_tokens:  provider.maxTokens||1400,
      }),
    },
    30000
  );
}

function extractText(provider, data) {
  if (provider.type==='gemini') {
    if (data.error) throw new Error(data.error.message||'Erreur Gemini');
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()||'';
  }
  return data.choices?.[0]?.message?.content?.trim()||'';
}

// ─── Parsing mode PAYANT (JSON) ───────────────────────────────────────────────

// Répare un JSON invalide causé par de vrais retours à la ligne dans les valeurs string
function repairJSON(raw) {
  let result = '', inString = false, escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped)      { result += ch; escaped = false; continue; }
    if (ch === '\\')  { result += ch; escaped = true;  continue; }
    if (ch === '"')   { result += ch; inString = !inString; continue; }
    if (inString) {
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
    }
    result += ch;
  }
  return result;
}

// Extraction regex en dernier recours sur JSON malformé
function extractBodyFromRawJSON(text, article) {
  const titleM   = text.match(/"titre_fr"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const accM     = text.match(/"accroche"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  // Pour body on accepte les guillemets non fermés (JSON tronqué)
  const bodyM    = text.match(/"body"\s*:\s*"([\s\S]+?)(?:"\s*\}|$)/);
  if (!bodyM) return null;

  let body = bodyM[1]
    .replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  body = ensureParagraphs(body);
  if (!body || body.length < 50) return null;

  const titleFR = titleM
    ? titleM[1].replace(/\\n/g,'').replace(/\\"/g,'"').trim()
    : article.title;
  const summary = accM
    ? truncateToSentences(accM[1].replace(/\\n/g,' ').replace(/\\"/g,'"').trim())
    : article.snippet.slice(0, 200);
  const wordCount   = body.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.round(wordCount/200));
  return { title: titleFR, summary, body, readingTime };
}

function cleanBodyFromJSON(body) {
  return body
    // Convertir les séquences \\n littérales (backslash+n) en vraie newline
    .split('\\n').join('\n')
    .split('\\r').join('')
    // Normaliser les newlines multiples
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parsePaidResponse(rawText, article) {
  let text = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // Extraire le bloc JSON
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) text = text.slice(start, end + 1);

  // Niveau 1 : JSON.parse direct
  try {
    const json    = JSON.parse(text);
    const titleFR = (json.titre_fr || article.title).replace(/^["«]|["»]$/g, '').trim();
    const summary = truncateToSentences(cleanText(json.accroche || '')) || article.snippet.slice(0, 200);
    let   body    = cleanBodyFromJSON((json.body || '').trim());
    body          = ensureParagraphs(body);
    if (!body || body.length < 50) body = `<p>${article.snippet}</p>`;
    const wordCount   = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    const readingTime = Math.max(1, Math.round(wordCount / 200));
    ok(`    JSON parsé ✓ — ${wordCount} mots`);
    return { title: titleFR, summary, body, readingTime };
  } catch (_) {}

  // Niveau 2 : repairJSON (gère les vrais retours à la ligne dans les strings)
  try {
    const repaired = repairJSON(text);
    const json     = JSON.parse(repaired);
    const titleFR  = (json.titre_fr || article.title).replace(/^["«]|["»]$/g, '').trim();
    const summary  = truncateToSentences(cleanText(json.accroche || '')) || article.snippet.slice(0, 200);
    let   body     = cleanBodyFromJSON((json.body || '').trim());
    body           = ensureParagraphs(body);
    if (!body || body.length < 50) body = `<p>${article.snippet}</p>`;
    const wordCount   = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    const readingTime = Math.max(1, Math.round(wordCount / 200));
    ok(`    JSON réparé ✓ — ${wordCount} mots`);
    return { title: titleFR, summary, body, readingTime };
  } catch (_) {}

  // Niveau 3 : extraction regex (JSON tronqué ou malformé au-delà de la réparation)
  const regexResult = extractBodyFromRawJSON(text, article);
  if (regexResult && regexResult.body.length > 100) {
    warn(`    JSON regex ✓ — ${regexResult.body.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length} mots`);
    return regexResult;
  }

  // Niveau 4 : fallback texte générique
  warn(`    JSON échoué — fallback texte`);
  return parseTextResponse(rawText, article);
}

// ─── Parsing mode GRATUIT (texte + |||BODY|||) ────────────────────────────────
function truncateToSentences(text, maxChars=260) {
  if (!text||text.length<=maxChars) return text||'';
  const sentences = text.match(/[^.!?]+[.!?]+/g)||[];
  let out='';
  for (const s of sentences) { if ((out+s).length>maxChars) break; out+=s; }
  return out.trim()||text.slice(0,maxChars).trim()+'…';
}

function ensureParagraphs(html) {
  if (!html) return '';
  if (!html.includes('<p')) {
    return html.split(/\n\n+/).map(b=>b.trim()).filter(Boolean).map(b=>`<p>${b}</p>`).join('\n');
  }
  return html.replace(/^<strong>([\s\S]+)<\/strong>$/i,'$1').trim();
}

function parseTextResponse(text, article) {
  // Nettoyage backticks et preamble
  text = text.replace(/^```(?:html|json|text|markdown)?\n?/gm,'').replace(/```\s*$/gm,'').trim();
  const titreIdx = text.search(/^TITRE_FR:/m);
  if (titreIdx>0) text = text.slice(titreIdx);

  let titleFR = article.title;
  const titleMatch = text.match(/^TITRE_FR:\s*(.+)/m);
  if (titleMatch) titleFR = titleMatch[1].trim().replace(/^["«]|["»]$/g,'');

  let summary='', body='';

  // Chercher |||BODY||| ou variantes
  const markers = ['|||BODY|||','---BODY---','## Corps','### Corps'];
  let foundMarker=null, markerIdx=-1;
  for (const m of markers) { const i=text.indexOf(m); if (i!==-1){foundMarker=m;markerIdx=i;break;} }

  if (foundMarker) {
    const before  = text.slice(0,markerIdx);
    const rawBody = text.slice(markerIdx+foundMarker.length).trim()
      .replace(/^```html?\n?/,'').replace(/```\s*$/,'').trim();
    body = ensureParagraphs(rawBody);
    const am = before.match(/ACCROCHE:\s*([\s\S]+?)(?:\n{2,}|$)/);
    if (am) summary = truncateToSentences(cleanText(am[1]));
    else {
      const fp = rawBody.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      if (fp) summary = truncateToSentences(cleanText(fp[1]));
    }
  } else {
    // Pas de marqueur — chercher si le texte contient du HTML
    const htmlStart = text.search(/<p[^>]*>|<h[1-6]|<strong>/);
    if (htmlStart!==-1) {
      const before = text.slice(0,htmlStart);
      body = ensureParagraphs(text.slice(htmlStart).trim());
      const am = before.match(/ACCROCHE:\s*([\s\S]+?)$/);
      if (am) summary = truncateToSentences(cleanText(am[1]));
    } else {
      const clean = cleanText(text)
        .replace(/^TITRE_FR:[^\n]+\n?/m,'')
        .replace(/^ACCROCHE:[^\n]+\n?/m,'').trim();
      const am = text.match(/ACCROCHE:\s*([^\n]+)/);
      if (am) summary = am[1].trim();
      body = clean.split(/\n\n+/).filter(Boolean).map(b=>`<p>${b}</p>`).join('\n');
    }
  }

  body = ensureParagraphs(body);
  if (!body||body.length<50) body = `<p>${article.snippet}</p>`;
  if (!summary||summary.length<10) {
    const fp=body.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    summary = fp ? truncateToSentences(cleanText(fp[1])) : article.snippet.slice(0,200);
  }
  if (summary.length>300) summary=summary.slice(0,297)+'…';
  const wordCount   = body.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.round(wordCount/200));
  return { title:titleFR, summary, body, readingTime };
}

// ─── Réécriture avec fallback ─────────────────────────────────────────────────
async function rewriteWithFallback(article) {
  const available = PROVIDERS.filter(p => process.env[p.envKey]);
  if (!available.length) {
    warn('Aucune clé API — fallback snippet');
    return { title:article.title, summary:article.snippet, body:`<p>${article.snippet}</p>`, readingTime:1 };
  }

  for (const provider of PROVIDERS) {
    if (!process.env[provider.envKey]) { dim(`  ${provider.name} : clé absente`); continue; }
    try {
      info(`${provider.name}...`);
      const userPrompt = IS_PAID ? buildPaidPrompt(article) : buildFreePrompt(article);
      const response   = await callProvider(provider, SYSTEM_PROMPT, userPrompt);

      if (response.status===429) { warn(`  ${provider.name} : 429 → suivant`); continue; }
      if (!response.ok)          { warn(`  ${provider.name} : HTTP ${response.status} → suivant`); continue; }

      const data = await response.json();
      const text = extractText(provider, data);
      if (!text||text.length<50) { warn(`  ${provider.name} : réponse vide → suivant`); continue; }

      // Parser selon le mode
      const result = IS_PAID ? parsePaidResponse(text, article) : parseTextResponse(text, article);

      // En mode payant : vérifier la longueur du corps, retry si trop court
      if (IS_PAID) {
        const wc = result.body.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
        if (wc < 150) {
          warn(`  Corps trop court (${wc} mots) — retry...`);
          await sleep(3000);
          const r2      = await callProvider(provider, SYSTEM_PROMPT, buildPaidPrompt(article));
          if (r2.ok) {
            const d2 = await r2.json();
            const t2 = extractText(provider, d2);
            if (t2&&t2.length>50) {
              const r2parsed = parsePaidResponse(t2, article);
              const wc2 = r2parsed.body.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
              if (wc2>wc) {
                ok(`  ${provider.name} ✓ retry — ${wc2} mots`);
                return r2parsed;
              }
            }
          }
        }
        const wcFinal = result.body.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
        ok(`  ${provider.name} ✓ — ${wcFinal} mots — ${article.title.slice(0,40)}`);
      } else {
        ok(`  ${provider.name} ✓ — ${article.title.slice(0,45)}`);
      }
      return result;

    } catch(e) { warn(`  ${provider.name} : ${e.message} → suivant`); }
  }

  err(`Tous les providers ont échoué [${article.id}]`);
  return { title:article.title, summary:article.snippet, body:`<p>${article.snippet}</p>`, readingTime:1 };
}

// ─── Éphéméride tech ─────────────────────────────────────────────────────────
async function rewriteEphemerisEvent(event, day, monthFR) {
  const system = `Tu incarnes Korben (korben.info). Style direct, geek, complice, légèrement ironique.`;
  const user   = `Réécris cet événement tech historique dans le style de Korben pour une section "éphéméride tech du jour".

RÈGLES :
- 2 à 4 phrases, texte brut (pas de HTML)
- Commence par "En ${event.year}," ou "C'était en ${event.year},"
- Traduis intégralement en français
- Ton Korben : direct, avis personnel, pointe d'humour si pertinent

ÉVÉNEMENT : ${event.text}`;

  for (const provider of PROVIDERS) {
    if (!process.env[provider.envKey]) continue;
    try {
      const response = await callProvider(provider, system, user);
      if (!response.ok) continue;
      const data = await response.json();
      const text = extractText(provider, data);
      if (text&&text.length>20) return text.trim();
    } catch { continue; }
  }
  return event.text;
}

async function fetchEphemeris(dateStr) {
  const [yearStr,monthStr,dayStr] = dateStr.split('-');
  const month=parseInt(monthStr), day=parseInt(dayStr), monthFR=MONTHS_FR[month-1];
  log(`Éphéméride tech : ${day} ${monthFR}...`);

  const endpoints = [
    `https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/${month}/${day}`,
    `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`,
  ];
  let techEvents=[];

  for (const url of endpoints) {
    try {
      const res = await fetchWithTimeout(url,{headers:{'User-Agent':'CelliA-Bot/1.0','Accept':'application/json'}},8000);
      if (!res.ok) continue;
      const data   = await res.json();
      const events = data.events||data.selected||[];
      techEvents   = events.filter(e => {
        if (!e.year||parseInt(e.year)>=parseInt(yearStr)) return false;
        const t=(e.text||'').toLowerCase();
        return EPHEMERIS_KEYWORDS.some(kw => t.includes(kw));
      });
      if (techEvents.length>0) break;
    } catch(e) { warn(`  Wikipedia : ${e.message}`); }
  }

  if (!techEvents.length) { warn('Éphéméride : aucun événement tech trouvé'); return null; }

  techEvents.sort((a,b)=>a.year-b.year);
  const selected = techEvents[0]===techEvents[techEvents.length-1]
    ? [techEvents[0]]
    : [techEvents[0], techEvents[techEvents.length-1]];

  const items=[];
  for (const event of selected) {
    const summary  = await rewriteEphemerisEvent(event, day, monthFR);
    const wikiPage = event.pages?.[0];
    items.push({
      year:          event.year,
      original:      event.text,
      summary,
      wikipedia_url: wikiPage?.content_urls?.desktop?.page||null,
      thumbnail:     wikiPage?.thumbnail?.source||null,
    });
    await sleep(2000);
  }
  ok(`Éphéméride : ${items.length} événement(s) — ${day} ${monthFR}`);
  return { date:dateStr, day, month, month_fr:monthFR, items };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${c.bold}${c.blue}━━━ CelliA — Veille Tech ━━━${c.reset}  ${IS_DEV?c.yellow+'[DEV]'+c.reset:''}\n`);

  // Override providers en mode payant
  if (IS_PAID) {
    PROVIDERS = [PAID_PROVIDER];
    console.log(`${c.yellow}${c.bold}  ★ MODE PAYANT — Gemini 2.5 Flash — JSON — 3000 tokens${c.reset}\n`);
  }

  const disponibles = PROVIDERS.filter(p=>process.env[p.envKey]).map(p=>p.name);
  log(`Providers : ${disponibles.join(' → ')||'aucun !'}`);

  // Config
  const config = JSON.parse(await fs.readFile(path.join(__dirname,'sources.json'),'utf-8'));
  log(`${config.sources.length} sources configurées`);

  // Cache
  const distPath = path.join(__dirname,'..','dist','articles.json');
  let cachedData = {articles:[], ephemeris:null};
  try { cachedData=JSON.parse(await fs.readFile(distPath,'utf-8')); ok(`Cache : ${cachedData.articles?.length||0} articles`); }
  catch { warn('Pas de cache existant'); }

  const cachedById={};
  for (const a of (cachedData.articles||[])) if (a.id&&a.body?.length>100) cachedById[a.id]=a;

  // Éphéméride (une fois par jour, ignorée en mode payant pour économiser)
  const today = new Date().toISOString().slice(0,10);
  let ephemeris = cachedData.ephemeris||null;
  if (!IS_PAID && (!ephemeris||ephemeris.date!==today)) {
    ephemeris = await fetchEphemeris(today);
  } else if (!IS_PAID) {
    ok('Éphéméride du jour déjà en cache');
  }

  // RSS
  log('Fetch des flux RSS...');
  const feedResults = await Promise.allSettled(
    config.sources.map(s =>
      s.proxy === 'rss2json'
        ? fetchFeedRss2Json(s, config.keywords, config)
        : fetchFeed(s, config.keywords, config)
    )
  );
  let allArticles = feedResults.filter(r=>r.status==='fulfilled').flatMap(r=>r.value);
  ok(`${allArticles.length} articles bruts récupérés`);

  const seenUrls=new Set();
  allArticles=allArticles.filter(a=>{if(seenUrls.has(a.url))return false;seenUrls.add(a.url);return true;});
  allArticles.sort((a,b)=>new Date(b.date)-new Date(a.date));
  const catCount={};
  allArticles=allArticles.filter(a=>{catCount[a.category]=(catCount[a.category]||0)+1;return catCount[a.category]<=5;});
  allArticles=allArticles.slice(0,MAX_ARTICLES);
  log(`${allArticles.length} articles retenus`);

  // fetchFullText
  log('Extraction du texte complet...');
  await Promise.all(allArticles.map(async a=>{a.fullText=await fetchFullText(a);}));

  // Réécriture
  log(`Réécriture IA${IS_PAID?' (mode payant)':''}...`);
  let newCount=0, cachedCount=0;

  for (const article of allArticles) {
    // En mode payant : TOUJOURS réécrire, même si en cache, pour qualité maximale
    if (!IS_PAID && cachedById[article.id]) {
      const cached=cachedById[article.id];
      article.title=cached.title; article.summary=cached.summary;
      article.body=cached.body;   article.readingTime=cached.readingTime;
      cachedCount++; dim(`  Cache hit : ${article.title.slice(0,55)}`);
    } else {
      const result=await rewriteWithFallback(article);
      article.title=result.title; article.summary=result.summary;
      article.body=result.body;   article.readingTime=result.readingTime;
      newCount++;
      await sleep(IS_PAID ? 3000 : 5000);
    }
    delete article.fullText;
  }

  // Images
  for (const a of allArticles) if (!a.image||!a.image.startsWith('http')) a.image=getUnsplashImage(a.category);

  // Fusion historique
  const cutoff=Date.now()-90*24*3600*1000;
  const newIds=new Set(allArticles.map(a=>a.id));
  const oldArticles=(cachedData.articles||[]).filter(a=>!newIds.has(a.id)&&new Date(a.date).getTime()>cutoff);
  const finalArticles=[...allArticles,...oldArticles];
  finalArticles.sort((a,b)=>new Date(b.date)-new Date(a.date));

  // Écriture
  const output={generated_at:new Date().toISOString(), count:finalArticles.length, ephemeris:ephemeris||null, articles:finalArticles};
  await fs.mkdir(path.join(__dirname,'..','dist'),{recursive:true});
  await fs.writeFile(distPath,JSON.stringify(output,null,2),'utf-8');

  console.log(`\n${c.bold}━━━ Terminé ━━━${c.reset}`);
  ok(`${newCount} nouveaux | ${cachedCount} depuis cache | ${finalArticles.length} total`);
  if (ephemeris) ok(`Éphéméride : ${ephemeris.items.length} événement(s)`);
  ok(`Écrit : dist/articles.json`);
  console.log();
}

main().catch(e=>{err(`Erreur fatale : ${e.message}`);console.error(e);process.exit(1);});
