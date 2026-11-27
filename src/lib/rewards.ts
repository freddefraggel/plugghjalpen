// Belöningar som gör det roligare att plugga: stjärnor, dagar i rad och märken.
// Allt sparas bara i den här webbläsaren och jämförs aldrig med andra elever.
import type { QuizResult } from './storage';

export interface Badge {
  id: string;
  icon: string;
  name: string;
  how: string;
}

export const BADGES: Badge[] = [
  { id: 'forsta', icon: '🎯', name: 'Första quizet', how: 'Gör ditt första quiz.' },
  { id: 'alla-ratt', icon: '🏆', name: 'Alla rätt', how: 'Få alla rätt på ett quiz.' },
  { id: 'battre', icon: '📈', name: 'Bättre än sist', how: 'Gör om ett quiz och få fler rätt än förra gången.' },
  { id: 'fritext', icon: '✍️', name: 'Ordkonstnär', how: 'Svara rätt på 5 fritextfrågor.' },
  { id: 'utforskare', icon: '🧭', name: 'Upptäckare', how: 'Gör quiz i 3 olika ämnen.' },
  { id: 'tre-dagar', icon: '🔥', name: 'Tre dagar i rad', how: 'Plugga tre dagar i rad.' },
  { id: 'fem', icon: '🖐️', name: 'Fem quiz', how: 'Gör 5 quiz.' },
  { id: 'sju-dagar', icon: '🌟', name: 'En hel vecka', how: 'Plugga sju dagar i rad.' },
  { id: 'tjugo', icon: '🚀', name: 'Tjugo quiz', how: 'Gör 20 quiz.' },
];

export interface RewardState {
  stars: number;
  quizzes: number;
  freeCorrect: number;
  subjects: string[];
  /** Dagar (ÅÅÅÅ-MM-DD, lokal tid) då eleven gjort minst ett quiz, högst de senaste 60. */
  days: string[];
  /** Märkets id → när det låstes upp. */
  badges: Record<string, number>;
}

export interface QuizReward {
  stars: number;
  streak: number;
  newBadges: Badge[];
}

export const EMPTY_REWARDS: RewardState = { stars: 0, quizzes: 0, freeCorrect: 0, subjects: [], days: [], badges: {} };

export const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Antal dagar i rad som slutar i dag eller i går. */
export function streakOf(days: string[], now = Date.now()): number {
  const set = new Set(days);
  const oneDay = 86_400_000;
  let t = now;
  if (!set.has(dayKey(t))) t -= oneDay;
  let n = 0;
  while (set.has(dayKey(t))) {
    n++;
    t -= oneDay;
  }
  return n;
}

const scoreOfResult = (r: QuizResult) => r.answers.reduce((s, a) => s + a.score, 0);

/** Stjärnor för ett quiz: en per poäng, en för att du gjorde klart och tre extra för alla rätt. */
export function starsFor(r: QuizResult): number {
  const score = scoreOfResult(r);
  const perfect = r.quiz.questions.length > 0 && score >= r.quiz.questions.length;
  return Math.round(score) + 1 + (perfect ? 3 : 0);
}

/**
 * Lägger till ett avslutat quiz. `earlier` är tidigare resultat (för "Bättre än sist").
 * Returnerar det nya läget och vad eleven fick för just det här quizet.
 */
export function addQuiz(state: RewardState, r: QuizResult, earlier: QuizResult[]): { state: RewardState; reward: QuizReward } {
  const score = scoreOfResult(r);
  const total = r.quiz.questions.length;
  const freeCorrect = r.quiz.questions.filter((q, i) => q.type === 'free' && (r.answers[i]?.score ?? 0) >= 1).length;
  const day = dayKey(r.finishedAt);
  const next: RewardState = {
    stars: state.stars + starsFor(r),
    quizzes: state.quizzes + 1,
    freeCorrect: state.freeCorrect + freeCorrect,
    subjects: state.subjects.includes(r.quiz.subject) ? state.subjects : [...state.subjects, r.quiz.subject],
    days: (state.days.includes(day) ? state.days : [...state.days, day]).sort().slice(-60),
    badges: { ...state.badges },
  };
  const streak = streakOf(next.days, r.finishedAt);
  const previous = earlier.find((e) => e.quiz.id === r.quiz.id);
  const earned: Record<string, boolean> = {
    forsta: next.quizzes >= 1,
    'alla-ratt': total > 0 && score >= total,
    battre: Boolean(previous && score > scoreOfResult(previous)),
    fritext: next.freeCorrect >= 5,
    utforskare: next.subjects.length >= 3,
    'tre-dagar': streak >= 3,
    fem: next.quizzes >= 5,
    'sju-dagar': streak >= 7,
    tjugo: next.quizzes >= 20,
  };
  const newBadges = BADGES.filter((b) => earned[b.id] && !next.badges[b.id]);
  for (const b of newBadges) next.badges[b.id] = r.finishedAt;
  return { state: next, reward: { stars: starsFor(r), streak, newBadges } };
}
