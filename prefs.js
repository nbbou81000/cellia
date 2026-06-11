/* prefs.js — CelliA Preferences Panel (IIFE) */
(function () {
  'use strict';

  // ── Polices ──────────────────────────────────────────────────────────────
  const CELLIA_FONTS = [
    { id: 'editorial',  label: 'Éditoriale',   family: "'Bricolage Grotesque', sans-serif", google: 'Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800' },
    { id: 'inter',      label: 'Inter',         family: "'Inter', sans-serif",               google: 'Inter:wght@300;400;500;600;700' },
    { id: 'geist',      label: 'Geist',         family: "'Geist', sans-serif",               google: 'Geist:wght@300;400;500;700' },
    { id: 'system',     label: 'Système',       family: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", system: true },
    { id: 'claude',     label: 'Claude',        family: "'DM Sans', sans-serif",             google: 'DM+Sans:ital,wght@0,300;0,400;0,600;0,700;1,400' },
    { id: 'classique',  label: 'Classique',     family: "'Lora', serif",                     google: 'Lora:ital,wght@0,400;0,600;1,400' },
    { id: 'technique',  label: 'Technique',     family: "'JetBrains Mono', monospace",       google: 'JetBrains+Mono:wght@300;400;600' },
    { id: 'raffinee',   label: 'Raffinée',      family: "'Playfair Display', serif",         google: 'Playfair+Display:ital,wght@0,400;0,700;1,400' },
    { id: 'dyslexic',   label: 'Atkinson',      family: "'Atkinson Hyperlegible', sans-serif", google: 'Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400' },
  ];

  // ── Couleurs de fond ──────────────────────────────────────────────────────
  const CELLIA_BGCOLORS = [
    { id: 'default', label: 'Défaut',  dark: '#1a1c22', light: '#f4f4f0' },
    { id: 'noir',    label: 'Noir',    dark: '#0b0c10', light: '#e8e8e3' },
    { id: 'chaud',   label: 'Chaud',   dark: '#1c1814', light: '#faf6ee' },
    { id: 'ocean',   label: 'Océan',   dark: '#0d1520', light: '#eef3fb' },
    { id: 'nuit',    label: 'Nuit',    dark: '#181828', light: '#ededfd' },
    { id: 'foret',   label: 'Forêt',   dark: '#111a13', light: '#eef5ef' },
  ];

  // ── Tailles de texte ──────────────────────────────────────────────────────
  const CELLIA_SIZES = [
    { id: 'small',  label: 'Aa',  title: '13px', summary: '11.5px', meta: '10px'  },
    { id: 'normal', label: 'A',   title: '15px', summary: '13px',   meta: '11px'  },
    { id: 'large',  label: 'A+',  title: '17px', summary: '14px',   meta: '12px'  },
    { id: 'xlarge', label: 'A++', title: '19px', summary: '15.5px', meta: '13px'  },
  ];

  // ── Conversions sliders ───────────────────────────────────────────────────
  const lsToEm  = v => v === 0 ? 'normal' : (v / 100).toFixed(2) + 'em';
  const lhToVal = v => (1.40 + v * 0.05).toFixed(2);
  const colToPx = v => (780 - v * 30) + 'px';

  // ── Interpolation couleurs (pour luminosité) ──────────────────────────────
  function hexToRgb(h) {
    return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  }
  function rgbToHex(r,g,b) {
    return '#' + [r,g,b].map(x => Math.round(Math.max(0,Math.min(255,x))).toString(16).padStart(2,'0')).join('');
  }
  function lerp(c1, c2, t) {
    const [r1,g1,b1] = hexToRgb(c1), [r2,g2,b2] = hexToRgb(c2);
    return rgbToHex(r1+(r2-r1)*t, g1+(g2-g1)*t, b1+(b2-b1)*t);
  }
  // Stops de luminosité : 0=sombre, 65=défaut, 100=lumineux
  function brightnessColors(val, theme) {
    const t = val / 100;
    if (theme === 'dark') {
      const t65 = Math.min(1, val / 65);
      const t35 = Math.max(0, (val - 65) / 35);
      const hi   = val <= 65 ? lerp('#404858', '#f0f2f8', t65) : lerp('#f0f2f8', '#ffffff', t35);
      const body = val <= 65 ? lerp('#2a3245', '#94a3b8', t65) : lerp('#94a3b8', '#d0dcf4', t35);
      return { hi, body };
    } else {
      const t65 = Math.min(1, val / 65);
      const t35 = Math.max(0, (val - 65) / 35);
      const hi   = val <= 65 ? lerp('#c0c8d4', '#1a1c22', t65) : lerp('#1a1c22', '#000000', t35);
      const body = val <= 65 ? lerp('#d0d8e4', '#64748b', t65) : lerp('#64748b', '#2a3040', t35);
      return { hi, body };
    }
  }

  // ── État ─────────────────────────────────────────────────────────────────
  let currentTheme      = localStorage.getItem('cellia-theme')      || 'dark';
  let currentFont       = localStorage.getItem('cellia-font')       || 'editorial';
  let currentBg         = localStorage.getItem('cellia-bg')         || 'default';
  let currentSize       = localStorage.getItem('cellia-size')       || 'normal';
  let currentBrightness = parseInt(localStorage.getItem('cellia-brightness') ?? '65', 10);
  let currentLS    = parseInt(localStorage.getItem('cellia-ls')  ?? '0',  10);
  let currentLH    = parseInt(localStorage.getItem('cellia-lh')  ?? '7',  10);
  let currentCol   = parseInt(localStorage.getItem('cellia-col') ?? '0',  10); // 0 → 780px
  let currentCream = localStorage.getItem('cellia-cream') === 'true';

  // ── Appliquer thème ───────────────────────────────────────────────────────
  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cellia-theme', theme);
    if (currentCream) applyCream(true, false);
    applyBg(currentBg, false);
    applyBrightness(currentBrightness, false);
    updateButtons();
  }

  // ── Appliquer fond ────────────────────────────────────────────────────────
  function applyBg(bgId, save = true) {
    currentBg = bgId;
    if (save) localStorage.setItem('cellia-bg', bgId);
    const bg = CELLIA_BGCOLORS.find(b => b.id === bgId) || CELLIA_BGCOLORS[0];
    document.documentElement.style.setProperty('--bg', currentTheme === 'dark' ? bg.dark : bg.light);
    updateButtons();
  }

  // ── Appliquer taille texte ────────────────────────────────────────────────
  function applySize(sizeId) {
    currentSize = sizeId;
    localStorage.setItem('cellia-size', sizeId);
    const s = CELLIA_SIZES.find(x => x.id === sizeId) || CELLIA_SIZES[1];
    document.documentElement.style.setProperty('--cellia-title-size',   s.title);
    document.documentElement.style.setProperty('--cellia-summary-size', s.summary);
    document.documentElement.style.setProperty('--cellia-meta-size',    s.meta);
    updateButtons();
  }

  // ── Appliquer luminosité texte ────────────────────────────────────────────
  function applyBrightness(val, save = true) {
    currentBrightness = val;
    if (save) localStorage.setItem('cellia-brightness', val);
    const { hi, body } = brightnessColors(val, currentTheme);
    document.documentElement.style.setProperty('--text-hi',   hi);
    document.documentElement.style.setProperty('--text-body', body);
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
    if (font.system) return; // Police système : toujours disponible, rien à charger
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
    /* ── Variables taille de texte ── */
    .card-title   { font-size: var(--cellia-title-size, 15px) !important; }
    .card-summary { font-size: var(--cellia-summary-size, 13px) !important; }
    .card-source, .card-time, .card-read, .card-meta { font-size: var(--cellia-meta-size, 11px) !important; }
    .article-body p, .article-body li { font-size: var(--cellia-title-size, 15px) !important; }

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

    /* ── Swatches de fond ── */
    .cp-bg-grid {
      display: flex; gap: 8px; flex-wrap: wrap;
    }
    .cp-bg-swatch {
      width: 32px; height: 32px;
      border-radius: 50%;
      border: 2.5px solid transparent;
      cursor: pointer;
      transition: transform 0.15s, border-color 0.15s;
      position: relative;
      flex-shrink: 0;
    }
    .cp-bg-swatch:hover { transform: scale(1.12); }
    .cp-bg-swatch.active { border-color: var(--red); }
    .cp-bg-swatch.active::after {
      content: '✓';
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700;
      color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.5);
    }

    /* ── Boutons taille ── */
    .cp-size-btn {
      font-weight: 700; letter-spacing: -0.03em; text-align: center;
    }
    .cp-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }

    /* ── Slider luminosité ── */
    .cp-bright-row {
      display: flex; align-items: center; gap: 10px;
    }
    .cp-bright-a1 { font-size: 11px; opacity: 0.4; flex-shrink: 0; }
    .cp-bright-a2 { font-size: 17px; font-weight: 700; flex-shrink: 0; }
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
      <div class="cp-section-label">Fond</div>
      <div class="cp-bg-grid">
        ${CELLIA_BGCOLORS.map(bg => `
          <button class="cp-bg-swatch ${currentBg === bg.id ? 'active' : ''}"
                  data-bg-btn="${bg.id}"
                  style="background:${currentTheme === 'dark' ? bg.dark : bg.light}"
                  title="${bg.label}"></button>
        `).join('')}
      </div>
    </div>

    <hr class="cp-divider">

    <div class="cp-section">
      <div class="cp-section-label">Taille du texte</div>
      <div class="cp-grid-4">
        ${CELLIA_SIZES.map(s => `
          <button class="cp-btn cp-size-btn" data-size-btn="${s.id}"
                  style="font-size:${s.title === '13px' ? '12px' : s.title === '19px' ? '17px' : s.title}">
            ${s.label}
          </button>
        `).join('')}
      </div>
    </div>

    <hr class="cp-divider">

    <div class="cp-section">
      <div class="cp-section-label">Luminosité du texte</div>
      <div class="cp-bright-row">
        <span class="cp-bright-a1">A</span>
        <input type="range" class="cp-slider" id="cp-br-slider"
               min="0" max="100" step="5" value="${currentBrightness}">
        <span class="cp-bright-a2">A</span>
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
    panel.querySelectorAll('[data-bg-btn]').forEach(btn => {
      const bg = CELLIA_BGCOLORS.find(b => b.id === btn.dataset.bgBtn);
      btn.classList.toggle('active', btn.dataset.bgBtn === currentBg);
      if (bg) btn.style.background = currentTheme === 'dark' ? bg.dark : bg.light;
    });
    panel.querySelectorAll('[data-size-btn]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sizeBtn === currentSize);
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

  // ── Events fond ───────────────────────────────────────────────────────────
  panel.querySelectorAll('[data-bg-btn]').forEach(btn => {
    btn.addEventListener('click', () => applyBg(btn.dataset.bgBtn));
  });

  // ── Events taille ─────────────────────────────────────────────────────────
  panel.querySelectorAll('[data-size-btn]').forEach(btn => {
    btn.addEventListener('click', () => applySize(btn.dataset.sizeBtn));
  });

  // ── Event luminosité ──────────────────────────────────────────────────────
  const brSlider = document.getElementById('cp-br-slider');
  if (brSlider) brSlider.addEventListener('input', e => applyBrightness(parseInt(e.target.value)));

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
  applyBg(currentBg, false);
  applySize(currentSize);
  applyBrightness(currentBrightness, false);
  applyLS(currentLS);
  applyLH(currentLH);
  applyCol(currentCol);
  if (currentCream) applyCream(true, false);

  loadFont(CELLIA_FONTS[0]); // Précharger Bricolage Grotesque
})();
