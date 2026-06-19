/* ═══════════════════════════════════════════════════════════════════
   CelliA — Doodles calendrier français
   Affiche automatiquement un doodle SVG sur le logo selon la date
   Aucune dépendance — vanilla JS pur
═══════════════════════════════════════════════════════════════════ */
(function initDoodle() {

  // ── Calculs de dates variables ───────────────────────────────────────────
  function easterDate(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    return {
      month: Math.floor((h + l - 7 * m + 114) / 31),
      day:   ((h + l - 7 * m + 114) % 31) + 1
    };
  }

  function lastSundayOfMonth(year, month) { // month 1-12
    const d = new Date(year, month, 0); // dernier jour du mois
    while (d.getDay() !== 0) d.setDate(d.getDate() - 1);
    return d.getDate();
  }

  function nthSundayOfMonth(year, month, n) { // month 1-12
    const d = new Date(year, month - 1, 1);
    let count = 0;
    while (true) {
      if (d.getDay() === 0 && ++count === n) return d.getDate();
      d.setDate(d.getDate() + 1);
    }
  }

  // ── Détection de la date du jour ────────────────────────────────────────
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  const day   = now.getDate();
  const dow   = now.getDay(); // 0=dim

  const easter     = easterDate(year);
  const fetesMeres = { month: 5, day: lastSundayOfMonth(year, 5), dow: 0 };
  const fetesPeres = { month: 6, day: nthSundayOfMonth(year, 6, 3), dow: 0 };

  function is(m, d)       { return month === m && day === d; }
  function isVar(ev)      { return month === ev.month && day === ev.day && dow === ev.dow; }

  // ── Catalogue des doodles ──────────────────────────────────────────────
  const DOODLES = {
    'nouvel-an': {
      label: '🎊 Bonne année !',
      svg: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <polygon points="30,4 14,46 46,46" fill="#ff5a4e"/>
        <rect x="14" y="44" width="32" height="5" rx="2" fill="#ffd93d"/>
        <circle cx="30" cy="4" r="3.5" fill="#ffd93d"/>
        <rect x="6"  y="18" width="5" height="5" rx="1" fill="#6366f1" transform="rotate(25,8,20)"/>
        <rect x="46" y="22" width="5" height="5" rx="1" fill="#10b981" transform="rotate(-15,48,24)"/>
        <circle cx="12" cy="36" r="3" fill="#f59e0b"/>
        <circle cx="48" cy="14" r="2.5" fill="#ff5a4e"/>
        <circle cx="50" cy="38" r="2" fill="#6366f1"/>
        <circle cx="8"  cy="10" r="2" fill="#10b981"/>
      </svg>`
    },
    'saint-valentin': {
      label: '❤️ Saint-Valentin',
      svg: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <path d="M30 50 C10 36, 4 20, 8 12 C12 4, 22 4, 30 14 C38 4, 48 4, 52 12 C56 20, 50 36, 30 50Z" fill="#ff5a4e"/>
        <path d="M30 46 C14 34, 9 20, 12 13 C15 7, 22 7, 30 16" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="2" stroke-linecap="round"/>
        <line x1="30" y1="50" x2="30" y2="58" stroke="#c0392b" stroke-width="2"/>
        <line x1="24" y1="54" x2="36" y2="54" stroke="#c0392b" stroke-width="2"/>
      </svg>`
    },
    'poisson-avril': {
      label: '🐟 Poisson d\'avril !',
      svg: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <path d="M48 30 C40 18, 20 16, 10 30 C20 44, 40 42, 48 30Z" fill="#06b6d4"/>
        <polygon points="52,22 60,30 52,38" fill="#06b6d4"/>
        <circle cx="18" cy="26" r="3.5" fill="white"/>
        <circle cx="18" cy="26" r="2" fill="#0f172a"/>
        <circle cx="19" cy="25" r=".8" fill="white"/>
        <path d="M28 22 C30 18, 34 18, 36 22" fill="none" stroke="#0891b2" stroke-width="1.5"/>
        <path d="M28 30 C30 34, 34 34, 36 30" fill="none" stroke="#0891b2" stroke-width="1.5"/>
        <path d="M38 24 C40 20, 44 20, 46 24" fill="none" stroke="#0891b2" stroke-width="1.2"/>
      </svg>`
    },
    'paques': {
      label: '🐣 Joyeuses Pâques !',
      svg: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="30" cy="33" rx="18" ry="22" fill="#fbbf24"/>
        <path d="M12 30 Q30 26 48 30" fill="none" stroke="#ff5a4e" stroke-width="3"/>
        <path d="M14 22 Q30 18 46 22" fill="none" stroke="#6366f1" stroke-width="2"/>
        <path d="M14 38 Q30 34 46 38" fill="none" stroke="#10b981" stroke-width="2"/>
        <circle cx="22" cy="44" r="3" fill="#ff5a4e" opacity=".8"/>
        <circle cx="38" cy="44" r="3" fill="#6366f1" opacity=".8"/>
        <circle cx="30" cy="48" r="2.5" fill="#10b981" opacity=".8"/>
      </svg>`
    },
    'fete-travail': {
      label: '🌹 Fête du Travail',
      svg: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <line x1="30" y1="58" x2="30" y2="22" stroke="#16a34a" stroke-width="3" stroke-linecap="round"/>
        <path d="M30 22 C30 22, 18 16, 14 8 C22 8, 28 14, 30 18 C32 14, 38 8, 46 8 C42 16, 30 22, 30 22Z" fill="#ff5a4e"/>
        <ellipse cx="22" cy="26" rx="8" ry="5" fill="#ff5a4e" transform="rotate(-30,22,26)" opacity=".6"/>
        <ellipse cx="16" cy="32" rx="7" ry="4.5" fill="#ff5a4e" transform="rotate(-20,16,32)" opacity=".5"/>
      </svg>`
    },
    'victoire': {
      label: '🕊️ Victoire du 8 mai 1945',
      svg: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <path d="M30 8 C22 14, 18 20, 20 30 C22 40, 28 44, 30 50 C32 44, 38 40, 40 30 C42 20, 38 14, 30 8Z" fill="white"/>
        <ellipse cx="30" cy="24" rx="11" ry="5" fill="white" transform="rotate(-20,30,24)"/>
        <ellipse cx="30" cy="24" rx="11" ry="5" fill="white" transform="rotate(20,30,24)"/>
        <circle cx="30" cy="8" r="4" fill="#fbbf24"/>
        <line x1="30" y1="5" x2="30" y2="3" stroke="#fbbf24" stroke-width="1.5"/>
        <path d="M26 54 Q30 58 34 54" fill="none" stroke="#94a3b8" stroke-width="1.5"/>
      </svg>`
    },
    'fetes-meres': {
      label: '🌸 Bonne fête Maman !',
      svg: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <line x1="30" y1="55" x2="30" y2="36" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="30" y1="46" x2="22" y2="38" stroke="#16a34a" stroke-width="2" stroke-linecap="round"/>
        <line x1="30" y1="42" x2="38" y2="34" stroke="#16a34a" stroke-width="2" stroke-linecap="round"/>
        <circle cx="30" cy="28" r="9" fill="#f9a8d4"/>
        <circle cx="30" cy="20" r="7" fill="#f472b6"/>
        <circle cx="30" cy="14" r="5" fill="#ec4899"/>
        <circle cx="30" cy="10" r="4" fill="#db2777"/>
        <circle cx="20" cy="28" r="7" fill="#fbbf24"/>
        <circle cx="20" cy="22" r="5" fill="#f59e0b"/>
        <circle cx="20" cy="17" r="4" fill="#d97706"/>
        <circle cx="40" cy="28" r="7" fill="#a78bfa"/>
        <circle cx="40" cy="22" r="5" fill="#8b5cf6"/>
        <circle cx="40" cy="17" r="4" fill="#7c3aed"/>
      </svg>`
    },
    'fetes-peres': {
      label: '👔 Bonne fête Papa !',
      svg: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <rect x="18" y="8" width="24" height="16" rx="4" fill="#1e40af"/>
        <rect x="20" y="10" width="20" height="12" rx="3" fill="#2563eb"/>
        <path d="M30 24 L24 40 L30 38 L36 40 Z" fill="#1e40af"/>
        <path d="M26 8 L30 14 L34 8" fill="#1e40af" stroke="#1e40af" stroke-width="1"/>
        <line x1="26" y1="14" x2="34" y2="14" stroke="white" stroke-width="1.5"/>
        <rect x="27" y="14" width="6" height="26" rx="3" fill="#ef4444"/>
        <path d="M27 40 Q30 44 33 40" fill="#ef4444"/>
      </svg>`
    },
    'bastille': {
      label: '🎆 Bonne fête nationale !',
      svg: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <rect x="10" y="4"  width="40" height="17" rx="2" fill="#002395"/>
        <rect x="10" y="21" width="40" height="17" fill="white"/>
        <rect x="10" y="38" width="40" height="17" rx="2" fill="#ED2939"/>
        <line x1="12" y1="4" x2="12" y2="55" stroke="#001a70" stroke-width="2"/>
        <circle cx="42" cy="28" r="10" fill="none" stroke="#ffd700" stroke-width="1" opacity=".5"/>
        <circle cx="42" cy="28" r="4" fill="#ffd700"/>
        <circle cx="42" cy="28" r="2" fill="#002395"/>
      </svg>`
    },
    'halloween': {
      label: '🎃 Halloween',
      svg: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="30" cy="36" rx="22" ry="20" fill="#f97316"/>
        <rect x="26" y="18" width="8" height="10" rx="2" fill="#16a34a"/>
        <path d="M14 32 L20 28 L14 26Z" fill="#0f172a"/>
        <path d="M46 32 L40 28 L46 26Z" fill="#0f172a"/>
        <path d="M22 26 L26 30 L30 26 L34 30 L38 26" fill="none" stroke="#0f172a" stroke-width="2.5" stroke-linejoin="round"/>
        <ellipse cx="24" cy="42" rx="4" ry="5" fill="#0f172a"/>
        <ellipse cx="36" cy="42" rx="4" ry="5" fill="#0f172a"/>
        <path d="M26 50 Q30 56 34 50" fill="#0f172a"/>
        <circle cx="24" cy="42" r="2" fill="#fbbf24"/>
        <circle cx="36" cy="42" r="2" fill="#fbbf24"/>
      </svg>`
    },
    'toussaint': {
      label: '🕯️ Toussaint',
      svg: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <rect x="24" y="30" width="12" height="22" rx="3" fill="#fef3c7"/>
        <rect x="24" y="30" width="12" height="22" rx="3" fill="none" stroke="#d97706" stroke-width=".8"/>
        <ellipse cx="30" cy="26" rx="6" ry="8" fill="#fbbf24"/>
        <path d="M28 18 Q30 12, 32 18" fill="#ff5a4e"/>
        <rect x="26" y="48" width="8" height="4" rx="2" fill="#d97706"/>
        <circle cx="30" cy="26" r="2" fill="#fef3c7" opacity=".6"/>
      </svg>`
    },
    'armistice': {
      label: '🌺 11 Novembre — Armistice',
      svg: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <circle cx="30" cy="28" r="18" fill="#ef4444"/>
        <circle cx="30" cy="28" r="18" fill="none" stroke="#b91c1c" stroke-width="1"/>
        <circle cx="30" cy="28" r="7" fill="#0f172a"/>
        <line x1="30" y1="8" x2="34" y2="2" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round"/>
        <ellipse cx="37" cy="1" rx="5" ry="3" fill="#16a34a" transform="rotate(20,37,1)"/>
      </svg>`
    },
    'noel': {
      label: '🎄 Joyeux Noël !',
      svg: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <polygon points="30,4 10,28 20,28 6,48 54,48 40,28 50,28" fill="#16a34a"/>
        <rect x="24" y="48" width="12" height="10" rx="2" fill="#92400e"/>
        <circle cx="30" cy="4"  r="4"   fill="#fbbf24"/>
        <circle cx="20" cy="32" r="3"   fill="#ff5a4e"/>
        <circle cx="40" cy="32" r="3"   fill="#fbbf24"/>
        <circle cx="26" cy="40" r="3"   fill="#6366f1"/>
        <circle cx="40" cy="40" r="2.5" fill="#ff5a4e"/>
        <circle cx="22" cy="42" r="2.5" fill="#10b981"/>
        <circle cx="34" cy="24" r="2.5" fill="#ff5a4e"/>
        <circle cx="24" cy="24" r="2.5" fill="#fbbf24"/>
      </svg>`
    },
    'reveillon': {
      label: '🥂 Bonne année !',
      svg: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
        <path d="M22 52 Q20 30 24 18 L36 18 Q40 30 38 52Z" fill="#fbbf24" opacity=".9"/>
        <ellipse cx="30" cy="16" rx="8" ry="4" fill="#fbbf24" stroke="#d97706" stroke-width=".8"/>
        <path d="M30 8 Q32 4 34 6 Q32 2 30 4 Q28 2 26 6 Q28 4 30 8Z" fill="#ff5a4e"/>
        <circle cx="14" cy="22" r="3"   fill="#ff5a4e" opacity=".8"/>
        <circle cx="46" cy="16" r="2.5" fill="#6366f1" opacity=".8"/>
        <circle cx="10" cy="40" r="2"   fill="#10b981" opacity=".8"/>
        <circle cx="50" cy="34" r="2.5" fill="#fbbf24" opacity=".8"/>
        <line x1="14" y1="19" x2="18" y2="12" stroke="#ff5a4e"  stroke-width="1" opacity=".5"/>
        <line x1="46" y1="13" x2="42" y2="6"  stroke="#6366f1"  stroke-width="1" opacity=".5"/>
        <line x1="10" y1="37" x2="14" y2="30" stroke="#10b981"  stroke-width="1" opacity=".5"/>
      </svg>`
    },
  };

  // ── Sélection du doodle du jour ─────────────────────────────────────────
  let doodleKey = null;

  if      (is(1, 1))                                   doodleKey = 'nouvel-an';
  else if (is(2, 14))                                  doodleKey = 'saint-valentin';
  else if (is(4, 1))                                   doodleKey = 'poisson-avril';
  else if (is(easter.month, easter.day))               doodleKey = 'paques';
  else if (is(5, 1))                                   doodleKey = 'fete-travail';
  else if (is(5, 8))                                   doodleKey = 'victoire';
  else if (isVar(fetesMeres))                          doodleKey = 'fetes-meres';
  else if (isVar(fetesPeres))                          doodleKey = 'fetes-peres';
  else if (is(7, 14))                                  doodleKey = 'bastille';
  else if (is(10, 31))                                 doodleKey = 'halloween';
  else if (is(11, 1))                                  doodleKey = 'toussaint';
  else if (is(11, 11))                                 doodleKey = 'armistice';
  else if (is(12, 24) || is(12, 25))                   doodleKey = 'noel';
  else if (is(12, 31))                                 doodleKey = 'reveillon';

  if (!doodleKey) return;

  const doodle = DOODLES[doodleKey];
  if (!doodle) return;

  // ── Injection dans le logo ──────────────────────────────────────────────
  function inject() {
    const logo = document.querySelector('.nav-logo');
    if (!logo || logo.dataset.doodle) return;
    logo.dataset.doodle = doodleKey;
    logo.style.position = 'relative';
    logo.style.overflow = 'visible';

    // Conteneur du doodle
    const wrap = document.createElement('span');
    wrap.className     = 'cellia-doodle';
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', doodle.label);
    wrap.innerHTML = doodle.svg;

    // Tooltip
    const tip = document.createElement('span');
    tip.className   = 'cellia-doodle-tip';
    tip.textContent = doodle.label;
    wrap.appendChild(tip);

    logo.appendChild(wrap);

    // CSS inline pour ne pas dépendre d'un fichier externe
    if (!document.getElementById('cellia-doodle-css')) {
      const style = document.createElement('style');
      style.id = 'cellia-doodle-css';
      style.textContent = `
        .cellia-doodle {
          position: absolute;
          top: -46px; left: 50%; transform: translateX(-50%);
          width: 44px; height: 44px;
          display: block; pointer-events: auto; cursor: default;
          animation: doodle-drop .4s cubic-bezier(.34,1.56,.64,1) both;
        }
        .cellia-doodle svg { width: 44px; height: 44px; display: block; }
        .cellia-doodle-tip {
          position: absolute; bottom: -28px; left: 50%; transform: translateX(-50%);
          background: rgba(10,12,20,.92); color: #f0f2f8;
          font-size: 11px; font-weight: 600; white-space: nowrap;
          padding: 3px 10px; border-radius: 6px;
          border: 1px solid rgba(255,255,255,.1);
          opacity: 0; pointer-events: none;
          transition: opacity .2s;
          font-family: system-ui, sans-serif;
        }
        .cellia-doodle:hover .cellia-doodle-tip { opacity: 1; }
        .cellia-doodle:hover svg { animation: doodle-wiggle .4s ease; }
        @keyframes doodle-drop {
          from { opacity: 0; transform: translateX(-50%) translateY(-12px) scale(.7); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes doodle-wiggle {
          0%,100% { transform: rotate(0deg); }
          25%      { transform: rotate(-8deg); }
          75%      { transform: rotate(8deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  // Injecter dès que le DOM est prêt
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

})();
