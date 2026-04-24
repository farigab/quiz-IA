// ESM helpers for parsing and normalizing responses from Gemini
export function extractTextFromResponse(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    return data.candidates[0].content.parts[0].text;
  }
  return JSON.stringify(data);
}

export function extractJSONFromText(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json/g, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

export function sanitizeTheme(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = String(raw).replace(/[^A-Za-z0-9 \-]/g, '').trim().slice(0,60);
  return cleaned || null;
}

export function sanitizeCount(raw) {
  return Math.min(Math.max(1, Number(raw) || 10), 20);
}

export function normalizeQuestions(parsed, themeFallback) {
  if (!Array.isArray(parsed)) return [];
  return parsed.map((it, idx) => {
    const id = it.id ?? (idx + 1);
    const th = it.theme ?? themeFallback ?? 'Misturado';
    const question = it.question ?? '';
    const choices = Array.isArray(it.choices) ? it.choices : [];
    const idxNum = Number(it.answerIndex ?? 0);
    const answerIndex = (idxNum >= 0 && idxNum < choices.length) ? idxNum : 0;
    const explanation = it.explanation ?? null;
    return { id, theme: th, question, choices, answerIndex, explanation };
  });
}
