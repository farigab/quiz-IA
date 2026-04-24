const QUESTIONS_URL = './questions.json';
const NUM_QUESTIONS = globalThis.SHOWDO_CONSTANTS?.NUM_QUESTIONS ?? 10;
// Runtime-configurable server base. Create a `config.js` that sets:
// window.SHOWDO_CONFIG = { serverBase: 'https://seu-backend.example.com' }
const DEFAULT_LOCAL_SERVER = 'http://localhost:3000';
const SERVER_BASE = (globalThis.SHOWDO_CONFIG?.serverBase)
  || ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? DEFAULT_LOCAL_SERVER : '');

const AUTO_ADVANCE_DELAY = globalThis.SHOWDO_CONSTANTS?.AUTO_ADVANCE_DELAY ?? 15000;
const AUTO_ADVANCE_ENABLED = globalThis.SHOWDO_CONSTANTS?.AUTO_ADVANCE_ENABLED ?? true;

const safeStorage = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { } },
  remove: (k) => { try { localStorage.removeItem(k); } catch { } },
};

const intro = document.getElementById('intro');
const questionScreen = document.getElementById('questionScreen');
const finalScreen = document.getElementById('finalScreen');
const questionEl = document.getElementById('question');
const choicesEl = document.getElementById('choices');
const explanationEl = document.getElementById('explanation');
const scoreEl = document.getElementById('score');
const finalScoreEl = document.getElementById('finalScore');
const highScoreEl = document.getElementById('highScore');
const progressText = document.getElementById('progressText');
const progressFill = document.getElementById('progressFill');
const nextBtn = document.getElementById('nextBtn');
const restartBtn = document.getElementById('restartBtn');
const quitBtn = document.getElementById('quitBtn');
const themeCards = Array.from(document.querySelectorAll('.theme-card'));
const diceBtn = document.getElementById('random-dice');
const themeTagEl = document.getElementById('themeTag');

let questions = [];
let selected = [];
let current = 0;
let score = 0;
let answered = false;
let autoAdvanceTimer = null;
let currentTheme = null;
let activeController = null;
// Accessible status node for screen readers (hidden visually)
let srStatusEl = document.getElementById('sr-status');
if (!srStatusEl) {
  srStatusEl = document.createElement('div');
  srStatusEl.id = 'sr-status';
  srStatusEl.setAttribute('aria-live', 'polite');
  srStatusEl.setAttribute('role', 'status');
  srStatusEl.style.position = 'absolute';
  srStatusEl.style.left = '-9999px';
  srStatusEl.style.width = '1px';
  srStatusEl.style.height = '1px';
  srStatusEl.style.overflow = 'hidden';
  try { document.body.appendChild(srStatusEl); } catch (e) { /* ignore */ }
}

nextBtn.addEventListener('click', onNext);
restartBtn.addEventListener('click', resetToIntro);
if (quitBtn) quitBtn.addEventListener('click', resetToIntro);


themeCards.forEach(card => {
  if (!card.dataset.theme) return; // ignora o dado
  card.addEventListener('click', () => {
    const theme = card.dataset.theme;
    themeCards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    startGame(theme);
  });
});

if (diceBtn) {
  diceBtn.addEventListener('click', () => {
    if (diceBtn.classList.contains('rolling')) return;
    diceBtn.classList.add('rolling');
    // Accessibility: mark as busy and announce to AT users
    diceBtn.setAttribute('aria-disabled', 'true');
    const prevLabel = diceBtn.getAttribute('aria-label') || '';
    diceBtn.setAttribute('data-prev-aria-label', prevLabel);
    diceBtn.setAttribute('aria-label', 'Gerando tema aleatório');
    if (srStatusEl) srStatusEl.textContent = 'Gerando tema aleatório';

    setTimeout(() => {
      diceBtn.classList.remove('rolling');
      diceBtn.removeAttribute('aria-disabled');
      const old = diceBtn.getAttribute('data-prev-aria-label') || 'Aleatório';
      diceBtn.setAttribute('aria-label', old);
      diceBtn.removeAttribute('data-prev-aria-label');
      if (srStatusEl) srStatusEl.textContent = '';

      // Seleciona um tema aleatório (exceto o próprio dado)
      const validThemes = themeCards.filter(c => c.dataset.theme);
      const randomIdx = Math.floor(Math.random() * validThemes.length);
      const chosen = validThemes[randomIdx];
      if (chosen) {
        themeCards.forEach(c => c.classList.remove('selected'));
        chosen.classList.add('selected');
        startGame(chosen.dataset.theme);
      }
    }, 700); // tempo igual à animação CSS
  });
}

async function startGame(theme) {
  currentTheme = theme;
  if (themeTagEl) {
    if (theme) {
      themeTagEl.textContent = `Tema: ${theme}`;
      themeTagEl.classList.remove('hidden');
    } else {
      themeTagEl.classList.add('hidden');
      themeTagEl.textContent = '';
    }
  }
  intro.classList.add('hidden');
  questionScreen.classList.remove('hidden');
  finalScreen.classList.add('hidden');

  if (theme) {
    questionEl.textContent = `A inteligência artificial está criando perguntas novinhas sobre ${theme}… `;
    const spinnerHtml = '<span class="svg-wrap"><svg class="hourglass" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"><path d="M7 2h10l-4 6 4 6H7l4-6-4-6z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><g class="sand-top"><rect x="6" y="2" width="12" height="8" fill="currentColor" opacity="0.95"/></g><rect class="stream" x="11.4" y="9" width="1.2" height="6" fill="currentColor" opacity="0.95" rx="0.6"/><g class="sand-bottom"><rect x="6" y="14" width="12" height="8" fill="currentColor" opacity="0.95"/></g></svg></span>';
    const tmp = document.createElement('div'); tmp.innerHTML = spinnerHtml;
    const node = tmp.firstElementChild; if (node) questionEl.appendChild(node);
    choicesEl.innerHTML = '';
  }

  let loaded = false;

  if (theme) {
    try {
      if (activeController) activeController.abort();
      activeController = new AbortController();
      const { signal } = activeController;

      const resp = await fetch(`${SERVER_BASE}/api/generate-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, count: NUM_QUESTIONS }), // Pede apenas as 10 necessárias
        signal,
      });
      activeController = null;
      if (resp.ok) {
        const data = await resp.json();
        if (data?.ok && Array.isArray(data.questions) && data.questions.length) {
          questions = data.questions;
          loaded = true;
          console.log('Perguntas geradas via servidor generativo');
        }
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return; // silencioso para abortos por troca de tema
      console.warn('Falha ao chamar servidor generativo:', err);
      activeController = null;
    }
  }

  if (!loaded) {
    try {
      questions = await loadQuestions();
    } catch (err) {
      console.error('Erro ao carregar perguntas:', err);
      questionEl.textContent = 'Erro ao carregar perguntas. Verifique sua conexão e atualize a página.';
      choicesEl.innerHTML = '';
      return;
    }
  }

  let pool = questions;
  if (theme && theme !== 'Misturado') {
    pool = questions.filter(q => String(q.theme || '').toLowerCase() === String(theme).toLowerCase());
  }

  selected = pickRandom(pool, NUM_QUESTIONS);
  current = 0;
  score = 0;
  answered = false;
  updateScore();

  if (progressFill) progressFill.style.width = '0%';
  showQuestion();
}

async function loadQuestions() {
  const res = await fetch(QUESTIONS_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('Falha ao carregar perguntas');
  return await res.json();
}

function pickRandom(arr, n) {
  const clone = arr.slice();
  for (let i = clone.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone.slice(0, Math.min(n, clone.length));
}

function showQuestion() {
  if (!selected || selected.length === 0) {
    questionEl.textContent = 'Não foram encontradas perguntas suficientes para este tema.';
    choicesEl.innerHTML = '';
    return;
  }

  const q = selected[current];
  questionEl.textContent = q.question;
  choicesEl.innerHTML = '';
  if (explanationEl) { explanationEl.classList.add('hidden'); explanationEl.textContent = ''; }
  answered = false;
  nextBtn.disabled = true;
  progressText.textContent = `${current + 1}/${selected.length}`;
  if (progressFill) progressFill.style.width = `${(current / selected.length) * 100}%`;

  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  if (explanationEl) { const prev = explanationEl.querySelector('.countdown'); if (prev) prev.remove(); }

  const choiceList = Array.isArray(q.choices) ? q.choices : [];
  choiceList.forEach((text, idx) => {
    const btn = document.createElement('button');
    btn.className = 'btn choice';
    btn.type = 'button';
    btn.dataset.index = idx;

    const label = document.createElement('span');
    label.className = 'choice-label';
    label.textContent = String.fromCodePoint(65 + idx);

    const txt = document.createElement('span');
    txt.className = 'choice-text';
    txt.textContent = text;

    btn.appendChild(label);
    btn.appendChild(txt);
    btn.addEventListener('click', onChoice);
    choicesEl.appendChild(btn);
  });
}

function onChoice(e) {
  if (answered) return;
  answered = true;
  const idx = Number(e.currentTarget.dataset.index);
  let correctIdx = Number(selected[current].answerIndex ?? 0);
  const buttons = Array.from(choicesEl.querySelectorAll('button'));
  if (!(correctIdx >= 0 && correctIdx < buttons.length)) correctIdx = 0;

  if (idx === correctIdx) {
    e.currentTarget.classList.add('correct');
    score++;
    updateScore();
  } else {
    e.currentTarget.classList.add('wrong');
    if (buttons[correctIdx]) buttons[correctIdx].classList.add('correct');
  }
  buttons.forEach(b => b.disabled = true);

  if (explanationEl) {
    const provided = selected[current].explanation;
    const expText = provided || (idx === correctIdx ? 'Certo!' : `A correta era: ${selected[current].choices[correctIdx]}`);
    explanationEl.textContent = expText;
    explanationEl.classList.remove('hidden');
  }

  nextBtn.disabled = false;
  nextBtn.textContent = (current === selected.length - 1) ? 'Finalizar' : 'Próxima';

  if (AUTO_ADVANCE_ENABLED && explanationEl) {
    const prev = explanationEl.querySelector('.countdown'); if (prev) prev.remove();
    const cd = document.createElement('div'); cd.className = 'countdown';
    const fill = document.createElement('div'); fill.className = 'countdown-fill';
    fill.style.width = '100%'; cd.appendChild(fill); explanationEl.appendChild(cd);

    void fill.offsetWidth;
    fill.style.transition = `width ${AUTO_ADVANCE_DELAY}ms linear`;
    setTimeout(() => { fill.style.width = '0%'; }, 20);

    if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
    autoAdvanceTimer = setTimeout(() => {
      autoAdvanceTimer = null;
      onNext();
    }, AUTO_ADVANCE_DELAY);
  }
  if (progressFill) progressFill.style.width = `${((current + 1) / selected.length) * 100}%`;
}

function onNext() {
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  if (explanationEl) { const prev = explanationEl.querySelector('.countdown'); if (prev) prev.remove(); }
  if (current < selected.length - 1) {
    current++; showQuestion();
  } else {
    showFinal();
  }
}

function updateScore() {
  scoreEl.textContent = score;
}

function showFinal() {
  questionScreen.classList.add('hidden');
  finalScreen.classList.remove('hidden');
  finalScoreEl.textContent = score;
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  if (explanationEl) { const prev = explanationEl.querySelector('.countdown'); if (prev) prev.remove(); }

  const key = 'showdo_miau_highscore';
  const prev = Number(safeStorage.get(key) || 0);
  if (score > prev) {
    safeStorage.set(key, String(score));
    highScoreEl.textContent = score + ' (novo recorde!)';
  } else {
    highScoreEl.textContent = prev;
  }
}

function resetToIntro() {
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  if (explanationEl) { const prev = explanationEl.querySelector('.countdown'); if (prev) prev.remove(); }
  if (activeController) { try { activeController.abort(); } catch (e) { } activeController = null; }
  // Hide any game screens and return to intro/theme selection
  questionScreen.classList.add('hidden');
  finalScreen.classList.add('hidden');
  intro.classList.remove('hidden');
  themeCards.forEach(c => c.classList.remove('selected'));
  if (themeTagEl) { themeTagEl.classList.add('hidden'); themeTagEl.textContent = ''; }

  // Reset in-memory game state
  questions = [];
  selected = [];
  current = 0;
  score = 0;
  answered = false;
  updateScore();
  if (nextBtn) nextBtn.disabled = true;
}

document.addEventListener('keydown', (e) => {
  if (questionScreen.classList.contains('hidden')) return;
  if (e.key >= '1' && e.key <= '9') {
    const idx = Number(e.key) - 1;
    const btn = choicesEl.querySelector(`button[data-index="${idx}"]`);
    if (btn) btn.click();
  }
});

// ── Service Worker Registration ───────────────────────────────────────────────
// FIX: Read the versioned SW filename from config (set by generate-config.js at
// build time) so the browser always registers the correct per-build file.
// Fallback to the unversioned name for local development where no config exists.
if ('serviceWorker' in navigator) {
  const swFile = globalThis.SHOWDO_CONFIG?.serviceWorkerFile || 'service-worker.js';

  navigator.serviceWorker.register(swFile).catch(err => {
    console.warn('Service worker registration failed:', err);
  });

  // Reload the page when the service worker signals that an update finished
  // activating. We replace the current history entry with a cache-busted
  // URL so the browser fetches fresh resources (best-effort).
  // FIX: Removed the `controllerchange` listener that was causing a second
  // reload race condition. A single reload triggered by SW_UPDATED is enough.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'SW_UPDATED' || event.data.type === 'SW_UNREGISTERED') {
      if (window.__swReloading) return;
      window.__swReloading = true;
      const url = new URL(location.href);
      url.searchParams.set('_sw', Date.now());
      try {
        location.replace(url.toString());
      } catch (e) {
        location.reload();
      }
    }
  });
}
