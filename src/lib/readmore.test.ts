import { describe, expect, it, vi } from 'vitest';
import type { McQuestion, FreeQuestion } from './quiz';
import { normalizeQuestion } from './quiz';
import { explainPrompt, findReadMore, keywords, pickPage, searchTerms, wikiSearchUrl } from './readmore';

const mc: McQuestion = {
  type: 'mc',
  question: 'Vilket ämne gör att växter blir gröna och kan fånga solljus?',
  options: ['Klorofyll', 'Glukos', 'Syre', 'Stärkelse'],
  correct: 0,
  explanation: 'Klorofyll fångar ljuset.',
  source: 'Fotosyntes.pdf, sida 2',
  area: 'Fotosyntes',
  topic: 'Fotosyntes',
};
const free: FreeQuestion = {
  type: 'free',
  question: 'Förklara varför Gustav Vasa ville bryta Kalmarunionen.',
  modelAnswer: 'Han ville att Sverige skulle bli självständigt.',
  points: ['självständighet'],
  source: '',
  area: 'Historia',
};

describe('Läs mer', () => {
  it('tar ut sökord utan småord', () => {
    expect(keywords('Vad är det som gör att växter är gröna?')).toEqual(['växter', 'gröna']);
  });

  it('prövar ämnesord först, sedan rätt svar och sist frågans nyckelord', () => {
    const t = searchTerms(mc);
    expect(t[0]).toBe('Fotosyntes');
    expect(t[1]).toBe('Klorofyll');
    expect(t.length).toBeGreaterThan(2);
    expect(searchTerms(free)[0]).toContain('kalmarunionen');
  });

  it('läser in topic från AI:n men lägger inte till fältet när det saknas', () => {
    expect(normalizeQuestion({ ...mc, topic: ' Fotosyntes ' })).toMatchObject({ topic: 'Fotosyntes' });
    const { topic: _t, ...noTopic } = mc;
    expect(normalizeQuestion(noTopic)).not.toHaveProperty('topic');
  });

  it('bygger en sökadress mot svenska Wikipedia med CORS', () => {
    const u = new URL(wikiSearchUrl('Fotosyntes'));
    expect(u.hostname).toBe('sv.wikipedia.org');
    expect(u.searchParams.get('origin')).toBe('*');
    expect(u.searchParams.get('gsrsearch')).toBe('Fotosyntes');
  });

  it('väljer bästa träffen och hoppar över förgreningssidor', () => {
    const data = {
      query: {
        pages: {
          '1': { title: 'Fotosyntes (olika betydelser)', index: 1, extract: 'Kan syfta på…', fullurl: 'https://sv.wikipedia.org/wiki/A', pageprops: { disambiguation: '' } },
          '2': { title: 'Klorofyll', index: 3, extract: 'Klorofyll är…', fullurl: 'https://sv.wikipedia.org/wiki/Klorofyll' },
          '3': { title: 'Fotosyntes', index: 2, extract: 'Fotosyntes är…', fullurl: 'https://sv.wikipedia.org/wiki/Fotosyntes' },
        },
      },
    };
    expect(pickPage(data)).toEqual({ title: 'Fotosyntes', extract: 'Fotosyntes är…', url: 'https://sv.wikipedia.org/wiki/Fotosyntes' });
    expect(pickPage({})).toBeNull();
  });

  it('går vidare till nästa sökord när första inte ger träff, och klarar nätfel', async () => {
    const q = { ...mc, topic: 'Ingenting-alls-xyz' };
    const fetchFn = vi.fn(async (url: string) => {
      const term = new URL(url).searchParams.get('gsrsearch');
      if (term === 'Klorofyll') {
        return new Response(JSON.stringify({ query: { pages: { '9': { title: 'Klorofyll', index: 1, extract: 'Grönt färgämne.', fullurl: 'https://sv.wikipedia.org/wiki/Klorofyll' } } } }));
      }
      return new Response(JSON.stringify({ batchcomplete: '' }));
    }) as unknown as typeof fetch;
    expect((await findReadMore(q, fetchFn))?.title).toBe('Klorofyll');
    const broken = vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    expect(await findReadMore({ ...free, topic: 'Offline-test' }, broken)).toBeNull();
  });

  it('ger AI:n fråga, rätt svar, elevens svar, nivå och Wikipedia-text', () => {
    const p = explainPrompt(mc, { given: 2, score: 0 }, 5, undefined, { title: 'Klorofyll', extract: 'Grönt färgämne.', url: '' });
    expect(p).toContain('Rätt svar: Klorofyll');
    expect(p).toContain('Elevens svar: Syre');
    expect(p).toContain('Grönt färgämne.');
    expect(p).toMatch(/Årskurs: 5/);
    expect(explainPrompt(free, undefined, 10, 'Nivå 1', null)).toContain('Inget svar.');
  });
});
