/** The scripted fake AI for the browser journeys: what it answers, and that it is never allowed in production. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PROMPTS, fence } from '@nyaai/prompts';
import { LecturePlan, WriterReplyWrite } from '@nyaai/shared';
import { parseConfig } from '../src/config.ts';
import { createFakeGateway, fencedSources, quotable } from '../src/services/llm-gateway/fake.ts';

const noUsage = async () => {};
const S56 = 'An agreement to do an act impossible in itself is void. A contract to do an act which, after the contract is made, becomes impossible becomes void when the act becomes impossible.';

describe('fake AI (E2E only)', () => {
  it('reads the fenced sources and quotes a sentence exactly as it stands', () => {
    const block = ['SOURCES', fence('S1 · Indian Contract Act › s. 56', S56, 'abc123')].join('\n');
    const [s] = fencedSources(block);
    expect(s).toMatchObject({ tag: 'S1', header: 'Indian Contract Act › s. 56' });
    const q = quotable(s!.text)!;
    expect(S56).toContain(q);
    expect(q.length).toBeGreaterThanOrEqual(40);
  });

  it('plans a recap and a bridge only when the course memory asks for them', async () => {
    const g = createFakeGateway();
    const run = async (task: string) => (await g.run({ prompt: PROMPTS['planner.lecture'], schema: LecturePlan, task }, noUsage)).data.parts.map((p) => p.kind);
    expect(await run('TOPIC: Frustration')).toEqual(['content', 'content']);
    expect(await run('TOPIC: Frustration\nCOURSE RECAP: yes: plan a recap part first. COURSE BRIDGE: yes: plan a bridge part last, to L03 X.')).toEqual(['recap', 'content', 'content', 'bridge']);
  });

  it("writes claims whose spans are the source's own words, and plants one unsourced line in the first part", async () => {
    const g = createFakeGateway();
    const context = ['TEACHER', ['SOURCES', fence('S1 · Indian Contract Act › s. 56', S56, 'abc123')].join('\n')];
    const r = await g.run({ prompt: PROMPTS['writer.part'], schema: WriterReplyWrite, context, task: 'TASK: WRITE\n\nPART 1: Meaning (20 minutes, kind content), the first part\n\nFill "written" (partIndex 0) and set "repairs" to null.' }, noUsage);
    const lines = r.data.written!.slides.flatMap((s) => s.lines);
    const claims = lines.flatMap((l) => l.claims);
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((c) => S56.includes(c.span))).toBe(true);
    expect(lines.some((l) => l.kind === 'teaching' && /Section 56/.test(l.text))).toBe(true);
  });

  it('refuses a prompt it has no answer for, rather than guessing', async () => {
    await expect(createFakeGateway().run({ prompt: { ...PROMPTS['planner.lecture'], id: 'coach.review' as never }, schema: z.object({}), task: 'x' }, noUsage)).rejects.toThrow(/no answer/);
  });

  it('is never allowed in production', () => {
    const base = {
      DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's',
      SESSION_SECRET: 'a'.repeat(32), CSRF_SECRET: 'b'.repeat(32), E2E_FAKE_AI: 'true',
    };
    expect(parseConfig({ ...base, NODE_ENV: 'development' }).E2E_FAKE_AI).toBe(true);
    expect(() => parseConfig({ ...base, NODE_ENV: 'production' })).toThrow(/E2E_FAKE_AI is never allowed in production/);
  });
});
