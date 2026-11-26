import type { AiSettings } from './ai';
import type { Quiz } from './quiz';

// Allt sparas bara i den här webbläsaren (localStorage).

export interface AnswerRecord {
  /** Flerval: index för valt alternativ. Fritext: elevens text. */
  given: number | string;
  score: number; // 0, 0.5 eller 1
  feedback?: string;
  tip?: string;
  pointsMet?: boolean[];
}

export interface QuizResult {
  quiz: Quiz;
  answers: AnswerRecord[];
  finishedAt: number;
}

const SETTINGS_KEY = 'plugghjalpen.settings.v1';
const RESULTS_KEY = 'plugghjalpen.results.v1';

export const DEFAULT_SETTINGS: AiSettings = { provider: 'anthropic', model: 'claude-haiku-5-5', keys: {} };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Privat läge eller fullt lagringsutrymme: appen fungerar ändå, men sparar inget.
  }
}

export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...read<Partial<AiSettings>>(SETTINGS_KEY, {}) });
export const saveSettings = (s: AiSettings) => write(SETTINGS_KEY, s);

export const loadResults = () => read<QuizResult[]>(RESULTS_KEY, []);
export function saveResult(r: QuizResult) {
  write(RESULTS_KEY, [r, ...loadResults()].slice(0, 50));
}

export function clearAll() {
  try {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(RESULTS_KEY);
  } catch {
    /* ignorera */
  }
}
