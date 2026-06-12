/* ═══════════════════════════════════════════════════════════════════
   CelliA — Lofi Radio  |  lofi.js
   Partagé entre index.html et article.html
═══════════════════════════════════════════════════════════════════ */
(function initLofi() {

  const STREAMS = [
    { name: 'Lofi Hip-Hop Radio',  sub: 'focus · chill · lo-fi beats',     url: 'https://streams.ilovemusic.de/iloveradio17.mp3' },
    { name: 'Open.FM Lofi',        sub: 'lofi hip-hop · atmospheric',       url: 'https://radio.open.fm/156/mp3' },
    { name: 'Groove Salad',        sub: 'ambient · downtempo · electronic', url: 'https://somafm.com/groovesalad256.mp3' },
  ];

  const LS_PLAYING = 'cellia-lofi-playing';
  const LS_STREAM  = 'cellia-lofi-stream';
  const LS_VOL     = 'cellia-lofi-volume';
  const LS_PLAYER  = 'cellia-lofi-player-open';

  // ── Audio ────────────────────────────────────────────────────────────
  const audio     = new Audio();
  audio.preload   = 'none';
  audio.crossOrigin = 'anonymous';

  let currentIdx  = Math.min(parseInt(localStorage.getItem(LS_STREAM) || '0'), STREAMS.length - 1);
  let playing     = false;
  let playerOpen  = false;
  let busy        = false;   // mutex pour éviter les double-appels

  // ── DOM (certains éléments peuvent être absents selon la page) ───────
  const get = id => document.getElementById(id);
  const radioBtn   = get('lofi-radio-btn');
  const playerBtn  = get('lofi-player-btn');
  const player     = get('lofi-player');
  const closeBtn   = get('lofi-close-btn');
  const liveDot    = get('lofi-live-dot');
  const wave       = get('lofi-wave');
  const stationEl  = get('lofi-station-name');
  const subEl      = get('lofi-station-sub');
  const ppBtn      = get('lofi-pp-btn');
  const prevBtn    = get('lofi-prev-btn');
  const nextBtn    = get('lofi-next-btn');
  const volSlider  = get('lofi-vol');
  const dotsEl     = get('lofi-dots');

  if (!radioBtn) return;  // lofi non présent sur cette page

  // ── Volume ───────────────────────────────────────────────────────────
  const savedVol  = parseFloat(localStorage.getItem(LS_VOL) || '0.7');
  audio.volume    = savedVol;
  if (volSlider) volSlider.value = savedVol;

  // ── Dots de navigation ───────────────────────────────────────────────
  function buildDots() {
    if (!dotsEl) return;
    dotsEl.innerHTML = '';
    STREAMS.forEach((s, i) => {
      const d = document.createElement('button');
      d.className = 'lofi-stream-dot' + (i === currentIdx ? ' active' : '');
      d.setAttribute('aria-label', `${s.name}`);
      d.addEventListener('click', () => goToStream(i));
      dotsEl.appendChild(d);
    });
  }
  buildDots();

  // ── Mise à jour UI ───────────────────────────────────────────────────
  function updateUI() {
    const s = STREAMS[currentIdx];
    if (stationEl) stationEl.textContent = s.name;
    if (subEl)     subEl.textContent     = s.sub;

    radioBtn.classList.toggle('active', playing);
    radioBtn.setAttribute('aria-pressed', playing);

    if (ppBtn) {
      ppBtn.textContent = playing ? '⏸' : '▶';
      ppBtn.setAttribute('aria-label', playing ? 'Pause' : 'Lecture');
    }
    if (wave)    wave.classList.toggle('playing', playing);
    if (liveDot) liveDot.classList.toggle('pulse', playing);
    if (playerBtn) playerBtn.classList.toggle('active', playerOpen);

    if (dotsEl) {
      dotsEl.querySelectorAll('.lofi-stream-dot').forEach((d, i) =>
        d.classList.toggle('active', i === currentIdx)
      );
    }
  }

  // ── Lecture ──────────────────────────────────────────────────────────
  function doPlay() {
    if (busy) return;
    busy = true;

    // On arrête proprement avant de changer la source
    audio.pause();
    // Supprimer l'écouteur d'erreur temporairement pour éviter les faux tirs
    audio.removeEventListener('error', onAudioError);

    audio.src = STREAMS[currentIdx].url;
    audio.load();

    audio.addEventListener('error', onAudioError);

    audio.play()
      .then(() => {
        playing = true;
        busy = false;
        localStorage.setItem(LS_PLAYING, 'true');
        localStorage.setItem(LS_STREAM, currentIdx);
        updateUI();
      })
      .catch(() => {
        busy = false;
        if (playing) tryFallback();
      });
  }

  function stopRadio() {
    playing = false;
    busy    = false;
    audio.removeEventListener('error', onAudioError);
    audio.pause();
    audio.src = '';
    localStorage.setItem(LS_PLAYING, 'false');
    updateUI();
  }

  function toggleRadio() {
    if (playing) stopRadio();
    else { playing = true; doPlay(); }
  }

  // ── Fallback automatique ─────────────────────────────────────────────
  let triedStreams = new Set();

  function tryFallback() {
    triedStreams.add(currentIdx);
    if (triedStreams.size >= STREAMS.length) {
      triedStreams.clear();
      stopRadio();
      return;
    }
    currentIdx = (currentIdx + 1) % STREAMS.length;
    buildDots();
    updateUI();
    doPlay();
  }

  function onAudioError() {
    if (playing && !busy) tryFallback();
  }

  // ── Navigation entre streams ─────────────────────────────────────────
  function goToStream(idx) {
    triedStreams.clear();
    currentIdx = ((idx % STREAMS.length) + STREAMS.length) % STREAMS.length;
    localStorage.setItem(LS_STREAM, currentIdx);
    buildDots();
    updateUI();
    if (playing) doPlay();
  }

  // ── Player visibility ────────────────────────────────────────────────
  function showPlayer() {
    if (!player) return;
    playerOpen = true;
    player.classList.add('visible');
    localStorage.setItem(LS_PLAYER, 'true');
    updateUI();
  }
  function hidePlayer() {
    if (!player) return;
    playerOpen = false;
    player.classList.remove('visible');
    localStorage.setItem(LS_PLAYER, 'false');
    updateUI();
  }
  function togglePlayer() { playerOpen ? hidePlayer() : showPlayer(); }

  // ── Événements ───────────────────────────────────────────────────────
  radioBtn.addEventListener('click',   toggleRadio);
  radioBtn.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' '){ e.preventDefault(); toggleRadio(); }});

  if (playerBtn) {
    playerBtn.addEventListener('click',   togglePlayer);
    playerBtn.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' '){ e.preventDefault(); togglePlayer(); }});
  }

  if (closeBtn) closeBtn.addEventListener('click', hidePlayer);
  if (ppBtn)    ppBtn.addEventListener('click',    toggleRadio);

  if (prevBtn) prevBtn.addEventListener('click', () => goToStream(currentIdx - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => goToStream(currentIdx + 1));

  if (volSlider) {
    volSlider.addEventListener('input', () => {
      audio.volume = parseFloat(volSlider.value);
      localStorage.setItem(LS_VOL, volSlider.value);
    });
  }

  // ── Restauration de l'état au chargement de page ─────────────────────
  const isMobile = window.innerWidth <= 800;

  if (!isMobile && localStorage.getItem(LS_PLAYER) === 'true') showPlayer();

  if (localStorage.getItem(LS_PLAYING) === 'true') {
    playing = true;   // marquer l'intention
    doPlay();         // tenter l'autoplay (réussit si interaction récente)
  }

  updateUI();

})();
