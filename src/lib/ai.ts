// Utbytbara AI-leverantörer. Alla anrop görs direkt från webbläsaren med
// användarens egen nyckel, som bara sparas lokalt (se storage.ts).

export type ProviderId = 'anthropic' | 'gemini' | 'groq' | 'openrouter';

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
    id: 'gemini',
    name: 'Google Gemini',
    blurb: 'Har en gratisnivå med begränsningar.',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza…',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini Pro' },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    blurb: 'Öppna modeller, snabbt och ofta gratis att testa.',
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_…',
    models: [{ id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' }],
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

export class AiError extends Error {}

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
    } else if (settings.provider === 'gemini') {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
          }),
        },
      );
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
    if (res.status === 429) throw new AiError('För många anrop just nu. Vänta en stund och försök igen.');
    throw new AiError(`AI-tjänsten svarade med ett fel: ${typeof msg === 'string' ? msg : res.status}`);
  }

  let text: string | undefined;
  if (settings.provider === 'anthropic') {
    text = data?.content?.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
  } else if (settings.provider === 'gemini') {
    text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('');
  } else {
    text = data?.choices?.[0]?.message?.content;
  }
  if (!text) throw new AiError('AI-tjänsten gav inget svar. Försök igen.');
  return text;
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
