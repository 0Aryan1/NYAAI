/**
 * Prompt registry (LLD §9). Every prompt has an id and a version; the version is stored on every
 * AI call and every citation. Templates land with Day 3 (planner, writer, checkers).
 */
export const PROMPT_IDS = [
  'planner.lecture', 'writer.part', 'writer.repair', 'checker.support', 'checker.second',
  'coach.review', 'research.plan', 'research.write', 'explore.answer', 'query.expand',
  'labeller.roles', 'extract.metadata', 'status.suggest', 'learn.summary', 'learn.writing_guide',
] as const;
export type PromptId = (typeof PROMPT_IDS)[number];

export type Tier = 'light' | 'heavy';

export interface PromptDefinition {
  id: PromptId;
  version: string;
  tier: Tier;
  temperature: number;
  maxOutputTokens: number;
}

export function promptKey(p: Pick<PromptDefinition, 'id' | 'version'>): string {
  return `${p.id}@${p.version}`;
}
