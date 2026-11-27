// Utbytbara AI-leverantörer. Alla anrop görs direkt från webbläsaren med
// användarens egen nyckel, som bara sparas lokalt (se storage.ts).

export type ProviderId = 'anthropic' | 'groq' | 'openrouter';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  blurb: string;
  keyUrl: string;
  keyHint: string;
  models: { id: string; label: string }[];
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    blurb: 'Bäst på svenska. Kostar några öre per quiz.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-…',
    models: [
      { id: 'claude-haiku-5-5', label: 'Claude Haiku (snabb och billig)' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet (bättre frågor, dyrare)' },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    blurb: 'Öppna modeller, snabbt och ofta gratis att testa.',
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_…',
    models: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (rekommenderas)' },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (snabbare)' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    blurb: 'Många modeller via en nyckel, vissa gratis.',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-…',
    models: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (gratis)' }],
  },
];

export interface AiSettings {
  /** "server" = skolans backend håller nyckeln; "own" = egen nyckel i webbläsaren. */
  mode?: 'own' | 'server';
  classCode?: string;
  provider: ProviderId;
  model: string;
  keys: Partial<Record<ProviderId, string>>;
}

export type AiErrorCode = 'model' | 'too_large' | 'rate' | 'auth' | 'timeout' | 'class_code' | 'quota' | 'other';

export class AiError extends Error {
  constructor(
    message: string,
    readonly code: AiErrorCode = 'other',
    readonly info: { limit?: number; requested?: number; retryAfter?: number } = {},
  ) {
    super(message);
  }
}

/** Hur mycket material (tecken) och svar (tokens) vi skickar per leverantör. Groqs gratisnivå har låga gränser. */
/** Gissar leverantör utifrån hur nyckeln börjar (gsk_, sk-ant-, sk-or-). */
/** Hur länge appen väntar på AI-tjänsten. Gratismodeller kan vara långsamma, men inte så här långsamma. */
export const AI_TIMEOUT_MS = 120_000;
export const TIMEOUT_MESSAGE =
  'AI-tjänsten svarade inte inom två minuter. Gratismodeller är ibland överbelastade. Försök igen, prova färre frågor eller välj en annan modell under Inställningar.';

export function providerForKey(key: string): ProviderId | undefined {
  const k = key.trim();
  if (k.startsWith('sk-ant-')) return 'anthropic';
  if (k.startsWith('gsk_')) return 'groq';
  if (k.startsWith('sk-or-')) return 'openrouter';
  return undefined;
}

export function budgetFor(provider: ProviderId) {
  if (provider === 'groq') return { inputChars: 10000, outputTokens: 3000 };
  if (provider === 'openrouter') return { inputChars: 24000, outputTokens: 4000 };
  return { inputChars: 60000, outputTokens: 8000 };
}

export function isTooLarge(status: number, msg: string) {
  return status === 413 || /request too large|context length|maximum context|prompt is too long|reduce (your|the) (message|prompt) size/i.test(msg);
}

/** Läser ut "Limit 8000, Requested 9598" och "try again in 12.5s" ur felmeddelanden. */
export function parseLimits(msg: string) {
  const limit = msg.match(/limit[^0-9]{0,10}(\d+)/i);
  const requested = msg.match(/requested[^0-9]{0,10}(\d+)/i);
  const retry = msg.match(/try again in (?:(\d+)m)?([\d.]+)s/i);
  return {
    limit: limit ? Number(limit[1]) : undefined,
    requested: requested ? Number(requested[1]) : undefined,
    retryAfter: retry ? Math.ceil(Number(retry[1] ?? 0) * 60 + Number(retry[2])) : undefined,
  };
}

export function isModelMissing(status: number, msg: string) {
  return status === 404 || /does not exist|not[ _]found|no such model|invalid model|not a valid model/i.test(msg);
}

/** Skickar en prompt och returnerar modellens svar som text. */
/** Adressen till skolans backend, satt vid bygget (VITE_API_URL). Tom = ingen backend. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const API_URL: string = ((import.meta as any).env?.VITE_API_URL ?? '').replace(/\/$/, '');

export function deviceId(): string {
  try {
    // localStorage finns bara i webbläsaren, inte i backenden som också använder den här filen.
    const store = (globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage!;
    let id = store.getItem('plugghjalpen.device');
    if (!id) {
      id = crypto.randomUUID();
      store.setItem('plugghjalpen.device', id);
    }
    return id;
  } catch {
    return 'anonym-enhet';
  }
}

/** Anropar skolans backend. Fel kommer tillbaka i samma form som från complete(). */
export async function serverFetch<T>(settings: Pick<AiSettings, 'classCode'>, path: string, init: RequestInit = {}): Promise<T> {
  if (!API_URL) throw new AiError('Appen har ingen skolserver inställd.');
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        'x-class-code': settings.classCode ?? '',
        'x-device-id': deviceId(),
      },
      signal: AbortSignal.timeout(AI_TIMEOUT_MS + 10_000),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new AiError(TIMEOUT_MESSAGE, 'timeout');
    throw new AiError('Kunde inte nå skolans server. Kontrollera internetanslutningen.');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    const e = data?.error ?? {};
    throw new AiError(e.message || `Skolans server svarade med fel (${res.status}).`, e.code ?? 'other', e.info ?? {});
  }
  return data as T;
}

export async function complete(settings: AiSettings, system: string, user: string, maxTokens = 4000): Promise<string> {
  if (settings.mode === 'server') {
    const { text } = await serverFetch<{ text: string }>(settings, '/api/complete', {
      method: 'POST',
      body: JSON.stringify({ system, user, maxTokens }),
    });
    return text;
  }
  const key = settings.keys[settings.provider]?.trim();
  if (!key) throw new AiError('Ingen API-nyckel är inlagd. Gå till Inställningar och lägg in en.');
  const model = settings.model;

  let res: Response;
  try {
    if (settings.provider === 'anthropic') {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
    } else {
      const url =
        settings.provider === 'groq'
          ? 'https://api.groq.com/openai/v1/chat/completions'
          : 'https://openrouter.ai/api/v1/chat/completions';
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          ...(settings.provider === 'groq' && model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new AiError(TIMEOUT_MESSAGE, 'timeout');
    throw new AiError('Kunde inte nå AI-tjänsten. Kontrollera internetanslutningen.');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json().catch((e) => {
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new AiError(TIMEOUT_MESSAGE, 'timeout');
    return null;
  });
  if (!res.ok) {
    const msg = data?.error?.message ?? data?.error ?? res.statusText;
    if (res.status === 401 || res.status === 403) throw new AiError('API-nyckeln godkändes inte. Kontrollera den i Inställningar.', 'auth');
    const text = String(msg);
    if (isTooLarge(res.status, text))
      throw new AiError('Materialet är för stort för den här AI-tjänsten.', 'too_large', parseLimits(text));
    if (res.status === 429) {
      const { retryAfter } = parseLimits(text);
      throw new AiError(
        `AI-tjänstens gräns för hur mycket som får skickas per minut är nådd. Vänta ${retryAfter ? `${retryAfter} sekunder` : 'en minut'} och försök igen.`,
        'rate',
        { retryAfter },
      );
    }
    if (isModelMissing(res.status, text))
      throw new AiError(`Modellen ${model} finns inte eller är inte tillgänglig för din nyckel. Välj en annan modell i Inställningar.`, 'model');
    throw new AiError(`AI-tjänsten svarade med ett fel: ${typeof msg === 'string' ? msg : res.status}`);
  }

  let text: string | undefined;
  if (settings.provider === 'anthropic') {
    text = data?.content?.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
  } else {
    text = data?.choices?.[0]?.message?.content;
  }
  if (!text) throw new AiError('AI-tjänsten gav inget svar. Försök igen.');
  return text;
}

/** Hämtar vilka modeller nyckeln har tillgång till. Returnerar modellernas id. */
export async function listModels(settings: AiSettings): Promise<string[]> {
  const key = settings.keys[settings.provider]?.trim();
  if (!key) throw new AiError('Ingen API-nyckel är inlagd.');
  const req =
    settings.provider === 'anthropic'
      ? fetch('https://api.anthropic.com/v1/models?limit=100', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        })
      : fetch(settings.provider === 'groq' ? 'https://api.groq.com/openai/v1/models' : 'https://openrouter.ai/api/v1/models', {
          headers: { authorization: `Bearer ${key}` },
        });
  let res: Response;
  try {
    res = await req;
  } catch {
    throw new AiError('Kunde inte nå AI-tjänsten. Kontrollera internetanslutningen.');
  }
  if (res.status === 401 || res.status === 403) throw new AiError('API-nyckeln godkändes inte. Kontrollera den i Inställningar.', 'auth');
  if (!res.ok) throw new AiError(`Kunde inte hämta modellistan (${res.status}).`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json().catch(() => null);
  const items: { id?: string; active?: boolean }[] = Array.isArray(data?.data) ? data.data : [];
  return items.filter((m) => m.id && m.active !== false).map((m) => m.id!);
}

/** Väljer en modell som finns: helst nuvarande, annars den första rekommenderade, annars null. */
export function pickAvailableModel(provider: ProviderId, current: string, available: string[]): string | null {
  if (available.includes(current)) return current;
  const recommended = PROVIDERS.find((p) => p.id === provider)?.models.map((m) => m.id) ?? [];
  return recommended.find((id) => available.includes(id)) ?? null;
}

/** Plockar ut JSON ur ett svar, även om modellen lagt till text eller ```-block runt. */
export const UNREADABLE =
  'AI-modellen svarade inte i det format appen behöver. Försök igen, eller välj en annan modell under Inställningar.';

/** Lagar vanliga fel i JSON från mindre modeller: radbrytningar i strängar och avslutande komman. */
export function repairJson(s: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (const c of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      else if (c === '\n') { out += '\\n'; continue; }
      else if (c === '\r') continue;
      else if (c === '\t') { out += ' '; continue; }
    } else if (c === '"') inStr = true;
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function tryParse<T>(s: string): T | undefined {
  try {
    return JSON.parse(s) as T;
  } catch {
    try {
      return JSON.parse(repairJson(s)) as T;
    } catch {
      return undefined;
    }
  }
}

export function parseJsonLoose<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  const parsed = start >= 0 && end > start ? tryParse<T>(body.slice(start, end + 1)) : undefined;
  if (parsed === undefined) throw new AiError(UNREADABLE);
  return parsed;
}

/**
 * Plockar ut de hela objekten i en lista, t.ex. "questions": [ {…}, {…}, {… (avklippt).
 * Används när svaret klipptes av eller ett objekt är trasigt, så att resten ändå går att använda.
 */
export function salvageObjects(text: string, key: string): unknown[] {
  const at = text.indexOf(`"${key}"`);
  const open = at < 0 ? -1 : text.indexOf('[', at);
  if (open < 0) return [];
  const found: unknown[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let from = -1;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') {
      if (depth === 0) from = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && from >= 0) {
        const obj = tryParse(text.slice(from, i + 1));
        if (obj !== undefined) found.push(obj);
        from = -1;
      }
    } else if (c === ']' && depth === 0) break;
  }
  return found;
}
