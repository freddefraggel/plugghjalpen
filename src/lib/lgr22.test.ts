import { describe, expect, it } from 'vitest';
import { criteriaForGrade, parseCentralContent, plain, shortHeading, simplifyGySubject, simplifySubject, stageForGrade, type ApiGySubject } from './lgr22-parse';
import { GY_GRADE, matchHeading, schoolOf, stageForLevel } from './curriculum';
import { ageFor, levelLabel, levelLine } from './quiz';

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

describe('gymnasiets ämnesplaner', () => {
  const api: ApiGySubject = {
    code: 'MATE',
    name: 'Matematik',
    version: '1',
    modifiedDate: '2025-12-19',
    courses: [
      {
        code: 'MATE1C00X',
        name: 'Nivå 1c',
        centralContent: {
          text: '<p>Undervisningen i ämnet matematik på nivå 1c ska behandla följande centrala innehåll:</p> <p><em>Aritmetik, algebra och funktioner</em></p> <ul> <li>Hantering av formler.</li> <li>Begreppet funktion.</li> </ul> <p><em>Trigonometri och vektorer</em></p> <ul> <li>Begreppen sinus, cosinus och tangens.</li> </ul>',
        },
      },
      { code: 'MATE2C00X', name: 'Nivå 2c', centralContent: { text: '<p>Undervisningen ska behandla:</p> <ul> <li>Andragradsekvationer.</li> </ul>' } },
      { code: 'TOM', name: 'Tom nivå', centralContent: { text: '<p></p>' } },
    ],
    knowledgeRequirements: [
      { gradeStep: 'E', text: '<h4><i>Betyget E</i></h4><p>Eleven använder begrepp med <strong>godtagbar</strong> säkerhet.</p>' },
      { gradeStep: 'D', text: '<h4><i>Betyget D</i></h4><p>Mellan C och E.</p>' },
      { gradeStep: 'A', text: '<h4><i>Betyget A</i></h4><p>Eleven använder begrepp med <strong>mycket god</strong> säkerhet.</p>' },
    ],
  };

  it('gör varje nivå till ett stadium med kursiva rubriker som områden', () => {
    const s = simplifyGySubject(api);
    expect(s.stages.map((x) => x.years)).toEqual(['Nivå 1c', 'Nivå 2c']);
    expect(s.stages[0].areas).toEqual([
      { heading: 'Aritmetik, algebra och funktioner', items: ['Hantering av formler.', 'Begreppet funktion.'] },
      { heading: 'Trigonometri och vektorer', items: ['Begreppen sinus, cosinus och tangens.'] },
    ]);
    expect(s.stages[1].areas).toEqual([{ heading: 'Andragradsekvationer', items: ['Andragradsekvationer.'] }]);
  });

  it('gör korta rubriker av punkter när nivån saknar delrubriker', () => {
    expect(shortHeading('Läsning av och samtal om sakprosa. Produktion av texter som anknyter till läst sakprosa.')).toBe('Läsning av och samtal om sakprosa');
    const long = shortHeading('Muntlig framställning i och inför grupp med fokus på anpassning till sammanhang, syfte och mottagare. Manus.');
    expect(long.length).toBeLessThanOrEqual(82);
    expect(long.endsWith(' …')).toBe(true);
  });

  it('behåller betygskriterierna E, C och A utan rubriker', () => {
    const s = simplifyGySubject(api);
    expect(s.criteria.map((c) => c.level)).toEqual(['E', 'A']);
    expect(s.criteria[0]).toEqual({ year: 'GY', level: 'E', text: 'Eleven använder begrepp med godtagbar säkerhet.' });
  });

  it('väljer nivå och visar gymnasiet i etiketter', () => {
    const s = simplifyGySubject(api);
    expect(stageForLevel(s, 'Nivå 2c')?.years).toBe('Nivå 2c');
    expect(stageForLevel(s, 'finns inte')?.years).toBe('Nivå 1c');
    expect(levelLabel(GY_GRADE, 'Nivå 1c')).toBe('gymnasiet, nivå 1c');
    expect(levelLabel(8)).toBe('åk 8');
    expect(ageFor(1)).toBe('cirka 7 år');
    expect(ageFor(9)).toBe('cirka 15 år');
    expect(levelLine(7)).toBe('Årskurs: 7 (åk 7–9, eleven är cirka 13 år)');
    expect(levelLine(GY_GRADE, 'Nivå 1c')).toBe('Skolform: gymnasieskolan, nivå 1c (eleven är 16–19 år)');
    expect(schoolOf(9)).toBe('GR');
    expect(schoolOf(GY_GRADE)).toBe('GY');
  });
});
