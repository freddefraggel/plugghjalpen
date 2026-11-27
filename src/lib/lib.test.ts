import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseJsonLoose } from './ai';
import { normalizeQuestion, buildMaterial, scoreOf, parseQuizResponse } from './quiz';
import { extractPptxFromBuffer, textSource } from './extract';

describe('parseJsonLoose', () => {
  it('läser JSON inuti ```-block med text runt', () => {
    expect(parseJsonLoose<{ a: number }>('Här är quizet:\n```json\n{"a": 1}\n```\nLycka till!')).toEqual({ a: 1 });
  });
  it('läser JSON utan block', () => {
    expect(parseJsonLoose<{ q: string[] }>('{"q":["x"]}')).toEqual({ q: ['x'] });
  });
  it('kastar ett begripligt fel på trasigt svar', () => {
    expect(() => parseJsonLoose('inget json här')).toThrow(/format/);
  });
});

describe('normalizeQuestion', () => {
  it('godtar en korrekt flervalsfråga', () => {
    const q = normalizeQuestion({ type: 'mc', question: ' Vad? ', options: ['a', 'b', 'c', 'd'], correct: 2, explanation: 'e', source: 's', area: 'A' });
    expect(q).toMatchObject({ type: 'mc', question: 'Vad?', correct: 2 });
  });
  it('avvisar flerval där rätt svar saknas bland alternativen', () => {
    expect(normalizeQuestion({ type: 'mc', question: 'Vad?', options: ['a', 'b'], correct: 5 })).toBeNull();
  });
  it('ger fritextfrågor ett område även om det saknas', () => {
    expect(normalizeQuestion({ type: 'free', question: 'Förklara', modelAnswer: 'x', points: ['p'] })).toMatchObject({ area: 'Övrigt', points: ['p'] });
  });
  it('avvisar okända typer', () => {
    expect(normalizeQuestion({ type: 'essay', question: 'x' })).toBeNull();
  });
});

describe('buildMaterial', () => {
  it('kortar av väldigt långt material', () => {
    const long = textSource('lång', 'ord '.repeat(30000));
    const { text, truncated } = buildMaterial([long]);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(60000);
    expect(text.length).toBeGreaterThan(55000);
  });
});

describe('scoreOf', () => {
  it('ger halv poäng för delvis rätt', () => {
    expect(scoreOf('partial')).toBe(0.5);
    expect(scoreOf('correct')).toBe(1);
    expect(scoreOf('incorrect')).toBe(0);
  });
});

describe('extractPptxFromBuffer', () => {
  it('läser text och anteckningar från bilder i rätt ordning', async () => {
    const zip = new JSZip();
    const slide = (texts: string[]) =>
      `<p:sld><p:cSld><p:spTree>${texts.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`;
    zip.file('ppt/slides/slide10.xml', slide(['Tionde']));
    zip.file('ppt/slides/slide2.xml', slide(['Andra', 'Koldioxid &amp; vatten']));
    zip.file('ppt/slides/slide1.xml', slide(['Fotosyntesen']));
    zip.file('ppt/notesSlides/notesSlide1.xml', slide(['Kom ihåg klorofyll']));
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const slides = await extractPptxFromBuffer(buf);
    expect(slides).toHaveLength(3);
    expect(slides[0]).toContain('Fotosyntesen');
    expect(slides[0]).toContain('Anteckningar: Kom ihåg klorofyll');
    expect(slides[1]).toBe('Andra\nKoldioxid & vatten');
    expect(slides[2]).toBe('Tionde');
  });
});

import { isModelMissing, pickAvailableModel } from './ai';

describe('modellval', () => {
  it('känner igen fel om modell som saknas', () => {
    expect(isModelMissing(404, '')).toBe(true);
    expect(isModelMissing(400, 'The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.')).toBe(true);
    expect(isModelMissing(400, 'max_tokens too large')).toBe(false);
  });
  it('behåller vald modell om den finns', () => {
    expect(pickAvailableModel('groq', 'openai/gpt-oss-20b', ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'])).toBe('openai/gpt-oss-20b');
  });
  it('byter till en rekommenderad modell som finns', () => {
    expect(pickAvailableModel('groq', 'llama-3.3-70b-versatile', ['whisper-large-v3', 'openai/gpt-oss-120b'])).toBe('openai/gpt-oss-120b');
  });
  it('ger null om ingen rekommenderad modell finns', () => {
    expect(pickAvailableModel('groq', 'x', ['whisper-large-v3'])).toBeNull();
  });
});

import { condense, relevantExcerpt, generateQuiz } from './quiz';
import { isTooLarge, parseLimits } from './ai';
import { vi } from 'vitest';

describe('långt material', () => {
  it('condense tar med början, mitten och slutet', () => {
    const text = Array.from({ length: 300 }, (_, i) => `Rad ${i} ` + 'x'.repeat(80)).join('\n');
    const out = condense(text, 5000);
    expect(out.length).toBeLessThanOrEqual(5000);
    expect(out).toContain('Rad 0 ');
    expect(out).toMatch(/Rad 1\d\d /);
    expect(out).toMatch(/Rad 2[0-8]\d /);
    expect(out).toMatch(/Rad 29\d /);
  });
  it('relevantExcerpt väljer stycken som handlar om frågan', () => {
    const material = ['Fotosyntesen sker i kloroplasterna.', 'Romarriket föll år 476.', 'Klorofyll fångar solljus i kloroplasterna.'].join('\n');
    const out = relevantExcerpt(material, 'Var finns klorofyll och kloroplasterna?', 80);
    expect(out).toContain('Klorofyll');
    expect(out).not.toContain('Romarriket');
  });
  it('läser gränser ur Groqs felmeddelanden', () => {
    const msg = 'Request too large for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 9598, please reduce your message size and try again.';
    expect(isTooLarge(413, msg)).toBe(true);
    expect(parseLimits(msg)).toMatchObject({ limit: 8000, requested: 9598 });
    expect(parseLimits('Rate limit reached ... Please try again in 7.2s.').retryAfter).toBe(8);
    expect(isTooLarge(429, 'Rate limit reached for tokens per minute (TPM): Limit 8000, Used 6000, Requested 3000.')).toBe(false);
  });
});

describe('generateQuiz med för stort material', () => {
  it('krymper materialet och försöker igen när tjänsten säger att det är för stort', async () => {
    const sizes: number[] = [];
    const quiz = { title: 'T', subject: 'Biologi', questions: [{ type: 'mc', question: 'Q?', options: ['a', 'b', 'c', 'd'], correct: 0 }] };
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const len = body.messages[1].content.length;
      sizes.push(len);
      if (sizes.length === 1)
        return new Response(JSON.stringify({ error: { message: 'Request too large ... (TPM): Limit 8000, Requested 9598, please reduce your message size' } }), { status: 413 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(quiz) } }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const src = textSource('Genetik', 'Gener och DNA. '.repeat(3000));
    const q = await generateQuiz({ provider: 'groq', model: 'openai/gpt-oss-120b', keys: { groq: 'k' } }, [src], { subject: '', grade: 8, mix: 'mc', count: 10 });
    vi.unstubAllGlobals();
    expect(q.questions).toHaveLength(1);
    expect(sizes).toHaveLength(2);
    expect(sizes[1]).toBeLessThan(sizes[0] * 0.8);
  });
});

import { shuffleOptions, type McQuestion } from './quiz';

describe('shuffleOptions', () => {
  const q: McQuestion = { type: 'mc', question: 'Q', options: ['rätt', 'fel1', 'fel2', 'fel3'], correct: 0, explanation: '', source: '', area: '' };
  it('behåller rätt svar när alternativen blandas', () => {
    for (let n = 0; n < 50; n++) {
      const s = shuffleOptions(q);
      expect(s.options[s.correct]).toBe('rätt');
      expect([...s.options].sort()).toEqual([...q.options].sort());
    }
  });
  it('sprider rätt svar över alla platser', () => {
    const seen = new Set<number>();
    for (let n = 0; n < 200; n++) seen.add(shuffleOptions(q).correct);
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe('läsa trasiga AI-svar', () => {
  it('lagar radbrytningar i strängar och avslutande komman', () => {
    expect(parseJsonLoose<{ a: string; b: number[] }>('{"a": "rad 1\nrad 2", "b": [1, 2,],}')).toEqual({ a: 'rad 1\nrad 2', b: [1, 2] });
  });

  it('använder de hela frågorna när svaret klipptes av', () => {
    const raw = '```json\n{"title": "Fotosyntes", "subject": "Biologi", "questions": [\n{"type":"mc","question":"Vad behöver växter?","options":["Ljus","Salt","Sand","Is"],"correct":0,"explanation":"x","source":"s","area":"a"},\n{"type":"free","question":"Förklara {kort}","modelAnswer":"m","points":["p"],"source":"s","area":"a"},\n{"type":"mc","question":"Avklip';
    const r = parseQuizResponse(raw);
    expect(r.title).toBe('Fotosyntes');
    expect(r.subject).toBe('Biologi');
    expect(r.questions).toHaveLength(2);
  });

  it('säger tydligt när inget går att läsa', () => {
    expect(() => parseQuizResponse('Jag kan tyvärr inte hjälpa till.')).toThrow(/format/);
    expect(() => parseQuizResponse('{"title":"x","questions":[{"type":"mc","question":"Avkl')).toThrow(/klipptes av/);
  });
});
