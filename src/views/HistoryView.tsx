import { loadResults, loadRewards, type QuizResult } from '../lib/storage';
import { BADGES, streakOf } from '../lib/rewards';
import { levelLabel } from '../lib/quiz';

export default function HistoryView({ onOpen }: { onOpen: (r: QuizResult) => void }) {
  const results = loadResults();
  const rewards = loadRewards();
  const streak = streakOf(rewards.days);
  return (
    <main className="main narrow">
      <h1>Mina resultat</h1>
      {rewards.quizzes > 0 && (
        <section className="card" aria-labelledby="rewards-h">
          <h2 id="rewards-h">Dina belöningar</h2>
          <div className="stats">
            <div className="stat"><strong>⭐ {rewards.stars}</strong><span>stjärnor</span></div>
            <div className="stat"><strong>🔥 {streak}</strong><span>{streak === 1 ? 'dag i rad' : 'dagar i rad'}</span></div>
            <div className="stat"><strong>🏅 {Object.keys(rewards.badges).length}/{BADGES.length}</strong><span>märken</span></div>
          </div>
          <div className="badges">
            {BADGES.map((b) => {
              const got = rewards.badges[b.id];
              return (
                <div key={b.id} className={`badge-card${got ? '' : ' locked'}`}>
                  <span className="icon" aria-hidden="true">{b.icon}</span>
                  <strong>{b.name}</strong>
                  <span className="small muted">{got ? `Fick ${new Date(got).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}` : b.how}</span>
                </div>
              );
            })}
          </div>
          <p className="small muted" style={{ margin: 0 }}>Stjärnor: en per rätt svar, en för varje quiz du gör klart och tre extra för alla rätt.</p>
        </section>
      )}
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
                    {r.quiz.subject} {levelLabel(r.quiz.grade, r.quiz.level)} · {new Date(r.finishedAt).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
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
