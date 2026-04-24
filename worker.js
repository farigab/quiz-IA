import {
  extractTextFromResponse,
  extractJSONFromText,
  sanitizeTheme,
  sanitizeCount,
  normalizeQuestions,
} from './lib/gemini-utils.mjs';

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
        'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent'
      ).replaceAll('"', '');

      const headers = { 'Content-Type': 'application/json' };
      if (!env.GOOGLE_API_KEY) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Server misconfigured: missing API key.' }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      // [FIX #2] Header exclusivo — sem ?key= na URL.
      headers['x-goog-api-key'] = env.GOOGLE_API_KEY;

      const geminiBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          thinkingConfig: { thinkingBudget: 0 },
        },
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

      const normalized = normalizeQuestions(parsed, theme);

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
