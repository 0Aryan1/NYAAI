import { describe, expect, it } from 'vitest';
import { defaultPer, readSyllabus, syllabusLectures, syllabusLines, syllabusPdfLines } from './syllabus.ts';

const ADR = `# Alternative Dispute Resolution

Course Objectives
Students will understand arbitration, conciliation and mediation in India.

Unit I: Arbitration Agreement
1. Meaning and essentials of an arbitration agreement
2. Arbitrability of disputes
Cases: Vidya Drolia v. Durga Trading Corporation

Unit II: Composition of the Arbitral Tribunal
- Appointment of arbitrators
- Challenge to arbitrators

Unit III - Interim measures; Section 9 and Section 17; Emergency arbitration

Unit IV
Setting aside of awards

Suggested Readings
1. O.P. Malhotra, The Law and Practice of Arbitration
2. Arbitration and Conciliation Act, 1996

Evaluation
Project 30 marks`;

describe('a course plan from a syllabus', () => {
  const outline = readSyllabus(syllabusLines(ADR));

  it('reads the units and their topics, and leaves out objectives, readings, marks and case lists', () => {
    expect(outline.courseName).toBe('Alternative Dispute Resolution');
    expect(outline.units).toEqual([
      { title: 'Arbitration Agreement', topics: ['Meaning and essentials of an arbitration agreement', 'Arbitrability of disputes'] },
      { title: 'Composition of the Arbitral Tribunal', topics: ['Appointment of arbitrators', 'Challenge to arbitrators'] },
      { title: 'Interim measures', topics: ['Section 9 and Section 17', 'Emergency arbitration'] },
      { title: 'Setting aside of awards', topics: [] },
    ]);
  });

  it('one lecture per unit, or per topic (a unit without topics stays one lecture)', () => {
    expect(syllabusLectures(outline, 'unit')).toEqual(['Arbitration Agreement', 'Composition of the Arbitral Tribunal', 'Interim measures', 'Setting aside of awards']);
    expect(syllabusLectures(outline, 'topic')).toEqual([
      'Meaning and essentials of an arbitration agreement',
      'Arbitrability of disputes',
      'Appointment of arbitrators',
      'Challenge to arbitrators',
      'Section 9 and Section 17',
      'Emergency arbitration',
      'Setting aside of awards',
    ]);
    expect(defaultPer(outline)).toBe('topic');
    expect(defaultPer(outline, 5)).toBe('unit'); // 7 topics do not fit 5 classes
  });

  it('a plain list with no units is the plan, one lecture per line', () => {
    const o = readSyllabus(syllabusLines('1. Transfer of property\n\n2. Doctrine of lis pendens\n\n3. Part performance'));
    expect(syllabusLectures(o, 'unit')).toEqual(['Transfer of property', 'Doctrine of lis pendens', 'Part performance']);
  });

  it('a unit line listing its topics with commas: the first names the unit', () => {
    const o = readSyllabus([{ text: 'Module 2: Mortgage, kinds of mortgage, rights of mortgagor, redemption', heading: null }]);
    expect(o.units).toEqual([{ title: 'Mortgage', topics: ['kinds of mortgage', 'rights of mortgagor', 'redemption'] }]);
  });

  it('roman, numbered and lettered units all count; Word headings start units too', () => {
    const o = readSyllabus([
      { text: 'Property Law', heading: 1 },
      { text: 'Sale and Gift', heading: 2 },
      { text: 'a) Sale of immovable property', heading: null },
      { text: 'Week 3: Leases', heading: null },
    ]);
    expect(o.courseName).toBe('Property Law');
    expect(o.units.map((u) => u.title)).toEqual(['Sale and Gift', 'Leases']);
    expect(o.units[0]!.topics).toEqual(['Sale of immovable property']);
  });

  it('a PDF line that carries on the one before is joined to it', () => {
    const line = (text: string, size = 11) => ({ text, size, x: 72, y: 0, marks: [] });
    const blocks = syllabusPdfLines({ bodySize: 11, scanned: false, pages: [{ pageNo: 1, lines: [line('Property Law', 16), line('Unit 1: Transfer of property'), line('1. Rule against perpetuity and the'), line('exceptions to it'), line('2. Lis pendens'), line('4')] }] });
    expect(readSyllabus(blocks)).toEqual({ courseName: 'Property Law', units: [{ title: 'Transfer of property', topics: ['Rule against perpetuity and the exceptions to it', 'Lis pendens'] }] });
  });
});
