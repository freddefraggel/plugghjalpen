import { budgetFor, complete, parseJsonLoose, salvageObjects, AiError, UNREADABLE, type AiSettings } from './ai';
import type { Source } from './extract';
import { curriculumContext, GY_GRADE, matchHeading, schoolOf } from './curriculum';

export const SUBJECTS = [
  'Biologi', 'Fysik', 'Kemi', 'Teknik', 'Matematik', 'Svenska', 'Svenska som andraspråk', 'Engelska',
  'Moderna språk', 'Historia', 'Geografi', 'Religionskunskap', 'Samhällskunskap', 'Hem- och konsumentkunskap',
  'Idrott och hälsa', 'Musik', 'Bild', 'Slöjd',
];

/** 1–9 är grundskolans årskurser, 10 (GY_GRADE) är gymnasiet. */
export const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, GY_GRADE];

export function stageFor(grade: number) {
  return grade >= GY_GRADE ? 'gymnasiet' : grade <= 3 ? 'åk 1–3' : grade <= 6 ? 'åk 4–6' : 'åk 7–9';
}

/** Kort text om årskurs eller gymnasienivå, t.ex. "åk 7" eller "gymnasiet, nivå 1c". */
export function levelLabel(grade: number, level?: string) {
  if (grade < GY_GRADE) return `åk ${grade}`;
  return level ? `gymnasiet, ${level.toLowerCase()}` : 'gymnasiet';
}

/** Elevens ungefärliga ålder, t.ex. "cirka 13 år" för åk 7 och "16–19 år" för gymnasiet. */
export function ageFor(grade: number) {
  return grade >= GY_GRADE ? '16–19 år' : `cirka ${grade + 6} år`;
}

/** Rad till AI:n om elevens nivå och ålder. */
export function levelLine(grade: number, level?: string) {
  return grade >= GY_GRADE
    ? `Skolform: gymnasieskolan${level ? `, ${level.toLowerCase()}` : ''} (eleven är ${ageFor(grade)})`
    : `Årskurs: ${grade} (${stageFor(grade)}, eleven är ${ageFor(grade)})`;
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
  /** Gymnasiet: vald nivå i ämnet, t.ex. "Nivå 1c". */
  level?: string;
  createdAt: number;
  questions: Question[];
  /** Varifrån områdena kommer, t.ex. "Skolverkets kursplan i biologi, centralt innehåll åk 7–9". Saknas = AI:ns egen bedömning. */
  curriculumLabel?: string;
}

export interface QuizOptions {
  subject: string; // '' = låt AI gissa
  grade: number;
  level?: string;
  mix: QuestionMix;
  count: number;
}

/** Standardgräns för materialets längd i tecken (Anthropic). Andra leverantörer har lägre, se budgetFor. */
export const MAX_CHARS = 60000;

export function buildMaterial(sources: Source[], maxChars = MAX_CHARS) {
  const full = sources.map((s) => `### Källa: ${s.name}\n${s.text}`).join('\n\n');
  if (full.length <= maxChars) return { text: full, truncated: false };
  return { text: condense(full, maxChars), truncated: true };
}

/**
 * Kortar en lång text genom att ta jämnt fördelade bitar från hela texten,
 * så att quizet täcker början, mitten och slutet i stället för bara början.
 */
export function condense(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const sep = '\n[…]\n';
  const pieces = Math.max(1, Math.min(10, Math.floor(maxChars / 1200)));
  const pieceLen = Math.floor((maxChars - sep.length * (pieces - 1)) / pieces);
  const step = (text.length - pieceLen) / Math.max(1, pieces - 1);
  const out: string[] = [];
  for (let i = 0; i < pieces; i++) {
    let start = pieces === 1 ? 0 : Math.round(i * step);
    // Börja helst vid en radbrytning så att bitarna inte startar mitt i ett ord.
    const nl = text.lastIndexOf('\n', start);
    if (nl >= 0 && start - nl < 300) start = nl + 1;
    out.push(text.slice(start, start + pieceLen).trim());
  }
  return out.join(sep).slice(0, maxChars);
}

/** Väljer de stycken i materialet som har flest ord gemensamt med frågan. */
export function relevantExcerpt(material: string, query: string, maxChars: number): string {
  if (material.length <= maxChars) return material;
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-zåäöéü0-9]{4,}/g) ?? []);
  const q = words(query);
  const paras = material.split(/\n+/).filter((p) => p.trim());
  const scored = paras.map((p, i) => {
    let hits = 0;
    for (const w of words(p)) if (q.has(w)) hits++;
    return { i, p, hits };
  });
  const chosen = new Set<number>();
  let used = 0;
  for (const s of [...scored].sort((a, b) => b.hits - a.hits)) {
    if (used + s.p.length + 1 > maxChars) continue;
    chosen.add(s.i);
    used += s.p.length + 1;
  }
  return scored.filter((s) => chosen.has(s.i)).map((s) => s.p).join('\n');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Anropar AI:n och väntar och försöker igen en gång om minutgränsen nåtts och väntetiden är kort. */
async function completeWithRetry(settings: AiSettings, system: string, user: string, maxTokens: number) {
  try {
    return await complete(settings, system, user, maxTokens);
  } catch (e) {
    if (e instanceof AiError && e.code === 'rate' && (e.info.retryAfter ?? 99) <= 30) {
      await sleep(((e.info.retryAfter ?? 0) + 1) * 1000);
      return complete(settings, system, user, maxTokens);
    }
    throw e;
  }
}

const SYSTEM_QUIZ = `Du är en erfaren svensk lärare som gör quiz för att hjälpa elever att plugga.
Regler:
- Bygg varje fråga ENBART på elevens material. Hitta inte på fakta som inte finns där.
- Skriv på tydlig svenska anpassad för elevens årskurs eller gymnasienivå: enkla ord och korta meningar för de yngsta, ämnesbegrepp och mer krävande resonemang högre upp.
- Flervalsfrågor har exakt 4 svarsalternativ, ett rätt, och tre rimliga men felaktiga.
- Fritextfrågor ska kräva att eleven förklarar eller resonerar, inte bara nämner ett ord.
- "area" är det område i det centrala innehållet (Skolverkets kursplan i Lgr22, eller ämnesplan för gymnasiet) som frågan bäst hör till, skrivet kort, t.ex. "Fotosyntes och förbränning".
- "source" anger var i materialet svaret finns, t.ex. "Fotosyntesen.pptx, bild 5".
Svara ENDAST med JSON.`;

export async function generateQuiz(settings: AiSettings, sources: Source[], opts: QuizOptions): Promise<Quiz> {
  const nMc = opts.mix === 'mc' ? opts.count : opts.mix === 'free' ? 0 : Math.ceil(opts.count * 0.6);
  const nFree = opts.count - nMc;
  const subjectLine = opts.subject
    ? `Ämne: ${opts.subject}`
    : `Ämne: avgör själv vilket ${schoolOf(opts.grade) === 'GY' ? 'gymnasieämne' : 'grundskoleämne'} materialet hör till och ange det i "subject".`;

  const cur = await curriculumContext(opts.subject, opts.grade, opts.level);
  const curriculumRules = cur.headings.length
    ? `\n${cur.prompt}\n\nVIKTIGT: "area" ska vara EXAKT en av rubrikerna ovan (${opts.subject ? 'efter ##' : 'för det ämne du väljer'}), ordagrant. Välj den rubrik vars punkter frågan bäst övar på.\n`
    : '';

  const user = `${subjectLine}
${levelLine(opts.grade, opts.level)}
Gör ${nMc} flervalsfrågor och ${nFree} fritextfrågor.
${curriculumRules}
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
`;

  const budget = budgetFor(settings.provider);
  let chars = Math.max(2000, budget.inputChars - curriculumRules.length);
  let outTokens = Math.min(budget.outputTokens, 600 + opts.count * 350);
  let raw = '';
  for (let attempt = 0; ; attempt++) {
    const { text } = buildMaterial(sources, chars);
    try {
      raw = await completeWithRetry(settings, SYSTEM_QUIZ, `${user}${text}\n"""`, outTokens);
      break;
    } catch (e) {
      if (!(e instanceof AiError) || e.code !== 'too_large' || attempt >= 2) {
        if (e instanceof AiError && e.code === 'too_large') throw tooLargeError();
        throw e;
      }
      // Krymp materialet så att det ryms inom tjänstens gräns och försök igen.
      const { limit, requested } = e.info;
      const ratio = limit && requested ? (limit / requested) * 0.8 : 0.5;
      chars = Math.floor(Math.min(text.length, chars) * ratio);
      if (limit) outTokens = Math.min(outTokens, Math.floor(limit * 0.4));
      if (chars < 1500) throw tooLargeError();
    }
  }
  const parsed = parseQuizResponse(raw);
  const questions = (parsed.questions ?? [])
    .map(normalizeQuestion)
    .filter((q): q is Question => q !== null)
    .map((q) => ({ ...q, area: matchHeading(q.area, cur.headings) }))
    // AI-modeller lägger ofta rätt svar först, så blanda alternativen här i stället för att lita på prompten.
    .map((q) => (q.type === 'mc' ? shuffleOptions(q) : q));
  if (questions.length === 0) throw new AiError('AI:n kunde inte göra några frågor av materialet. Prova med mer text.');
  return {
    id: Math.random().toString(36).slice(2, 10),
    title: parsed.title?.trim() || sources[0]?.name || 'Quiz',
    subject: opts.subject || parsed.subject?.trim() || 'Okänt ämne',
    grade: opts.grade,
    ...(opts.level && opts.grade >= GY_GRADE ? { level: opts.level } : {}),
    createdAt: Date.now(),
    questions,
    curriculumLabel: cur.label ?? undefined,
  };
}

function tooLargeError() {
  return new AiError(
    'Materialet är för långt för den här AI-tjänstens gräns. Prova färre frågor, ta bort någon källa eller byt till Anthropic under Inställningar.',
    'too_large',
  );
}

/** Blandar svarsalternativen och flyttar markeringen av rätt svar med dem. */
export function shuffleOptions(q: McQuestion, random: () => number = Math.random): McQuestion {
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, options: order.map((i) => q.options[i]), correct: order.indexOf(q.correct) };
}

/** Läser AI:ns quizsvar. Är det avklippt eller delvis trasigt används de frågor som går att läsa. */
export function parseQuizResponse(raw: string): { title?: string; subject?: string; questions?: unknown[] } {
  try {
    return parseJsonLoose(raw);
  } catch {
    const questions = salvageObjects(raw, 'questions');
    if (!questions.length) {
      throw new AiError(
        raw.includes('"questions"')
          ? 'AI-svaret blev för långt och klipptes av innan första frågan var klar. Prova färre frågor, eller en annan modell under Inställningar.'
          : UNREADABLE,
      );
    }
    const field = (k: string) => raw.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`))?.[1];
    return { title: field('title'), subject: field('subject'), questions };
  }
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

const SYSTEM_GRADE = `Du rättar en elevs fritextsvar. Var vänlig, uppmuntrande och konkret.
Bedöm innehållet, inte stavning. Jämför med bedömningspunkterna och materialet, och ställ krav som passar elevens årskurs eller gymnasienivå.
Skriv på tydlig svenska, anpassad till elevens ålder, riktad direkt till eleven ("du").
Svara ENDAST med JSON.`;

export async function gradeAnswer(
  settings: AiSettings,
  q: FreeQuestion,
  answer: string,
  grade: number,
  materialExcerpt: string,
  level?: string,
): Promise<Grade> {
  const user = `${levelLine(grade, level)}
Bedöm utifrån vad som är rimligt att kräva på den nivån.
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
${relevantExcerpt(materialExcerpt, `${q.question} ${q.modelAnswer} ${q.points.join(' ')}`, Math.min(15000, Math.floor(budgetFor(settings.provider).inputChars / 3)))}
"""

Svara med JSON:
{"verdict":"correct|partial|incorrect","pointsMet":[true,false,...],"feedback":"1-2 meningar om vad som var bra och vad som saknas","tip":"ett konkret tips om vad eleven kan läsa eller tänka på"}
"pointsMet" ska ha ett värde per bedömningspunkt, i samma ordning.`;

  const raw = await completeWithRetry(settings, SYSTEM_GRADE, user, 1000);
  const g = parseJsonLoose<Partial<Grade>>(raw);
  const verdict = g.verdict === 'correct' || g.verdict === 'partial' || g.verdict === 'incorrect' ? g.verdict : 'partial';
  const pointsMet = q.points.map((_, i) => Boolean(g.pointsMet?.[i]));
  return { verdict, pointsMet, feedback: String(g.feedback ?? ''), tip: String(g.tip ?? '') };
}

/** Poäng för en fråga: flerval 0/1, fritext 1 / 0,5 / 0. */
export function scoreOf(verdict: Grade['verdict'] | 'mc-correct' | 'mc-wrong') {
  return verdict === 'correct' || verdict === 'mc-correct' ? 1 : verdict === 'partial' ? 0.5 : 0;
}
