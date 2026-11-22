import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import type { ReviewJudgmentList, UploadJudgmentStatus } from '@nyaai/shared';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';

type Outcome = NonNullable<UploadJudgmentStatus['outcome']>;
const pct = (n: number | null) => (n === null ? '' : `${Math.round(n * 100)}%`);

/** The result of reading an upload, in the editor's words. */
export function outcomeText(o: Outcome, replacing: boolean): string {
  if (o.kind === 'duplicate') return 'This file is already in the library.';
  if (o.kind === 'mismatch') return `This PDF does not look like the same judgment: only ${pct(o.agreement)} of the text in the library is in it. Nothing was changed.`;
  if (o.kind === 'kept_existing') return `This copy is a scan with reading errors, so the cleaner text already in the library was kept. Your copy is saved beside it (the two agree ${pct(o.agreement)}).`;
  const where = o.status === 'live' ? 'Teachers can use it now.' : 'It is in the library, marked "not yet reviewed" until you approve it.';
  const scan = o.scanned ? ' It is a scanned copy: check quoted words against the PDF before approving.' : '';
  return replacing
    ? `Replaced the text with your copy (${o.paragraphs ?? 0} paragraphs; it agrees ${pct(o.agreement)} with the old text). ${where}${scan}`
    : `Added: ${o.paragraphs ?? 0} paragraphs. ${where}${scan}`;
}

/**
 * Library editor: add a judgment PDF the automatic loaders could not find (or a better copy of one already held).
 * The file is read like the official report: paragraphs, opinions and labels; she then checks its labels as usual.
 */
export function UploadJudgment({ judgments, onDone }: { judgments: ReviewJudgmentList['judgments']; onDone: (sourceId: string) => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [caseName, setCaseName] = useState('');
  const [court, setCourt] = useState('Supreme Court of India');
  const [decidedOn, setDecidedOn] = useState('');
  const [official, setOfficial] = useState(true);
  const [sourceUrl, setSourceUrl] = useState('');
  const [replaces, setReplaces] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: () =>
      api.uploadJudgment(
        { caseName, court, decidedOn: decidedOn || undefined, official: official ? 'true' : 'false', sourceUrl: sourceUrl || undefined, replaces: replaces || undefined },
        file!,
      ),
    onSuccess: (r) => setJobId(r.jobId),
  });
  const status = useQuery({
    queryKey: queryKeys.uploadStatus(jobId ?? ''),
    queryFn: () => api.uploadStatus(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.state === 'done' || q.state.data?.state === 'failed' ? false : 2000),
  });
  const done = status.data?.state === 'done' || status.data?.state === 'failed';
  useEffect(() => {
    if (done) void qc.invalidateQueries({ queryKey: queryKeys.reviewJudgments });
  }, [done, qc]);

  const pickReplaced = (id: string) => {
    setReplaces(id);
    const j = judgments.find((x) => x.id === id);
    if (j) {
      setCaseName(j.title);
      if (j.court) setCourt(j.court);
      setDecidedOn(j.decidedOn ?? '');
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (file) upload.mutate();
  };
  const reset = () => {
    setFile(null);
    setJobId(null);
    upload.reset();
  };
  const error = upload.error instanceof ApiRequestError ? upload.error.message : upload.error ? 'The upload did not go through. Try again.' : null;

  return (
    <article className="mx-auto max-w-2xl">
      <h2 className="mb-1 text-xl font-semibold">Add a judgment</h2>
      <p className="mb-6 text-sm text-muted">
        For a case the library could not find, or a better copy of one it has. Use the court's own PDF where you can (the Supreme Court or High Court
        website). The file is read into paragraphs; then check its labels as for any judgment.
      </p>

      {jobId ? (
        <div className="rounded-card border border-border bg-surface p-4 text-sm" role="status" aria-live="polite">
          {!done && <p>Reading the PDF… this takes up to a minute.</p>}
          {status.data?.state === 'failed' && <p className="text-flag-yellow">{status.data.message}</p>}
          {status.data?.outcome && <p>{outcomeText(status.data.outcome, !!replaces)}</p>}
          {done && (
            <div className="mt-4 flex gap-2">
              {status.data?.outcome && status.data.outcome.kind !== 'mismatch' && (
                <Button variant="primary" onClick={() => onDone(status.data!.outcome!.sourceId)}>
                  Open it
                </Button>
              )}
              <Button onClick={reset}>Add another</Button>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 text-sm">
          <label className="block">
            <span className="mb-1 block font-medium">Judgment PDF</span>
            <input type="file" accept="application/pdf" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">It replaces (optional)</span>
            <select value={replaces} onChange={(e) => pickReplaced(e.target.value)} className="w-full rounded-control border border-border bg-bg px-2 py-2">
              <option value="">Nothing: this is a new case for the library</option>
              {judgments.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                  {j.decidedOn ? ` (${j.decidedOn.slice(0, 4)})` : ''}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted">The text is replaced only if your copy is the same judgment; paragraphs that match keep their labels.</span>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">Case name</span>
            <input value={caseName} onChange={(e) => setCaseName(e.target.value)} required minLength={5} placeholder="TRF Ltd. v. Energo Engineering Projects Ltd." className="w-full rounded-control border border-border bg-bg px-2 py-2" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block font-medium">Court</span>
              <input value={court} onChange={(e) => setCourt(e.target.value)} required className="w-full rounded-control border border-border bg-bg px-2 py-2" />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium">Date of judgment</span>
              <input type="date" value={decidedOn} onChange={(e) => setDecidedOn(e.target.value)} required={!replaces} className="w-full rounded-control border border-border bg-bg px-2 py-2" />
            </label>
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={official} onChange={(e) => setOfficial(e.target.checked)} className="mt-1" />
            <span>
              This copy is from an official court website
              <span className="block text-xs text-muted">Official copies are used straight away. Other copies stay "not yet reviewed" until you approve them.</span>
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">Where you got it (optional)</span>
            <input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" className="w-full rounded-control border border-border bg-bg px-2 py-2" />
          </label>
          {error && <p className="text-flag-yellow">{error}</p>}
          <Button type="submit" variant="primary" disabled={!file || upload.isPending}>
            <FileUp className="size-4" aria-hidden />
            {upload.isPending ? 'Uploading…' : 'Upload and read'}
          </Button>
        </form>
      )}
    </article>
  );
}
