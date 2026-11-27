import { complete, type AiSettings } from './ai';
import { levelLine, type Question } from './quiz';
import type { AnswerRecord } from './storage';

// "Läs mer": frågorna bygger bara på elevens material, men på resultatsidan
// slår vi upp det frågan handlar om på svenska Wikipedia och kan låta AI:n
// förklara med hjälp av den texten.

export interface WikiSummary {
  title: string;
  extract: string;
  url: string;
}

const STOP = new Set(
  'och att det som en på är av för med till den har de inte om ett han men var jag sig från vi så kan man när år säger hon under också efter eller nu sin där vid mot ska skulle kunde bara vara alla andra mycket finns hur vad vilken vilket vilka varför vem varje blir blev många några något någon dessa detta denna här sedan dock samt enligt mellan genom utan över inom kallas betyder beskriv förklara ge exempel nämn varför vilket'.split(
    ' ',
  ),
);

/** Ord ur en fråga som duger som sökord: inga småord, gärna långa ord först. */
export function keywords(text: string, max = 4): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  const unique = [...new Set(words)];
  const top = new Set([...unique].sort((a, b) => b.length - a.length).slice(0, max));
  return unique.filter((w) => top.has(w));
}

/** Sökord att pröva i tur och ordning, från mest till minst träffsäkert. */
export function searchTerms(q: Question): string[] {
  const terms: string[] = [];
  if (q.topic) terms.push(q.topic);
  if (q.type === 'mc') {
    const right = q.options[q.correct] ?? '';
    if (right && right.split(/\s+/).length <= 4 && !/^\d+([.,]\d+)?$/.test(right.trim())) terms.push(right);
  }
  const kw = keywords(q.question);
  if (kw.length) terms.push(kw.join(' '));
  if (kw.length > 2) terms.push(kw.slice(0, 2).join(' '));
  return [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
}

export function wikiSearchUrl(term: string) {
  const p = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: term,
    gsrlimit: '3',
    gsrnamespace: '0',
    prop: 'extracts|info|pageprops',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    exlimit: '3',
    inprop: 'url',
    ppprop: 'disambiguation',
    redirects: '1',
    format: 'json',
    origin: '*',
  });
  return `https://sv.wikipedia.org/w/api.php?${p}`;
}

interface ApiPage {
  title?: string;
  index?: number;
  extract?: string;
  fullurl?: string;
  pageprops?: { disambiguation?: string };
}

/** Bästa träffen i ett svar från Wikipedias sök-API, utan förgreningssidor. */
export function pickPage(data: unknown): WikiSummary | null {
  const pages = Object.values((data as { query?: { pages?: Record<string, ApiPage> } })?.query?.pages ?? {});
  const best = pages
    .filter((p) => p.title && p.extract?.trim() && p.fullurl && p.pageprops?.disambiguation === undefined)
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))[0];
  if (!best) return null;
  return { title: best.title!, extract: best.extract!.trim(), url: best.fullurl! };
}

const cache = new Map<string, Promise<WikiSummary | null>>();

async function lookup(term: string, fetchFn: typeof fetch): Promise<WikiSummary | null> {
  if (!cache.has(term)) {
    const p = fetchFn(wikiSearchUrl(term))
      .then((r) => (r.ok ? r.json() : null))
      .then(pickPage)
      .catch(() => {
        cache.delete(term);
        return null;
      });
    cache.set(term, p);
  }
  return cache.get(term)!;
}

/** Slår upp frågans ämne på svenska Wikipedia. Ger null om inget hittas eller nätet strular. */
export async function findReadMore(q: Question, fetchFn: typeof fetch = fetch): Promise<WikiSummary | null> {
  for (const term of searchTerms(q)) {
    const hit = await lookup(term, fetchFn);
    if (hit) return hit;
  }
  return null;
}

const SYSTEM_EXPLAIN = `Du är en vänlig och tydlig svensk lärare. En elev har svarat fel eller ofullständigt på en quizfråga.
Förklara rätt svar så att eleven förstår varför, med ord som passar elevens ålder. Skriv 3–5 korta meningar direkt till eleven ("du").
Utgå från frågan och rätt svar. Använd texten från Wikipedia bara om den handlar om samma sak, och hitta inte på fakta.
Om elevens svar visar ett vanligt missförstånd, reda ut det vänligt. Svara med ren text, utan rubriker eller listor.`;

export function explainPrompt(q: Question, answer: AnswerRecord | undefined, grade: number, level: string | undefined, wiki: WikiSummary | null) {
  const right = q.type === 'mc' ? `${q.options[q.correct]}${q.explanation ? ` (${q.explanation})` : ''}` : q.modelAnswer;
  const given =
    answer === undefined || answer.given === '' ? 'Inget svar.' : q.type === 'mc' && typeof answer.given === 'number' ? q.options[answer.given] ?? 'Inget svar.' : String(answer.given);
  return `${levelLine(grade, level)}
Fråga: ${q.question}
Rätt svar: ${right}
Elevens svar: ${given}
${wiki ? `\nText från Wikipedia, artikeln "${wiki.title}":\n"""\n${wiki.extract}\n"""` : ''}`;
}

/** En kort, åldersanpassad förklaring av en fråga eleven missade. */
export async function explainMore(
  settings: AiSettings,
  q: Question,
  answer: AnswerRecord | undefined,
  grade: number,
  level: string | undefined,
  wiki: WikiSummary | null,
): Promise<string> {
  const text = await complete(settings, SYSTEM_EXPLAIN, explainPrompt(q, answer, grade, level, wiki), 600);
  return text.trim();
}
