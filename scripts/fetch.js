import Parser  from 'rss-parser';
import fs      from 'fs/promises';
import path    from 'path';
import crypto  from 'crypto';
import { fileURLToPath } from 'url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const IS_DEV            = process.argv.includes('--dev');
const IS_PAID           = process.env.USE_PAID_GEMINI === 'true';
const IS_KORBEN         = process.env.USE_KORBEN === 'true';
const IS_FOND           = process.env.USE_FOND === 'true';
const IS_MISTRAL_BOOST  = process.env.USE_MISTRAL_BOOST === 'true';
const IS_SCHEDULED      = process.env.IS_SCHEDULED === 'true';
const MAX_ARTICLES = IS_DEV ? 3
  : IS_PAID || IS_FOND    ? 15
  : IS_KORBEN             ? 20
  : IS_MISTRAL_BOOST      ? (IS_SCHEDULED ? 15 : 20)
  : 10;
const WINDOW_HOURS = IS_KORBEN ? 24 : 48;

// ─── Providers IA ─────────────────────────────────────────────────────────────
// Déclaré en `let` — overridé en mode payant dans main()
let PROVIDERS = [
  {
    name:      'Mistral',
    envKey:    'MISTRAL_API_KEY',
    type:      'openai',
    url:       'https://api.mistral.ai/v1/chat/completions',
    model:     'mistral-small-2506',
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

const MISTRAL_BOOST_PROVIDER = {
  name:        'Mistral-Boost',
  envKey:      'MISTRAL_API_KEY',
  type:        'openai',
  url:         'https://api.mistral.ai/v1/chat/completions',
  model:       'mistral-small-2506',
  maxTokens:   8000,
  temperature: 0.7,
  jsonMode:    true,
  callTimeout: 90000, // 90s — nécessaire pour générer ~8000 tokens
};

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
  const MISTRAL_KEY = process.env.MISTRAL_API_KEY;
  if (!MISTRAL_KEY) throw new Error('MISTRAL_API_KEY manquante pour le mode fond');

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

  const resp = await fetch(
    'https://api.mistral.ai/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MISTRAL_KEY}` },
      body: JSON.stringify({
        model: 'mistral-small-2506',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 10,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(30000)
    }
  );
  if (!resp.ok) throw new Error(`Scoring HTTP ${resp.status}`);
  const data  = await resp.json();
  const text  = data?.choices?.[0]?.message?.content || '0';
  const match = text.match(/\d+/);
  const idx   = match ? Math.min(parseInt(match[0]), articles.length - 1) : 0;
  return idx;
}

// ─── Mode FOND : réécriture longue forme ─────────────────────────────────────
async function rewriteFond(article) {
  const MISTRAL_KEY = process.env.MISTRAL_API_KEY;

  const prompt = `Tu es un journaliste tech indépendant, passionné et pédagogue, avec plus de 20 ans d'expérience dans le web francophone.
Tu vas écrire un GRAND ARTICLE DE FOND sur ce sujet. Pas un simple résumé : une véritable exploration journalistique, engagée mais nuancée.

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
- Style : engagé, passionné, humour discret, vulgarisation sans condescendance, références pop culture ou cinéma si pertinent
- Écris en HTML pur : <h2>, <p>, <strong>, <em>, <ul><li> — SANS balises markdown, SANS bloc de code
- Langue : français impeccable
- Le titre de l'article sera fourni séparément, ne le répète pas en début de corps

Génère l'article maintenant :`;

  const resp = await fetch(
    'https://api.mistral.ai/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MISTRAL_KEY}` },
      body: JSON.stringify({
        model: 'mistral-small-2506',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 8000,
        temperature: 0.75,
      }),
      signal: AbortSignal.timeout(120000)
    }
  );
  if (!resp.ok) throw new Error(`Fond HTTP ${resp.status}`);
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content || '';
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
const SYSTEM_PROMPT = `Tu es un blogueur tech français passionné et geek — une voix indépendante du web francophone depuis plus de 20 ans.

STYLE :
- Ton direct et vivant, avec une vraie personnalité — on a un avis, on le dit sans tourner autour du pot
- On s'adresse à des gens qui s'y connaissent, pas à des débutants — pas besoin d'expliquer ce qu'est une API
- Mélange les longueurs de phrases : des courtes pour marteler un point, des moyennes, des plus développées pour l'analyse
- Petites touches de familiarité bienvenues quand elles sont naturelles — pas forcées, pas vulgaires
- Ironie légère et humour sec quand la situation s'y prête (une annonce gonflée, une promesse déjà vue cent fois...)
- Apartés entre parenthèses pour les précisions, les blagues discrètes ou les coups de griffe (comme ça)
- Quand c'est impressionnant on le dit sans retenue. Quand c'est du vent, on le dit aussi.
- Utilise "on" naturellement pour embarquer le lecteur ("on voit bien que", "on peut se demander", "c'est là que ça devient intéressant")

RÉPÉTITION DU SUJET INTERDITE :
- Ne répète pas le nom de l'entreprise, du produit ou de la technologie principale plus de 2 fois dans tout l'article
- Utilise des substituts naturels selon le contexte : "la startup", "l'entreprise", "la société", "l'éditeur", "le service", "l'outil", "elle", "ils", "ce dernier"
- Varie systématiquement — jamais deux substituts identiques consécutifs

COHÉRENCE FACTUELLE ABSOLUE :
- Un seul chiffre, une seule date, un seul fait par information — jamais deux versions du même élément dans le même article
- Si tu mentionnes un montant ou une date au début, tu utilises exactement le même partout
- Relis mentalement avant de conclure : y a-t-il des contradictions entre les paragraphes ?

STRUCTURE :
- Chaque angle n'est traité qu'une seule fois — pas de paragraphes qui couvrent le même sujet sous un angle légèrement différent
- Maximum 1 ou 2 questions rhétoriques dans tout l'article — jamais une rafale de questions sans réponse
- Si on pose une question, on y répond ou on donne un avis — pas de questions suspendues dans le vide

INTERDIT :
- "je" et "j'" pour parler en son nom propre
- Tutoiement : jamais "tu", "te", "ton", "ta", "tes" pour s'adresser au lecteur
- "les gars", "franchement", "clairement", "en gros", "clair.", "la loose.", "beau boulot."
- "Une chose est sûre" — expression interdite, trop éculée
- "Reste à voir si…", "les résultats restent à venir", "seul l'avenir nous le dira" — conclusions vagues interdites
- "Il convient de noter", "Dans le cadre de", "Il est important de souligner"
- Ton journalistique froid, neutre, impersonnel
- Anglais sauf noms propres tech (GPU, CPU, API, RAM…)
- Conclusion bateau type "En conclusion, nous pouvons dire que…"`;

// Prompt mode GRATUIT — format texte avec |||BODY|||
function buildFreePrompt(article) {
  return `Réécris cet article dans un style tech direct, geek et personnel.

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

// Prompt mode PAYANT Gemini — JSON, 350-500 mots (inchangé)
function buildPaidPrompt(article) {
  return `Réécris cet article dans un style tech direct, geek et personnel.

RÈGLES :
- Traduis et réécris en français, style engagé, geek, accessible, avis nuancé mais personnel
- Le "body" doit faire entre 350 et 500 mots — vrai article de fond, pas un résumé
- Structure l'article avec 2 ou 3 <h2> pour guider la lecture
- Utilise <p>, <h2>, <strong> uniquement. Pas d'autres balises.
- L'accroche : une seule phrase punchy, max 25 mots
- Le titre "titre_fr" : OBLIGATOIREMENT en français correct, accrocheur, max 90 caractères, sans fautes, sans mélange anglais/français

FORMAT JSON — CRITIQUE :
- Réponds UNIQUEMENT avec un objet JSON valide (sans backticks, sans texte avant ou après)
- COMPLÈTE ENTIÈREMENT la réponse JSON avant de t'arrêter — ne jamais tronquer
- La valeur "body" DOIT être sur une seule ligne — paragraphes séparés par <p></p> directement collés, AUCUN \\n réel
- Format exact : {"titre_fr":"...","accroche":"...","body":"<p>texte</p><h2>titre</h2><p>texte</p>"}

SOURCE :
Titre : ${article.title}
Source : ${article.source}
Contenu : ${(article.fullText||article.snippet||'').slice(0, 2000)}`;
}

// Prompt mode MISTRAL BOOST — JSON, 600-1000 mots, structure plus riche
function buildMistralBoostPrompt(article) {
  return `Réécris cet article en français dans un style tech engagé, passionné et accessible.

⚠️ LONGUEUR : entre 700 et 1000 mots. Ne termine pas avant 700 mots.

CONSIGNES :
- Reste STRICTEMENT fidèle au contenu source — ne retranche rien d'important, n'invente aucun fait, chiffre ou citation absent de l'article original
- Réécris dans l'ordre logique de l'article source, en développant chaque point
- Tu peux structurer avec quelques <h2> si c'est naturel et pertinent, mais ce n'est pas obligatoire
- Si la source ne suffit pas pour atteindre 700 mots sans inventer, développe uniquement le contexte technique général connu (fonctionnement de la technologie, définitions) — jamais des faits spécifiques inventés
- Balises autorisées : <p>, <h2>, <strong> uniquement
- Titre "titre_fr" : en français, accrocheur, max 90 caractères, sans fautes

FORMAT JSON — une seule ligne, zéro retour chariot dans "body" :
{"titre_fr":"...","accroche":"une phrase d'accroche max 25 mots","body":"<p>...</p>"}
JSON complet et valide — aucun texte avant ou après les accolades.

SOURCE :
Titre : ${article.title}
Source : ${article.source}
Contenu : ${(article.fullText||article.snippet||'').slice(0, 2000)}`;
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
        temperature: provider.temperature ?? 0.85,
        max_tokens:  provider.maxTokens||1400,
        ...(provider.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    },
    provider.callTimeout || 30000
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

// Répare un body HTML potentiellement tronqué en plein milieu d'une phrase/tag
function fixTruncatedBody(html) {
  if (!html) return '';
  html = html.replace(/<[^>]*$/, '').trim();
  html = html.replace(/<h2[^>]*>[^<]*$/, '').trim();
  const lastPOpen  = html.lastIndexOf('<p');
  const lastPClose = html.lastIndexOf('</p>');
  if (lastPOpen > lastPClose) {
    const fragment = html.slice(lastPOpen);
    if (fragment.length < 80) {
      html = html.slice(0, lastPOpen).trim();
    } else {
      html = html + '</p>';
    }
  }
  html = html.replace(/\\n\s*["\\}]+\s*$/, '').replace(/["\\}]{2,}\s*$/, '').trim();
  return html;
}

// Vérifie que le body se termine sur une phrase complète — coupe proprement sinon
function sealBodyEnd(body) {
  if (!body) return body;
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || /[.!?»]$/.test(text)) return body; // déjà propre
  const lastDot   = body.lastIndexOf('.');
  const lastExcl  = body.lastIndexOf('!');
  const lastQuest = body.lastIndexOf('?');
  const lastPunct = Math.max(lastDot, lastExcl, lastQuest);
  if (lastPunct < body.length * 0.4) return body; // trop loin, on garde tel quel
  let cut = body.slice(0, lastPunct + 1).trim();
  if (!cut.endsWith('>')) cut += '</p>';
  return cut;
}

// Extraction manuelle du body depuis un JSON malformé/tronqué (gère les \" échappés)
function extractBodyFromRawJSON(text, article) {
  const titleM = text.match(/"titre_fr"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/);
  const accM   = text.match(/"accroche"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/);

  // Extraction caractère par caractère — résiste aux guillemets échappés et au JSON tronqué
  const bodyKeyPos = text.indexOf('"body"');
  if (bodyKeyPos === -1) return null;

  const quoteOpen = text.indexOf('"', bodyKeyPos + 6);
  if (quoteOpen === -1) return null;

  let body = '';
  let i = quoteOpen + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === '"')  { body += '"';  i += 2; continue; }
      if (next === 'n')  { body += '\n'; i += 2; continue; }
      if (next === 'r')  { i += 2; continue; }
      if (next === '\\') { body += '\\'; i += 2; continue; }
      body += ch; i++; continue;
    }
    if (ch === '"') break; // guillemet fermant = fin du body
    body += ch;
    i++;
  }

  body = fixTruncatedBody(body.trim());
  body = ensureParagraphs(body);
  if (!body || body.length < 50) return null;

  const titleFR = titleM
    ? titleM[1].replace(/\\n/g,'').replace(/\\"/g,'"').trim()
    : article.title;
  const summary = accM
    ? truncateToSentences(accM[1].replace(/\\n/g,' ').replace(/\\"/g,'"').trim())
    : (article.snippet||'').slice(0, 200);
  const wordCount   = body.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.round(wordCount / 200));
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
    let   body    = sealBodyEnd(fixTruncatedBody(cleanBodyFromJSON((json.body || '').trim())));
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
    let   body     = sealBodyEnd(fixTruncatedBody(cleanBodyFromJSON((json.body || '').trim())));
    body           = ensureParagraphs(body);
    if (!body || body.length < 50) body = `<p>${article.snippet}</p>`;
    const wordCount   = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    const readingTime = Math.max(1, Math.round(wordCount / 200));
    ok(`    JSON réparé ✓ — ${wordCount} mots`);
    return { title: titleFR, summary, body, readingTime };
  } catch (_) {}

  // Niveau 3 : extraction regex (JSON tronqué ou malformé)
  const regexResult = extractBodyFromRawJSON(text, article);
  if (regexResult && regexResult.body.length > 100) {
    regexResult.body = sealBodyEnd(fixTruncatedBody(regexResult.body));
    regexResult.body = ensureParagraphs(regexResult.body);
    const wc = regexResult.body.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
    regexResult.readingTime = Math.max(1, Math.round(wc / 200));
    warn(`    JSON regex ✓ — ${wc} mots`);
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
      const sourceText  = (article.fullText || article.snippet || '').trim();
      const sourceWords = sourceText.split(/\s+/).filter(Boolean).length;
      const useJsonMode = IS_PAID || IS_MISTRAL_BOOST; // toujours JSON pour Mistral
      const userPrompt  = IS_MISTRAL_BOOST
        ? (sourceWords >= 120 ? buildMistralBoostPrompt(article) : buildPaidPrompt(article))
        : IS_PAID ? buildPaidPrompt(article)
        :           buildFreePrompt(article);
      if (IS_MISTRAL_BOOST && sourceWords < 120) dim(`  Source courte (${sourceWords} mots) → prompt 350 mots (Mistral JSON)`);
      const response   = await callProvider(provider, SYSTEM_PROMPT, userPrompt);

      if (response.status===429) { warn(`  ${provider.name} : 429 → suivant`); continue; }
      if (!response.ok)          { warn(`  ${provider.name} : HTTP ${response.status} → suivant`); continue; }

      const data = await response.json();
      const text = extractText(provider, data);
      if (!text||text.length<50) { warn(`  ${provider.name} : réponse vide → suivant`); continue; }

      // Parser selon le mode
      const result = useJsonMode ? parsePaidResponse(text, article) : parseTextResponse(text, article);

      // En mode JSON : vérifier la longueur du corps, retry si trop court
      if (useJsonMode) {
        const wc = result.body.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
        // Seuil de retry adapté au mode : 400 mots pour Mistral Boost (cible 700), 150 pour Gemini
        const retryThreshold = IS_MISTRAL_BOOST ? 400 : 150;
        if (wc < retryThreshold) {
          warn(`  Corps trop court (${wc} mots < ${retryThreshold}) — retry...`);
          await sleep(IS_MISTRAL_BOOST ? 2000 : 3000);
          // Utiliser le bon prompt selon le mode
          const retryPrompt = IS_MISTRAL_BOOST
            ? (sourceWords >= 120 ? buildMistralBoostPrompt(article) : buildPaidPrompt(article))
            : buildPaidPrompt(article);
          const r2 = await callProvider(provider, SYSTEM_PROMPT, retryPrompt);
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
// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${c.bold}${c.blue}━━━ CelliA — Veille Tech ━━━${c.reset}  ${IS_DEV?c.yellow+'[DEV]'+c.reset:''}\n`);

  // Override providers en mode payant
  if (IS_PAID) {
    PROVIDERS = [PAID_PROVIDER];
    console.log(`${c.yellow}${c.bold}  ★ MODE PAYANT — Gemini 2.5 Flash — JSON — 3000 tokens${c.reset}\n`);
  }

  // Mode Mistral Boost : mistral-small-latest, JSON, 3000 tokens, 20 articles
  if (IS_MISTRAL_BOOST) {
    PROVIDERS = [MISTRAL_BOOST_PROVIDER];
    console.log(`${c.cyan}${c.bold}  ★ MODE MISTRAL BOOST — mistral-small-2506 — JSON — 4000 tokens — ${MAX_ARTICLES} articles${c.reset}\n`);
  }

  const disponibles = PROVIDERS.filter(p=>process.env[p.envKey]).map(p=>p.name);
  log(`Providers : ${disponibles.join(' → ')||'aucun !'}`);

  // Config
  const allConfig = JSON.parse(await fs.readFile(path.join(__dirname,'sources.json'),'utf-8'));
  // Sources désactivées depuis le panneau admin (disabled: true)
  const config    = allConfig.filter(s => !s.disabled);
  if (allConfig.length !== config.length)
    ok(`Sources : ${config.length}/${allConfig.length} actives (${allConfig.length - config.length} désactivées)`);
  log(`${config.sources.length} sources configurées`);

  // Cache — lecture depuis articles-full.json (avec bodies) ou articles.json en fallback
  const fullPath  = path.join(__dirname,'..','dist','articles-full.json');
  const distPath  = path.join(__dirname,'..','dist','articles.json');
  let cachedData = {articles:[]};
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

  // ── Déduplication par sujet ───────────────────────────────────────────────
  // Sauvegarder le pool avant Jaccard (filet de sécurité pour garantir MAX_ARTICLES)
  const preJaccardPool = [...allArticles];

  // 2. Déduplication par sujet — désactivée en mode Korben (on veut tout)
  if (!IS_KORBEN) {
    const deduped = [];
    for (const a of allArticles) {
      const isDup = deduped.some(k => jaccard(k.title, a.title) > 0.35);
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
  // Filtre catégories — cap dynamique pour garantir MAX_ARTICLES après le slice
  // Formule : au moins MAX_ARTICLES/2 par cat (assure la cible même avec 2-3 catégories actives)
  if (!IS_KORBEN) {
    const CAT_CAP = Math.max(5, Math.ceil(MAX_ARTICLES / 2));
    const catCount={};
    allArticles=allArticles.filter(a=>{catCount[a.category]=(catCount[a.category]||0)+1;return catCount[a.category]<=CAT_CAP;});
  }
  allArticles=allArticles.slice(0,MAX_ARTICLES);

  // ── Filet de sécurité : compléter si count insuffisant ────────────────────
  if (allArticles.length < MAX_ARTICLES && !IS_KORBEN) {
    const existingIds = new Set(allArticles.map(a => a.id));
    const extras = preJaccardPool
      .filter(a => !existingIds.has(a.id))
      .slice(0, MAX_ARTICLES - allArticles.length);
    if (extras.length > 0) {
      allArticles = [...allArticles, ...extras];
      warn(`Filet de sécurité : +${extras.length} article(s) ajouté(s) pour atteindre ${MAX_ARTICLES}`);
    }
  }

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
      await sleep(IS_MISTRAL_BOOST ? 2000 : IS_PAID ? 3000 : 5000);
    }
    delete article.fullText;
  }

  // Images
  for (const a of allArticles) if (!a.image||!a.image.startsWith('http')) a.image=getUnsplashImage(a.category);

  // ── Redating universel : heure Paris au moment du CRON ───────────────────
  // Garantit que les nouveaux articles remontent en tête, datés heure française
  const now = new Date();
  // Offset Paris (gère automatiquement heure d'été +2 / heure d'hiver +1)
  const parisOffsetH = (() => {
    const utcMs   = now.getTime();
    const parisMs = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' })).getTime();
    return Math.round((parisMs - utcMs) / 3600000); // +1 ou +2
  })();
  const tzSuffix = `+0${parisOffsetH}:00`; // "+01:00" ou "+02:00"

  allArticles = allArticles.map((a, i) => {
    const d = new Date(now.getTime() - i * 60000 + parisOffsetH * 3600000);
    return { ...a, date: d.toISOString().replace('Z', tzSuffix) };
  });
  ok(`Articles redatés à l'heure de Paris (UTC+${parisOffsetH}) — ${now.toLocaleTimeString('fr-FR', { timeZone:'Europe/Paris' })}`);

  // Fusion historique — fenêtre 30 jours
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const newIds = new Set(allArticles.map(a => a.id));
  const oldArticles = (cachedData.articles||[]).filter(a => !newIds.has(a.id) && new Date(a.date).getTime() > cutoff);
  const finalArticles = [...allArticles, ...oldArticles];
  finalArticles.sort((a,b) => new Date(b.date) - new Date(a.date));
  // Plafond 500 articles — évite la croissance indéfinie de articles-full.json
  if (finalArticles.length > 500) finalArticles.splice(500);

  // Écriture — fichiers JSON
  await fs.mkdir(path.join(__dirname,'..','dist'), { recursive: true });

  // 1. articles-full.json — cache interne (conservé pour la compatibilité)
  const outputFull = { generated_at: new Date().toISOString(), count: finalArticles.length, articles: finalArticles };
  await fs.writeFile(fullPath, JSON.stringify(outputFull), 'utf-8');

  // 2. articles.json — sans bodies, léger, pour index.html
  const indexArticles = finalArticles.map(({ body, fullText, ...rest }) => rest);
  const outputIndex   = { generated_at: new Date().toISOString(), count: finalArticles.length, articles: indexArticles };
  await fs.writeFile(distPath, JSON.stringify(outputIndex), 'utf-8');

  // 3. Fichiers individuels dist/articles/[id].json — pour article.html (fetch ciblé)
  const articlesDir = path.join(__dirname, '..', 'dist', 'articles');
  await fs.mkdir(articlesDir, { recursive: true });
  for (const article of finalArticles) {
    const { fullText: _ft, ...articleData } = article;
    await fs.writeFile(
      path.join(articlesDir, `${article.id}.json`),
      JSON.stringify(articleData),
      'utf-8'
    );
  }

  // 4. Nettoyage des fichiers individuels > 30 jours
  try {
    const files   = await fs.readdir(articlesDir);
    let   deleted = 0;
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(await fs.readFile(path.join(articlesDir, file), 'utf-8'));
        if (new Date(data.date).getTime() < cutoff) {
          await fs.unlink(path.join(articlesDir, file));
          deleted++;
        }
      } catch {}
    }
    if (deleted > 0) ok(`${deleted} article(s) individuel(s) supprimé(s) (>30j)`);
  } catch {}

  console.log(`\n${c.bold}━━━ Terminé ━━━${c.reset}`);
  ok(`${newCount} nouveaux | ${oldArticles.length} depuis cache | ${finalArticles.length} total`);
  ok(`Écrit : articles.json + articles-full.json + dist/articles/ (${finalArticles.length} fichiers)`);
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
