// Cloudflare Worker: proxy /api/generate-questions to the Generative API
// Expects `GOOGLE_API_KEY` as a secret (set with `wrangler secret put`) and
// `GENERATIVE_API_URL` / `FRONTEND_ORIGIN` in `wrangler.toml` [vars].

const extractTextFromResponse = (data) => {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    return data.candidates[0].content.parts[0].text;
  }
  return JSON.stringify(data);
};

const extractJSONFromText = (text) => {
  if (!text) return null;
  const cleanedText = text.replaceAll('```json', '').replaceAll('```', '').trim();
  const start = cleanedText.indexOf('[');
  const end = cleanedText.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = cleanedText.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch (e) { /* fall through */ }
  }
  return null;
};

// [FIX #3] Sanitização de input idêntica ao server.js para evitar prompt injection.
// Remove qualquer caractere que não seja letra Unicode, número, espaço ou hífen.
const sanitizeTheme = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replaceAll(/[^\p{L}\p{N} \-]/gu, '').trim().slice(0, 60);
  return cleaned || null;
};

// [FIX #3] Clamp de count igual ao server.js: mínimo 1, máximo 20.
const sanitizeCount = (raw) => Math.min(Math.max(1, Number(raw) || 10), 20);

export default {
  async fetch(request, env) {
    const originHeader = request.headers.get('origin') || '';
    const configuredFrontend = (env.FRONTEND_ORIGIN || '*').replaceAll('"', '');

    let originToAllow = configuredFrontend;
    if (originHeader) {
      if (configuredFrontend === '*' || configuredFrontend === originHeader) {
        originToAllow = originHeader;
      }
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': originToAllow,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    if (originToAllow !== '*') corsHeaders['Access-Control-Allow-Credentials'] = 'true';
    // Evita que respostas do endpoint API sejam cacheadas por CDNs/proxies.
    corsHeaders['Cache-Control'] = 'no-store';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/generate-questions')) {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ ok: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    try {
      const body = await request.json().catch(() => ({}));

      // [FIX #3] Valida e sanitiza antes de qualquer uso.
      const theme = sanitizeTheme(body?.theme);
      if (!theme) {
        return new Response(
          JSON.stringify({ ok: false, error: 'theme é obrigatório e deve ser string (máx 60 chars).' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const count = sanitizeCount(body?.count);

      const prompt =
        `Gere ${count} perguntas de múltipla escolha em português sobre o tema "${theme}". ` +
        `Responda APENAS com um array JSON. Cada item deve ter: id (inteiro), theme (string), ` +
        `question (string), choices (array de exatas 4 strings), answerIndex (inteiro começando em 0), ` +
        `e explanation (string). ` +
        `Exemplo:\n[ { "id": 1, "theme": "${theme}", "question": "Pergunta?", ` +
        `"choices": ["A","B","C","D"], "answerIndex": 0, "explanation": "Motivo da resposta" } ]\n` +
        `Sem texto adicional, formatação markdown ou crases, apenas o JSON puro.`;

      // [FIX #2] API key enviada APENAS no header — nunca concatenada na URL
      // para evitar que apareça em logs de proxy/CDN.
      const apiUrl = (env.GENERATIVE_API_URL ||
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent'
      ).replaceAll('"', '');

      const headers = { 'Content-Type': 'application/json' };
      if (env.GOOGLE_API_KEY) {
        // [FIX #2] Header exclusivo — sem ?key= na URL.
        headers['x-goog-api-key'] = env.GOOGLE_API_KEY;
      }

      const geminiBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
      };

      const apiResp = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(geminiBody),
      });

      if (!apiResp.ok) {
        const text = await apiResp.text().catch(() => '(no body)');
        return new Response(
          JSON.stringify({ ok: false, error: `Generative API returned ${apiResp.status}: ${text}` }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const data = await apiResp.json();
      const text = extractTextFromResponse(data);
      const parsed = extractJSONFromText(text);

      if (!parsed) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Não foi possível extrair JSON da resposta da IA.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const normalized = parsed.map((it, idx) => ({
        id: it.id ?? (idx + 1),
        theme: it.theme ?? theme,
        question: it.question ?? '',
        choices: Array.isArray(it.choices) ? it.choices : [],
        answerIndex: Number(it.answerIndex ?? 0),
        explanation: it.explanation ?? null,
      }));

      return new Response(
        JSON.stringify({ ok: true, questions: normalized }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );

    } catch (err) {
      return new Response(
        JSON.stringify({ ok: false, error: err.message || String(err) }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
  },
};
