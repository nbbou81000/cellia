// ─── delete-article.js ───────────────────────────────────────────────────────
// Supprime un article (par son id) de tous les fichiers JSON du dist/
// Usage : ARTICLE_ID=<id> node delete-article.js
// ─────────────────────────────────────────────────────────────────────────────
import fs   from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ARTICLE_ID = process.env.ARTICLE_ID?.trim();

if (!ARTICLE_ID) {
  console.error('✗ ARTICLE_ID manquant');
  process.exit(1);
}

const FILES = [
  path.join(__dirname, '..', 'dist', 'articles.json'),
  path.join(__dirname, '..', 'dist', 'articles-full.json'),
  path.join(__dirname, '..', 'dist', 'articles-fond.json'),
];

let totalRemoved = 0;

for (const filePath of FILES) {
  try {
    const raw  = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);

    const before = data.articles?.length ?? 0;
    data.articles = (data.articles || []).filter(a => a.id !== ARTICLE_ID);
    const removed = before - data.articles.length;

    if (removed === 0) {
      console.log(`  — ${path.basename(filePath)} : article non trouvé, ignoré`);
      continue;
    }

    data.count        = data.articles.length;
    data.generated_at = new Date().toISOString();
    await fs.writeFile(filePath, JSON.stringify(data), 'utf-8');
    console.log(`  ✓ ${path.basename(filePath)} : ${removed} article(s) supprimé(s)`);
    totalRemoved += removed;
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log(`  — ${path.basename(filePath)} : fichier absent, ignoré`);
    } else {
      console.error(`  ✗ ${path.basename(filePath)} : ${e.message}`);
    }
  }
}

if (totalRemoved === 0) {
  console.error(`✗ Article "${ARTICLE_ID}" introuvable dans tous les fichiers JSON`);
  process.exit(1);
}

console.log(`\n✓ Suppression terminée — ID : ${ARTICLE_ID}`);
process.exit(0);
