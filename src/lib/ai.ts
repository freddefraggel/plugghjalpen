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
  provider: ProviderId;
  model: string;
  keys: Partial<Record<ProviderId, string>>;
}

export type AiErrorCode = 'model' | 'too_large' | 'rate' | 'other';

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
export async function complete(settings: AiSettings, system: string, user: string, maxTokens = 4000): Promise<string> {
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
      });
    }
  } catch {
    throw new AiError('Kunde inte nå AI-tjänsten. Kontrollera internetanslutningen.');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message ?? data?.error ?? res.statusText;
    if (res.status === 401 || res.status === 403) throw new AiError('API-nyckeln godkändes inte. Kontrollera den i Inställningar.');
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
  if (res.status === 401 || res.status === 403) throw new AiError('API-nyckeln godkändes inte. Kontrollera den i Inställningar.');
  if (!res.ok) throw new AiError(`Kunde inte hämta modellistan (${res.status}).`);
  const data = await res.json().catch(() => null);
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
export function parseJsonLoose<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (start < 0 || end < start) throw new AiError('AI-svaret gick inte att läsa. Försök igen.');
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    throw new AiError('AI-svaret gick inte att läsa. Försök igen.');
  }
}
