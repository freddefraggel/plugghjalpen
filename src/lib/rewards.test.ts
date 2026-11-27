import { describe, expect, it } from 'vitest';
import { addQuiz, EMPTY_REWARDS, starsFor, streakOf, dayKey } from './rewards';
import type { QuizResult } from './storage';
import type { Quiz } from './quiz';

const DAY = 86_400_000;
const T0 = new Date(2026, 10, 20, 12).getTime();

function result(id: string, scores: number[], at: number, subject = 'Biologi', types: ('mc' | 'free')[] = []): QuizResult {
  const quiz = {
    id, title: id, subject, grade: 7, createdAt: at,
    questions: scores.map((_, i) => (types[i] === 'free'
      ? { type: 'free', question: 'q', modelAnswer: 'm', points: [], source: '', area: '' }
      : { type: 'mc', question: 'q', options: ['a', 'b', 'c', 'd'], correct: 0, explanation: '', source: '', area: '' })),
  } as unknown as Quiz;
  return { quiz, answers: scores.map((score) => ({ given: 0, score })), finishedAt: at };
}

describe('belöningar', () => {
  it('ger stjärnor per poäng, för att göra klart och extra för alla rätt', () => {
    expect(starsFor(result('a', [1, 0, 0.5], T0))).toBe(3); // round(1,5)=2 + 1
    expect(starsFor(result('a', [1, 1, 1], T0))).toBe(7); // 3 + 1 + 3
  });

  it('låser upp första quizet och alla rätt bara en gång', () => {
    const r1 = addQuiz(EMPTY_REWARDS, result('a', [1, 1], T0), []);
    expect(r1.reward.newBadges.map((b) => b.id)).toEqual(['forsta', 'alla-ratt']);
    const r2 = addQuiz(r1.state, result('b', [1, 1], T0 + 1000), []);
    expect(r2.reward.newBadges).toEqual([]);
    expect(r2.state.quizzes).toBe(2);
  });

  it('räknar dagar i rad och ger märke efter tre', () => {
    let s = EMPTY_REWARDS;
    let last;
    for (let i = 0; i < 3; i++) last = addQuiz(s, result(`q${i}`, [0], T0 + i * DAY), []), (s = last.state);
    expect(last!.reward.streak).toBe(3);
    expect(last!.reward.newBadges.map((b) => b.id)).toContain('tre-dagar');
    expect(streakOf(s.days, T0 + 3 * DAY)).toBe(3); // i går räknas fortfarande
    expect(streakOf(s.days, T0 + 5 * DAY)).toBe(0);
    expect(dayKey(T0)).toBe('2026-11-20');
  });

  it('ger "Bättre än sist" när ett omgjort quiz går bättre', () => {
    const first = result('a', [0, 1], T0);
    const r = addQuiz(addQuiz(EMPTY_REWARDS, first, []).state, result('a', [1, 1], T0 + 1000), [first]);
    expect(r.reward.newBadges.map((b) => b.id)).toContain('battre');
  });

  it('räknar rätta fritextsvar och olika ämnen', () => {
    let s = EMPTY_REWARDS;
    for (const subject of ['Biologi', 'Historia', 'Geografi']) s = addQuiz(s, result(subject, [1, 1, 1], T0, subject, ['free', 'free', 'mc']), []).state;
    expect(s.freeCorrect).toBe(6);
    expect(Object.keys(s.badges)).toEqual(expect.arrayContaining(['fritext', 'utforskare']));
  });
});
