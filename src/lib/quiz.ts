import { complete, parseJsonLoose, AiError, type AiSettings } from './ai';
import type { Source } from './extract';

export const SUBJECTS = [
  'Biologi', 'Fysik', 'Kemi', 'Teknik', 'Matematik', 'Svenska', 'Svenska som andraspråk', 'Engelska',
  'Moderna språk', 'Historia', 'Geografi', 'Religionskunskap', 'Samhällskunskap', 'Hem- och konsumentkunskap',
  'Idrott och hälsa', 'Musik', 'Bild', 'Slöjd',
];

export const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function stageFor(grade: number) {
  return grade <= 3 ? 'åk 1–3' : grade <= 6 ? 'åk 4–6' : 'åk 7–9';
}

export type QuestionMix = 'mc' | 'free' | 'mixed';

export interface McQuestion {
  type: 'mc';
  question: string;
  options: string[];
  correct: number;
  explanation: string;
  source: string;
  area: string;
}

export interface FreeQuestion {
  type: 'free';
  question: string;
  modelAnswer: string;
  points: string[];
  source: string;
  area: string;
}

export type Question = McQuestion | FreeQuestion;

export interface Quiz {
  id: string;
  title: string;
  subject: string;
  grade: number;
  createdAt: number;
  questions: Question[];
}

export interface QuizOptions {
  subject: string; // '' = låt AI gissa
  grade: number;
  mix: QuestionMix;
  count: number;
}

/** Ungefär 60 000 tecken räcker till ett långt kapitel utan att bli dyrt. */
const MAX_CHARS = 60000;

export function buildMaterial(sources: Source[]) {
  let text = sources.map((s) => `### Källa: ${s.name}\n${s.text}`).join('\n\n');
  let truncated = false;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    truncated = true;
  }
  return { text, truncated };
}

const SYSTEM_QUIZ = `Du är en erfaren svensk grundskolelärare som gör quiz för att hjälpa elever att plugga.
Regler:
- Bygg varje fråga ENBART på elevens material. Hitta inte på fakta som inte finns där.
- Skriv på enkel, tydlig svenska anpassad för årskursen.
- Flervalsfrågor har exakt 4 svarsalternativ, ett rätt, och tre rimliga men felaktiga.
- Variera var det rätta svaret står.
- Fritextfrågor ska kräva att eleven förklarar eller resonerar, inte bara nämner ett ord.
- "area" är det område i det centrala innehållet i Lgr22 (Skolverkets kursplan för ämnet och stadiet) som frågan bäst hör till, skrivet kort, t.ex. "Fotosyntes och förbränning".
- "source" anger var i materialet svaret finns, t.ex. "Fotosyntesen.pptx, bild 5".
Svara ENDAST med JSON.`;

export async function generateQuiz(settings: AiSettings, sources: Source[], opts: QuizOptions): Promise<Quiz> {
  const { text } = buildMaterial(sources);
  const nMc = opts.mix === 'mc' ? opts.count : opts.mix === 'free' ? 0 : Math.ceil(opts.count * 0.6);
  const nFree = opts.count - nMc;
  const subjectLine = opts.subject
    ? `Ämne: ${opts.subject}`
    : 'Ämne: avgör själv vilket grundskoleämne materialet hör till och ange det i "subject".';

  const user = `${subjectLine}
Årskurs: ${opts.grade} (${stageFor(opts.grade)})
Gör ${nMc} flervalsfrågor och ${nFree} fritextfrågor.

Svara med JSON i exakt detta format:
{
  "title": "kort rubrik på materialet",
  "subject": "ämnet",
  "questions": [
    {"type":"mc","question":"...","options":["...","...","...","..."],"correct":0,"explanation":"kort förklaring av rätt svar","source":"...","area":"..."},
    {"type":"free","question":"...","modelAnswer":"ett bra svar","points":["delar ett fullständigt svar ska ha"],"source":"...","area":"..."}
  ]
}

Elevens material:
"""
${text}
"""`;

  const raw = await complete(settings, SYSTEM_QUIZ, user, 8000);
  const parsed = parseJsonLoose<{ title?: string; subject?: string; questions?: unknown[] }>(raw);
  const questions = (parsed.questions ?? []).map(normalizeQuestion).filter((q): q is Question => q !== null);
  if (questions.length === 0) throw new AiError('AI:n kunde inte göra några frågor av materialet. Prova med mer text.');
  return {
    id: Math.random().toString(36).slice(2, 10),
    title: parsed.title?.trim() || sources[0]?.name || 'Quiz',
    subject: opts.subject || parsed.subject?.trim() || 'Okänt ämne',
    grade: opts.grade,
    createdAt: Date.now(),
    questions,
  };
}

export function normalizeQuestion(q: unknown): Question | null {
  if (!q || typeof q !== 'object') return null;
  const o = q as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const question = str(o.question);
  if (!question) return null;
  const base = { question, source: str(o.source), area: str(o.area) || 'Övrigt' };
  if (o.type === 'mc') {
    const options = Array.isArray(o.options) ? o.options.map(str).filter(Boolean) : [];
    const correct = Number(o.correct);
    if (options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) return null;
    return { type: 'mc', ...base, options, correct, explanation: str(o.explanation) };
  }
  if (o.type === 'free') {
    const points = Array.isArray(o.points) ? o.points.map(str).filter(Boolean) : [];
    return { type: 'free', ...base, modelAnswer: str(o.modelAnswer), points };
  }
  return null;
}

export interface Grade {
  verdict: 'correct' | 'partial' | 'incorrect';
  pointsMet: boolean[];
  feedback: string;
  tip: string;
}

const SYSTEM_GRADE = `Du rättar en grundskoleelevs fritextsvar. Var vänlig, uppmuntrande och konkret.
Bedöm innehållet, inte stavning. Jämför med bedömningspunkterna och materialet.
Skriv på enkel svenska riktad direkt till eleven ("du").
Svara ENDAST med JSON.`;

export async function gradeAnswer(
  settings: AiSettings,
  q: FreeQuestion,
  answer: string,
  grade: number,
  materialExcerpt: string,
): Promise<Grade> {
  const user = `Årskurs: ${grade}
Fråga: ${q.question}
Exempel på bra svar: ${q.modelAnswer}
Bedömningspunkter:
${q.points.map((p, i) => `${i + 1}. ${p}`).join('\n')}
Var i materialet: ${q.source}

Elevens svar:
"""
${answer}
"""

Utdrag ur materialet:
"""
${materialExcerpt.slice(0, 15000)}
"""

Svara med JSON:
{"verdict":"correct|partial|incorrect","pointsMet":[true,false,...],"feedback":"1-2 meningar om vad som var bra och vad som saknas","tip":"ett konkret tips om vad eleven kan läsa eller tänka på"}
"pointsMet" ska ha ett värde per bedömningspunkt, i samma ordning.`;

  const raw = await complete(settings, SYSTEM_GRADE, user, 1000);
  const g = parseJsonLoose<Partial<Grade>>(raw);
  const verdict = g.verdict === 'correct' || g.verdict === 'partial' || g.verdict === 'incorrect' ? g.verdict : 'partial';
  const pointsMet = q.points.map((_, i) => Boolean(g.pointsMet?.[i]));
  return { verdict, pointsMet, feedback: String(g.feedback ?? ''), tip: String(g.tip ?? '') };
}

/** Poäng för en fråga: flerval 0/1, fritext 1 / 0,5 / 0. */
export function scoreOf(verdict: Grade['verdict'] | 'mc-correct' | 'mc-wrong') {
  return verdict === 'correct' || verdict === 'mc-correct' ? 1 : verdict === 'partial' ? 0.5 : 0;
}
