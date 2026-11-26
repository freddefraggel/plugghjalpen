import { loadResults, type QuizResult } from '../lib/storage';

export default function HistoryView({ onOpen }: { onOpen: (r: QuizResult) => void }) {
  const results = loadResults();
  return (
    <main className="main narrow">
      <h1>Mina resultat</h1>
      {results.length === 0 ? (
        <p className="lead">Du har inte gjort något quiz än. Resultaten sparas här på den här datorn.</p>
      ) : (
        <div className="history">
          {results.map((r) => {
            const score = r.answers.reduce((s, a) => s + a.score, 0);
            return (
              <button key={r.quiz.id + r.finishedAt} onClick={() => onOpen(r)}>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <strong style={{ fontWeight: 600 }}>{r.quiz.title}</strong>
                  <span className="small muted">
                    {r.quiz.subject} åk {r.quiz.grade} · {new Date(r.finishedAt).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
                <strong style={{ fontSize: 20, color: 'var(--accent-ink)' }}>
                  {String(Math.round(score * 10) / 10).replace('.', ',')}/{r.quiz.questions.length}
                </strong>
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
}
