// Hämtar grundskolans kursplaner (Lgr22) från Skolverkets öppna Syllabus-API och sparar
// en förenklad version i public/lgr22/. Körs vid bygget i GitHub Actions: npm run lgr22
// API:t tillåter inte anrop direkt från webbläsare, därför hämtas datan i förväg.
import { mkdir, writeFile } from 'node:fs/promises';
import { simplifySubject, type ApiSubject } from '../src/lib/lgr22-parse.ts';

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

const index: { code: string; name: string; version: number; modifiedDate: string; stages: { years: string; headings: string[] }[] }[] = [];
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
  index.push({
    code: simple.code,
    name: simple.name,
    version: simple.version,
    modifiedDate: simple.modifiedDate,
    stages: simple.stages.map((st) => ({ years: st.years, headings: st.areas.map((a) => a.heading) })),
  });
}
index.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
await writeFile(new URL('index.json', OUT), JSON.stringify({ fetchedAt: new Date().toISOString(), source: `${API}/subjects?schooltype=GR`, subjects: index }));
console.log(`Sparade ${index.length} ämnen, ${(bytes / 1024).toFixed(0)} kB totalt.`);
