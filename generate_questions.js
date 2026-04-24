const fs = require('node:fs');
require('dotenv').config();

const argv = process.argv.slice(2);
let count = 10;
let theme = null;
let serverUrl = process.env.GENERATIVE_SERVER_URL || null;

const GENERATIVE_API_URL = process.env.GENERATIVE_API_URL || 'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent';

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--count' && argv[i + 1]) { count = Number(argv[i + 1]); }
  if (argv[i] === '--theme' && argv[i + 1]) { theme = argv[i + 1]; }
  if (argv[i] === '--server' && argv[i + 1]) { serverUrl = argv[i + 1]; }
}

const SAMPLE_POOL = [
  { question: 'Qual é a capital do Brasil?', choices: ['Brasília', 'Rio de Janeiro', 'São Paulo', 'Salvador'], answerIndex: 0, explanation: 'Brasília foi inaugurada em 1960 para ser a nova capital federal.' },
  { question: 'Qual é o maior planeta do Sistema Solar?', choices: ['Júpiter', 'Saturno', 'Terra', 'Marte'], answerIndex: 0, explanation: 'Júpiter é um gigante gasoso e de longe o maior planeta do nosso sistema.' },
  { question: 'Em que continente fica o Egito?', choices: ['África', 'Ásia', 'Europa', 'América do Sul'], answerIndex: 0, explanation: 'O Egito fica no nordeste da África (com uma pequena parte na Ásia).' },
  { question: 'Qual elemento químico tem o símbolo O?', choices: ['Oxigênio', 'Ouro', 'Prata', 'Hélio'], answerIndex: 0, explanation: 'O símbolo "O" representa o Oxigênio na tabela periódica.' }
];

async function generate() {
  if (serverUrl) {
    try {
      const endpoint = `${serverUrl.replace(/\/$/, '')}/api/generate-questions`;
      console.log(`A tentar gerar via servidor local: ${endpoint}...`);

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, count }),
        signal: AbortSignal.timeout(10_000),
      });

      if (resp.ok) {
        const data = await resp.json().catch(() => null);
        if (data && data.ok && Array.isArray(data.questions)) {
          fs.writeFileSync('questions.json', JSON.stringify(data.questions, null, 2), 'utf8');
          console.log('✅ questions.json criado via servidor local!');
          return;
        }
      }
    } catch (err) {
      console.error('Falha ao chamar o servidor local:', err?.message);
    }
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (apiKey) {
    try {
      console.log('A tentar gerar via API direta do Gemini...');

      const prompt = `Gere ${count} perguntas de múltipla escolha em português sobre o tema "${theme || 'variado'}". Responda APENAS com um array JSON. Cada item deve ter: id (inteiro), theme (string), question (string), choices (array de exatas 4 strings), answerIndex (inteiro começando em 0), e explanation (string). Exemplo:\n[ { "id": 1, "theme": "${theme || 'variado'}", "question": "Pergunta?", "choices": ["A","B","C","D"], "answerIndex": 0, "explanation": "Motivo da resposta" } ]\nSem texto adicional, formatação markdown ou crases, apenas o JSON puro.`;

      const geminiUtils = require('./lib/gemini-utils.cjs');

      const url = GENERATIVE_API_URL; // never place API keys in the URL
      const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };

      const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) throw new Error(`Erro API ${res.status}: ${await res.text()}`);

      const data = await res.json();
      const text = geminiUtils.extractTextFromResponse(data);
      if (!text) throw new Error('A resposta da API não continha texto válido.');

      const parsed = geminiUtils.extractJSONFromText(text);
      if (!parsed) throw new Error('Não foi possível extrair JSON da resposta da API.');

      const normalized = geminiUtils.normalizeQuestions(parsed, theme || 'Misturado');
      fs.writeFileSync('questions.json', JSON.stringify(normalized, null, 2), 'utf8');
      console.log('✅ questions.json criado via API do Gemini!');
      return;
    } catch (err) {
      console.error('Falha ao gerar via API do Gemini, a usar o fallback local:', err.message || err);
    }
  }

  console.log('A gerar usando as perguntas locais de emergência...');
  const out = [];
  for (let i = 0; i < count; i++) {
    const item = SAMPLE_POOL[i % SAMPLE_POOL.length];
    out.push({
      id: i + 1, theme: theme || 'Misturado', question: item.question, choices: item.choices, answerIndex: item.answerIndex, explanation: item.explanation
    });
  }
  fs.writeFileSync('questions.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('✅ questions.json criado com sucesso (fallback).');
}

generate();
