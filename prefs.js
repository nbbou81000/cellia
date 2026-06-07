/* prefs.js — CelliA Preferences Panel (IIFE) */
(function () {
  'use strict';

  const CELLIA_FONTS = [
    { id: 'editorial',  label: 'Éditoriale',   family: "'Bricolage Grotesque', sans-serif", google: 'Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800' },
    { id: 'claude',     label: 'Claude',        family: "'DM Sans', sans-serif",             google: 'DM+Sans:ital,wght@0,300;0,400;0,600;0,700;1,400' },
    { id: 'classique',  label: 'Classique',     family: "'Lora', serif",                     google: 'Lora:ital,wght@0,400;0,600;1,400' },
    { id: 'technique',  label: 'Technique',     family: "'JetBrains Mono', monospace",       google: 'JetBrains+Mono:wght@300;400;600' },
    { id: 'raffinee',   label: 'Raffinée',      family: "'Playfair Display', serif",         google: 'Playfair+Display:ital,wght@0,400;0,700;1,400' },
    { id: 'dyslexic',   label: 'OpenDyslexic',  family: "'OpenDyslexic', sans-serif",        cdn:    'https://fonts.cdnfonts.com/css/opendyslexic' },
  ];

  // ── État initial ──────────────────────────────────────────────────────────
  let currentTheme = localStorage.getItem('cellia-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'dark'); // dark par défaut
  let currentFont  = localStorage.getItem('cellia-font') || 'editorial';

  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cellia-theme', theme);
    updateButtons();
  }

  function applyFont(fontId) {
    const font = CELLIA_FONTS.find(f => f.id === fontId);
    if (!font) return;
    currentFont = fontId;
    loadGoogleFont(font);
    document.documentElement.style.setProperty('--font-ui', font.family);
    localStorage.setItem('cellia-font', fontId);
    updateButtons();
  }

  function loadGoogleFont(font) {
    const id  = `gf-${font.id}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    // Certaines polices (ex: OpenDyslexic) ne sont pas sur Google Fonts
    link.href = font.cdn
      ? font.cdn
      : `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
    document.head.appendChild(link);
  }

  // ── CSS du panneau ────────────────────────────────────────────────────────
  const panelCSS = `
    #cp-panel {
      position: fixed;
      top: 68px;
      right: 12px;
      z-index: 9999;
      width: 280px;
      background: var(--glass-panel);
      backdrop-filter: blur(36px);
      -webkit-backdrop-filter: blur(36px);
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.18);
      padding: 20px;
      transform-origin: top right;
      transform: scale(0.88) translateY(-8px);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.28s cubic-bezier(0.16,1,0.3,1), opacity 0.28s;
    }
    #cp-panel.open {
      transform: scale(1) translateY(0);
      opacity: 1;
      pointer-events: all;
    }
    .cp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .cp-title {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-dim);
    }
    .cp-close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-dim);
      font-size: 18px;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 6px;
      transition: color 0.15s, background 0.15s;
    }
    .cp-close:hover { background: var(--glass-hover); color: var(--text-hi); }
    .cp-section-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-dimmer);
      margin-bottom: 8px;
    }
    .cp-section { margin-bottom: 16px; }
    .cp-section:last-child { margin-bottom: 0; }
    .cp-grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .cp-btn {
      background: var(--glass-card);
      border: 1px solid var(--border-soft);
      border-radius: 10px;
      color: var(--text-body);
      cursor: pointer;
      font-family: var(--font-ui);
      font-size: 13px;
      font-weight: 500;
      padding: 9px 12px;
      text-align: center;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .cp-btn:hover {
      background: var(--glass-hover);
      color: var(--text-hi);
    }
    [data-theme="dark"] .cp-btn { color: #9aa4be; }
    [data-theme="dark"] .cp-btn:hover { color: #f0f2f8; }
    .cp-btn.active {
      border-color: var(--red);
      background: rgba(232,53,42,0.07);
      color: var(--text-hi);
      font-weight: 600;
    }
    [data-theme="dark"] .cp-btn.active {
      background: rgba(255,68,68,0.09);
    }
    .cp-font-btn {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 10px 12px;
      margin-bottom: 4px;
    }
    .cp-font-label {
      font-size: 14px;
      font-weight: 600;
      line-height: 1.3;
    }
    .cp-font-sub {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      color: var(--text-dim);
      margin-top: 2px;
    }
    .cp-divider {
      border: none;
      border-top: 1px solid var(--border-soft);
      margin: 14px 0;
    }
  `;

  const style = document.createElement('style');
  style.textContent = panelCSS;
  document.head.appendChild(style);

  // ── DOM du panneau ────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id    = 'cp-panel';
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
        <button class="cp-btn" id="cp-light" data-theme-btn="light">☀ Clair</button>
        <button class="cp-btn" id="cp-dark"  data-theme-btn="dark">⏾ Sombre</button>
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
  `;

  document.body.appendChild(panel);

  // ── Mise à jour état boutons ──────────────────────────────────────────────
  function updateButtons() {
    panel.querySelectorAll('[data-theme-btn]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeBtn === currentTheme);
    });
    panel.querySelectorAll('[data-font-btn]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.fontBtn === currentFont);
    });
  }

  // ── Events ────────────────────────────────────────────────────────────────
  panel.querySelectorAll('[data-theme-btn]').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.themeBtn));
  });

  panel.querySelectorAll('[data-font-btn]').forEach(btn => {
    btn.addEventListener('click', () => applyFont(btn.dataset.fontBtn));
  });

  document.getElementById('cp-close')?.addEventListener('click', closePanel);

  let isOpen = false;
  function openPanel()  { isOpen = true;  panel.classList.add('open'); }
  function closePanel() { isOpen = false; panel.classList.remove('open'); }

  function onTriggerClick(e) {
    e.stopPropagation();
    isOpen ? closePanel() : openPanel();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const trigger = document.getElementById('cp-trigger');
    if (trigger) trigger.addEventListener('click', onTriggerClick);
  });

  // Fermer au clic en dehors
  document.addEventListener('click', (e) => {
    if (isOpen && !panel.contains(e.target) && e.target.id !== 'cp-trigger') {
      closePanel();
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  applyTheme(currentTheme);
  applyFont(currentFont);

  // Précharger Bricolage Grotesque (police par défaut)
  loadGoogleFont(CELLIA_FONTS[0]);
})();
