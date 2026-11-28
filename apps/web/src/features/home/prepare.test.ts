import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/shared/api/http';
import { missingChoices, ONE_OFF, prepareRefusal, prepareRequest, type PrepareForm } from './prepare';

const empty: PrepareForm = {
  topic: '',
  course: null,
  length: null,
  level: null,
  style: null,
  mustInclude: '',
  special: '',
  notes: [],
};
const full = {
  ...empty,
  topic: ' Arbitration agreement ',
  course: 'c1',
  length: '50',
  level: 'intro',
  style: 'socratic',
};
const ctx = { planUnit: null, nextUnit: 'u-next', conceptId: undefined, prereqAck: false };
const refused = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiRequestError(409, { error: { code: code as never, message, details, traceId: 't' } });

describe('Home: Prepare', () => {
  it('says everything still missing, in her words, and nothing once all is chosen', () => {
    expect(missingChoices(empty, true)).toEqual([
      'a topic',
      'a course (or one-off)',
      'a class length',
      'a level',
      'a style',
      'your notes to finish reading (or untick them)',
    ]);
    expect(missingChoices(full, false)).toEqual([]);
  });

  it("uses the plan's lecture she clicked, else the course's next one; one-off has no course", () => {
    expect(prepareRequest(full, ctx).course).toEqual({ kind: 'course', courseId: 'c1', unitId: 'u-next' });
    expect(prepareRequest(full, { ...ctx, planUnit: 'u-plan' }).course).toMatchObject({ unitId: 'u-plan' });
    expect(prepareRequest({ ...full, course: ONE_OFF }, ctx).course).toEqual({ kind: 'one_off' });
    const r = prepareRequest({ ...full, mustInclude: '  ', special: ' x ' }, ctx);
    expect(r).toMatchObject({
      topic: 'Arbitration agreement',
      lengthMin: 50,
      anythingSpecial: 'x',
      mustInclude: undefined,
    });
  });

  it('turns a refusal into what it asks of her', () => {
    const choices = [{ conceptId: '00000000-0000-4000-8000-000000000001', name: 'Damages', subject: 'Contract' }];
    expect(prepareRefusal(refused('TOPIC_AMBIGUOUS', 'Which one?', { choices }))).toEqual({
      kind: 'ambiguous',
      choices,
    });
    expect(prepareRefusal(refused('PREREQ_WARNING_UNACKED', 'L02 is not taught yet.'))).toEqual({
      kind: 'prereq',
      message: 'L02 is not taught yet.',
    });
    expect(prepareRefusal(new Error('boom'))).toEqual({
      kind: 'error',
      message: 'Something went wrong. Please try again.',
    });
  });
});
