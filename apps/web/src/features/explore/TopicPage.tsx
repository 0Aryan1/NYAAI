import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Gavel, GraduationCap, HelpCircle, Presentation, Send } from 'lucide-react';
import type { ExploreAnswer } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { caseStatusLabel, lectureNo } from '@/shared/lib/labels';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Pill } from '@/shared/ui/pill';
import { ListSkeleton, LoadError, Skeleton, SlowNote } from '@/shared/ui/states';
import { CaseStatusPill } from '@/shared/ui/case-status-pill';
import { HighlightedPassage } from '@/shared/ui/highlighted-passage';
import { FlaggedLine } from '@/shared/ui/flagged-line';
import { errorText } from '@/shared/lib/errors';

/** One answered question: its lines (with the same yellow and grey marks as the Studio) and the sources they rest on. */
function AnswerCard({ question, answer }: { question: string; answer: ExploreAnswer }) {
  const [open, setOpen] = useState<string | null>(null);
  const source = answer.sources.find((s) => s.tag === open);
  return (
    <article className="rounded-card border border-border bg-surface p-5">
      <p className="font-medium">{question}</p>
      {answer.lines.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Not found in the library.
          {answer.libraryTold && ' The library team has your question and will look for the sources.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm leading-relaxed">
          {answer.lines.map((l, i) => (
            <FlaggedLine
              key={i}
              text={l.text}
              flag={l.flag}
              reason={l.reason}
              className={cn(l.kind === 'question' && 'italic')}
            >
              {l.sources.map((s) => (
                <button
                  key={s.tag}
                  type="button"
                  onClick={() => setOpen(open === s.tag ? null : s.tag)}
                  aria-expanded={open === s.tag}
                  className={cn(
                    'ml-1.5 rounded-full border px-2 py-0.5 align-middle text-xs',
                    open === s.tag
                      ? 'border-accent text-text'
                      : 'border-border text-muted hover:border-accent hover:text-text',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </FlaggedLine>
          ))}
        </ul>
      )}
      {answer.lines.length > 0 && answer.notFound.length > 0 && (
        <p className="mt-3 text-xs text-muted">Not found in the library: {answer.notFound.join(' · ')}</p>
      )}
      {source && (
        <div
          className="mt-4 rounded-card border border-border bg-bg p-4 text-sm"
          aria-label={`Source: ${source.label}`}
        >
          <p className="mb-2 text-xs text-muted">
            {source.header}
            {source.provisional && ' · not yet reviewed by the library team'}
            {source.caseStatus && ` · ${caseStatusLabel(source.caseStatus)}`}
          </p>
          <p className="whitespace-pre-line leading-relaxed">
            <HighlightedPassage text={source.text} span={source.spans[0]} />
          </p>
        </div>
      )}
    </article>
  );
}

/**
 * A topic map (EXP-1) with follow-up questions (EXP-2) and "Turn into a lecture" (EXP-6). Library only: every answer
 * line is checked like a lecture line, and what the library cannot answer is said plainly.
 */
export function TopicPage() {
  const { conceptId = '' } = useParams();
  const navigate = useNavigate();
  const map = useQuery({ queryKey: queryKeys.topic(conceptId), queryFn: () => api.topicMap(conceptId) });
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<{ question: string; answer: ExploreAnswer }[]>([]);
  const ask = useMutation({
    mutationFn: (q: string) => api.exploreAsk({ question: q, conceptId }),
    onSuccess: (answer, q) => {
      setAnswers((a) => [{ question: q, answer }, ...a]);
      setQuestion('');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (question.trim().length >= 5) ask.mutate(question.trim());
  };

  if (map.isError)
    return <LoadError what="This topic" onRetry={() => void map.refetch()} className="mx-auto max-w-3xl" />;
  const t = map.data;
  if (!t)
    return (
      <div className="mx-auto max-w-3xl">
        <Skeleton className="mb-6 h-8 w-64" />
        <ListSkeleton rows={4} label="Opening the topic" />
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Link to="/explore" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4" aria-hidden /> All topics
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{t.concept.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {t.concept.subject}
              {t.concept.aliases.length > 0 && ` · also called ${t.concept.aliases.join(', ')}`}
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => void navigate(`/?topic=${encodeURIComponent(t.concept.name)}&concept=${t.concept.id}`)}
          >
            <Presentation className="size-4" aria-hidden />
            Turn into a lecture
          </Button>
        </div>
      </div>

      <section aria-labelledby="key-sections">
        <h2 id="key-sections" className="mb-3 flex items-center gap-2 font-semibold">
          <BookOpen className="size-4" aria-hidden /> Key sections
        </h2>
        {t.keySections.length === 0 ? (
          <p className="text-sm text-muted">None linked yet.</p>
        ) : (
          <ul className="space-y-3">
            {t.keySections.map((s) => (
              <li key={s.chunkId} className="rounded-card border border-border bg-surface p-4 text-sm">
                <p className="font-medium">{s.heading}</p>
                <p className="mt-1 leading-relaxed text-muted">{s.excerpt}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="leading-cases">
        <h2 id="leading-cases" className="mb-3 flex items-center gap-2 font-semibold">
          <Gavel className="size-4" aria-hidden /> Leading cases
        </h2>
        {t.leadingCases.length === 0 ? (
          <p className="text-sm text-muted">None linked yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-card border border-border bg-surface">
            {t.leadingCases.map((c) => (
              <li key={c.sourceId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span>
                  <span className="font-medium">{c.title}</span>
                  <span className="text-muted">
                    {[c.court, c.year].filter(Boolean).length
                      ? ` · ${[c.court, c.year].filter(Boolean).join(', ')}`
                      : ''}
                  </span>
                </span>
                <span className="flex gap-1.5">
                  {!c.confirmed && <Pill tone="grey">Link not yet confirmed by an expert</Pill>}
                  <CaseStatusPill status={c.caseStatus} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {t.openQuestions.length > 0 && (
        <section aria-labelledby="open-questions">
          <h2 id="open-questions" className="mb-3 flex items-center gap-2 font-semibold">
            <HelpCircle className="size-4" aria-hidden /> Open questions
          </h2>
          <p className="mb-2 text-sm text-muted">
            Your lectures on this topic could not answer these from the library; the library team has them.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {t.openQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}

      {t.inCourses.length > 0 && (
        <section aria-labelledby="in-courses">
          <h2 id="in-courses" className="mb-3 flex items-center gap-2 font-semibold">
            <GraduationCap className="size-4" aria-hidden /> In your courses
          </h2>
          <ul className="space-y-1 text-sm">
            {t.inCourses.map((u) => (
              <li key={u.unitId}>
                <Link
                  to={u.lectureId ? `/lectures/${u.lectureId}` : `/courses/${u.courseId}`}
                  className="text-accent hover:underline"
                >
                  {u.courseName} · {lectureNo(u.position)} {u.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="ask">
        <h2 id="ask" className="mb-3 font-semibold">
          Ask about {t.concept.name}
        </h2>
        <form onSubmit={submit} className="flex gap-2">
          <label htmlFor="question" className="sr-only">
            Your question
          </label>
          <input
            id="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={400}
            placeholder="e.g. Does it apply to a gift?"
            className="h-10 min-w-0 flex-1 rounded-control border border-border bg-surface px-3 text-sm"
          />
          <Button type="submit" variant="primary" disabled={ask.isPending || question.trim().length < 5}>
            <Send className="size-4" aria-hidden />
            {ask.isPending ? 'Looking…' : 'Ask'}
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted">
          Answered from the library only. Every statement carries its source and is checked, as on your slides.
        </p>
        {ask.isPending && (
          <div className="mt-4" role="status" aria-label="Finding the answer">
            <Skeleton className="h-24 w-full" />
            <SlowNote />
          </div>
        )}
        {ask.error && (
          <p className="mt-3 text-sm text-danger">
            {errorText(ask.error, 'No answer this time. Check your connection and try again.')}
          </p>
        )}
        <div className="mt-4 space-y-4">
          {answers.map((a, i) => (
            <AnswerCard key={answers.length - i} question={a.question} answer={a.answer} />
          ))}
        </div>
      </section>
    </div>
  );
}
