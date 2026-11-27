import { useEffect, useState } from 'react';
import { levelLabel, type Quiz } from '../lib/quiz';
import { criteriaFor, GY_GRADE } from '../lib/curriculum';
import type { Lgr22Criteria } from '../lib/lgr22-parse';
import type { QuizResult } from '../lib/storage';
import type { QuizReward } from '../lib/rewards';
import Confetti from './Confetti';

interface Props {
  result: QuizResult;
  /** Finns bara direkt efter ett quiz, inte när ett gammalt resultat öppnas. */
  reward?: QuizReward;
  onRetry: (q: Quiz) => void;
  onNew: () => void;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

export default function ResultView({ result, reward, onRetry, onNew }: Props) {
  const { quiz, answers } = result;
  const [criteria, setCriteria] = useState<Lgr22Criteria[]>([]);
  useEffect(() => {
    let alive = true;
    criteriaFor(quiz.subject, quiz.grade).then((c) => alive && setCriteria(c.filter((x) => ['E', 'C', 'A', 'godtagbara'].includes(x.level))));
    return () => { alive = false; };
  }, [quiz.subject, quiz.grade]);
  const endYear = quiz.grade <= 3 ? 3 : quiz.grade <= 6 ? 6 : 9;
  const total = quiz.questions.length;
  const score = answers.reduce((s, a) => s + a.score, 0);
  const pct = total ? score / total : 0;
  const mc = quiz.questions.map((q, i) => ({ q, a: answers[i] })).filter((x) => x.q.type === 'mc');
  const free = quiz.questions.map((q, i) => ({ q, a: answers[i] })).filter((x) => x.q.type === 'free');
  const sum = (xs: typeof mc) => xs.reduce((s, x) => s + (x.a?.score ?? 0), 0);

  const areas = new Map<string, { got: number; of: number }>();
  quiz.questions.forEach((q, i) => {
    const a = areas.get(q.area) ?? { got: 0, of: 0 };
    a.got += answers[i]?.score ?? 0;
    a.of += 1;
    areas.set(q.area, a);
  });

  const weak = quiz.questions.map((q, i) => ({ q, a: answers[i] })).filter((x) => (x.a?.score ?? 0) < 1);
  const message = pct >= 0.9 ? 'Grymt, du kan det här!' : pct >= 0.7 ? 'Snyggt jobbat!' : pct >= 0.4 ? 'Bra början, plugga lite till!' : 'Fortsätt öva, det kommer!';

  return (
    <main className="main">
      {reward && (pct >= 0.8 || reward.newBadges.length > 0) && <Confetti />}
      {reward && reward.newBadges.length > 0 && (
        <section className="card" aria-labelledby="new-badges-h">
          <h2 id="new-badges-h">{reward.newBadges.length === 1 ? 'Nytt märke!' : 'Nya märken!'}</h2>
          <div className="badges">
            {reward.newBadges.map((b) => (
              <div key={b.id} className="badge-card new">
                <span className="icon" aria-hidden="true">{b.icon}</span>
                <strong>{b.name}</strong>
                <span className="small muted">{b.how}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="row" style={{ alignItems: 'stretch' }}>
        <section className="card side score">
          <span className="muted">{quiz.title} · {quiz.subject} {levelLabel(quiz.grade, quiz.level)}</span>
          <span className="big">{fmt(score)}/{total}</span>
          <span style={{ fontSize: 20, fontWeight: 600 }}>{message}</span>
          <span className="muted" style={{ fontSize: 15 }}>
            {[mc.length && `Flerval ${fmt(sum(mc))} av ${mc.length}`, free.length && `Fritext ${fmt(sum(free))} av ${free.length}`].filter(Boolean).join(' · ')}
          </span>
          {reward && (
            <div className="reward" aria-label="Belöning">
              <span className="reward-pill">⭐ +{reward.stars} stjärnor</span>
              {reward.streak >= 2 && <span className="reward-pill">🔥 {reward.streak} dagar i rad</span>}
            </div>
          )}
        </section>

        <section className="card grow">
          <h2>Så gick det per del i läroplanen</h2>
          {[...areas.entries()].map(([area, { got, of }]) => (
            <div className="bar-row" key={area}>
              <div className="top"><span>{area}</span><span style={{ fontWeight: 600 }}>{fmt(got)} av {of}</span></div>
              <div className="bar" role="img" aria-label={`${fmt(got)} av ${of}`}><div style={{ width: `${(got / of) * 100}%` }} /></div>
            </div>
          ))}
          <p className="small muted" style={{ margin: 0 }}>
            {quiz.curriculumLabel
              ? `Delarna kommer från ${quiz.curriculumLabel}.`
              : 'Delarna är AI:ns koppling till Skolverkets centrala innehåll och kan vara ungefärliga.'}
          </p>
        </section>
      </div>

      <section className="card">
        <h2>{weak.length ? 'Plugga lite mer på' : 'Alla rätt!'}</h2>
        {weak.map(({ q, a }, i) => (
          <div className="review" key={i}>
            <span className={`chip ${q.type}`}>{q.type === 'mc' ? 'Flerval' : 'Fritext'}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontWeight: 600 }}>{q.question}</span>
              <span style={{ color: 'var(--ink-2)', fontSize: 15 }}>
                {q.type === 'mc' ? `Rätt svar: ${q.options[q.correct]}. ${q.explanation}` : a?.tip || q.modelAnswer}
              </span>
              {q.source && <span className="small muted">{q.source}</span>}
            </div>
          </div>
        ))}
        <div className="inline" style={{ marginTop: 6 }}>
          {weak.length > 0 && (
            <button
              className="btn big"
              onClick={() => onRetry({ ...quiz, id: Math.random().toString(36).slice(2, 10), createdAt: Date.now(), questions: weak.map((w) => w.q) })}
            >
              Öva på de svåra frågorna
            </button>
          )}
          <button className="btn secondary" onClick={onNew}>Nytt quiz</button>
        </div>
      </section>

      {criteria.length > 0 && (
        <section className="card">
          <h2>{quiz.grade >= GY_GRADE ? `Vad krävs för E, C och A i ${quiz.subject.toLowerCase()}?` : `Vad krävs i ${quiz.subject.toLowerCase()} i slutet av åk ${endYear}?`}</h2>
          <p className="muted" style={{ margin: 0 }}>{quiz.grade >= GY_GRADE ? 'Skolverkets betygskriterier, som gäller ämnet på alla nivåer.' : 'Skolverkets kunskapskrav.'} Quizet kan inte ge ett betyg, men du ser vad lärarna bedömer.</p>
          {criteria.map((c) => (
            <details key={c.level}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                {c.level === 'godtagbara' ? 'Godtagbara kunskaper' : `Betyget ${c.level}`}
              </summary>
              {c.text.split('\n').map((p, i) => <p key={i} style={{ margin: '8px 0 0', lineHeight: 1.55 }}>{p}</p>)}
            </details>
          ))}
        </section>
      )}
    </main>
  );
}
