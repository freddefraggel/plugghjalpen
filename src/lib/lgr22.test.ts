import { describe, expect, it } from 'vitest';
import { criteriaForGrade, parseCentralContent, plain, simplifySubject, stageForGrade } from './lgr22-parse';
import { matchHeading } from './curriculum';

// Utdrag i samma form som Skolverkets Syllabus-API (religionskunskap).
const REL_79 =
  '<h3>I årskurs 7–9</h3><h4>Religioner och andra livsåskådningar</h4> <ul> <li>Vad religion och livsåskådning kan betyda för människors behov av me­ning, gemenskap och identitet.</li> <li>Centrala tankegångar inom kristendom, islam, judendom, hinduism och budd&shy;hism.</li> </ul> <h4>Religion och samhälle</h4> <ul> <li>Kritisk granskning av hur religion framställs i media.</li> </ul>';
const NO_13 =
  '<h4>Undervisningen i de naturorienterande ämnena ska behandla följande centrala innehåll</h4><h3>I årskurs 1–3</h3><h4>Året runt i naturen</h4> <ul> <li>Årstidsväxlingar i naturen.</li> </ul>';

describe('Lgr22-tolkning', () => {
  it('delar upp centralt innehåll i rubriker och punkter och tar bort mjuka bindestreck', () => {
    const areas = parseCentralContent(REL_79);
    expect(areas.map((a) => a.heading)).toEqual(['Religioner och andra livsåskådningar', 'Religion och samhälle']);
    expect(areas[0].items[0]).toContain('behov av mening');
    expect(areas[0].items[1]).toContain('buddhism');
  });

  it('hoppar över inledande rubriker som inte följs av punkter', () => {
    expect(parseCentralContent(NO_13).map((a) => a.heading)).toEqual(['Året runt i naturen']);
  });

  it('läser betygsnivå och gör om kriterier till ren text', () => {
    const s = simplifySubject({
      code: 'GRGRREL01',
      name: 'Religionskunskap',
      version: 14,
      modifiedDate: '2024-02-09',
      centralContents: [
        { year: '7-9', text: REL_79 },
        { year: '1-3', text: NO_13 },
      ],
      knowledgeRequirements: [
        { year: '3', text: '<h3>Kriterier för bedömning av godtagbara kunskaper i slutet av årskurs 3</h3><p>Eleven visar grundläggande kunskaper.</p>' },
        { year: '9', text: '<h3>Betygskriterier för betyget E i slutet av årskurs 9</h3><p>Eleven visar <strong>grundläggande</strong> kunskaper.</p> <p>Andra stycket.</p>' },
      ],
    });
    expect(s.stages.map((x) => x.years)).toEqual(['7-9', '1-3']);
    expect(criteriaForGrade(s, 8)).toEqual([{ year: '9', level: 'E', text: 'Eleven visar grundläggande kunskaper.\nAndra stycket.' }]);
    expect(criteriaForGrade(s, 2)[0].level).toBe('godtagbara');
  });

  it('väljer det smalaste stadiet som passar årskursen', () => {
    const subject = simplifySubject({
      code: 'X',
      name: 'Moderna språk',
      version: 1,
      modifiedDate: '',
      centralContents: [
        { year: '4-9', text: REL_79 },
        { year: '4-6', text: NO_13 },
      ],
    });
    expect(stageForGrade(subject, 5)?.years).toBe('4-6');
    expect(stageForGrade(subject, 8)?.years).toBe('4-9');
    expect(stageForGrade(subject, 2)).toBeUndefined();
  });

  it('hittar betygsnivån även när det finns flera rubriker och tar bort dubbletter', () => {
    const k = { year: '6', text: '<h3>Inom ramen för skolans val</h3><h3>Betygskriterier för betyget E i slutet av årskurs 6</h3><p>Eleven lyssnar.</p>' };
    const s = simplifySubject({ code: 'M', name: 'Moderna språk', version: 1, modifiedDate: '', centralContents: [{ year: '4-6', text: NO_13 }], knowledgeRequirements: [k, k] });
    expect(s.criteria).toEqual([{ year: '6', level: 'E', text: 'Eleven lyssnar.' }]);
  });

  it('plain hanterar entiteter och radbrytningar', () => {
    expect(plain('<p>A &amp; B</p><p>C</p>')).toBe('A & B\nC');
  });

  it('matchar AI:ns områden mot Skolverkets rubriker', () => {
    const h = ['Religioner och andra livsåskådningar', 'Etik och livsfrågor'];
    expect(matchHeading('etik och livsfrågor', h)).toBe('Etik och livsfrågor');
    expect(matchHeading('Religioner', h)).toBe('Religioner och andra livsåskådningar');
    expect(matchHeading('Något annat', h)).toBe('Något annat');
  });
});
