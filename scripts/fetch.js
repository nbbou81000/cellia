import Parser  from 'rss-parser';
import fs      from 'fs/promises';
import path    from 'path';
import crypto  from 'crypto';
import { fileURLToPath } from 'url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const IS_DEV       = process.argv.includes('--dev');
const IS_PAID      = process.env.USE_PAID_GEMINI === 'true';
const IS_KORBEN    = process.env.USE_KORBEN === 'true';
const IS_FOND      = process.env.USE_FOND === 'true';
const MAX_ARTICLES = IS_DEV ? 3 : IS_PAID || IS_FOND ? 15 : IS_KORBEN ? 20 : 10;
const WINDOW_HOURS = IS_KORBEN ? 24 : 48;

// ─── Providers IA ─────────────────────────────────────────────────────────────
// Déclaré en `let` — overridé en mode payant dans main()
let PROVIDERS = [
  {
    name:      'Mistral',
    envKey:    'MISTRAL_API_KEY',
    type:      'openai',
    url:       'https://api.mistral.ai/v1/chat/completions',
    model:     'mistral-small-latest',
    maxTokens: 2000,
  },
  {
    name:      'Gemini',
    envKey:    'GEMINI_API_KEY',
    type:      'gemini',
    url:       'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
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

// Normalise une URL d'image : gère les URLs protocol-relative et filtre les non-HTTP
function normalizeImgUrl(url) {
  if (!url) return null;
  url = url.trim();
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('http')) return url;
  return null;
}

function extractImage(item) {
  // media:content (plusieurs formats possibles)
  const mc = item['media:content'];
  if (mc?.$.url)                             return normalizeImgUrl(mc.$.url);
  if (Array.isArray(mc) && mc[0]?.$.url)    return normalizeImgUrl(mc[0].$.url);

  // media:thumbnail
  if (item.mediaThumbnail?.$.url)            return normalizeImgUrl(item.mediaThumbnail.$.url);

  // enclosure (seulement si c'est bien une image)
  if (item.enclosure?.url && /\.(jpe?g|png|webp|gif|avif)/i.test(item.enclosure.url))
    return normalizeImgUrl(item.enclosure.url);

  // itunes:image (podcasts, certains blogs)
  if (item['itunes:image']?.$.href)          return normalizeImgUrl(item['itunes:image'].$.href);

  // Champ image direct
  if (typeof item.image === 'string')        return normalizeImgUrl(item.image);
  if (item.image?.url)                       return normalizeImgUrl(item.image.url);

  // Regex dans le contenu HTML (content:encoded prioritaire sur content)
  const html = item['content:encoded'] || item.content || item.description || '';
  // og:image ou twitter:image dans le contenu
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (ogMatch?.[1]) return normalizeImgUrl(ogMatch[1]);

  // Première <img> dans le contenu
  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch?.[1]) return normalizeImgUrl(imgMatch[1]);

  return null;
}

// Scoring : compte le nombre de mots-clés trouvés par catégorie → la plus haute gagne
// Bien meilleur que le "premier match" qui favorisait les catégories en tête de liste
const detectCategory = (text, kws) => {
  const l = text.toLowerCase();
  let bestCat = 'web', bestScore = 0;
  for (const [cat, words] of Object.entries(kws)) {
    const score = words.filter(w => l.includes(w)).length;
    if (score > bestScore) { bestScore = score; bestCat = cat; }
  }
  return bestCat;
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

// ─── Calcul temps de lecture réel ────────────────────────────────────────────
function calcReadingTime(body) {
  const text  = (body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text.split(' ').filter(w => w.length > 0).length;
  return Math.max(1, Math.ceil(words / 200));
}

// ─── Mode FOND : scorer les articles et choisir le meilleur ──────────────────
async function scorerMeilleurArticle(articles) {
  const PAID_KEY = process.env.GEMINI_PAID_API_KEY;
  if (!PAID_KEY) throw new Error('GEMINI_PAID_API_KEY manquante pour le mode fond');

  const liste = articles.map((a, i) =>
    `${i}. ${a.title}\n   ${(a.snippet||'').replace(/<[^>]+>/g,' ').slice(0,180).trim()}`
  ).join('\n\n');

  const prompt = `Tu es un éditeur tech senior français réputé.
Voici ${articles.length} articles candidats (titre + extrait) :

${liste}

Ta mission : identifier l'article le plus propice à un grand reportage de fond.
Critères : originalité, profondeur potentielle, impact sociétal ou technique durable, intérêt journalistique réel.
À ÉVITER : bon plan, promo, rumeur sans substance, simple mise à jour logicielle.
FAVORISER : découverte importante, analyse de tendance de fond, enjeu technologique majeur, sujet qui mérite contexte et investigation.

Réponds UNIQUEMENT avec le numéro de l'article (entre 0 et ${articles.length-1}), rien d'autre.`;

  const body = JSON.stringify({
    contents: [{ role:'user', parts:[{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 8, temperature: 0.1 }
  });
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${PAID_KEY}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body, signal: AbortSignal.timeout(30000) }
  );
  if (!resp.ok) throw new Error(`Scoring HTTP ${resp.status}`);
  const data = await resp.json();
  const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '0';
  const match = text.match(/\d+/);
  const idx   = match ? Math.min(parseInt(match[0]), articles.length - 1) : 0;
  return idx;
}

// ─── Mode FOND : réécriture longue forme ─────────────────────────────────────
async function rewriteFond(article) {
  const PAID_KEY = process.env.GEMINI_PAID_API_KEY;

  const prompt = `Tu es Korben, le blogueur tech français légendaire depuis plus de 20 ans.
Tu vas écrire un GRAND ARTICLE DE FOND exceptionnel sur ce sujet. Pas un simple résumé : une véritable exploration journalistique.

SUJET : ${article.title}
SOURCE : ${article.source}
TEXTE ORIGINAL :
${(article.fullText || article.snippet || '').slice(0, 4000)}

CONSIGNES IMPÉRATIVES :
- Longueur : 1500 mots MINIMUM, vise 2000 mots
- Structure avec 5 à 7 sections titrées en <h2>
- SECTION 1 : Accroche percutante et inattendue (pas "Introduction", pas de résumé bateau)
- SECTION 2 : Contexte et historique (d'où ça vient, comment on en est arrivé là)
- SECTION 3 : Analyse technique ou factuelle approfondie (avec détails concrets)
- SECTION 4 : Enjeux réels et implications pratiques (pour qui, pourquoi ça change quelque chose)
- SECTION 5 : Exemples concrets, anecdotes, comparaisons parlantes
- SECTION 6 (optionnel) : Ce que les autres ne disent pas, ton angle original
- SECTION FINALE : Ta vision personnelle, ce qui va se passer ensuite
- Style Korben : direct, passionné, humour geek discret, vulgarisation sans condescendance, références pop culture ou cinéma si pertinent
- Écris en HTML pur : <h2>, <p>, <strong>, <em>, <ul><li> — SANS balises markdown, SANS bloc de code
- Langue : français impeccable
- Le titre de l'article sera fourni séparément, ne le répète pas en début de corps

Génère l'article maintenant :`;

  const bodyPayload = JSON.stringify({
    contents: [{ role:'user', parts:[{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 6000, temperature: 0.75 }
  });
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${PAID_KEY}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body: bodyPayload, signal: AbortSignal.timeout(120000) }
  );
  if (!resp.ok) throw new Error(`Fond HTTP ${resp.status}`);
  const data  = await resp.json();
  const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('Réponse fond vide');
  return text.trim();
}
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
        source:   source.source_name || extractDomain(source.url),
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
      ['itunes:image','itunes:image',{keepArray:false}],
    ]},
  });
  let feed;
  try { feed = await parser.parseURL(source.url); }
  catch(e) { warn(`Flux indisponible : ${source.url} — ${e.message}`); return []; }

  const now = Date.now(), windowMs = WINDOW_HOURS*3600*1000, items = [];
  for (const item of feed.items||[]) {
    const pubDate = item.isoDate ? new Date(item.isoDate).getTime() : 0;
    if (pubDate && (now-pubDate) > windowMs) continue;
    // Titre — Google News ajoute " – NomSite" en suffixe → on retire
    let title = cleanText(item.title||'');
    if (source.source_name) {
      const site = source.source_name.split('.')[0];
      title = title.replace(new RegExp(`\\s*[–—-]\\s*${site}\\s*$`, 'i'), '').trim();
    }
    const url = item.link||item.url||'';
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
      source:   source.source_name || extractDomain(source.url),
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

// ─── fetchFullText + extraction og:image ─────────────────────────────────────
async function fetchFullText(article) {
  try {
    const res = await fetchWithTimeout(
      article.url,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CelliA-Bot/1.0)' } },
      5000
    );
    if (!res.ok) return article.snippet;
    const html = await res.text();

    // ── Extraire og:image / twitter:image si l'article n'a pas encore d'image ──
    if (!article.image) {
      const meta =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
        html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image/i);
      const imgUrl = normalizeImgUrl(meta?.[1]);
      if (imgUrl) article.image = imgUrl;
    }
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
- Corps : 280 à 380 mots — vrai article, pas un résumé
- Utilise 1 ou 2 <h2> pour structurer si pertinent
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

// Prompt mode PAYANT — format JSON, articles longs et structurés
function buildPaidPrompt(article) {
  return `Réécris cet article INTÉGRALEMENT dans le style de Korben.

RÈGLES :
- Traduis et réécris en français, style Korben : direct, geek, complice, avis tranché
- Le "body" doit faire entre 350 et 500 mots — vrai article de fond, pas un résumé
- Structure l'article avec 2 ou 3 <h2> pour guider la lecture
- Utilise <p>, <h2>, <strong> uniquement. Pas d'autres balises.
- L'accroche : une seule phrase punchy, max 25 mots
- Le titre : accrocheur, en français, max 90 caractères
- Donne ton analyse personnelle : contexte, enjeux, ce que ça change vraiment

FORMAT JSON — CRITIQUE :
- Réponds UNIQUEMENT avec un objet JSON valide (sans backticks, sans texte avant ou après)
- La valeur "body" DOIT être sur une seule ligne — paragraphes séparés par <p></p> directement collés, AUCUN \\n réel
- Format exact : {"titre_fr":"...","accroche":"...","body":"<p>texte</p><h2>titre</h2><p>texte</p>"}

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

  // Chercher |||BODY||| ou variantes (le modèle fait parfois des typos)
  const markers = ['|||BODY|||','|||BODY||','|||BODY|','---BODY---','## Corps','### Corps'];
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
  // Nettoyer les artefacts markdown et séparateurs résiduels dans le résumé
  summary = summary
    .replace(/^\*+\s*/,'').replace(/\s*\*+$/,'')      // ** gras markdown
    .replace(/\|\|\|BODY\|*/gi,'').replace(/---BODY---/gi,'')  // séparateurs résiduels
    .trim();
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

  // Cache — lecture depuis articles-full.json (avec bodies) ou articles.json en fallback
  const fullPath  = path.join(__dirname,'..','dist','articles-full.json');
  const distPath  = path.join(__dirname,'..','dist','articles.json');
  let cachedData = {articles:[], ephemeris:null};
  try {
    cachedData = JSON.parse(await fs.readFile(fullPath,'utf-8'));
    ok(`Cache : ${cachedData.articles?.length||0} articles (articles-full.json)`);
  } catch {
    try {
      cachedData = JSON.parse(await fs.readFile(distPath,'utf-8'));
      ok(`Cache : ${cachedData.articles?.length||0} articles (articles.json — fallback)`);
    } catch { warn('Pas de cache existant'); }
  }

  const cachedById={};
  for (const a of (cachedData.articles||[])) if (a.id&&a.body?.length>100) cachedById[a.id]=a;

  // Éphéméride (une fois par jour, toujours — peu importe le mode)
  const today = new Date().toISOString().slice(0,10);
  let ephemeris = cachedData.ephemeris||null;
  if (!ephemeris||ephemeris.date!==today) {
    ephemeris = await fetchEphemeris(today);
  } else {
    ok('Éphéméride du jour déjà en cache');
  }

  // RSS
  log('Fetch des flux RSS...');
  // Sources actives
  const activeSources = IS_KORBEN
    ? config.sources.filter(s => s.source_name === 'korben.info' || s.url.includes('korben'))
    : config.sources.filter(s => !s.paid_only || IS_PAID);

  if (IS_KORBEN) {
    log(`★ MODE SPÉCIAL KORBEN — ${activeSources.length} source(s) · fenêtre 24h · max ${MAX_ARTICLES} articles`);
  } else {
    log(`${activeSources.length} sources actives${IS_PAID ? ' (mode payant — toutes sources)' : ''}`);
  }

  const feedResults = await Promise.allSettled(
    activeSources.map(s =>
      s.proxy === 'rss2json'
        ? fetchFeedRss2Json(s, config.keywords, config)
        : fetchFeed(s, config.keywords, config)
    )
  );
  let allArticles = feedResults.filter(r=>r.status==='fulfilled').flatMap(r=>r.value);
  ok(`${allArticles.length} articles bruts récupérés`);

  // 1. Déduplication par URL exacte
  const seenUrls=new Set();
  allArticles=allArticles.filter(a=>{if(seenUrls.has(a.url))return false;seenUrls.add(a.url);return true;});

  // Sauvegarder les articles Korben avant que les filtres les éliminent (pour le mode payant)
  const korbenPool = [...allArticles]
    .filter(a => a.source === 'korben.info')
    .sort((a,b) => new Date(b.date) - new Date(a.date));

  // ── Diversité des sources : max par source (3 défaut, configurable) ────────
  if (!IS_KORBEN) {
    // Construire la map source → max_per_run
    const srcMaxMap = {};
    config.sources.forEach(s => {
      const key = s.source_name || (() => { try { return new URL(s.url).hostname.replace(/^www\./,''); } catch { return ''; } })();
      if (key && s.max_per_run) srcMaxMap[key] = s.max_per_run;
    });
    const DEFAULT_PER_SOURCE = 3;

    // Grouper par source, limiter aux N plus récents
    const bySource = {};
    allArticles.forEach(a => { (bySource[a.source] = bySource[a.source]||[]).push(a); });
    const before = allArticles.length;
    allArticles = Object.entries(bySource).flatMap(([src, arts]) => {
      const limit = srcMaxMap[src] ?? DEFAULT_PER_SOURCE;
      arts.sort((a,b) => new Date(b.date) - new Date(a.date));
      return arts.slice(0, limit);
    });
    if (allArticles.length < before) ok(`Diversité sources : ${before - allArticles.length} articles écrêtés (max ${DEFAULT_PER_SOURCE}/source, dev.to max 2)`);
  }

  // Fonctions de similarité Jaccard (utilisées pour dédup et garantie Korben)
  const FR_STOP = new Set(['le','la','les','de','du','des','un','une','en','et','ou','que','qui','se','sur','par','pour','avec','dans','au','aux','est','sont','a','l','d','ce','il','elle','on','nous','vous','ils','elles','je','tu','sa','son','ses','mon','ton','ma','ta','pas','plus','tout','bien','aussi','mais','donc','car','si','ni','ne','y','s']);
  function titleTokens(t) {
    return t.toLowerCase()
      .replace(/[^a-z0-9àâäéèêëîïôùûüœæç]/g,' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !FR_STOP.has(w));
  }
  function jaccard(t1, t2) {
    const s1 = new Set(titleTokens(t1));
    const s2 = new Set(titleTokens(t2));
    const inter = [...s1].filter(w => s2.has(w)).length;
    const union = new Set([...s1, ...s2]).size;
    return union === 0 ? 0 : inter / union;
  }

  // 2. Déduplication par sujet — désactivée en mode Korben (on veut tout)
  if (!IS_KORBEN) {
    const deduped = [];
    for (const a of allArticles) {
      const isDup = deduped.some(k => jaccard(k.title, a.title) > 0.30);
      if (!isDup) deduped.push(a);
      else dim(`  [dup sujet] "${a.title.slice(0,60)}…"`);
    }
    const dupCount = allArticles.length - deduped.length;
    if (dupCount > 0) ok(`${dupCount} doublon(s) de sujet éliminé(s)`);
    allArticles = deduped;
  }

  // Mode Korben : redater les articles au moment du fetch pour qu'ils remontent en tête
  if (IS_KORBEN) {
    const now = new Date().toISOString();
    allArticles = allArticles.map(a => ({ ...a, date: now }));
    ok(`Articles Korben redatés à maintenant (remontée en tête de liste)`);
  }

  allArticles.sort((a,b)=>new Date(b.date)-new Date(a.date));
  // Limite par catégorie — désactivée en mode Korben (une seule source)
  if (!IS_KORBEN) {
    // Mélange aléatoire dans chaque catégorie pour varier les sources à chaque run
    function shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    const byCat = {};
    allArticles.forEach(a => { (byCat[a.category] = byCat[a.category]||[]).push(a); });
    allArticles = Object.values(byCat).flatMap(group => {
      // Séparer les articles récents (<24h) des plus anciens
      const cutoff = Date.now() - 24 * 3600 * 1000;
      const recent = group.filter(a => new Date(a.date) > cutoff);
      const older  = group.filter(a => new Date(a.date) <= cutoff);
      // Mélanger les récents pour varier les sources qui "gagnent"
      shuffle(recent);
      return [...recent, ...older].slice(0, 5);
    });
  }
  allArticles=allArticles.slice(0,MAX_ARTICLES);

  // Mode payant : garantir au moins 1 article Korben s'il en existe
  if (IS_PAID && korbenPool.length > 0) {
    const hasKorben = allArticles.some(a => a.source === 'korben.info');
    if (!hasKorben) {
      // Prendre le plus récent qui n'est pas déjà un doublon sujet avec la sélection actuelle
      const best = korbenPool.find(k => !allArticles.some(a => jaccard(a.title, k.title) > 0.35));
      if (best) {
        allArticles[allArticles.length - 1] = best; // remplace le dernier slot
        ok(`Korben.info : article garanti — "${best.title.slice(0,55)}…"`);
      }
    } else {
      ok(`Korben.info : déjà présent dans la sélection`);
    }
  }
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

  // ── Redating universel : les nouveaux articles reçoivent l'heure du CRON ──
  // Garantit qu'ils remontent en tête quelle que soit leur date de publication source
  const fetchTime = Date.now();
  allArticles = allArticles.map((a, i) => ({
    ...a,
    date: new Date(fetchTime - i * 60000).toISOString() // 1 min d'écart pour conserver l'ordre
  }));
  ok(`Articles redatés au moment du fetch (${new Date(fetchTime).toLocaleTimeString('fr-FR')})`);

  // Fusion historique
  const cutoff=Date.now()-90*24*3600*1000;
  const newIds=new Set(allArticles.map(a=>a.id));
  const oldArticles=(cachedData.articles||[]).filter(a=>!newIds.has(a.id)&&new Date(a.date).getTime()>cutoff);
  const finalArticles=[...allArticles,...oldArticles];
  finalArticles.sort((a,b)=>new Date(b.date)-new Date(a.date));

  // Écriture — deux fichiers
  await fs.mkdir(path.join(__dirname,'..','dist'),{recursive:true});

  // 1. articles-full.json — avec bodies, pour article.html et le cache interne
  const outputFull = { generated_at:new Date().toISOString(), count:finalArticles.length, ephemeris:ephemeris||null, articles:finalArticles };
  await fs.writeFile(fullPath, JSON.stringify(outputFull), 'utf-8');

  // 2. articles.json — sans bodies, léger, pour index.html (~8x plus petit)
  const indexArticles = finalArticles.map(({ body, fullText, ...rest }) => rest);
  const outputIndex   = { generated_at:new Date().toISOString(), count:finalArticles.length, ephemeris:ephemeris||null, articles:indexArticles };
  await fs.writeFile(distPath, JSON.stringify(outputIndex), 'utf-8');

  console.log(`\n${c.bold}━━━ Terminé ━━━${c.reset}`);
  ok(`${newCount} nouveaux | ${cachedCount} depuis cache | ${finalArticles.length} total`);
  if (ephemeris) ok(`Éphéméride : ${ephemeris.items.length} événement(s)`);
  ok(`Écrit : dist/articles.json (index léger) + dist/articles-full.json (complet)`);
  console.log();

  // ── Mode FOND : sélection + réécriture longue forme ──────────────────────
  if (IS_FOND) {
    log('★ MODE ARTICLE DE FOND — sélection du meilleur sujet…');
    try {
      // 1. Scorer tous les articles du run (pas le cache)
      const candidats = allArticles.slice(0, 30); // top 30 du run
      const bestIdx   = await scorerMeilleurArticle(candidats);
      const choisi    = candidats[bestIdx];
      ok(`Article choisi (${bestIdx}) : "${choisi.title.slice(0,70)}…"`);
      ok(`Source : ${choisi.source}`);

      // 2. Récupérer le texte complet si pas encore fait
      if (!choisi.fullText || choisi.fullText.length < 200) {
        log('  Extraction du texte complet…');
        choisi.fullText = await fetchFullText(choisi.url);
      }

      // 3. Réécriture longue forme
      log('  Réécriture longue forme (Gemini 2.5 Flash, 6000 tokens)…');
      const bodyFond = await rewriteFond(choisi);
      const wordsFond = bodyFond.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
      ok(`Article de fond : ${wordsFond} mots`);

      // 4. Construire l'article fond
      const articleFond = {
        ...choisi,
        id:          'fond-' + choisi.id,
        type:        'fond',
        title:       choisi.title,
        body:        bodyFond,
        summary:     choisi.summary || choisi.snippet?.slice(0,200),
        readingTime: Math.max(5, Math.ceil(wordsFond / 200)),
        fondDate:    new Date().toISOString(),
      };
      delete articleFond.fullText;

      // 5. Sauvegarder dans articles-fond.json
      const fondPath    = path.join(__dirname,'..','dist','articles-fond.json');
      let fondExisting  = { articles: [] };
      try { fondExisting = JSON.parse(await fs.readFile(fondPath,'utf-8')); } catch {}
      // Éviter les doublons sur le même sujet
      const fondFiltered = (fondExisting.articles||[]).filter(a => a.id !== articleFond.id);
      fondFiltered.unshift(articleFond);
      const fondOutput = {
        generated_at: new Date().toISOString(),
        count:        fondFiltered.length,
        articles:     fondFiltered,
      };
      await fs.writeFile(fondPath, JSON.stringify(fondOutput), 'utf-8');
      ok(`Écrit : dist/articles-fond.json (${fondFiltered.length} articles de fond)`);

      // 6. Injecter en tête de articles-full.json — en retirant la version normale
      const fondForFull = { ...articleFond };
      const updatedFull = {
        ...outputFull,
        articles: [fondForFull, ...outputFull.articles.filter(a => a.id !== choisi.id)]
      };
      await fs.writeFile(fullPath, JSON.stringify(updatedFull), 'utf-8');

      // 7. Injecter en tête de articles.json — en retirant la version normale
      const { body: _b, fullText: _ft, ...fondIndex } = fondForFull;
      const updatedIndex = {
        ...outputIndex,
        articles: [fondIndex, ...outputIndex.articles.filter(a => a.id !== choisi.id)]
      };
      await fs.writeFile(distPath, JSON.stringify(updatedIndex), 'utf-8');

      ok(`Article de fond injecté en tête du site`);
    } catch(e) {
      err(`Mode fond échoué : ${e.message}`);
    }
  }
  process.exit(0);
}

main().catch(e=>{err(`Erreur fatale : ${e.message}`);console.error(e);process.exit(1);});
