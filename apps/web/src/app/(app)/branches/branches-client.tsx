'use client';

import { useState, type FormEvent } from 'react';
import {
  api,
  Badge,
  Button,
  ErrorText,
  inputClass,
  Modal,
  SecretBox,
  useAsync,
} from '@/components/ui';

interface BranchRow {
  id: string;
  code: string;
  name: string;
  isHeadOffice: boolean;
  status: string;
}

interface Issued {
  branch: BranchRow;
  code: string;
  expiresAt: string;
  cloudUrl: string;
  branchCreated: boolean;
}

export function BranchesClient({
  headOffice,
  canCreate,
}: {
  headOffice: boolean;
  canCreate: boolean;
}) {
  const list = useAsync(() => api<{ branches: BranchRow[] }>('/api/branches'));
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Branches</h1>
          <p className="text-sm text-muted">
            {headOffice
              ? 'Every branch of the organisation. Head Office sets item prices and tax rates for all of them.'
              : 'The branches of this organisation. They are managed by Head Office.'}
          </p>
        </div>
        {canCreate ? (
          <Button className="ms-auto" onClick={() => setAdding(true)}>
            Add a branch
          </Button>
        ) : null}
      </div>
      <ErrorText message={list.error} />
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.branches.map((b) => (
              <tr key={b.id} className="border-t border-border">
                <td className="px-4 py-3 font-mono">{b.code}</td>
                <td className="px-4 py-3">{b.name}</td>
                <td className="px-4 py-3">
                  <Badge tone={b.isHeadOffice ? 'warning' : 'neutral'}>
                    {b.isHeadOffice ? 'Head Office' : 'Branch'}
                  </Badge>
                </td>
                <td className="px-4 py-3">{b.status}</td>
              </tr>
            ))}
            {!list.data && !list.error ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {adding ? (
        <AddBranchDialog
          onClose={() => setAdding(false)}
          onIssued={(r) => {
            setAdding(false);
            setIssued(r);
            list.reload();
          }}
        />
      ) : null}
      {issued ? <CodeDialog issued={issued} onClose={() => setIssued(null)} /> : null}
    </>
  );
}

function AddBranchDialog({
  onClose,
  onIssued,
}: {
  onClose: () => void;
  onIssued: (r: Issued) => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onIssued(
        await api<Issued>('/api/branches/enrollment-codes', {
          body: { code: code.trim().toUpperCase(), name: name.trim() },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the code');
      setBusy(false);
    }
  }

  return (
    <Modal title="Add a branch" onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <p className="text-sm text-muted">
          This adds the branch to the organisation and creates a one-time code for the branch PC. It
          needs the internet. If the branch already exists here and has not joined yet, this creates
          a new code for it.
        </p>
        <label className="block text-sm">
          Branch code
          <input
            autoFocus
            className={`${inputClass} mt-1 uppercase`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="KHI02"
            maxLength={8}
            required
          />
        </label>
        <label className="block text-sm">
          Branch name
          <input
            className={`${inputClass} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || code.trim().length < 2 || name.trim().length < 2}>
            {busy ? 'Creating…' : 'Create code'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CodeDialog({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  return (
    <Modal title={`Enrollment code for ${issued.branch.code}`} onClose={onClose}>
      <div className="space-y-3">
        <SecretBox
          label="Enrollment code"
          value={issued.code}
          note={`Valid until ${new Date(issued.expiresAt).toLocaleString()} and works once. It is not shown again.`}
        />
        <ol className="list-decimal space-y-1 ps-5 text-sm">
          <li>Install Mediescare on the branch PC and open it.</li>
          <li>
            On the first screen choose <strong>Join an existing organisation</strong>.
          </li>
          <li>
            Cloud address: <span className="break-all font-mono">{issued.cloudUrl}</span>
          </li>
          <li>Enter the code above, then your name, a username and a password.</li>
          <li>Keep the PC online until the first copy of items and suppliers is finished.</li>
        </ol>
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
