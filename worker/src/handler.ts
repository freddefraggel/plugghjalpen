// Plugghjälpens backend: håller AI-nyckeln hemlig, kontrollerar klasskod och dagskvot,
// och hämtar webbsidor som källor. Körs som en Cloudflare Worker (se index.ts).
import { AiError, complete, providerForKey, PROVIDERS, type AiSettings, type ProviderId } from '../../src/lib/ai';
import { htmlToText, isAllowedUrl } from '../../src/lib/html-text';

export interface Env {
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  AI_API_KEY?: string;
  /** Kommaseparerade klasskoder, t.ex. "7B-HOST,8A-VINTER". */
  CLASS_CODES?: string;
  /** Kommaseparerade tillåtna ursprung, t.ex. "https://freddefraggel.github.io". */
  ALLOWED_ORIGINS?: string;
  DAILY_LIMIT_DEVICE?: string;
  DAILY_LIMIT_CODE?: string;
}

/** Räknar anrop per nyckel och dygn. I produktion en Durable Object (quota.ts). */
export interface QuotaStore {
  /** Ökar räknarna och returnerar false om någon gräns redan är nådd. */
  take(entries: { key: string; limit: number }[]): Promise<boolean>;
}

const MAX_BODY = 200_000;
const MAX_PAGE = 2_000_000;

export async function handle(req: Request, env: Env, quota: QuotaStore): Promise<Response> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? 'https://freddefraggel.github.io,http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const cors: Record<string, string> = allowed.includes(origin)
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-class-code, x-device-id',
        'access-control-max-age': '86400',
        vary: 'origin',
      }
    : {};
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors } });
  const fail = (message: string, status: number, code = 'other', info: Record<string, unknown> = {}) =>
    json({ error: { message, code, info } }, status);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (origin && !allowed.includes(origin)) return fail('Den här webbplatsen får inte använda servern.', 403);

  const url = new URL(req.url);
  // Leverantören väljs i första hand utifrån nyckeln, så att det räcker att byta AI_API_KEY.
  const provider = (providerForKey(env.AI_API_KEY ?? '') ?? PROVIDERS.find((p) => p.id === env.AI_PROVIDER)?.id ?? 'anthropic') as ProviderId;
  const info = PROVIDERS.find((p) => p.id === provider)!;
  // AI_MODEL gäller bara när den hör till samma leverantör som AI_PROVIDER.
  const model = env.AI_MODEL && env.AI_PROVIDER === provider ? env.AI_MODEL : info.models[0].id;

  if (url.pathname === '/api/info' && req.method === 'GET') {
    return json({ provider, model, needsClassCode: Boolean(env.CLASS_CODES?.trim()), configured: Boolean(env.AI_API_KEY) });
  }

  // Allt annat kräver klasskod (om sådana är inställda) och räknas mot dagskvoten.
  const codes = (env.CLASS_CODES ?? '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  const code = (req.headers.get('x-class-code') ?? '').trim().toUpperCase();
  if (codes.length && !codes.includes(code)) return fail('Fel klasskod. Fråga din lärare om koden.', 401, 'class_code');
  const device = (req.headers.get('x-device-id') ?? '').slice(0, 64);
  if (!/^[a-z0-9-]{8,64}$/i.test(device)) return fail('Saknar enhets-id.', 400);

  const day = new Date().toISOString().slice(0, 10);
  const ok = await quota.take([
    { key: `device:${device}:${day}`, limit: Number(env.DAILY_LIMIT_DEVICE) || 60 },
    { key: `code:${code || '-'}:${day}`, limit: Number(env.DAILY_LIMIT_CODE) || 2000 },
  ]);
  if (!ok) return fail('Dagens gräns för quiz är nådd. Försök igen i morgon.', 429, 'quota');

  if (url.pathname === '/api/complete' && req.method === 'POST') {
    if (!env.AI_API_KEY) return fail('Servern saknar AI-nyckel. Be läraren lägga in den.', 503);
    const raw = await req.text();
    if (raw.length > MAX_BODY) return fail('Materialet är för stort för den här AI-tjänsten.', 413, 'too_large');
    let body: { system?: unknown; user?: unknown; maxTokens?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return fail('Ogiltig förfrågan.', 400);
    }
    if (typeof body.system !== 'string' || typeof body.user !== 'string') return fail('Ogiltig förfrågan.', 400);
    const maxTokens = Math.min(8000, Math.max(16, Number(body.maxTokens) || 4000));
    const settings: AiSettings = { provider, model, keys: { [provider]: env.AI_API_KEY } };
    try {
      return json({ text: await complete(settings, body.system, body.user, maxTokens) });
    } catch (e) {
      if (e instanceof AiError) {
        if (e.code === 'auth') return fail('Skolans AI-nyckel fungerar inte just nu. Säg till din lärare.', 502, 'auth');
        const status = e.code === 'too_large' ? 413 : e.code === 'rate' ? 429 : 502;
        return fail(e.message, status, e.code, e.info);
      }
      return fail('Något gick fel på servern.', 500);
    }
  }

  if (url.pathname === '/api/fetch-url' && req.method === 'GET') {
    const target = isAllowedUrl(url.searchParams.get('url') ?? '');
    if (!target) return fail('Det ser inte ut som en vanlig webbadress.', 400);
    let res: Response;
    try {
      res = await fetch(target.toString(), {
        headers: { 'user-agent': 'Plugghjalpen/1.0 (studieapp)', accept: 'text/html,text/plain;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return fail('Kunde inte hämta sidan. Kontrollera länken.', 502);
    }
    if (!res.ok) return fail(`Sidan svarade med fel (${res.status}).`, 502);
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/(html|plain)|application\/xhtml/i.test(type)) return fail('Länken är inte en vanlig webbsida. Ladda ner filen och ladda upp den istället.', 415);
    const html = (await res.text()).slice(0, MAX_PAGE);
    const { title, text } = type.includes('text/plain') ? { title: '', text: html } : htmlToText(html);
    if (text.length < 200) return fail('Hittade nästan ingen text på sidan. Den kan kräva inloggning eller JavaScript.', 422);
    return json({ title: title || target.hostname, text: text.slice(0, 200_000), url: res.url || target.toString() });
  }

  return fail('Okänd adress.', 404);
}
