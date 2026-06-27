// scripts/check-status.js
// Récupère le statut détaillé d'OpenAI, Anthropic, Google (Gemini), Mistral, Groq
// Aucune dépendance externe — Node.js 18+ natif uniquement

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT       = path.join(__dirname, '..', 'status.json');
const HIST_OUTPUT  = path.join(__dirname, '..', 'status-history.json');
const TIMEOUT_MS   = 12_000;
const HISTORY_MAX  = 96; // 24h à raison d'un check toutes les 15 min

function normalizeStatus(raw) {
  switch (raw) {
    case 'operational':          return 'operational';
    case 'degraded_performance': return 'degraded';
    case 'partial_outage':       return 'partial_outage';
    case 'major_outage':         return 'outage';
    case 'under_maintenance':    return 'maintenance';
    default:                     return 'unknown';
  }
}

function worstStatus(components) {
  const order = ['outage','partial_outage','degraded','maintenance','unknown','operational'];
  for (const status of order) {
    if (components.some(c => c.status === status)) return status;
  }
  return 'operational';
}

// ── Atlassian Statuspage — OpenAI, Anthropic, Groq ───────────────────────────
async function checkAtlassian(baseUrl, label) {
  try {
    const res  = await fetch(`${baseUrl}/api/v2/summary.json`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const groups = new Set(
      (data.components || []).filter(c => !c.group_id && c.group).map(c => c.id)
    );
    const components = (data.components || [])
      .filter(c => !groups.has(c.id) && !c.name.startsWith('Visit '))
      .map(c => ({
        name:       c.name.trim(),
        status:     normalizeStatus(c.status),
        updated_at: c.updated_at,
        group:      c.group_id ? (data.components.find(g => g.id === c.group_id)?.name || null) : null
      }));

    return {
      overall: (() => {
        const ind = data.status?.indicator;
        if (ind === 'none')                         return 'operational';
        if (ind === 'minor')                        return 'degraded';
        if (ind === 'major' || ind === 'critical')  return 'outage';
        return worstStatus(components);
      })(),
      description: data.status?.description || '',
      components
    };
  } catch (e) {
    console.warn(`⚠ ${label} : ${e.message}`);
    return { overall: 'unknown', description: 'Page de statut inaccessible', components: [] };
  }
}

// ── Mistral — Checkly Status Page ────────────────────────────────────────────
// Mistral n'utilise pas Atlassian mais Checkly (stack Nuxt).
// Les endpoints sont exposés directement par le serveur Nuxt de status.mistral.ai.
async function checkMistral() {
  const BASE = 'https://status.mistral.ai/api/status-page/mistral-ai';
  try {
    const [incRes, uptimeRes] = await Promise.all([
      fetch(`${BASE}/unresolved-incidents`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Accept': 'application/json' }
      }),
      fetch(`${BASE}/uptime`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Accept': 'application/json' }
      }),
    ]);
    if (!incRes.ok)    throw new Error(`incidents HTTP ${incRes.status}`);
    if (!uptimeRes.ok) throw new Error(`uptime HTTP ${uptimeRes.status}`);

    const { incidents }          = await incRes.json();
    const { metadata, uptime }   = await uptimeRes.json();

    // Aplatir les groupes de services en liste de composants
    const components = (metadata || []).flatMap(group =>
      (group.services || []).map(svc => ({
        name:       svc.name,
        status:     'operational',   // valeur par défaut, corrigée ci-dessous
        updated_at: null,
        group:      group.name || null,
      }))
    );

    // Mapper les incidents actifs sur les composants concernés
    const activeIncidents = (incidents || []).filter(inc => !inc.resolvedAt);
    for (const inc of activeIncidents) {
      const severity = inc.severity === 'MAJOR' ? 'outage'
                     : inc.severity === 'MINOR' ? 'degraded'
                     : 'degraded';
      for (const affected of (inc.affectedServices || [])) {
        const comp = components.find(c => c.name === affected.name);
        if (comp) {
          comp.status     = severity;
          comp.updated_at = inc.startedAt || null;
        }
      }
    }

    // Statut global
    let overall;
    if (activeIncidents.some(i => i.severity === 'MAJOR')) {
      overall = 'outage';
    } else if (activeIncidents.length > 0) {
      overall = 'degraded';
    } else {
      overall = 'operational';
    }

    const description = activeIncidents.length === 0
      ? 'All Systems Operational'
      : `${activeIncidents.length} incident(s) actif(s)`;

    return { overall, description, components };
  } catch (e) {
    console.warn(`⚠ Mistral : ${e.message}`);
    return { overall: 'unknown', description: 'Page de statut inaccessible', components: [] };
  }
}

// ── Google Cloud Status — filtré sur les services IA / Gemini ────────────────
async function checkGoogle() {
  const AI_SERVICES = [
    'AI Platform','Vertex AI','Generative AI','Gemini',
    'Google AI Studio','Cloud AI','Natural Language API',
    'Speech-to-Text','Translation API'
  ];
  try {
    const res = await fetch('https://status.cloud.google.com/incidents.json', {
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const incidents = await res.json();
    const now       = Date.now();
    const window48  = 48 * 3600 * 1000;
    const relevant  = incidents.filter(inc => {
      if (inc.end && (now - new Date(inc.end).getTime()) > window48) return false;
      const svc  = (inc.service_name  || '').toLowerCase();
      const desc = (inc.external_desc || '').toLowerCase();
      return AI_SERVICES.some(s => svc.includes(s.toLowerCase()) || desc.includes(s.toLowerCase()));
    });

    const seen = new Map();
    for (const inc of relevant) {
      const name   = inc.service_name || 'Google AI';
      const active = !inc.end;
      if (!seen.has(name)) {
        seen.set(name, {
          name,
          status:     active ? (inc.severity === 'high' ? 'outage' : 'degraded') : 'operational',
          updated_at: inc.end || inc.begin,
          group:      'Google Cloud AI'
        });
      }
    }
    const defaults = ['Gemini API','Vertex AI','Google AI Studio','Natural Language API'];
    for (const svc of defaults) {
      if (!seen.has(svc)) seen.set(svc, { name:svc, status:'operational', updated_at:null, group:'Google Cloud AI' });
    }
    const components = [...seen.values()];
    return {
      overall:     worstStatus(components),
      description: relevant.filter(i => !i.end).length === 0 ? 'All Systems Operational' : `${relevant.filter(i=>!i.end).length} incident(s) actif(s)`,
      components
    };
  } catch (e) {
    console.warn(`⚠ Google : ${e.message}`);
    return { overall:'unknown', description:'Page de statut inaccessible', components:[] };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log('🔍 Vérification des statuts API…');

const [openai, anthropic, google, mistral, groq] = await Promise.all([
  checkAtlassian('https://status.openai.com',    'OpenAI'),
  checkAtlassian('https://status.anthropic.com', 'Anthropic'),
  checkGoogle(),
  checkMistral(),
  checkAtlassian('https://groqstatus.com',       'Groq'),
]);

const now    = new Date().toISOString();
const result = {
  last_updated: now,
  services: { openai, anthropic, google, mistral, groq }
};

// Écrire status.json
fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2), 'utf-8');

// ── Historique 24h ────────────────────────────────────────────────────────────
let history = { entries: [] };
try {
  if (fs.existsSync(HIST_OUTPUT)) {
    history = JSON.parse(fs.readFileSync(HIST_OUTPUT, 'utf-8'));
  }
} catch {}

history.entries.push({
  timestamp: now,
  services: {
    openai:    openai.overall,
    anthropic: anthropic.overall,
    google:    google.overall,
    mistral:   mistral.overall,
    groq:      groq.overall,
  }
});
if (history.entries.length > HISTORY_MAX) {
  history.entries = history.entries.slice(-HISTORY_MAX);
}
fs.writeFileSync(HIST_OUTPUT, JSON.stringify(history, null, 2), 'utf-8');

// Résumé console
for (const [name, svc] of Object.entries(result.services)) {
  console.log(`✓ ${name.padEnd(10)}: ${svc.overall.padEnd(15)} (${svc.components.length} composants)`);
}
console.log(`→ status.json + status-history.json écrits`);
