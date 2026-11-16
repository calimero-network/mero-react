import './workspaceReview.css';
import './createWorkspace.css';
import { useEffect, useId, useRef, useState } from 'react';
import { useMero } from '../context';
import { WorkspaceReview } from './WorkspaceReview';
import { useCreateWorkspace, type CreatedWorkspace } from './useCreateWorkspace';
import type { ReviewRelease } from '../node-shield/nodeChecks';

/** The dialog's wording, so each app keeps its own. */
export interface CreateWorkspaceLabels {
  title?: string;
  subtitle?: string;
  nameLabel?: string;
  namePlaceholder?: string;
  selfLabel?: string;
  selfPlaceholder?: string;
  next?: string;
}

const DEFAULT_LABELS: Required<CreateWorkspaceLabels> = {
  title: 'Create workspace',
  subtitle: 'Name your workspace, and choose how others in it will see you.',
  nameLabel: 'Workspace name',
  namePlaceholder: '',
  selfLabel: 'Your name',
  selfPlaceholder: '',
  next: 'Continue',
};

export interface CreateWorkspaceDialogProps {
  open: boolean;
  onClose: () => void;
  /** The package release the workspace will run, reviewed before creating. */
  release: ReviewRelease;
  /** Called once the workspace exists; the app does its own follow-ups. */
  onCreated: (workspace: CreatedWorkspace) => void;
  /** Where the node's consent page sends the person back. Default: this origin's root, where the app mounts `ConsentPopupReturn`. */
  returnTo?: string;
  labels?: CreateWorkspaceLabels;
}

/**
 * Create a workspace in three steps: names, review, and (on a session bound to
 * the app's frontend) approval on the node's own page. Needs `MeroProvider`.
 */
export function CreateWorkspaceDialog({ open, onClose, release, onCreated, returnTo, labels }: CreateWorkspaceDialogProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const { client, cluster, nodeUrl } = useMero();
  const flow = useCreateWorkspace({ returnTo: returnTo ?? `${typeof window === 'undefined' ? '' : window.location.origin}/`, onCreated });
  const [step, setStep] = useState<'names' | 'review'>('names');
  const [name, setName] = useState('');
  const [selfName, setSelfName] = useState('');
  const ids = [useId(), useId()];
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && step === 'names') first.current?.focus();
  }, [open, step]);
  if (!open) return null;

  const trimmed = { name: name.trim(), self: selfName.trim() };
  const approving = flow.phase === 'approving';
  return (
    <div className="mero-cw mero-cw-overlay" onKeyDown={(e) => e.key === 'Escape' && !approving && onClose()}>
      <div className="mero-cw-card" role="dialog" aria-modal="true" aria-label={text.title}>
        <button type="button" className="mero-cw-x" aria-label="Close" onClick={() => (approving ? flow.cancel() : onClose())}>
          x
        </button>
        {approving ? (
          <div className="mero-cw-approve">
            <h2 className="mero-cw-title">Approve with your passkey</h2>
            <p className="mero-cw-sub">A window from your node opened. Check it shows this code, then approve there.</p>
            <div className="mero-cw-code" aria-live="polite">
              {flow.code ?? '...'}
            </div>
            <div className="mero-cw-wait" role="status">
              <span className="mero-cw-dot" aria-hidden="true" />
              Waiting for your approval...
            </div>
            <div className="mero-cw-row">
              <button type="button" className="mero-cw-btn" onClick={flow.cancel}>
                Cancel
              </button>
              <button type="button" className="mero-cw-link" onClick={flow.reopen}>
                Open the window again
              </button>
            </div>
          </div>
        ) : step === 'names' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (trimmed.name && trimmed.self) setStep('review');
            }}
          >
            <h2 className="mero-cw-title">{text.title}</h2>
            <p className="mero-cw-sub">{text.subtitle}</p>
            <div className="mero-cw-field">
              <label htmlFor={ids[0]}>{text.nameLabel}</label>
              <input id={ids[0]} ref={first} value={name} placeholder={text.namePlaceholder} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="mero-cw-field">
              <label htmlFor={ids[1]}>{text.selfLabel}</label>
              <input id={ids[1]} value={selfName} placeholder={text.selfPlaceholder} onChange={(e) => setSelfName(e.target.value)} />
            </div>
            <button type="submit" className="mero-cw-btn mero-cw-btn--primary mero-cw-btn--full" disabled={!trimmed.name || !trimmed.self}>
              {text.next}
            </button>
          </form>
        ) : (
          <>
            {flow.error && (
              <p className="mero-cw-error" role="alert">
                {flow.error}
              </p>
            )}
            <WorkspaceReview
              client={client}
              cluster={cluster ?? nodeUrl ?? undefined}
              local={!cluster}
              release={release}
              creating={flow.phase === 'creating'}
              disabled={!flow.ready}
              onBack={() => setStep('names')}
              onCreate={() => flow.create(trimmed.name, trimmed.self)}
            />
          </>
        )}
      </div>
    </div>
  );
}
