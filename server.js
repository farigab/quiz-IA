const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { GoogleAuth } = require('google-auth-library');
require('dotenv').config();
const path = require('node:path');
const fs = require('node:fs');

const app = express();
const IS_PROD = process.env.NODE_ENV === 'production';

// ── Trust Proxy ───────────────────────────────────────────────────────────────
// [FIX #8] Sem isso, req.ip é sempre o IP do proxy (nginx/Cloudflare),
// tornando o rate limit global em vez de por utilizador.
app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────────────────────
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
app.use(cors({
  origin: FRONTEND_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
}));

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Muitas requisições. Tente novamente em 1 minuto.' },
});
app.use('/api/', apiLimiter);

// ── Content-Security-Policy ───────────────────────────────────────────────────
// [FIX #4] localhost removido em produção — só presente quando NODE_ENV != production.
const devConnect = IS_PROD ? '' : ' http://localhost:3000';
const connectSrc = `connect-src 'self'${devConnect} https://generativelanguage.googleapis.com https://fonts.googleapis.com https://fonts.gstatic.com`;
const fontSrc = "font-src 'self' https://fonts.gstatic.com";
const styleSrc = IS_PROD
  ? "style-src 'self' https://fonts.googleapis.com"
  : "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com";
const CSP = [
  "default-src 'self'",
  connectSrc,
  fontSrc,
  styleSrc,
  "img-src 'self' data:",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  next();
});

// ── Cache-Control para Service Worker e config ───────────────────────────────
app.use((req, res, next) => {
  // Ensure any per-build service worker file (service-worker.<id>.js)
  // or the legacy service-worker.js is served with no-cache headers.
  if (req.path === '/service-worker.js' || req.path.startsWith('/service-worker.')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }

  // Prevent generated config from being cached by browsers/CDNs so clients
  // can always fetch the latest buildId/serviceWorkerFile.
  if (req.path === '/config.js' || req.path === '/config.json') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }

  next();
});

// ── Bloqueio de arquivos sensíveis ────────────────────────────────────────────
const BLOCKED_BASENAMES = new Set([
  'server.js', 'worker.js', 'wrangler.toml', 'wrangler.json',
  'package.json', 'package-lock.json', '.env', '.env.example',
  'generate_questions.js',
]);

const ALLOWED_EXT = /\.(html|css|js|json|webmanifest|png|svg|ico|webp|jpg|jpeg|woff2?|ttf|eot)$/i;

app.use((req, res, next) => {
  const basename = path.basename(req.path);
  const ext = path.extname(req.path);

  if (BLOCKED_BASENAMES.has(basename)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (/^\/(scripts|node_modules|\.git)(\/|$)/.test(req.path)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (ext && !ALLOWED_EXT.test(ext)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  next();
});

// Fallback: quando um pedido ao service-worker versionado (service-worker.<id>.js)
// chegar e o ficheiro não existir no disco (por exemplo build não incluiu o
// ficheiro versionado), devolvemos o `service-worker.js` não-versionado.
// Isso evita que clientes fiquem presos a um `serviceWorkerFile` apontando
// para um ficheiro inexistente e facilita correção imediata em produção.
app.get(/^\/service-worker\..*\.js$/, (req, res, next) => {
  try {
    const requested = req.path.replace(/^\//, '');
    const fileOnDisk = path.join(__dirname, 'public', requested);
    if (fs.existsSync(fileOnDisk)) return next();
  } catch (err) {
    // se houver erro a verificar o ficheiro, deixa passar para o static (retorna 404)
    return next();
  }

  return res.sendFile(path.join(__dirname, 'public', 'service-worker.js'));
});

app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.get(/^\/(?!api).*/, (req, res) => {
  if (path.extname(req.path)) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Configuração ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

const GENERATIVE_API_URL =
  process.env.GENERATIVE_API_URL ||
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// ── Cliente da Generative API ─────────────────────────────────────────────────
async function callGenerativeAPI(prompt) {
  const headers = { 'Content-Type': 'application/json' };

  if (GOOGLE_API_KEY) {
    headers['x-goog-api-key'] = GOOGLE_API_KEY;
  } else {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token?.token) throw new Error('Falha ao obter token de acesso.');
    headers['Authorization'] = `Bearer ${token.token}`;
  }

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
  };

  const res = await fetch(GENERATIVE_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`Generative API retornou ${res.status}: ${text}`);
  }

  return res.json();
}

// ── Utilitários de parse ──────────────────────────────────────────────────────
function extractTextFromResponse(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? JSON.stringify(data);
}

function extractJSONFromText(text) {
  if (!text) return null;
  const clean = text.replaceAll('```json', '').replaceAll('```', '').trim();
  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(clean.slice(start, end + 1)); } catch { return null; }
}

// ── Rota de geração ───────────────────────────────────────────────────────────
// [FIX #17] express.json() aplicado por rota, não globalmente.
// Reduz superfície de parsing desnecessário em rotas estáticas.
app.post('/api/generate-questions', express.json({ limit: '16kb' }), async (req, res) => {
  const rawTheme = req.body?.theme;
  const rawCount = req.body?.count;

  if (!rawTheme || typeof rawTheme !== 'string') {
    return res.status(400).json({ ok: false, error: 'theme é obrigatório e deve ser string.' });
  }

  const theme = rawTheme.replaceAll(/[^\p{L}\p{N} \-]/gu, '').trim().slice(0, 60);
  if (!theme) {
    return res.status(400).json({ ok: false, error: 'theme inválido após sanitização.' });
  }

  const count = Math.min(Math.max(1, Number(rawCount) || 10), 20);

  const prompt =
    `Gere ${count} perguntas de múltipla escolha em português sobre o tema "${theme}". ` +
    `Responda APENAS com um array JSON. Cada item deve ter: id (inteiro), theme (string), ` +
    `question (string), choices (array de exatas 4 strings), answerIndex (inteiro começando em 0), ` +
    `e explanation (string). ` +
    `Exemplo:\n[ { "id": 1, "theme": "${theme}", "question": "Pergunta?", ` +
    `"choices": ["A","B","C","D"], "answerIndex": 0, "explanation": "Motivo da resposta" } ]\n` +
    `Sem texto adicional, formatação markdown ou crases, apenas o JSON puro.`;

  try {
    const apiResp = await callGenerativeAPI(prompt);
    const text = extractTextFromResponse(apiResp);
    const parsed = extractJSONFromText(text);

    if (!parsed) {
      console.error('Falha ao extrair JSON da resposta:', text?.slice(0, 500));
      return res.status(200).json({
        ok: false,
        error: 'Não foi possível extrair JSON da resposta da IA.',
      });
    }

    const normalized = parsed.map((it, idx) => ({
      id: it.id ?? (idx + 1),
      theme: it.theme ?? theme,
      question: it.question ?? '',
      choices: Array.isArray(it.choices) ? it.choices : [],
      answerIndex: Number(it.answerIndex ?? 0),
      explanation: it.explanation ?? null,
    }));

    return res.json({ ok: true, questions: normalized });

  } catch (err) {
    console.error('Erro na geração:', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`Servidor proxy generativo a correr em http://localhost:${PORT}`),
);
