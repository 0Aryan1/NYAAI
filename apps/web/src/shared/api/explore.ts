/** Explore: topics, a topic's map, and follow-up questions answered from the library (EXP-1, EXP-2). */
import { ConceptList, ExploreAnswer, TopicMap, type ExploreAsk } from '@nyaai/shared';
import { call } from './http';

export const exploreApi = {
  exploreConcepts: (q?: string) =>
    call('GET', `/explore/concepts${q ? `?q=${encodeURIComponent(q)}` : ''}`, { parse: (v) => ConceptList.parse(v) }),
  topicMap: (conceptId: string) => call('GET', `/explore/topic/${conceptId}`, { parse: (v) => TopicMap.parse(v) }),
  exploreAsk: (body: ExploreAsk) => call('POST', '/explore/ask', { body, parse: (v) => ExploreAnswer.parse(v) }),
};

export const exploreKeys = {
  exploreAll: ['explore'] as const,
  concepts: (q: string) => ['explore', 'concepts', q] as const,
  topic: (id: string) => ['explore', 'topic', id] as const,
};
