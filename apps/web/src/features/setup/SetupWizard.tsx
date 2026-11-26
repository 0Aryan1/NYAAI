import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { NewCourseForm } from '@/features/courses/CourseList';
import { SETUP_STEPS, STYLE_QUESTIONS, type Me, type SetupStepName, type StyleRequest } from '@nyaai/shared';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { queryClient } from '@/app/queryClient';
import { Button } from '@/shared/ui/button';
import { ChipGroup } from '@/shared/ui/chip-group';

const TITLES: Record<SetupStepName, string> = {
  consent: 'Your data',
  profile: 'Profile',
  old_slides: 'Old slides',
  style: 'Your style',
  template: 'Template',
  courses: 'Courses',
};

/**
 * Setup wizard (F1, ACC-2; LLD §12.3). Consent first, then the five steps. Every step saves on Next, so she can
 * leave and come back to the same place. Old slides and template are placeholders until CNLU's templates arrive.
 */
export function SetupWizard() {
  const { step = 'consent' } = useParams();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const navigate = useNavigate();
  const index = SETUP_STEPS.indexOf(step as SetupStepName);
  const name = SETUP_STEPS[index] ?? 'consent';

  async function advance(save: () => Promise<void>) {
    await save();
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    // Agreeing again after a withdrawal: back to work, not through setup again.
    const next = me.data?.setupDone ? undefined : SETUP_STEPS[index + 1];
    navigate(next ? `/setup/${next}` : '/');
  }
  const back = index > 0 ? () => navigate(`/setup/${SETUP_STEPS[index - 1]}`) : undefined;

  if (!me.data) return null;
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="mb-1 flex items-center justify-between gap-3 text-sm text-muted">
        <p>
          Setting up NYAAI · about 5 minutes · signed in as {me.data.user.email}
        </p>
        <button
          type="button"
          className="shrink-0 rounded-control px-2 py-1 hover:bg-surface hover:text-text"
          onClick={async () => {
            await api.logout();
            queryClient.clear();
            void navigate('/login');
          }}
        >
          Sign out
        </button>
      </div>
      <ol aria-label="Setup steps" className="mb-8 grid grid-cols-6 gap-1.5">
        {SETUP_STEPS.map((s, i) => (
          <li key={s} aria-current={i === index ? 'step' : undefined}>
            <span className={`block h-1.5 rounded-full ${i <= index ? 'bg-accent' : 'bg-border'}`} aria-hidden />
            <span className={`mt-1.5 block truncate text-xs ${i === index ? 'font-medium text-text' : 'text-muted'}`}>{TITLES[s]}</span>
          </li>
        ))}
      </ol>
      {name === 'consent' && <ConsentStep onNext={advance} />}
      {name === 'profile' && <ProfileStep me={me.data} onNext={advance} back={back} />}
      {name === 'old_slides' && (
        <Placeholder
          title="Your old slides"
          body="Upload a few of your past lecture files and NYAAI will match their look and layout. This step opens in the next update; you can add slides later from My Style."
          onNext={() => advance(() => api.setupProgress(4))}
          back={back}
        />
      )}
      {name === 'style' && <StyleStep me={me.data} onNext={advance} back={back} />}
      {name === 'template' && (
        <Placeholder
          title="Slide template"
          body="Choose a template from your own slides or one of the ready CNLU templates. Templates open in the next update; until then lectures use a plain NYAAI layout."
          onNext={() => advance(() => api.setupProgress(6))}
          back={back}
        />
      )}
      {name === 'courses' && <CoursesStep onNext={() => advance(api.finishSetup)} back={back} />}
    </main>
  );
}

function StepFrame({ title, intro, children, onSubmit, back, nextLabel = 'Next', canNext = true }: {
  title: string;
  intro?: string;
  children?: ReactNode;
  onSubmit: () => Promise<void>;
  back?: () => void;
  nextLabel?: string;
  canNext?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="rounded-card border border-border bg-surface p-6">
      <h1 className="mb-1 text-xl font-semibold">{title}</h1>
      {intro && <p className="mb-6 text-sm text-muted">{intro}</p>}
      <div className="space-y-6">{children}</div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-8 flex items-center justify-between">
        {back ? (
          <Button variant="ghost" onClick={back}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary" disabled={busy || !canNext}>
          {busy ? 'Saving…' : nextLabel}
        </Button>
      </div>
    </form>
  );
}

function ConsentStep({ onNext }: { onNext: (save: () => Promise<void>) => Promise<void> }) {
  const consent = useQuery({ queryKey: queryKeys.consent, queryFn: api.consent });
  const [agree, setAgree] = useState(false);
  return (
    <StepFrame
      title="Before we start: where your data goes"
      intro="NYAAI uses these services to prepare your lectures. Nothing you upload is shared with other teachers unless you ask."
      onSubmit={() => onNext(api.acceptConsent)}
      canNext={agree || consent.data?.accepted === true}
      nextLabel="I agree, continue"
    >
      <ul className="divide-y divide-border rounded-card border border-border">
        {consent.data?.processors.map((p) => (
          <li key={p.name} className="p-4 text-sm">
            <p className="font-medium">{p.name}</p>
            <p className="text-muted">{p.purpose}</p>
            <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-1">
              <dt className="text-muted">What is sent</dt>
              <dd>{p.dataSent}</dd>
              <dt className="text-muted">Where</dt>
              <dd>{p.region}</dd>
            </dl>
          </li>
        ))}
      </ul>
      {!consent.data?.accepted && (
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          I agree that NYAAI may send my data to these services for these purposes. I can withdraw and delete my data at any time
          from My data.
        </label>
      )}
    </StepFrame>
  );
}

const SUBJECTS = ['Law of Contract I', 'Law of Contract II', 'Constitutional Law I', 'Constitutional Law II', 'Law of Torts', 'Criminal Law', 'Company Law', 'Jurisprudence', 'Family Law', 'Administrative Law'];

function ProfileStep({ me, onNext, back }: { me: Me; onNext: (save: () => Promise<void>) => Promise<void>; back?: () => void }) {
  const [name, setName] = useState(me.user.name);
  const [department, setDepartment] = useState(me.profile.department ?? '');
  const [subjects, setSubjects] = useState<string[]>(me.profile.subjects);
  const [other, setOther] = useState('');
  const [language, setLanguage] = useState<string | null>(me.profile.subjects.length ? me.profile.teachingLanguage : null);
  const toggle = (s: string) => setSubjects((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const addOther = () => {
    const s = other.trim();
    if (s.length >= 2 && !subjects.includes(s)) setSubjects([...subjects, s]);
    setOther('');
  };
  return (
    <StepFrame
      title="Your profile"
      intro="Tell us what you teach, so suggestions fit your courses."
      back={back}
      canNext={name.trim().length >= 2 && subjects.length > 0 && language !== null}
      onSubmit={() =>
        onNext(() =>
          api.saveProfile({
            name: name.trim(),
            department: department.trim() || undefined,
            subjects,
            teachingLanguage: language as 'en' | 'en_hi' | 'hi',
          }),
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">Name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} className="h-10 w-full rounded-control border border-border bg-bg px-3 text-sm" />
        </div>
        <div>
          <label htmlFor="dept" className="mb-1 block text-sm font-medium">Department <span className="font-normal text-muted">(optional)</span></label>
          <input id="dept" value={department} onChange={(e) => setDepartment(e.target.value)} className="h-10 w-full rounded-control border border-border bg-bg px-3 text-sm" />
        </div>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Subjects you teach</legend>
        <div className="flex flex-wrap gap-2">
          {[...new Set([...SUBJECTS, ...subjects])].map((s) => (
            <label key={s} className="cursor-pointer">
              <input type="checkbox" className="peer sr-only" checked={subjects.includes(s)} onChange={() => toggle(s)} />
              <span className="inline-flex min-h-9 items-center rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-contrast peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                {s}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <label htmlFor="other" className="sr-only">Another subject</label>
          <input
            id="other"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addOther();
              }
            }}
            placeholder="Another subject"
            className="h-9 min-w-0 flex-1 rounded-control border border-border bg-bg px-3 text-sm"
          />
          <Button size="sm" onClick={addOther} disabled={other.trim().length < 2}>Add</Button>
        </div>
      </fieldset>
      <ChipGroup
        label="Teaching language"
        value={language}
        onChange={setLanguage}
        options={[
          { value: 'en', label: 'English' },
          { value: 'en_hi', label: 'English and Hindi' },
          { value: 'hi', label: 'Hindi' },
        ]}
      />
    </StepFrame>
  );
}

function StyleStep({ me, onNext, back }: { me: Me; onNext: (save: () => Promise<void>) => Promise<void>; back?: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>(me.profile.style);
  const done = STYLE_QUESTIONS.every((q) => answers[q.key]);
  return (
    <StepFrame
      title="Your teaching style"
      intro="Five quick choices. You can change any of them later in My Style."
      back={back}
      canNext={done}
      onSubmit={() => onNext(() => api.saveStyle(answers as unknown as StyleRequest))}
    >
      {STYLE_QUESTIONS.map((q) => (
        <ChipGroup key={q.key} label={q.question} options={q.options} value={answers[q.key] ?? null} onChange={(v) => setAnswers({ ...answers, [q.key]: v })} />
      ))}
    </StepFrame>
  );
}

function Placeholder({ title, body, onNext, back, nextLabel = 'Skip for now' }: { title: string; body: string; onNext: () => Promise<void>; back?: () => void; nextLabel?: string }) {
  return (
    <StepFrame title={title} back={back} onSubmit={onNext} nextLabel={nextLabel}>
      <p className="text-sm text-muted">{body}</p>
    </StepFrame>
  );
}

/**
 * Step 6, courses (COURSE-1, COURSE-2): the same form as the Courses screen, from her syllabus file or a pasted list.
 * She can add several, or none and finish; one-off lectures need no course. (Not a StepFrame: the course form is a
 * form of its own, and forms cannot nest.)
 */
function CoursesStep({ onNext, back }: { onNext: () => Promise<void>; back?: () => void }) {
  const list = useQuery({ queryKey: queryKeys.courses, queryFn: api.courses });
  const courses = list.data?.courses ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await onNext();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <section className="rounded-card border border-border bg-surface p-6">
        <h1 className="mb-1 text-xl font-semibold">Your courses</h1>
        <p className="text-sm text-muted">
          Add the courses you teach this semester. Upload your syllabus and NYAAI lists its lectures for you to check; a lecture in a course opens with a recap of the last
          class. You can also do this later on the Courses screen.
        </p>
        {courses.length > 0 && (
          <ul aria-label="Your courses" className="mt-4 divide-y divide-border rounded-card border border-border text-sm">
            {courses.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-3 py-2">
                <span className="font-medium">{c.name}</span>
                <span className="text-muted">
                  {c.lectures} {c.lectures === 1 ? 'lecture' : 'lectures'} planned
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <NewCourseForm title={courses.length ? 'Another course' : 'A course'} onCreated={() => void list.refetch()} />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between">
        {back ? (
          <Button variant="ghost" onClick={back}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" disabled={busy} onClick={() => void finish()}>
          {busy ? 'Saving…' : courses.length ? 'Finish setup' : 'Finish without a course'}
        </Button>
      </div>
    </div>
  );
}
