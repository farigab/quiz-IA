import {
  extractJSONFromText,
  extractTextFromResponse,
  normalizeQuestions,
  sanitizeCount,
  sanitizeTheme,
} from './lib/gemini-utils.mjs';

const DEFAULT_GENERATIVE_URL = 'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent';

function jsonResponse(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.FRONTEND_ORIGIN || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const pathname = url.pathname;

    if (request.method === 'POST' && (pathname === '/api/generate-questions' || pathname === '/generate-questions')) {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400, corsHeaders);
      }

      const theme = sanitizeTheme(body.theme);
      if (!theme) return jsonResponse({ ok: false, error: 'theme é obrigatório e deve ser string.' }, 400, corsHeaders);

      const count = sanitizeCount(body.count);

      const prompt = `Gere ${count} perguntas de múltipla escolha em português sobre o tema "${theme}". ` +
        `As perguntas devem ter níveis de dificuldade variados (fácil, médio e difícil), distribuídos de forma equilibrada. ` +
        `Responda APENAS com um array JSON. Cada item deve ter: id (inteiro), theme (string), ` +
        `question (string), choices (array de exatas 4 strings), answerIndex (inteiro começando em 0), ` +
        `e explanation (string). ` +
        `Exemplo:\n[ { "id": 1, "theme": "${theme}", "question": "Pergunta?", ` +
        `"choices": ["A","B","C","D"], "answerIndex": 0, "explanation": "Motivo da resposta" } ]\n` +
        `Sem texto adicional, formatação markdown ou crases, apenas o JSON puro.`;

      const GENERATIVE_API_URL = env.GENERATIVE_API_URL || DEFAULT_GENERATIVE_URL;
      const apiKey = env.GOOGLE_API_KEY;
      if (!apiKey) {
        return jsonResponse({ ok: false, error: 'GOOGLE_API_KEY is not configured. Set it as a Worker secret.' }, 500, corsHeaders);
      }

      const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
      const bodyReq = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
      };

      const timeoutMs = Number(env.GENERATIVE_TIMEOUT_MS) || 45000;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(GENERATIVE_API_URL, { method: 'POST', headers, body: JSON.stringify(bodyReq), signal: controller.signal });
        clearTimeout(id);
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          return jsonResponse({ ok: false, error: `Generative API retornou ${res.status}: ${t}` }, res.status || 500, corsHeaders);
        }
        const apiResp = await res.json();
        const text = extractTextFromResponse(apiResp);
        const parsed = extractJSONFromText(text);
        if (!parsed) {
          console.error('Falha ao extrair JSON da resposta:', text?.slice(0, 500));
          return jsonResponse({ ok: false, error: 'Não foi possível extrair JSON da resposta da IA.' }, 200, corsHeaders);
        }
        const normalized = normalizeQuestions(parsed, theme);
        return jsonResponse({ ok: true, questions: normalized }, 200, corsHeaders);
      } catch (err) {
        clearTimeout(id);
        const message = err.name === 'AbortError' ? 'Request timed out' : String(err);
        console.error('Erro na geração:', err);
        return jsonResponse({ ok: false, error: message }, 500, corsHeaders);
      }
    }

    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain', ...corsHeaders } });
  }
};
