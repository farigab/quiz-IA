const QUESTIONS_URL = './questions.json';
const NUM_QUESTIONS = 10;

const DEFAULT_LOCAL_SERVER = 'http://localhost:3000';
const SERVER_BASE =
  (globalThis.SHOWDO_CONFIG?.serverBase) ||
  ((location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? DEFAULT_LOCAL_SERVER
    : '');

const AUTO_ADVANCE_DELAY = 15000;
const AUTO_ADVANCE_ENABLED = true;

// ── DOM refs ──────────────────────────────────────────────────────────────────
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

// ── Estado centralizado ───────────────────────────────────────────────────────
// [FIX #15] Usa factory function em vez de Object.freeze + spread para evitar
// referências de array compartilhadas entre resets.
function createInitialState() {
  return {
    questions: [],
    selected: [],
    current: 0,
    score: 0,
    answered: false,
    autoAdvanceTimer: null,
    currentTheme: null,
    // [FIX #1] Ação do nextBtn gerida pelo estado — handler único no DOM.
    nextAction: null,
  };
}

let state = createInitialState();

function resetState() {
  clearAutoAdvance();
  state = createInitialState();
}

// ── [FIX #5] AbortController — cancela fetches pendentes ao mudar de tema ────
let currentFetchController = null;

// ── Helpers de auto-avanço ────────────────────────────────────────────────────
function clearAutoAdvance() {
  if (state.autoAdvanceTimer) {
    clearTimeout(state.autoAdvanceTimer);
    state.autoAdvanceTimer = null;
  }
  explanationEl?.querySelector('.countdown')?.remove();
}

// ── [FIX #1] Handler único para o nextBtn ─────────────────────────────────────
// Em vez de misturar addEventListener permanente com onclick pontual,
// um único listener despacha para state.nextAction.
// Isso elimina o bug de double-dispatch no fluxo de erro.
nextBtn.addEventListener('click', () => {
  if (typeof state.nextAction === 'function') state.nextAction();
});

restartBtn.addEventListener('click', resetToIntro);

// ── Listeners de UI ───────────────────────────────────────────────────────────
themeCards.forEach(card => {
  if (!card.dataset.theme) return;
  card.addEventListener('click', () => {
    themeCards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    startGame(card.dataset.theme);
  });
});

if (diceBtn) {
  diceBtn.addEventListener('click', () => {
    if (diceBtn.classList.contains('rolling')) return;
    diceBtn.classList.add('rolling');
    setTimeout(() => {
      diceBtn.classList.remove('rolling');
      const validThemes = themeCards.filter(c => c.dataset.theme);
      const chosen = validThemes[Math.floor(Math.random() * validThemes.length)];
      if (chosen) {
        themeCards.forEach(c => c.classList.remove('selected'));
        chosen.classList.add('selected');
        startGame(chosen.dataset.theme);
      }
    }, 700);
  });
}

// ── Fluxo do jogo ─────────────────────────────────────────────────────────────
async function startGame(theme) {
  // [FIX #5] Aborta qualquer fetch em curso antes de iniciar um novo.
  currentFetchController?.abort();
  currentFetchController = new AbortController();
  const { signal } = currentFetchController;

  resetState();
  state.currentTheme = theme;

  if (themeTagEl) {
    themeTagEl.textContent = theme ? `Tema: ${theme}` : '';
    themeTagEl.classList.toggle('hidden', !theme);
  }

  intro.classList.add('hidden');
  questionScreen.classList.remove('hidden');
  finalScreen.classList.add('hidden');

  if (theme) {
    questionEl.textContent = `A inteligência artificial está criando perguntas novinhas sobre ${theme}… `;
    const hg = document.createElement('span');
    hg.className = 'hourglass';
    hg.setAttribute('aria-hidden', 'true');
    hg.textContent = '⏳';
    questionEl.appendChild(hg);
    choicesEl.innerHTML = '';
  }

  try {
    let loaded = false;

    if (theme) {
      try {
        const resp = await fetch(`${SERVER_BASE}/api/generate-questions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme, count: NUM_QUESTIONS }),
          // [FIX #5] Signal passado ao fetch.
          signal,
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.ok && Array.isArray(data.questions) && data.questions.length) {
            state.questions = data.questions;
            loaded = true;
            console.log('Perguntas geradas via servidor generativo.');
          }
        }
      } catch (err) {
        // AbortError é esperado quando o utilizador muda de tema rapidamente — não logar como erro.
        if (err.name !== 'AbortError') {
          console.warn('Falha ao chamar servidor generativo:', err);
        } else {
          // Fetch cancelado intencionalmente — sai silenciosamente.
          return;
        }
      }
    }

    if (!loaded) {
      state.questions = await loadQuestions();
    }

    let pool = state.questions;
    if (theme && theme !== 'Misturado') {
      pool = state.questions.filter(
        q => String(q.theme || '').toLowerCase() === String(theme).toLowerCase()
      );
    }

    if (pool.length === 0) {
      throw new Error(`Nenhuma pergunta encontrada para o tema "${theme}".`);
    }

    state.selected = pickRandom(pool, NUM_QUESTIONS);
    // [FIX #16] Removidas as linhas redundantes após resetState():
    // current, score e answered já são 0/false vindos de createInitialState().
    updateScore();

    if (progressFill) progressFill.style.width = '0%';
    showQuestion();

  } catch (err) {
    if (err.name === 'AbortError') return;

    console.error('Erro ao iniciar jogo:', err);
    questionEl.textContent =
      `❌ Erro ao carregar perguntas: ${err.message} Tente novamente.`;
    choicesEl.innerHTML = '';
    nextBtn.textContent = 'Voltar ao início';
    nextBtn.disabled = false;
    // [FIX #1] Define a ação no estado — o handler único vai executá-la.
    state.nextAction = resetToIntro;
  }
}

async function loadQuestions() {
  const res = await fetch(QUESTIONS_URL, { cache: 'default' });
  if (!res.ok) throw new Error('Falha ao carregar perguntas locais.');
  return res.json();
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
  if (!state.selected?.length) {
    questionEl.textContent = 'Não foram encontradas perguntas suficientes...';
    choicesEl.innerHTML = '';
    nextBtn.textContent = 'Voltar ao início';
    nextBtn.disabled = false;
    state.nextAction = resetToIntro;
    return;
  }
  const q = state.selected[state.current];
  questionEl.textContent = q.question;
  choicesEl.innerHTML = '';

  if (explanationEl) {
    explanationEl.classList.add('hidden');
    explanationEl.textContent = '';
  }

  state.answered = false;
  nextBtn.disabled = true;
  // [FIX #1] Define a ação padrão de "próxima" para este passo do jogo.
  state.nextAction = onNext;

  if (progressText) progressText.textContent = `${state.current + 1}/${state.selected.length}`;
  // [FIX #6] Linha setAttribute('textContent', ...) removida — era dead code
  // (setAttribute não altera a propriedade textContent do DOM).

  if (progressFill) {
    progressFill.style.width =
      `${(state.current / state.selected.length) * 100}%`;
  }

  clearAutoAdvance();

  q.choices.forEach((text, idx) => {
    const btn = document.createElement('button');
    btn.className = 'btn choice';
    btn.type = 'button';
    btn.dataset.index = idx;
    btn.setAttribute('aria-label', `Opção ${String.fromCodePoint(65 + idx)}: ${text}`);

    const label = document.createElement('span');
    label.className = 'choice-label';
    label.textContent = String.fromCodePoint(65 + idx);
    label.setAttribute('aria-hidden', 'true');

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
  if (state.answered) return;
  state.answered = true;

  const idx = Number(e.currentTarget.dataset.index);
  const correctIdx = state.selected[state.current].answerIndex;
  const buttons = Array.from(choicesEl.querySelectorAll('button'));
  const isCorrect = idx === correctIdx;

  if (isCorrect) {
    e.currentTarget.classList.add('correct');
    e.currentTarget.setAttribute('aria-label',
      `Resposta correta: ${state.selected[state.current].choices[idx]}`);
    state.score++;
    updateScore();
  } else {
    e.currentTarget.classList.add('wrong');
    e.currentTarget.setAttribute('aria-label',
      `Resposta incorreta: ${state.selected[state.current].choices[idx]}`);
    if (buttons[correctIdx]) {
      buttons[correctIdx].classList.add('correct');
      buttons[correctIdx].setAttribute('aria-label',
        `Resposta correta: ${state.selected[state.current].choices[correctIdx]}`);
    }
  }

  buttons.forEach(b => { b.disabled = true; });

  if (explanationEl) {
    const provided = state.selected[state.current].explanation;
    explanationEl.textContent = provided ||
      (isCorrect
        ? 'Certo!'
        : `A correta era: ${state.selected[state.current].choices[correctIdx]}`);
    explanationEl.classList.remove('hidden');
  }

  nextBtn.disabled = false;
  nextBtn.textContent =
    state.current === state.selected.length - 1 ? 'Finalizar' : 'Próxima';

  // [FIX #7] Usa dois requestAnimationFrame aninhados em vez de setTimeout(20).
  // Garante que o browser pintou o reflow antes de iniciar a transição CSS,
  // evitando o caso em que frames lentos perdem o trigger.
  if (AUTO_ADVANCE_ENABLED && explanationEl) {
    const cd = document.createElement('div');
    const fill = document.createElement('div');
    cd.className = 'countdown';
    fill.className = 'countdown-fill';
    fill.style.width = '100%';
    cd.appendChild(fill);
    explanationEl.appendChild(cd);

    void fill.offsetWidth; // força reflow inicial para a propriedade ser registada
    fill.style.transition = `width ${AUTO_ADVANCE_DELAY}ms linear`;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => { fill.style.width = '0%'; })
    );

    state.autoAdvanceTimer = setTimeout(() => {
      state.autoAdvanceTimer = null;
      onNext();
    }, AUTO_ADVANCE_DELAY);
  }

  if (progressFill) {
    progressFill.style.width =
      `${((state.current + 1) / state.selected.length) * 100}%`;
  }
}

function onNext() {
  clearAutoAdvance();
  if (state.current < state.selected.length - 1) {
    state.current++;
    showQuestion();
  } else {
    showFinal();
  }
}

function updateScore() {
  scoreEl.textContent = state.score;
}

function showFinal() {
  clearAutoAdvance();
  questionScreen.classList.add('hidden');
  finalScreen.classList.remove('hidden');
  finalScoreEl.textContent = state.score;

  const key = 'showdo_miau_highscore';
  const prev = Number(localStorage.getItem(key) || 0);
  if (state.score > prev) {
    localStorage.setItem(key, String(state.score));
    highScoreEl.textContent = `${state.score} (novo recorde! 🏆)`;
  } else {
    highScoreEl.textContent = prev;
  }
}

function resetToIntro() {
  resetState();
  updateScore();
  finalScreen.classList.add('hidden');
  questionScreen.classList.add('hidden');
  intro.classList.remove('hidden');
  themeCards.forEach(c => c.classList.remove('selected'));
  if (themeTagEl) {
    themeTagEl.classList.add('hidden');
    themeTagEl.textContent = '';
  }
  nextBtn.textContent = 'Próxima';
  nextBtn.disabled = true;
  // state.nextAction já foi reposto para null pelo resetState().
}

// ── Atalhos de teclado ────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (questionScreen.classList.contains('hidden')) return;
  // [FIX #14] parseInt com radix explícito — mais claro que comparação de strings.
  const idx = Number.parseInt(e.key, 10) - 1;
  if (!Number.isNaN(idx) && idx >= 0 && idx < 9) {
    choicesEl.querySelector(`button[data-index="${idx}"]`)?.click();
  }
});

// ── Service Worker ─────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(console.error);

  let swReloading = false;

  function handleSWUpdate() {
    if (swReloading) return;
    swReloading = true;
    const url = new URL(location.href);
    url.searchParams.set('_sw', Date.now());
    try {
      location.replace(url.toString());
    } catch {
      location.reload();
    }
  }

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SW_UPDATED') handleSWUpdate();
  });

  navigator.serviceWorker.addEventListener('controllerchange', handleSWUpdate);
}
