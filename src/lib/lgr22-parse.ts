// Gör om Skolverkets kursplaner (HTML i Syllabus-API:t) till en liten, enkel struktur.
// Används både av byggskriptet (scripts/fetch-lgr22.ts) och av testerna.

export interface Lgr22Area {
  heading: string;
  items: string[];
}

export interface Lgr22Stage {
  /** T.ex. "1-3", "4-6", "7-9", "1-6" eller "4-9". */
  years: string;
  areas: Lgr22Area[];
}

export interface Lgr22Criteria {
  /** Årskursen kriterierna gäller i slutet av: "1", "3", "6" eller "9". */
  year: string;
  /** "E", "D", "C", "B", "A" eller "godtagbara". */
  level: string;
  text: string;
}

export interface Lgr22Subject {
  code: string;
  name: string;
  version: number;
  modifiedDate: string;
  stages: Lgr22Stage[];
  criteria: Lgr22Criteria[];
}

interface ApiText {
  text: string;
  year: string;
}

export interface ApiSubject {
  code: string;
  name: string;
  version: number;
  modifiedDate: string;
  centralContents?: ApiText[];
  knowledgeRequirements?: ApiText[];
}

/** Tar bort taggar, mjuka bindestreck och HTML-entiteter. */
export function plain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|li|h\d)>/gi, '$&\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/­|&shy;/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function parseCentralContent(html: string): Lgr22Area[] {
  const areas: Lgr22Area[] = [];
  for (const m of html.matchAll(/<h4[^>]*>((?:(?!<\/?h4)[\s\S])*?)<\/h4>\s*<ul[^>]*>([\s\S]*?)<\/ul>/gi)) {
    const items = [...m[2].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((li) => plain(li[1]).replace(/\n/g, ' ')).filter(Boolean);
    const heading = plain(m[1]).replace(/\n/g, ' ');
    if (heading && items.length) areas.push({ heading, items });
  }
  return areas;
}

export function parseCriteria(k: ApiText): Lgr22Criteria {
  // Rubrikerna kan vara flera, t.ex. "Inom ramen för skolans val" följt av "Betygskriterier för betyget E …".
  const headings = [...k.text.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map((m) => plain(m[1])).join(' ');
  const level = headings.match(/betyget\s+([A-E])\b/i)?.[1]?.toUpperCase() ?? 'godtagbara';
  return { year: k.year, level, text: plain(k.text.replace(/<h3[^>]*>[\s\S]*?<\/h3>/gi, '')) };
}

export function simplifySubject(s: ApiSubject): Lgr22Subject {
  const stages: Lgr22Stage[] = [];
  for (const c of s.centralContents ?? []) {
    const areas = parseCentralContent(c.text);
    if (!areas.length) continue;
    // Vissa ämnen (t.ex. moderna språk) har flera varianter per stadium; slå ihop dem.
    const existing = stages.find((x) => x.years === c.year);
    if (existing) existing.areas.push(...areas.filter((a) => !existing.areas.some((e) => e.heading === a.heading)));
    else stages.push({ years: c.year, areas });
  }
  // Ämnen med flera varianter (t.ex. språkval) upprepar kriterierna; behåll den första per årskurs och nivå.
  const criteria: Lgr22Criteria[] = [];
  for (const c of (s.knowledgeRequirements ?? []).map(parseCriteria)) {
    if (!criteria.some((x) => x.year === c.year && x.level === c.level)) criteria.push(c);
  }
  return { code: s.code, name: s.name, version: s.version, modifiedDate: s.modifiedDate, stages, criteria };
}

/** Väljer stadiet som gäller för en årskurs, t.ex. 8 → "7-9", 5 → "4-6" eller "1-6". */
export function stageForGrade(subject: Lgr22Subject, grade: number): Lgr22Stage | undefined {
  const fits = subject.stages.filter((s) => {
    const [a, b] = s.years.split('-').map(Number);
    return grade >= a && grade <= (b || a);
  });
  // Föredra det smalaste stadiet (4-6 före 4-9).
  return fits.sort((x, y) => span(x.years) - span(y.years))[0];
}

const span = (years: string) => {
  const [a, b] = years.split('-').map(Number);
  return (b || a) - a;
};

/** Kunskapskraven i slutet av det stadium årskursen hör till (3, 6 eller 9). */
export function criteriaForGrade(subject: Lgr22Subject, grade: number): Lgr22Criteria[] {
  const end = grade <= 3 ? '3' : grade <= 6 ? '6' : '9';
  return subject.criteria.filter((c) => c.year === end);
}

// ---- Gymnasiet (ämnesbetyg med nivåer, GY25) ----

export interface ApiGySubject {
  code: string;
  name: string;
  version: number | string;
  modifiedDate: string;
  courses?: { code: string; name: string; centralContent?: { text: string } }[];
  knowledgeRequirements?: { gradeStep: string; text: string }[];
}

/** Gymnasiets centrala innehåll: kursiva rubriker i <p><em>…</em></p> följda av punktlistor. */
export function parseCentralContentGy(html: string): Lgr22Area[] {
  const areas: Lgr22Area[] = [];
  const items = (ul: string) => [...ul.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((li) => plain(li[1]).replace(/\n/g, ' ')).filter(Boolean);
  for (const m of html.matchAll(/<p[^>]*>\s*<(em|i|strong|b)>((?:(?!<\/?p\b)[\s\S])*?)<\/\1>\s*<\/p>\s*<ul[^>]*>([\s\S]*?)<\/ul>/gi)) {
    const heading = plain(m[2]).replace(/\n/g, ' ');
    const list = items(m[3]);
    if (heading && list.length) areas.push({ heading, items: list });
  }
  if (!areas.length) {
    // Många ämnen (t.ex. svenska och religionskunskap) har bara en punktlista utan delrubriker.
    // Då blir varje punkt ett eget område, med punktens första mening som rubrik.
    const list = [...html.matchAll(/<ul[^>]*>([\s\S]*?)<\/ul>/gi)].flatMap((m) => items(m[1]));
    for (const item of list) areas.push({ heading: shortHeading(item), items: [item] });
  }
  return areas;
}

/** Första meningen i en punkt, högst cirka 80 tecken. */
export function shortHeading(item: string): string {
  const first = item.split(/(?<=[a-zåäö0-9)])\.\s/i)[0].replace(/\.$/, '').trim();
  if (first.length <= 80) return first;
  const cut = first.slice(0, 80);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '')} …`;
}

/** Varje nivå (t.ex. "Nivå 1c") blir ett "stadium"; betygskriterierna (E, C, A) gäller ämnet och har year "GY". */
export function simplifyGySubject(s: ApiGySubject): Lgr22Subject {
  const stages: Lgr22Stage[] = (s.courses ?? [])
    .map((c) => ({ years: c.name.trim(), areas: parseCentralContentGy(c.centralContent?.text ?? '') }))
    .filter((st) => st.areas.length);
  const criteria: Lgr22Criteria[] = (s.knowledgeRequirements ?? [])
    .filter((k) => ['E', 'C', 'A'].includes(k.gradeStep))
    .map((k) => ({ year: 'GY', level: k.gradeStep, text: plain(k.text.replace(/<h\d[^>]*>[\s\S]*?<\/h\d>/gi, '')) }));
  return { code: s.code, name: s.name, version: Number(s.version) || 1, modifiedDate: s.modifiedDate, stages, criteria };
}
