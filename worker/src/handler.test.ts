import { afterEach, describe, expect, it, vi } from 'vitest';
import { handle, type Env, type QuotaStore } from './handler';
import { htmlToText, isAllowedUrl } from '../../src/lib/html-text';

const ORIGIN = 'https://freddefraggel.github.io';
const DEVICE = 'device-12345678';

function memoryQuota(): QuotaStore & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    async take(entries) {
      if (entries.some((e) => (counts.get(e.key) ?? 0) >= e.limit)) return false;
      for (const e of entries) counts.set(e.key, (counts.get(e.key) ?? 0) + 1);
      return true;
    },
  };
}

const env: Env = { AI_PROVIDER: 'groq', AI_MODEL: 'openai/gpt-oss-120b', AI_API_KEY: 'hemlig', CLASS_CODES: '7B-HOST, 8a-vinter', DAILY_LIMIT_DEVICE: '2' };

function req(path: string, init: RequestInit & { code?: string; origin?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set('origin', init.origin ?? ORIGIN);
  headers.set('x-device-id', DEVICE);
  if (init.code !== undefined) headers.set('x-class-code', init.code);
  return new Request(`https://api.example.dev${path}`, { ...init, headers });
}

afterEach(() => vi.unstubAllGlobals());

describe('backend', () => {
  it('svarar på CORS-förfrågan från appen men inte från andra webbplatser', async () => {
    const ok = await handle(req('/api/complete', { method: 'OPTIONS' }), env, memoryQuota());
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const bad = await handle(req('/api/info', { origin: 'https://evil.example' }), env, memoryQuota());
    expect(bad.status).toBe(403);
  });

  it('visar leverantör men aldrig nyckeln i /api/info', async () => {
    const res = await handle(req('/api/info'), env, memoryQuota());
    const body = await res.json();
    expect(body).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b', needsClassCode: true, configured: true });
    expect(JSON.stringify(body)).not.toContain('hemlig');
  });

  it('väljer leverantör utifrån nyckeln', async () => {
    const info = async (e: Env) => (await (await handle(req('/api/info'), e, memoryQuota())).json()) as { provider: string; model: string };
    const base = { AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-haiku-5-5' };
    expect(await info({ ...base, AI_API_KEY: 'gsk_abc' })).toMatchObject({ provider: 'groq', model: 'openai/gpt-oss-120b' });
    expect(await info({ ...base, AI_API_KEY: 'sk-ant-abc' })).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5' });
    expect(await info({ ...base, AI_API_KEY: 'sk-or-abc' })).toMatchObject({ provider: 'openrouter' });
  });

  it('säger att det är skolans nyckel som felar, inte elevens inställningar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 })));
    const res = await handle(req('/api/complete', { method: 'POST', code: '7b-host', body: JSON.stringify({ system: 's', user: 'u' }) }), env, memoryQuota());
    const body = await res.json();
    expect(body.error.code).toBe('auth');
    expect(body.error.message).toContain('lärare');
    expect(body.error.message).not.toContain('Inställningar');
  });

  it('kräver rätt klasskod, oavsett skiftläge', async () => {
    const wrong = await handle(req('/api/complete', { method: 'POST', body: '{}', code: 'FEL' }), env, memoryQuota());
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.code).toBe('class_code');
  });

  it('skickar vidare till AI-tjänsten med serverns nyckel och räknar dagskvoten', async () => {
    const calls: { url: string; auth: string | null }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, auth: new Headers(init.headers).get('authorization') });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 });
    }));
    const quota = memoryQuota();
    const body = JSON.stringify({ system: 's', user: 'u', maxTokens: 50 });
    const r1 = await handle(req('/api/complete', { method: 'POST', body, code: '8A-VINTER' }), env, quota);
    expect(await r1.json()).toEqual({ text: 'OK' });
    expect(calls[0]).toEqual({ url: 'https://api.groq.com/openai/v1/chat/completions', auth: 'Bearer hemlig' });
    await handle(req('/api/complete', { method: 'POST', body, code: '8A-VINTER' }), env, quota);
    const r3 = await handle(req('/api/complete', { method: 'POST', body, code: '8A-VINTER' }), env, quota);
    expect(r3.status).toBe(429);
    expect((await r3.json()).error.code).toBe('quota');
  });

  it('skickar AI-tjänstens fel vidare med kod så att appen kan krympa materialet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Request too large ... Limit 8000, Requested 9598' } }), { status: 413 })));
    const res = await handle(req('/api/complete', { method: 'POST', body: JSON.stringify({ system: 's', user: 'u' }), code: '7B-HOST' }), env, memoryQuota());
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatchObject({ code: 'too_large', info: { limit: 8000, requested: 9598 } });
  });

  it('hämtar en webbsida och gör om den till text', async () => {
    const html = `<html><head><title>Fotosyntes &ndash; Lär dig mer</title><script>alert(1)</script></head><body><nav>Meny</nav><main><h1>Fotosyntes</h1><p>${'Växter gör socker av koldioxid och vatten. '.repeat(20)}</p></main><footer>Kontakt</footer></body></html>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })));
    const res = await handle(req(`/api/fetch-url?url=${encodeURIComponent('https://example.se/fotosyntes')}`, { code: '7B-HOST' }), env, memoryQuota());
    const page = await res.json();
    expect(page.title).toBe('Fotosyntes – Lär dig mer');
    expect(page.text).toContain('Växter gör socker');
    expect(page.text).not.toMatch(/Meny|Kontakt|alert/);
  });

  it('vägrar hämta lokala adresser', async () => {
    const res = await handle(req(`/api/fetch-url?url=${encodeURIComponent('http://192.168.1.1/admin')}`, { code: '7B-HOST' }), env, memoryQuota());
    expect(res.status).toBe(400);
  });
});

describe('html-text', () => {
  it('avkodar entiteter och behåller styckebrytningar', () => {
    expect(htmlToText('<p>A &amp; B</p><p>&#229;&auml;&ouml;</p>').text).toBe('A & B\nåäö');
  });
  it('godkänner bara vanliga publika webbadresser', () => {
    expect(isAllowedUrl('https://sv.wikipedia.org/wiki/DNA')).not.toBeNull();
    for (const bad of ['ftp://example.se/x', 'http://localhost:8080', 'http://10.0.0.1/', 'https://user:pw@example.se/', 'http://intranet/', 'https://example.se:8443/']) {
      expect(isAllowedUrl(bad)).toBeNull();
    }
  });
});
