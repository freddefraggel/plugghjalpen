// Hämtar grundskolans kursplaner (Lgr22) och gymnasiets ämnesplaner (GY25) från Skolverkets öppna Syllabus-API och sparar
// en förenklad version i public/lgr22/. Körs vid bygget i GitHub Actions: npm run lgr22
// API:t tillåter inte anrop direkt från webbläsare, därför hämtas datan i förväg.
import { mkdir, writeFile } from 'node:fs/promises';
import { simplifyGySubject, simplifySubject, type ApiGySubject, type ApiSubject, type Lgr22Subject } from '../src/lib/lgr22-parse.ts';

const API = 'https://api.skolverket.se/syllabus/v1';
const OUT = new URL('../public/lgr22/', import.meta.url);

async function get<T>(path: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API + path, { headers: { accept: 'application/json' } });
    if (res.ok) return (await res.json()) as T;
    if (attempt >= 3) throw new Error(`${path}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

const list = await get<{ subjects: { code: string; name: string; typeOfSyllabus: string }[] }>('/subjects?schooltype=GR');
const wanted = list.subjects.filter((s) => s.typeOfSyllabus === 'COURSE_SYLLABUS');
await mkdir(OUT, { recursive: true });

type IndexEntry = { code: string; name: string; version: number; modifiedDate: string; stages: { years: string; headings: string[] }[] };
const entryFor = (simple: Lgr22Subject): IndexEntry => ({
  code: simple.code,
  name: simple.name,
  version: simple.version,
  modifiedDate: simple.modifiedDate,
  stages: simple.stages.map((st) => ({ years: st.years, headings: st.areas.map((a) => a.heading) })),
});
const index: IndexEntry[] = [];
let bytes = 0;
for (const s of wanted) {
  const { subject } = await get<{ subject: ApiSubject }>(`/subjects/${s.code}`);
  const simple = simplifySubject(subject);
  if (!simple.stages.length) {
    console.warn(`Hoppar över ${s.name}: hittade inget centralt innehåll`);
    continue;
  }
  const json = JSON.stringify(simple);
  bytes += json.length;
  await writeFile(new URL(`${s.code}.json`, OUT), json);
  index.push(entryFor(simple));
}
index.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
await writeFile(new URL('index.json', OUT), JSON.stringify({ fetchedAt: new Date().toISOString(), source: `${API}/subjects?schooltype=GR`, subjects: index }));
console.log(`Sparade ${index.length} ämnen, ${(bytes / 1024).toFixed(0)} kB totalt.`);

// Gymnasiet: de nya ämnesplanerna med nivåer (GY25), bara gymnasiegemensamma och andra
// högskoleförberedande ämnen ("Kapitel 4-ämnen"), inte yrkesämnen.
try {
  const GY = new URL('gy/', OUT);
  type GyListItem = { code: string; name: string; typeOfSyllabus: string; canceledDate?: string; categories?: { code: string }[] };
  const gyList = await get<{ subjects: GyListItem[] }>('/subjects?schooltype=GY');
  const gyWanted = gyList.subjects.filter(
    (s) => s.typeOfSyllabus === 'GRADE_SUBJECT_SYLLABUS' && !s.canceledDate && (s.categories ?? []).some((c) => c.code === 'COMMON2'),
  );
  await mkdir(GY, { recursive: true });
  const gyIndex: IndexEntry[] = [];
  let gyBytes = 0;
  for (const s of gyWanted) {
    const { subject } = await get<{ subject: ApiGySubject }>(`/subjects/${encodeURIComponent(s.code)}?schooltype=GY`);
    const simple = simplifyGySubject(subject);
    if (!simple.stages.length) {
      console.warn(`Hoppar över ${s.name} (gymnasiet): hittade inget centralt innehåll`);
      continue;
    }
    const json = JSON.stringify(simple);
    gyBytes += json.length;
    await writeFile(new URL(`${s.code}.json`, GY), json);
    gyIndex.push(entryFor(simple));
  }
  gyIndex.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  await writeFile(new URL('index.json', GY), JSON.stringify({ fetchedAt: new Date().toISOString(), source: `${API}/subjects?schooltype=GY`, subjects: gyIndex }));
  console.log(`Gymnasiet: sparade ${gyIndex.length} ämnen, ${(gyBytes / 1024).toFixed(0)} kB totalt.`);
} catch (e) {
  console.log(`::warning::Kunde inte hämta gymnasiets ämnesplaner: ${e instanceof Error ? e.message : e}`);
}
