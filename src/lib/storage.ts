import { API_URL, PROVIDERS, type AiSettings } from './ai';
import type { Quiz } from './quiz';
import { addQuiz, EMPTY_REWARDS, type QuizReward, type RewardState } from './rewards';

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
const REWARDS_KEY = 'plugghjalpen.rewards.v1';

export const DEFAULT_SETTINGS: AiSettings = { mode: API_URL ? 'server' : 'own', provider: 'anthropic', model: 'claude-haiku-5-5', keys: {} };

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

const RETIRED_MODELS = ['llama-3.3-70b-versatile'];

export function loadSettings(): AiSettings {
  const stored = read<Partial<AiSettings>>(SETTINGS_KEY, {});
  const s = { ...DEFAULT_SETTINGS, ...stored };
  // Den som redan har en egen nyckel sparad fortsätter med den; alla andra använder skolans server om den finns.
  if (!stored.mode) s.mode = API_URL && !Object.values(stored.keys ?? {}).some(Boolean) ? 'server' : 'own';
  if (!API_URL) s.mode = 'own';
  const provider = PROVIDERS.find((p) => p.id === s.provider);
  // Leverantörer som tagits bort (t.ex. Gemini) och modeller som inte längre är öppna byts mot standardvalen.
  if (!provider) return { ...DEFAULT_SETTINGS, keys: s.keys ?? {} };
  if (!s.model || RETIRED_MODELS.includes(s.model)) s.model = provider.models[0].id;
  return s;
}
export const saveSettings = (s: AiSettings) => write(SETTINGS_KEY, s);

export const loadResults = () => read<QuizResult[]>(RESULTS_KEY, []);
/** Sparar resultatet och räknar fram belöningen för det. */
export function saveResult(r: QuizResult): QuizReward {
  const earlier = loadResults();
  write(RESULTS_KEY, [r, ...earlier].slice(0, 50));
  const { state, reward } = addQuiz(loadRewards(), r, earlier);
  write(REWARDS_KEY, state);
  return reward;
}

export const loadRewards = (): RewardState => ({ ...EMPTY_REWARDS, ...read<Partial<RewardState>>(REWARDS_KEY, {}) });

export function clearAll() {
  try {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(RESULTS_KEY);
    localStorage.removeItem(REWARDS_KEY);
  } catch {
    /* ignorera */
  }
}
