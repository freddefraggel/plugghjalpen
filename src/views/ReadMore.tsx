import { useEffect, useState } from 'react';
import type { AiSettings } from '../lib/ai';
import type { Question } from '../lib/quiz';
import { explainMore, findReadMore, type WikiSummary } from '../lib/readmore';
import type { AnswerRecord } from '../lib/storage';

interface Props {
  settings: AiSettings;
  q: Question;
  answer?: AnswerRecord;
  grade: number;
  level?: string;
}

/** Wikipedia-sammanfattning och "Förklara mer" under en fråga eleven missade. */
export default function ReadMore({ settings, q, answer, grade, level }: Props) {
  const [wiki, setWiki] = useState<WikiSummary | null | undefined>(undefined);
  const [explanation, setExplanation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    findReadMore(q).then((w) => alive && setWiki(w));
    return () => { alive = false; };
  }, [q]);

  const canExplain = settings.mode === 'server' || Boolean(settings.keys[settings.provider]);

  async function explain() {
    setBusy(true);
    setError('');
    try {
      setExplanation(await explainMore(settings, q, answer, grade, level, wiki ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="readmore">
      {wiki === undefined && <span className="small muted">Letar på Wikipedia…</span>}
      {wiki && (
        <details>
          <summary>
            Läs mer på Wikipedia: <strong>{wiki.title}</strong>
          </summary>
          <p>{wiki.extract}</p>
          <a href={wiki.url} target="_blank" rel="noopener noreferrer">
            Öppna artikeln om {wiki.title}
          </a>
        </details>
      )}
      {explanation ? (
        <div className="explain" aria-live="polite">
          <p>{explanation}</p>
          <span className="small muted">Förklarat av AI{wiki ? ` med hjälp av Wikipedia-artikeln "${wiki.title}"` : ''}. Kolla gärna med din lärare om något verkar konstigt.</span>
        </div>
      ) : (
        canExplain && (
          <button className="btn secondary small" onClick={explain} disabled={busy || wiki === undefined}>
            {busy ? 'Förklarar…' : 'Förklara mer'}
          </button>
        )
      )}
      {error && <span className="small" role="alert" style={{ color: 'var(--warn-ink)' }}>{error}</span>}
    </div>
  );
}
