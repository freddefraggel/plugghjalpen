import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseJsonLoose } from './ai';
import { normalizeQuestion, buildMaterial, scoreOf } from './quiz';
import { extractPptxFromBuffer, textSource } from './extract';

describe('parseJsonLoose', () => {
  it('läser JSON inuti ```-block med text runt', () => {
    expect(parseJsonLoose<{ a: number }>('Här är quizet:\n```json\n{"a": 1}\n```\nLycka till!')).toEqual({ a: 1 });
  });
  it('läser JSON utan block', () => {
    expect(parseJsonLoose<{ q: string[] }>('{"q":["x"]}')).toEqual({ q: ['x'] });
  });
  it('kastar ett begripligt fel på trasigt svar', () => {
    expect(() => parseJsonLoose('inget json här')).toThrow(/gick inte att läsa/);
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
    expect(text.length).toBe(60000);
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
