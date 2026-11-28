import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ExternalLink, Pencil, Scale, Signature, Trash2, Undo2 } from 'lucide-react';
import { MAPPING_PAIRS, type LawMapping, type MappingRelation, type SaveLawMapping } from '@nyaai/shared';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { Pill } from '@/shared/ui/pill';
import { EmptyState, ListSkeleton, LoadError } from '@/shared/ui/states';
import { Tabs } from '@/shared/ui/tabs';

type Show = 'unsigned' | 'all';
type Pair = SaveLawMapping['pair'];

export const RELATIONS: { value: MappingRelation; label: string; hint: string }[] = [
  { value: 'same', label: 'Same', hint: 'One old section, one new section, same law and number' },
  { value: 'renumbered', label: 'Renumbered', hint: 'Same law, new number' },
  { value: 'merged', label: 'Merged', hint: 'Two or more old sections became one' },
  { value: 'split', label: 'Split', hint: 'One old section became two or more' },
  {
    value: 'substantively_changed',
    label: 'Substantively changed',
    hint: 'The law itself changed; never "equivalent"',
  },
  { value: 'no_direct_equivalent', label: 'No direct equivalent', hint: 'Nothing in the new law matches' },
];
/** What each decision does, asked once more before it is made. */
const ASK = {
  sign: () => 'Sign this row? Lecture lines that link these sections will rely on it.',
  unsign: () =>
    'Take back the signature? Lecture lines that relied on this row will be marked for their teachers to check again.',
  remove: (signed: boolean) =>
    signed
      ? 'Remove this row? Lecture lines that relied on it will be marked for their teachers to check again.'
      : 'Remove this row? It is not signed, so no lecture relies on it.',
} as const;
const RELATION_LABEL = Object.fromEntries(RELATIONS.map((r) => [r.value, r.label])) as Record<MappingRelation, string>;

/** "420, 415" or "s. 420; 415" → ["420", "415"] (the server checks each one). */
export const sectionsFrom = (text: string): string[] =>
  text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const EMPTY = {
  pair: 'IPC → BNS' as Pair,
  relation: 'renumbered' as MappingRelation,
  oldSections: '',
  newSections: '',
  note: '',
  sourceUrl: '',
};

/**
 * Old ↔ new criminal law mapping (DATA-6, LIB-1). The table the checker reads (C5): a line that links an IPC, CrPC or
 * Evidence Act section to its new one is supported only by a signed row, and a "substantively changed" or "no direct
 * equivalent" row must never be called equivalent. The criminal-law expert signs each row; changing a row removes
 * the signature, and lines that relied on a signed row are marked for their teachers to check again (in the
 * background). Signing, taking back a signature and removing each ask once more.
 */
export function MappingsPage() {
  const qc = useQueryClient();
  const [show, setShow] = useState<Show>('unsigned');
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<LawMapping | null>(null);
  const [asking, setAsking] = useState<{ id: string; action: 'sign' | 'unsign' | 'remove' } | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const top = useRef<HTMLFormElement>(null);
  const q = useQuery({ queryKey: queryKeys.lawMappings(show), queryFn: () => api.lawMappings(show) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['review', 'mappings'] });

  const save = useMutation({
    mutationFn: () => {
      const body: SaveLawMapping = {
        pair: form.pair,
        relation: form.relation,
        oldSections: sectionsFrom(form.oldSections),
        newSections: sectionsFrom(form.newSections),
        note: form.note,
        sourceUrl: form.sourceUrl,
      };
      return editing ? api.editLawMapping(editing.id, body) : api.addLawMapping(body);
    },
    onSuccess: () => {
      setForm(EMPTY);
      setEditing(null);
      refresh();
    },
  });
  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'sign' | 'unsign' | 'remove' }) => {
      if (action === 'sign') await api.signLawMapping(id);
      else if (action === 'unsign') await api.unsignLawMapping(id);
      else await api.removeLawMapping(id);
      return { id, action };
    },
    onSuccess: ({ id, action }) => {
      setAsking(null);
      if (action === 'remove') setRemoved((r) => new Set(r).add(id));
      refresh();
    },
  });
  const startEdit = (m: LawMapping) => {
    setEditing(m);
    setForm({
      pair: m.pair as Pair,
      relation: m.relation,
      oldSections: m.oldSections.join(', '),
      newSections: m.newSections.join(', '),
      note: m.note,
      sourceUrl: m.sourceUrl,
    });
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const rows = (q.data?.mappings ?? []).filter((m) => !removed.has(m.id));
  const noNew = form.relation === 'no_direct_equivalent';
  const saveError =
    save.error instanceof ApiRequestError
      ? save.error.body?.error.details?.issues
        ? issuesText(save.error.body.error.details.issues)
        : save.error.message
      : save.error
        ? 'Not saved. Try again.'
        : null;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <Scale className="size-5" aria-hidden />
        Old and new criminal law
      </h1>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Each row links IPC, CrPC or Evidence Act sections to the new Sanhitas. A lecture line that makes such a link is
        supported only by a row the criminal-law expert has signed; any other is marked for the teacher to verify.
        Changing a signed row removes the signature.
      </p>

      <form
        ref={top}
        onSubmit={submit}
        className="mt-6 space-y-4 rounded-card border border-border bg-surface p-4 text-sm"
        aria-label={editing ? 'Change the row' : 'New row'}
      >
        <h2 className="text-base font-semibold">{editing ? 'Change the row' : 'New row'}</h2>
        {editing?.signedBy && (
          <p className="rounded-control bg-flag-yellow-bg px-3 py-2">
            Saving removes {editing.signedBy}’s signature; the row is not used until it is signed again, and lecture
            lines that relied on it are marked for their teachers to check again.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block font-medium">Laws</span>
            <select
              value={form.pair}
              onChange={(e) => setForm({ ...form, pair: e.target.value as Pair })}
              className="h-10 w-full rounded-control border border-border bg-bg px-2"
            >
              {MAPPING_PAIRS.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">How they relate</span>
            <select
              value={form.relation}
              onChange={(e) =>
                setForm({
                  ...form,
                  relation: e.target.value as MappingRelation,
                  newSections: e.target.value === 'no_direct_equivalent' ? '' : form.newSections,
                })
              }
              className="h-10 w-full rounded-control border border-border bg-bg px-2"
            >
              {RELATIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted">
              {RELATIONS.find((r) => r.value === form.relation)!.hint}
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">Old sections</span>
            <input
              value={form.oldSections}
              onChange={(e) => setForm({ ...form, oldSections: e.target.value })}
              required
              placeholder="420"
              className="h-10 w-full rounded-control border border-border bg-bg px-2"
            />
            <span className="mt-1 block text-xs text-muted">Separate several with commas.</span>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">New sections</span>
            <input
              value={form.newSections}
              onChange={(e) => setForm({ ...form, newSections: e.target.value })}
              disabled={noNew}
              required={!noNew}
              placeholder={noNew ? 'None' : '318'}
              className="h-10 w-full rounded-control border border-border bg-bg px-2 disabled:opacity-60"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block font-medium">Note</span>
          <textarea
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            required
            minLength={3}
            rows={2}
            placeholder="What changed, in a sentence a teacher can say in class."
            className="w-full rounded-control border border-border bg-bg px-2 py-2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium">Official source</span>
          <input
            type="url"
            value={form.sourceUrl}
            onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
            required
            placeholder="https://… (the comparison table or the gazette)"
            className="h-10 w-full rounded-control border border-border bg-bg px-2"
          />
        </label>
        {saveError && <p className="text-danger">{saveError}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : editing ? 'Save the change' : 'Add the row'}
          </Button>
          {editing && (
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setForm(EMPTY);
                save.reset();
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </form>

      <Tabs<Show>
        label="Show"
        value={show}
        onChange={(v) => {
          setShow(v);
          setAsking(null);
        }}
        className="mt-8"
        options={[
          { value: 'unsigned', label: 'To sign', count: q.data?.unsigned },
          { value: 'all', label: 'All' },
        ]}
      />
      {act.error && (
        <p className="mt-3 text-sm text-danger">
          {act.error instanceof ApiRequestError ? act.error.message : 'Not saved. Try again.'}
        </p>
      )}
      <div className="mt-4">
        {q.isLoading && <ListSkeleton rows={3} label="Loading the rows" />}
        {q.isError && <LoadError what="The mapping rows" onRetry={() => void q.refetch()} />}
        {q.isSuccess && rows.length === 0 && (
          <EmptyState title={show === 'unsigned' ? 'Nothing to sign' : 'No rows yet'}>
            Rows you add appear here for the expert to sign.
          </EmptyState>
        )}
        {rows.length > 0 && (
          <ul className="divide-y divide-border rounded-card border border-border bg-surface">
            {rows.map((m) => {
              const ask = asking?.id === m.id ? asking.action : null;
              const busy = act.isPending && act.variables?.id === m.id;
              return (
                <li key={m.id} className="space-y-2 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-1.5 font-medium">
                      <span>
                        {m.pair.split(' → ')[0]} s. {m.oldSections.join(', ')}
                      </span>
                      <ArrowRight className="size-4 text-muted" aria-label="to" />
                      <span>
                        {m.newSections.length
                          ? `${m.pair.split(' → ')[1]} s. ${m.newSections.join(', ')}`
                          : 'no new section'}
                      </span>
                    </p>
                    <span className="flex flex-wrap gap-1.5">
                      <Pill
                        tone={
                          m.relation === 'substantively_changed' || m.relation === 'no_direct_equivalent'
                            ? 'yellow'
                            : 'grey'
                        }
                      >
                        {RELATION_LABEL[m.relation]}
                      </Pill>
                      {m.signedBy ? (
                        <Pill tone="success">Signed by {m.signedBy}</Pill>
                      ) : (
                        <Pill tone="grey">Not signed: not used</Pill>
                      )}
                    </span>
                  </div>
                  <p className="text-muted">{m.note}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <a
                      href={m.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      Official source <ExternalLink className="size-3" aria-hidden />
                    </a>
                    {ask ? (
                      <span
                        role="group"
                        aria-label="Are you sure?"
                        className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-bg px-3 py-2"
                      >
                        <span>{ASK[ask](!!m.signedBy)}</span>
                        <Button
                          size="sm"
                          variant={ask === 'sign' ? 'primary' : 'secondary'}
                          className={ask === 'remove' ? 'border-danger text-danger' : undefined}
                          disabled={busy}
                          onClick={() => act.mutate({ id: m.id, action: ask })}
                        >
                          {ask === 'sign' ? 'Yes, sign' : ask === 'unsign' ? 'Yes, take it back' : 'Yes, remove'}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking(null)}>
                          Cancel
                        </Button>
                      </span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {m.signedBy ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setAsking({ id: m.id, action: 'unsign' })}
                          >
                            <Undo2 className="size-4" aria-hidden />
                            Undo signature
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={busy}
                            onClick={() => setAsking({ id: m.id, action: 'sign' })}
                          >
                            <Signature className="size-4" aria-hidden />
                            Sign
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => startEdit(m)}>
                          <Pencil className="size-4" aria-hidden />
                          Change
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setAsking({ id: m.id, action: 'remove' })}
                        >
                          <Trash2 className="size-4" aria-hidden />
                          Remove
                        </Button>
                      </span>
                    )}
                  </div>
                  {m.signedAt && (
                    <p className="text-xs text-muted">
                      Signed{' '}
                      {new Date(m.signedAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The server's field messages ("Add the new section, or choose…"), one per line, without the field names. */
function issuesText(issues: unknown): string {
  const list = Array.isArray(issues) ? issues : [];
  const msgs = list
    .map((i) => (i && typeof i === 'object' && 'message' in i ? String((i as { message: unknown }).message) : ''))
    .filter(Boolean);
  return msgs.length ? [...new Set(msgs)].join(' ') : 'Some fields need a fix.';
}
