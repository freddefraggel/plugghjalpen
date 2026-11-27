import { useState } from 'react';
import type { AiSettings } from '../lib/ai';
import type { Source } from '../lib/extract';
import { buildMaterial, gradeAnswer, levelLabel, scoreOf, type FreeQuestion, type Grade, type Quiz } from '../lib/quiz';
import type { AnswerRecord, QuizResult } from '../lib/storage';
import { AlertIcon, BackIcon, CheckIcon, CrossIcon } from '../icons';

interface Props {
  quiz: Quiz;
  sources: Source[];
  settings: AiSettings;
  onExit: () => void;
  onDone: (r: QuizResult) => void;
}

const LETTERS = 'ABCDEFGH';

export default function QuizView({ quiz, sources, settings, onExit, onDone }: Props) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<(AnswerRecord | undefined)[]>([]);
  const [draft, setDraft] = useState('');
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState('');
  const [grade, setGrade] = useState<Grade | null>(null);

  const q = quiz.questions[index];
  const answer = answers[index];
  const total = quiz.questions.length;
  const isLast = index === total - 1;

  const record = (a: AnswerRecord) => setAnswers((prev) => {
    const next = [...prev];
    next[index] = a;
    return next;
  });

  function next() {
    if (isLast) {
      const final = quiz.questions.map((_, i) => answers[i] ?? { given: '', score: 0 });
      onDone({ quiz, answers: final, finishedAt: Date.now() });
      return;
    }
    setIndex(index + 1);
    setDraft('');
    setGrade(null);
    setError('');
  }

  async function submitFree(fq: FreeQuestion) {
    if (!draft.trim()) return;
    setGrading(true);
    setError('');
    try {
      const material = sources.length ? buildMaterial(sources).text : fq.modelAnswer;
      const g = await gradeAnswer(settings, fq, draft, quiz.grade, material, quiz.level);
      setGrade(g);
      record({ given: draft, score: scoreOf(g.verdict), feedback: g.feedback, tip: g.tip, pointsMet: g.pointsMet });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGrading(false);
    }
  }

  return (
    <>
      <header className="quiz-head">
        <button className="back" onClick={onExit}><BackIcon /> Avsluta</button>
        <span style={{ fontWeight: 600 }}>{quiz.title} · {quiz.subject} {levelLabel(quiz.grade, quiz.level)}</span>
        <span className="muted" style={{ fontSize: 15 }}>Fråga {index + 1} av {total}</span>
      </header>
      <div className="progress" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={total} aria-label="Hur långt du kommit">
        <div style={{ width: `${((index + (answer ? 1 : 0)) / total) * 100}%` }} />
      </div>

      <main className="main narrow">
        <div className="pills">
          <span className={`chip ${q.type}`}>{q.type === 'mc' ? 'Flerval' : 'Fritext'}</span>
          {q.area && <span className="chip area">Lgr22: {q.area}</span>}
        </div>
        <h1 className="question">{q.question}</h1>

        {q.type === 'mc' ? (
          <>
            <div className="options">
              {q.options.map((opt, i) => {
                const chosen = answer?.given === i;
                const state = answer ? (i === q.correct ? 'correct' : chosen ? 'wrong' : '') : '';
                return (
                  <button
                    key={i}
                    className={`option ${state}`}
                    disabled={Boolean(answer)}
                    onClick={() => record({ given: i, score: i === q.correct ? 1 : 0 })}
                  >
                    <span className="letter">{LETTERS[i]}</span>
                    <span className="label-text">{opt}</span>
                    {state === 'correct' && <span className="mark"><CheckIcon /> Rätt</span>}
                    {state === 'wrong' && <span className="mark"><CrossIcon /> Ditt svar</span>}
                  </button>
                );
              })}
            </div>
            {answer && (
              <div className="feedback" role="status">
                <span className={`title ${answer.score ? 'ok' : 'bad'}`}>{answer.score ? 'Bra jobbat!' : 'Inte riktigt.'}</span>
                {q.explanation && <p>{q.explanation}</p>}
                {q.source && <p className="small muted">Från ditt material: {q.source}</p>}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="svar">Ditt svar</label>
              <textarea
                id="svar"
                className="input"
                rows={4}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={grading || Boolean(grade)}
              />
            </div>
            {error && <div className="error" role="alert">{error}</div>}
            {grade && <FreeFeedback q={q} grade={grade} />}
          </>
        )}

        <div className={`actions ${q.type === 'mc' ? 'end' : ''}`}>
          {q.type === 'free' && !grade && (
            <>
              <button className="btn secondary" onClick={next}>Hoppa över</button>
              <button className="btn big" disabled={!draft.trim() || grading} onClick={() => submitFree(q)}>
                {grading ? <><span className="spinner" /> Rättar…</> : 'Rätta mitt svar'}
              </button>
            </>
          )}
          {q.type === 'free' && grade && (
            <>
              <button className="btn secondary" onClick={() => setGrade(null)}>Försök igen</button>
              <button className="btn big" onClick={next}>{isLast ? 'Se resultat' : 'Nästa fråga'}</button>
            </>
          )}
          {q.type === 'mc' && answer && <button className="btn big" onClick={next}>{isLast ? 'Se resultat' : 'Nästa fråga'}</button>}
        </div>
      </main>
    </>
  );
}

function FreeFeedback({ q, grade }: { q: FreeQuestion; grade: Grade }) {
  const met = grade.pointsMet.filter(Boolean).length;
  const title = grade.verdict === 'correct' ? 'Riktigt bra!' : grade.verdict === 'partial' ? 'Nästan där!' : 'Inte riktigt än.';
  const tone = grade.verdict === 'correct' ? 'ok' : grade.verdict === 'partial' ? 'warn' : 'bad';
  return (
    <div className="feedback" role="status">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span className={`title ${tone}`}>{title}</span>
        {q.points.length > 0 && <span className={`badge ${tone}`}>{met} av {q.points.length} delar med</span>}
      </div>
      {grade.feedback && <p>{grade.feedback}</p>}
      {q.points.length > 0 && (
        <ul className="checks">
          {q.points.map((p, i) => (
            <li key={i}>
              <span style={{ color: grade.pointsMet[i] ? 'var(--ok)' : 'var(--warn)' }}>
                {grade.pointsMet[i] ? <CheckIcon /> : <AlertIcon />}
              </span>
              <span>{grade.pointsMet[i] ? p : `Saknas: ${p}`}</span>
            </li>
          ))}
        </ul>
      )}
      {grade.tip && <div className="tip"><strong style={{ fontWeight: 600 }}>Tips:</strong> {grade.tip}</div>}
      {grade.verdict !== 'correct' && q.modelAnswer && (
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Visa ett exempel på ett bra svar</summary>
          <p style={{ marginTop: 8 }}>{q.modelAnswer}</p>
        </details>
      )}
    </div>
  );
}
