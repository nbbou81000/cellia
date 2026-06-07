/* prefs.js — CelliA Preferences Panel (IIFE) */
(function () {
  'use strict';

  // ── Polices ──────────────────────────────────────────────────────────────
  const CELLIA_FONTS = [
    { id: 'editorial',  label: 'Éditoriale',   family: "'Bricolage Grotesque', sans-serif", google: 'Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800' },
    { id: 'claude',     label: 'Claude',        family: "'DM Sans', sans-serif",             google: 'DM+Sans:ital,wght@0,300;0,400;0,600;0,700;1,400' },
    { id: 'classique',  label: 'Classique',     family: "'Lora', serif",                     google: 'Lora:ital,wght@0,400;0,600;1,400' },
    { id: 'technique',  label: 'Technique',     family: "'JetBrains Mono', monospace",       google: 'JetBrains+Mono:wght@300;400;600' },
    { id: 'raffinee',   label: 'Raffinée',      family: "'Playfair Display', serif",         google: 'Playfair+Display:ital,wght@0,400;0,700;1,400' },
    { id: 'dyslexic',   label: 'Atkinson',      family: "'Atkinson Hyperlegible', sans-serif", google: 'Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400' },
  ];

  // ── Conversions sliders ───────────────────────────────────────────────────
  // Letter-spacing : 0–12 → 0.00em–0.12em
  const lsToEm    = v => v === 0 ? 'normal' : (v / 100).toFixed(2) + 'em';
  // Line-height    : 0–16 → 1.40–2.20 (pas de 0.05)
  const lhToVal   = v => (1.40 + v * 0.05).toFixed(2);
  // Column width   : 0–10 → 780px–480px (pas de 30)
  const colToPx   = v => (780 - v * 30) + 'px';

  // ── État ─────────────────────────────────────────────────────────────────
  let currentTheme = localStorage.getItem('cellia-theme') || 'dark';
  let currentFont  = localStorage.getItem('cellia-font')  || 'editorial';
  let currentLS    = parseInt(localStorage.getItem('cellia-ls')  ?? '0',  10);
  let currentLH    = parseInt(localStorage.getItem('cellia-lh')  ?? '7',  10); // 7 → 1.75
  let currentCol   = parseInt(localStorage.getItem('cellia-col') ?? '0',  10); // 0 → 780px
  let currentCream = localStorage.getItem('cellia-cream') === 'true';

  // ── Appliquer thème ───────────────────────────────────────────────────────
  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cellia-theme', theme);
    if (currentCream) applyCream(true, false); // recalculer les surcharges crème
    updateButtons();
  }

  // ── Appliquer police ──────────────────────────────────────────────────────
  function applyFont(fontId) {
    const font = CELLIA_FONTS.find(f => f.id === fontId);
    if (!font) return;
    currentFont = fontId;
    loadFont(font);
    document.documentElement.style.setProperty('--font-ui', font.family);
    localStorage.setItem('cellia-font', fontId);
    updateButtons();
  }

  function loadFont(font) {
    const id = `gf-${font.id}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id; link.rel = 'stylesheet';
    link.href = font.cdn
      ? font.cdn
      : `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
    document.head.appendChild(link);
  }

  // ── Appliquer espacement lettres ──────────────────────────────────────────
  function applyLS(val) {
    currentLS = val;
    document.documentElement.style.setProperty('--cellia-ls', lsToEm(val));
    localStorage.setItem('cellia-ls', val);
  }

  // ── Appliquer hauteur de ligne ────────────────────────────────────────────
  function applyLH(val) {
    currentLH = val;
    document.documentElement.style.setProperty('--cellia-lh', lhToVal(val));
    localStorage.setItem('cellia-lh', val);
  }

  // ── Appliquer largeur de colonne ──────────────────────────────────────────
  function applyCol(val) {
    currentCol = val;
    document.documentElement.style.setProperty('--cellia-col', colToPx(val));
    localStorage.setItem('cellia-col', val);
  }

  // ── Appliquer fond crème ──────────────────────────────────────────────────
  function applyCream(enabled, save = true) {
    currentCream = enabled;
    if (save) localStorage.setItem('cellia-cream', enabled);
    if (enabled) {
      document.documentElement.setAttribute('data-cream', 'true');
    } else {
      document.documentElement.removeAttribute('data-cream');
    }
    updateButtons();
  }

  // ── CSS injecté ───────────────────────────────────────────────────────────
  const panelCSS = `
    /* ── Fond crème ── */
    [data-cream="true"][data-theme="light"] {
      --bg:          #faf6ee;
      --text-hi:     #18140e;
      --text-body:   #4a4038;
      --text-dim:    #8a7e70;
      --glass-card:  rgba(255,250,240,0.55);
      --glass-hover: rgba(255,248,232,0.82);
      --glass-nav:   rgba(250,246,238,0.82);
      --glass-panel: rgba(248,244,232,0.94);
      --border-soft: rgba(160,140,100,0.22);
      --shadow-md:   rgba(80,60,30,0.08);
      --shadow-lg:   rgba(80,60,30,0.18);
    }
    [data-cream="true"][data-theme="dark"] {
      --bg:          #1c1814;
      --text-body:   #b8a898;
      --glass-card:  rgba(255,240,210,0.04);
      --glass-hover: rgba(255,240,210,0.08);
      --glass-nav:   rgba(18,15,11,0.82);
      --glass-panel: rgba(24,20,16,0.94);
    }

    /* ── Variables lecture appliquées aux deux pages ── */
    .article-body,
    .article-body p,
    .article-body h2,
    .article-body strong,
    .article-summary {
      letter-spacing: var(--cellia-ls, normal);
    }
    .article-body {
      line-height: var(--cellia-lh, 1.75);
    }
    .article-wrap {
      max-width: var(--cellia-col, 780px) !important;
    }
    .card-summary {
      letter-spacing: var(--cellia-ls, normal);
    }

    /* ── Panneau ── */
    #cp-panel {
      position: fixed;
      top: 68px; right: 12px;
      z-index: 9999;
      width: 292px;
      background: var(--glass-panel);
      backdrop-filter: blur(36px);
      -webkit-backdrop-filter: blur(36px);
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.22);
      padding: 18px 18px 20px;
      transform-origin: top right;
      transform: scale(0.88) translateY(-8px);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.28s cubic-bezier(0.16,1,0.3,1), opacity 0.28s;
      max-height: calc(100vh - 80px);
      overflow-y: auto;
    }
    #cp-panel.open {
      transform: scale(1) translateY(0);
      opacity: 1;
      pointer-events: all;
    }
    .cp-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 14px;
    }
    .cp-title {
      font-size: 11px; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--text-dim);
    }
    .cp-close {
      background: none; border: none; cursor: pointer;
      color: var(--text-dim); font-size: 17px; line-height: 1;
      padding: 2px 6px; border-radius: 6px;
      transition: color 0.15s, background 0.15s;
    }
    .cp-close:hover { background: var(--glass-hover); color: var(--text-hi); }
    .cp-section-label {
      font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
      text-transform: uppercase; color: var(--text-dimmer);
      margin-bottom: 8px;
    }
    .cp-section { margin-bottom: 14px; }
    .cp-section:last-child { margin-bottom: 0; }
    .cp-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .cp-btn {
      background: var(--glass-card);
      border: 1px solid var(--border-soft);
      border-radius: 10px;
      color: var(--text-body);
      cursor: pointer;
      font-family: var(--font-ui);
      font-size: 13px; font-weight: 500;
      padding: 9px 12px;
      text-align: center;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .cp-btn:hover { background: var(--glass-hover); color: var(--text-hi); }
    .cp-btn.active {
      border-color: var(--red);
      background: rgba(232,53,42,0.07);
      color: var(--text-hi); font-weight: 600;
    }
    [data-theme="dark"] .cp-btn { color: #9aa4be; }
    [data-theme="dark"] .cp-btn:hover { color: #f0f2f8; }
    [data-theme="dark"] .cp-btn.active { background: rgba(255,68,68,0.09); }
    .cp-font-btn {
      display: flex; flex-direction: column; align-items: flex-start;
      padding: 10px 12px; margin-bottom: 4px;
    }
    .cp-font-label { font-size: 14px; font-weight: 600; line-height: 1.3; }
    .cp-font-sub   { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--text-dim); margin-top: 2px; }
    .cp-divider    { border: none; border-top: 1px solid var(--border-soft); margin: 12px 0; }

    /* ── Sliders ── */
    .cp-slider-row {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 10px;
    }
    .cp-slider-row:last-child { margin-bottom: 0; }
    .cp-slider-label {
      font-size: 11px; font-weight: 600; color: var(--text-dim);
      width: 58px; flex-shrink: 0;
    }
    .cp-slider {
      flex: 1;
      -webkit-appearance: none; appearance: none;
      height: 3px;
      background: var(--border-soft);
      border-radius: 2px;
      outline: none; cursor: pointer;
      border: none;
    }
    .cp-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 16px; height: 16px;
      border-radius: 50%;
      background: var(--red);
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
      transition: transform 0.15s;
    }
    .cp-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
    .cp-slider::-moz-range-thumb {
      width: 16px; height: 16px;
      border-radius: 50%;
      background: var(--red);
      cursor: pointer; border: none;
    }
    .cp-slider-val {
      font-size: 10px; font-weight: 700; font-family: 'JetBrains Mono', monospace;
      color: var(--text-dimmer); width: 28px; text-align: right; flex-shrink: 0;
    }

    /* ── Bouton crème ── */
    .cp-cream-btn {
      width: 100%; text-align: left;
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px;
    }
    .cp-cream-check {
      width: 18px; height: 18px;
      border-radius: 5px;
      border: 1.5px solid var(--border-soft);
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; flex-shrink: 0;
      transition: background 0.15s, border-color 0.15s;
    }
    .cp-cream-btn.active .cp-cream-check {
      background: var(--red); border-color: var(--red); color: #fff;
    }
    .cp-cream-desc { font-size: 11px; color: var(--text-dim); margin-top: 1px; }
  `;

  const style = document.createElement('style');
  style.textContent = panelCSS;
  document.head.appendChild(style);

  // ── DOM du panneau ────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'cp-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Préférences CelliA');

  panel.innerHTML = `
    <div class="cp-header">
      <span class="cp-title">Préférences</span>
      <button class="cp-close" id="cp-close" aria-label="Fermer">✕</button>
    </div>

    <div class="cp-section">
      <div class="cp-section-label">Apparence</div>
      <div class="cp-grid-2">
        <button class="cp-btn" data-theme-btn="light">☀ Clair</button>
        <button class="cp-btn" data-theme-btn="dark">⏾ Sombre</button>
      </div>
    </div>

    <hr class="cp-divider">

    <div class="cp-section">
      <div class="cp-section-label">Typographie</div>
      ${CELLIA_FONTS.map(f => `
        <button class="cp-btn cp-font-btn" data-font-btn="${f.id}" style="font-family:${f.family};width:100%">
          <span class="cp-font-label">${f.label}</span>
          <span class="cp-font-sub">${f.id}</span>
        </button>
      `).join('')}
    </div>

    <hr class="cp-divider">

    <div class="cp-section">
      <div class="cp-section-label">Espacement</div>

      <div class="cp-slider-row">
        <span class="cp-slider-label">Lettres</span>
        <input type="range" class="cp-slider" id="cp-ls-slider"
               min="0" max="12" step="1" value="${currentLS}">
        <span class="cp-slider-val" id="cp-ls-val">${currentLS === 0 ? '—' : '+' + currentLS}</span>
      </div>

      <div class="cp-slider-row">
        <span class="cp-slider-label">Lignes</span>
        <input type="range" class="cp-slider" id="cp-lh-slider"
               min="0" max="16" step="1" value="${currentLH}">
        <span class="cp-slider-val" id="cp-lh-val">${lhToVal(currentLH)}</span>
      </div>

      <div class="cp-slider-row">
        <span class="cp-slider-label">Colonne</span>
        <input type="range" class="cp-slider" id="cp-col-slider"
               min="0" max="10" step="1" value="${currentCol}">
        <span class="cp-slider-val" id="cp-col-val">${colToPx(currentCol)}</span>
      </div>
    </div>

    <hr class="cp-divider">

    <div class="cp-section">
      <div class="cp-section-label">Présentation</div>
      <button class="cp-btn cp-cream-btn ${currentCream ? 'active' : ''}" id="cp-cream-btn">
        <span class="cp-cream-check" id="cp-cream-check">${currentCream ? '✓' : ''}</span>
        <span>
          Fond crème
          <div class="cp-cream-desc">Réduit la fatigue visuelle</div>
        </span>
      </button>
    </div>
  `;

  document.body.appendChild(panel);

  // ── Mise à jour visuels boutons ───────────────────────────────────────────
  function updateButtons() {
    panel.querySelectorAll('[data-theme-btn]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeBtn === currentTheme);
    });
    panel.querySelectorAll('[data-font-btn]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.fontBtn === currentFont);
    });
    const creamBtn   = document.getElementById('cp-cream-btn');
    const creamCheck = document.getElementById('cp-cream-check');
    if (creamBtn)   creamBtn.classList.toggle('active', currentCream);
    if (creamCheck) creamCheck.textContent = currentCream ? '✓' : '';
  }

  // ── Events thème ──────────────────────────────────────────────────────────
  panel.querySelectorAll('[data-theme-btn]').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.themeBtn));
  });

  // ── Events police ─────────────────────────────────────────────────────────
  panel.querySelectorAll('[data-font-btn]').forEach(btn => {
    btn.addEventListener('click', () => applyFont(btn.dataset.fontBtn));
  });

  // ── Events sliders ────────────────────────────────────────────────────────
  const lsSlider  = document.getElementById('cp-ls-slider');
  const lhSlider  = document.getElementById('cp-lh-slider');
  const colSlider = document.getElementById('cp-col-slider');
  const lsVal     = document.getElementById('cp-ls-val');
  const lhVal     = document.getElementById('cp-lh-val');
  const colVal    = document.getElementById('cp-col-val');

  lsSlider.addEventListener('input', e => {
    const v = parseInt(e.target.value);
    lsVal.textContent = v === 0 ? '—' : '+' + v;
    applyLS(v);
  });

  lhSlider.addEventListener('input', e => {
    const v = parseInt(e.target.value);
    lhVal.textContent = lhToVal(v);
    applyLH(v);
  });

  colSlider.addEventListener('input', e => {
    const v = parseInt(e.target.value);
    colVal.textContent = colToPx(v);
    applyCol(v);
  });

  // ── Event fond crème ──────────────────────────────────────────────────────
  document.getElementById('cp-cream-btn').addEventListener('click', () => {
    applyCream(!currentCream);
  });

  // ── Fermer ────────────────────────────────────────────────────────────────
  document.getElementById('cp-close').addEventListener('click', closePanel);

  let isOpen = false;
  function openPanel()  { isOpen = true;  panel.classList.add('open'); }
  function closePanel() { isOpen = false; panel.classList.remove('open'); }

  document.addEventListener('DOMContentLoaded', () => {
    const trigger = document.getElementById('cp-trigger');
    if (trigger) trigger.addEventListener('click', e => {
      e.stopPropagation();
      isOpen ? closePanel() : openPanel();
    });
  });

  document.addEventListener('click', e => {
    if (isOpen && !panel.contains(e.target) && e.target.id !== 'cp-trigger') {
      closePanel();
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  applyTheme(currentTheme);
  applyFont(currentFont);
  applyLS(currentLS);
  applyLH(currentLH);
  applyCol(currentCol);
  if (currentCream) applyCream(true, false);

  loadFont(CELLIA_FONTS[0]); // Précharger Bricolage Grotesque
})();
