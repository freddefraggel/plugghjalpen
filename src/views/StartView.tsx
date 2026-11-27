import { useEffect, useRef, useState } from 'react';
import { budgetFor, type AiSettings } from '../lib/ai';
import { extractFile, extractLink, textSource, type Source } from '../lib/extract';
import { generateQuiz, GRADES, SUBJECTS, stageFor, buildMaterial, type Quiz, type QuestionMix } from '../lib/quiz';
import { CloseIcon, CurriculumIcon, UploadIcon } from '../icons';
import { GY_GRADE, loadIndex, loadSubject, schoolOf, stageForLevel } from '../lib/curriculum';
import CurriculumDialog from './CurriculumDialog';
import { stageForGrade, type Lgr22Stage } from '../lib/lgr22-parse';

interface Props {
  settings: AiSettings;
  sources: Source[];
  setSources: (s: Source[]) => void;
  onQuiz: (q: Quiz) => void;
  goSettings: () => void;
}

const MIXES: { id: QuestionMix; label: string }[] = [
  { id: 'mc', label: 'Flerval' },
  { id: 'free', label: 'Fritext' },
  { id: 'mixed', label: 'Blandat' },
];

export default function StartView({ settings, sources, setSources, onQuiz, goSettings }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [link, setLink] = useState('');
  const [pasted, setPasted] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState(7);
  const [level, setLevel] = useState('');
  const [levels, setLevels] = useState<string[]>([]);
  const [gySubjects, setGySubjects] = useState<string[]>([]);
  const [stage, setStage] = useState<Lgr22Stage | null>(null);
  const [showCurriculum, setShowCurriculum] = useState(false);
  const school = schoolOf(grade);
  const subjects = school === 'GY' ? gySubjects : SUBJECTS;

  // Gymnasiets ämnen kommer från Skolverkets ämnesplaner som hämtas vid bygget.
  useEffect(() => {
    if (school !== 'GY') return;
    let alive = true;
    loadIndex('GY').then((ix) => alive && setGySubjects(ix?.subjects.map((x) => x.name) ?? []));
    return () => { alive = false; };
  }, [school]);

  // Byter man skolform och ämnet inte finns där, börja om med "Gissa".
  useEffect(() => {
    if (subject && subjects.length && !subjects.includes(subject)) setSubject('');
  }, [subjects, subject]);

  // Hämta Skolverkets centrala innehåll för valt ämne och årskurs eller nivå, om datan finns.
  useEffect(() => {
    let alive = true;
    setStage(null);
    if (!subject) {
      setLevels([]);
      return;
    }
    loadSubject(subject, school).then((s) => {
      if (!alive) return;
      if (school === 'GY') {
        const names = s?.stages.map((x) => x.years) ?? [];
        setLevels(names);
        setStage((s && stageForLevel(s, level)) ?? null);
        if (s && names.length && !names.includes(level)) setLevel(names[0]);
      } else {
        setLevels([]);
        setStage((s && stageForGrade(s, grade)) ?? null);
      }
    });
    return () => { alive = false; };
  }, [subject, grade, school, level]);
  const [mix, setMix] = useState<QuestionMix>('mixed');
  const [count, setCount] = useState(10);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const hasKey = settings.mode === 'server' || Boolean(settings.keys[settings.provider]);

  async function addFiles(files: FileList | File[]) {
    setError('');
    setLoadingFiles(true);
    const added: Source[] = [];
    for (const f of Array.from(files)) {
      try {
        const s = await extractFile(f);
        if (!s.text.trim()) throw new Error(`Hittade ingen text i ${f.name}. Är det en inskannad bild?`);
        added.push(s);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setSources([...sources, ...added]);
    setLoadingFiles(false);
  }

  async function addLink() {
    if (!link.trim()) return;
    setError('');
    try {
      const s = await extractLink(link, settings);
      setSources([...sources, s]);
      setLink('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function addPasted() {
    if (!pasted.trim()) return;
    setSources([...sources, textSource(`Inklistrad text ${sources.filter((s) => s.kind === 'text').length + 1}`, pasted)]);
    setPasted('');
    setShowPaste(false);
  }

  async function create() {
    setError('');
    if (!hasKey) {
      setError('Du behöver lägga in en API-nyckel under Inställningar först.');
      return;
    }
    setBusy(true);
    try {
      onQuiz(await generateQuiz(settings, sources, { subject, grade, level: school === 'GY' ? level : undefined, mix, count }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const truncated = sources.length > 0 && buildMaterial(sources, budgetFor(settings.provider).inputChars).truncated;

  return (
    <main className="main">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1>Vad vill du plugga på idag?</h1>
        <p className="lead">Lägg in ditt material, så gör Plugghjälpen ett quiz åt dig.</p>
      </div>

      {!hasKey && (
        <div className="note" role="status">
          <CurriculumIcon />
          <span>
            Innan du börjar: lägg in en API-nyckel för AI:n.{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); goSettings(); }}>Gå till Inställningar</a>
          </span>
        </div>
      )}

      <div className="row">
        <section className="card grow" aria-labelledby="material-h">
          <h2 id="material-h">1. Ditt material</h2>
          <div
            className={`drop${over ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
          >
            <span style={{ color: 'var(--accent)' }}><UploadIcon /></span>
            <p style={{ fontSize: 18, fontWeight: 600 }}>Dra hit filer eller</p>
            <button className="btn" onClick={() => fileInput.current?.click()} disabled={loadingFiles}>
              {loadingFiles ? <><span className="spinner" /> Läser in…</> : 'Välj filer'}
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".docx,.pptx,.pdf,.txt,.md"
              className="sr-only"
              aria-label="Välj filer"
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
            />
            <p className="small muted">Word, PowerPoint, PDF eller text. Från Google Docs: Arkiv › Ladda ned › Microsoft Word.</p>
          </div>

          {sources.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sources.map((s) => (
                <li key={s.id} className="file">
                  <span className={`tag ${s.kind}`}>{s.kind === 'link' ? 'Länk' : s.kind}</span>
                  <span className="file-name" title={s.name}>{s.name}</span>
                  <span className="file-meta">{s.summary}</span>
                  <button className="icon-btn" aria-label={`Ta bort ${s.name}`} onClick={() => setSources(sources.filter((x) => x.id !== s.id))}>
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="field">
            <label htmlFor="lank">Eller lägg till en webblänk</label>
            <div className="inline">
              <input
                id="lank"
                className="input"
                type="url"
                placeholder="https://sv.wikipedia.org/wiki/Fotosyntes"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addLink()}
              />
              <button className="btn secondary" onClick={addLink}>Lägg till</button>
            </div>
            <span className="small muted">{settings.mode === 'server' ? 'Fungerar med de flesta öppna webbsidor.' : 'Med egen nyckel fungerar länkar till Wikipedia.'}</span>
          </div>

          {showPaste ? (
            <div className="field">
              <label htmlFor="paste">Klistra in text</label>
              <textarea id="paste" className="input" rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)} />
              <div className="inline">
                <button className="btn secondary" onClick={addPasted}>Lägg till texten</button>
                <button className="btn secondary" onClick={() => setShowPaste(false)}>Avbryt</button>
              </div>
            </div>
          ) : (
            <div><button className="btn secondary" onClick={() => setShowPaste(true)}>Klistra in text istället</button></div>
          )}
          {truncated && <p className="small muted" style={{ margin: 0 }}>Materialet är långt, så quizet bygger på utvalda delar från hela texten.</p>}
        </section>

        <aside className="card side" aria-labelledby="settings-h">
          <h2 id="settings-h">2. Inställningar för quizet</h2>
          <div className="field">
            <label htmlFor="amne">Ämne</label>
            <select id="amne" className="input" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Gissa från materialet</option>
              {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="arskurs">Årskurs</label>
            <select id="arskurs" className="input" value={grade} onChange={(e) => setGrade(Number(e.target.value))}>
              {GRADES.map((g) => <option key={g} value={g}>{g >= GY_GRADE ? 'Gymnasiet' : `Åk ${g}`}</option>)}
            </select>
          </div>
          {school === 'GY' && levels.length > 0 && (
            <div className="field">
              <label htmlFor="niva">Nivå</label>
              <select id="niva" className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
                {levels.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <span className="label" id="typ-h">Typ av frågor</span>
            <div className="pills" role="group" aria-labelledby="typ-h">
              {MIXES.map((m) => (
                <button key={m.id} className="pill" aria-pressed={mix === m.id} onClick={() => setMix(m.id)}>{m.label}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="antal">Antal frågor: {count}</label>
            <input id="antal" type="range" min={5} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ accentColor: 'var(--accent)' }} />
          </div>
          <div className="note" style={{ flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <CurriculumIcon />
              <span>
                {stage
                  ? school === 'GY'
                    ? `Frågorna kopplas till centralt innehåll i Skolverkets ämnesplan för ${subject.toLowerCase()}, ${stage.years.toLowerCase()}.`
                    : `Frågorna kopplas till centralt innehåll i Skolverkets kursplan för ${subject.toLowerCase()} åk ${stage.years.replace('-', '–')}.`
                  : school === 'GY'
                    ? subject
                      ? `Frågorna kopplas till centralt innehåll i gymnasiets ämnesplan för ${subject.toLowerCase()}.`
                      : 'Välj ämne för att koppla frågorna till gymnasiets ämnesplan.'
                    : `Frågorna kopplas till centralt innehåll i Lgr22 för ${subject ? subject.toLowerCase() : 'ämnet'} ${stageFor(grade)}.`}
              </span>
            </div>
            {stage && (
              <>
                <div style={{ paddingLeft: 30 }}>
                  <span className="small">{stage.areas.map((a) => a.heading).join(' · ')}</span>
                </div>
                <div style={{ paddingLeft: 30 }}>
                  <button className="link-btn" onClick={() => setShowCurriculum(true)}>Se centralt innehåll</button>
                </div>
                <CurriculumDialog subject={subject} stage={stage} gymnasium={school === 'GY'} open={showCurriculum} onClose={() => setShowCurriculum(false)} />
              </>
            )}
          </div>
          {error && <div className="error" role="alert">{error}</div>}
          <button className="btn big" disabled={sources.length === 0 || busy} onClick={create}>
            {busy ? <><span className="spinner" /> Skapar quiz…</> : 'Skapa quiz'}
          </button>
          {sources.length === 0 && <span className="small muted" style={{ textAlign: 'center' }}>Lägg till material först.</span>}
        </aside>
      </div>
    </main>
  );
}
