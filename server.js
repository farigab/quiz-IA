const express = require('express');
const cors = require('cors');
const { GoogleAuth } = require('google-auth-library');
require('dotenv').config();
const path = require('node:path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const CSP = process.env.CONTENT_SECURITY_POLICY || "default-src 'self'; connect-src 'self' http://localhost:3000 https://generativelanguage.googleapis.com https://fonts.googleapis.com https://fonts.gstatic.com; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:;";
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  next();
});

app.use(express.static(path.join(__dirname)));
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
const GENERATIVE_API_URL = process.env.GENERATIVE_API_URL || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

async function callGenerativeAPI(prompt) {
  const url = GOOGLE_API_KEY ? `${GENERATIVE_API_URL}?key=${GOOGLE_API_KEY}` : GENERATIVE_API_URL;
  const headers = { 'Content-Type': 'application/json' };

  if (!GOOGLE_API_KEY) {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    if (!accessToken) throw new Error('Falha ao obter token de acesso.');
    headers['Authorization'] = `Bearer ${accessToken.token || accessToken}`;
  }

  if (GOOGLE_API_KEY) {
    headers['x-goog-api-key'] = GOOGLE_API_KEY;
  }

  // Payload do Gemini corrigido (sem o responseMimeType que causou o erro 400)
  const geminiBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2000
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(geminiBody)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      throw new Error(`Generative API retornou ${res.status}: ${text}`);
    }

    return await res.json();
  } catch (err) {
    throw new Error(`Falha na requisição: ${err.message}`);
  }
}

function extractTextFromResponse(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    return data.candidates[0].content.parts[0].text;
  }
  return JSON.stringify(data);
}

function extractJSONFromText(text) {
  if (!text) return null;
  // Limpeza caso a IA devolva blocos markdown
  const cleanedText = text.replaceAll('```json', '').replaceAll('```', '').trim();
  const start = cleanedText.indexOf('[');
  const end = cleanedText.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = cleanedText.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch (e) { }
  }
  return null;
}

app.post('/api/generate-questions', async (req, res) => {
  const { theme, count = 10 } = req.body || {};
  if (!theme) return res.status(400).json({ ok: false, error: 'theme is required' });

  const prompt = `Gere ${count} perguntas de múltipla escolha em português sobre o tema "${theme}". Responda APENAS com um array JSON. Cada item deve ter: id (inteiro), theme (string), question (string), choices (array de exatas 4 strings), answerIndex (inteiro começando em 0), e explanation (string). Exemplo:\n[ { "id": 1, "theme": "${theme}", "question": "Pergunta?", "choices": ["A","B","C","D"], "answerIndex": 0, "explanation": "Motivo da resposta" } ]\nSem texto adicional, formatação markdown ou crases, apenas o JSON puro.`;

  try {
    const apiResp = await callGenerativeAPI(prompt);
    const text = extractTextFromResponse(apiResp);
    const parsed = extractJSONFromText(text);

    if (!parsed) {
      console.error('Falha ao extrair JSON da resposta:', text);
      return res.status(200).json({ ok: false, error: 'Não foi possível extrair JSON da resposta' });
    }

    const normalized = parsed.map((it, idx) => ({
      id: it.id ?? (idx + 1),
      theme: it.theme ?? theme,
      question: it.question ?? '',
      choices: it.choices ?? [],
      answerIndex: Number(it.answerIndex ?? 0),
      explanation: it.explanation ?? null
    }));

    return res.json({ ok: true, questions: normalized });
  } catch (err) {
    console.error('Erro na geração:', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.listen(PORT, () => console.log(`Generative proxy server a correr em http://localhost:${PORT}`));
