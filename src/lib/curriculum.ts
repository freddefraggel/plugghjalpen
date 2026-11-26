// Läser in Lgr22-datan som byggskriptet sparat i public/lgr22/. Finns den inte (t.ex. lokalt
// innan `npm run lgr22` körts) faller appen tillbaka på AI:ns egen kunskap om läroplanen.
import { criteriaForGrade, stageForGrade, type Lgr22Criteria, type Lgr22Subject } from './lgr22-parse';

export interface Lgr22IndexEntry {
  code: string;
  name: string;
  version: number;
  modifiedDate: string;
  stages: { years: string; headings: string[] }[];
}

export interface Lgr22Index {
  fetchedAt: string;
  source: string;
  subjects: Lgr22IndexEntry[];
}

const base = () => `${import.meta.env?.BASE_URL ?? '/'}lgr22/`;
let indexPromise: Promise<Lgr22Index | null> | null = null;
const subjectCache = new Map<string, Promise<Lgr22Subject | null>>();

export function loadIndex(): Promise<Lgr22Index | null> {
  indexPromise ??= fetch(`${base()}index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Lgr22Index>) : null))
    .catch(() => null);
  return indexPromise;
}

export async function loadSubject(name: string): Promise<Lgr22Subject | null> {
  const index = await loadIndex();
  const entry = index?.subjects.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
  if (!entry) return null;
  if (!subjectCache.has(entry.code)) {
    subjectCache.set(
      entry.code,
      fetch(`${base()}${entry.code}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<Lgr22Subject>) : null))
        .catch(() => null),
    );
  }
  return subjectCache.get(entry.code)!;
}

export function headingsFor(entry: Lgr22IndexEntry, grade: number): { years: string; headings: string[] } | undefined {
  const stub = { stages: entry.stages.map((x) => ({ years: x.years, areas: [] })) } as unknown as Lgr22Subject;
  const stage = stageForGrade(stub, grade);
  return stage && entry.stages.find((x) => x.years === stage.years);
}

export interface CurriculumContext {
  /** Text som läggs in i prompten. */
  prompt: string;
  /** Tillåtna områden; tom lista betyder att AI:n får formulera fritt. */
  headings: string[];
  /** Var områdena kommer ifrån, visas för eleven. */
  label: string | null;
}

/** Bygger läroplanstext till prompten för valt ämne, eller rubriker för alla ämnen om ämnet ska gissas. */
export async function curriculumContext(subject: string, grade: number): Promise<CurriculumContext> {
  const none: CurriculumContext = { prompt: '', headings: [], label: null };
  const index = await loadIndex();
  if (!index) return none;

  if (subject) {
    const s = await loadSubject(subject);
    const stage = s && stageForGrade(s, grade);
    if (!s || !stage) return none;
    const text = stage.areas.map((a) => `## ${a.heading}\n${a.items.map((i) => `- ${i}`).join('\n')}`).join('\n');
    return {
      prompt: `Centralt innehåll i ${s.name} för årskurs ${stage.years.replace('-', '–')} enligt Skolverkets kursplan (Lgr22):\n${text}`,
      headings: stage.areas.map((a) => a.heading),
      label: `Skolverkets kursplan i ${s.name.toLowerCase()}, centralt innehåll åk ${stage.years.replace('-', '–')}`,
    };
  }

  const lines: string[] = [];
  const headings: string[] = [];
  for (const e of index.subjects) {
    const st = headingsFor(e, grade);
    if (!st) continue;
    lines.push(`${e.name}: ${st.headings.join(' | ')}`);
    headings.push(...st.headings);
  }
  return {
    prompt: `Områden i centralt innehåll per ämne för årskurs ${grade} enligt Skolverkets kursplaner (Lgr22):\n${lines.join('\n')}`,
    headings,
    label: 'Skolverkets kursplaner, centralt innehåll',
  };
}

/** Matchar AI:ns områdesnamn mot Skolverkets rubriker, även om skiftläge eller ändelse skiljer. */
export function matchHeading(area: string, headings: string[]): string {
  if (!headings.length || !area) return area;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-zåäö0-9 ]/g, '').trim();
  const a = norm(area);
  return (
    headings.find((h) => norm(h) === a) ??
    headings.find((h) => norm(h).startsWith(a) || a.startsWith(norm(h))) ??
    area
  );
}

export async function criteriaFor(subject: string, grade: number): Promise<Lgr22Criteria[]> {
  const s = await loadSubject(subject);
  return s ? criteriaForGrade(s, grade) : [];
}
