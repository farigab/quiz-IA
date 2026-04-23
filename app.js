const QUESTIONS_URL = './questions.json';
const NUM_QUESTIONS = 10;
// Runtime-configurable server base. Create a `config.js` that sets:
// window.SHOWDO_CONFIG = { serverBase: 'https://seu-backend.example.com' }
const DEFAULT_LOCAL_SERVER = 'http://localhost:3000';
const SERVER_BASE = (globalThis.SHOWDO_CONFIG?.serverBase)
  || ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? DEFAULT_LOCAL_SERVER : '');

const AUTO_ADVANCE_DELAY = 15000;
const AUTO_ADVANCE_ENABLED = true;

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

nextBtn.addEventListener('click', onNext);
restartBtn.addEventListener('click', resetToIntro);


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
    setTimeout(() => {
      diceBtn.classList.remove('rolling');
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
    questionEl.textContent = `A inteligência artificial está criando perguntas novinhas sobre ${theme}… Isso pode levar alguns segundos.`;
    choicesEl.innerHTML = '';
  }

  let loaded = false;

  if (theme) {
    try {
      const resp = await fetch(`${SERVER_BASE}/api/generate-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, count: NUM_QUESTIONS }) // Pede apenas as 10 necessárias
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.ok && Array.isArray(data.questions) && data.questions.length) {
          questions = data.questions;
          loaded = true;
          console.log('Perguntas geradas via servidor generativo');
        }
      }
    } catch (err) {
      console.warn('Falha ao chamar servidor generativo:', err);
    }
  }

  if (!loaded) {
    questions = await loadQuestions();
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

  q.choices.forEach((text, idx) => {
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
  const correctIdx = selected[current].answerIndex;
  const buttons = Array.from(choicesEl.querySelectorAll('button'));

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
  const prev = Number(localStorage.getItem(key) || 0);
  if (score > prev) {
    localStorage.setItem(key, String(score));
    highScoreEl.textContent = score + ' (novo recorde!)';
  } else {
    highScoreEl.textContent = prev;
  }
}

function resetToIntro() {
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  if (explanationEl) { const prev = explanationEl.querySelector('.countdown'); if (prev) prev.remove(); }
  finalScreen.classList.add('hidden');
  intro.classList.remove('hidden');
  themeCards.forEach(c => c.classList.remove('selected'));
  if (themeTagEl) { themeTagEl.classList.add('hidden'); themeTagEl.textContent = ''; }
}

document.addEventListener('keydown', (e) => {
  if (questionScreen.classList.contains('hidden')) return;
  if (e.key >= '1' && e.key <= '9') {
    const idx = Number(e.key) - 1;
    const btn = choicesEl.querySelector(`button[data-index="${idx}"]`);
    if (btn) btn.click();
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});

  // Reload the page when the service worker signals that an update finished
  // activating. We replace the current history entry with a cache-busted
  // URL so the browser fetches fresh resources (best-effort).
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'SW_UPDATED') {
      const url = new URL(location.href);
      url.searchParams.set('_sw', Date.now());
      try {
        location.replace(url.toString());
      } catch (e) {
        // fallback to a normal reload if replace fails
        location.reload();
      }
    }
  });

  // As a fallback, reload when the controlling service worker changes.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!window.__swReloading) {
      window.__swReloading = true;
      window.location.reload();
    }
  });
}
