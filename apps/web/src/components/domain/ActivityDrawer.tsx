import { useState } from 'react';
import {
  ACTIVITY_STATUS_LABELS,
  COMMENT_KIND_LABELS,
  COMMENT_KIND_TONE,
  formatRevision,
  type ActivityComment,
  type DesignFile,
  type DrawingRevision,
  type WorkItem,
} from '@ciq/shared';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  useAddComment,
  useAddDesignFileComment,
  useAddDesignFileRevision,
  useAddRevision,
} from '@/lib/queries';
import { formatIso, formatTimestamp } from '@/lib/format';
import { Avatar, Badge, Button, Modal, useToast } from '@/components/ui';
import { IconArrowUpRight, IconCheck, IconDrawing, IconPlus } from '@/components/ui/Icons';

/**
 * The two things a drawer can be opened on.
 *
 * A drawing file and a work item are different rows with different lifecycles,
 * but their comment thread and revision history are identical — so the drawer
 * takes whichever it is given and only the mutation hooks differ.
 */
export type DrawerSubject =
  { kind: 'workItem'; item: WorkItem } | { kind: 'designFile'; file: DesignFile };

interface Subject {
  id: string;
  name: string;
  currentRevision: number;
  revisions: DrawingRevision[];
  comments: ActivityComment[];
  issued: boolean;
  phase?: { name: string; colour: string };
}

function normalise(subject: DrawerSubject): Subject {
  if (subject.kind === 'workItem') {
    const i = subject.item;
    return {
      id: i.id,
      name: i.name,
      currentRevision: i.currentRevision,
      revisions: i.revisions,
      comments: i.comments,
      issued: i.designComplete,
      phase: { name: i.phase.name, colour: i.phase.colour },
    };
  }
  const f = subject.file;
  return {
    id: f.id,
    name: f.name,
    currentRevision: f.currentRevision,
    revisions: f.revisions,
    comments: f.comments,
    issued: f.isComplete,
  };
}

/**
 * Everything said and issued about one activity.
 *
 * Comments and revisions are the same panel because they are the same
 * conversation: a reissued drawing is usually the answer to a comment about the
 * previous one, and splitting them into two screens would mean reading the
 * history twice to reconstruct one thread.
 */
export function ActivityDrawer({
  projectId,
  subject,
  onClose,
}: {
  projectId: string;
  subject: DrawerSubject;
  onClose: () => void;
}) {
  const { can, settings } = useAuth();
  const toast = useToast();

  // Both pairs are created unconditionally — hooks cannot be called
  // conditionally — and only the matching pair is used.
  const commentWorkItem = useAddComment(projectId);
  const reviseWorkItem = useAddRevision(projectId);
  const commentDrawing = useAddDesignFileComment(projectId);
  const reviseDrawing = useAddDesignFileRevision(projectId);

  const isWorkItem = subject.kind === 'workItem';
  const addComment = isWorkItem ? commentWorkItem : commentDrawing;
  const addRevision = isWorkItem ? reviseWorkItem : reviseDrawing;

  const item = normalise(subject);

  const [draft, setDraft] = useState('');
  const [revising, setRevising] = useState(false);
  const [revNotes, setRevNotes] = useState('');

  const canComment = can('activity:update');
  const canRevise = can('drawing:update');

  return (
    <Modal
      title={item.name}
      onClose={onClose}
      size="lg"
      description={
        <span className="row gap-2 wrap">
          {item.phase && (
            <>
              <span className="phase-swatch" style={{ background: item.phase.colour }} />
              {item.phase.name}
            </>
          )}
          <span className="rev-chip" data-issued={item.currentRevision > 0}>
            <IconDrawing size={11} />
            {formatRevision(item.currentRevision)}
          </span>
          <Badge tone={item.issued ? 'success' : 'neutral'}>
            {item.issued ? 'Issued' : 'Not issued'}
          </Badge>
        </span>
      }
    >
      {/* --- Revisions ------------------------------------------------------ */}
      <section>
        <div className="row-between" style={{ marginBottom: 'var(--space-3)' }}>
          <span className="eyebrow">Revisions</span>
          {canRevise && !revising && (
            <Button size="sm" onClick={() => setRevising(true)}>
              <IconPlus size={13} />
              New revision
            </Button>
          )}
        </div>

        {revising && (
          <form
            className="stack gap-2"
            style={{ marginBottom: 'var(--space-4)' }}
            onSubmit={(event) => {
              event.preventDefault();
              addRevision.mutate(
                { id: item.id, notes: revNotes.trim() || undefined },
                {
                  onSuccess: (updated) => {
                    setRevising(false);
                    setRevNotes('');
                    const rev = formatRevision(updated.currentRevision);
                    toast.success(`${rev} issued`, `${item.name} is now at ${rev}.`);
                  },
                  onError: (error) =>
                    toast.error(
                      'Could not issue the revision',
                      error instanceof ApiRequestError ? error.message : undefined,
                    ),
                },
              );
            }}
          >
            <label className="visually-hidden" htmlFor="rev-notes">
              What changed in this revision
            </label>
            <textarea
              id="rev-notes"
              className="textarea"
              rows={3}
              autoFocus
              placeholder="What changed? e.g. door opening moved 300mm, RCP coordinated with HVAC"
              value={revNotes}
              onChange={(event) => setRevNotes(event.target.value)}
            />
            <div className="row gap-2">
              <Button type="submit" variant="primary" size="sm" loading={addRevision.isPending}>
                Issue {formatRevision(item.currentRevision + 1)}
              </Button>
              <Button size="sm" type="button" onClick={() => setRevising(false)}>
                Cancel
              </Button>
            </div>
            <p className="text-2xs text-tertiary">
              Issuing a revision also marks this as issued — a revision that existed while the item
              still read &ldquo;not issued&rdquo; would contradict itself.
            </p>
          </form>
        )}

        {item.revisions.length === 0 ? (
          <p className="comment-empty">No revisions issued yet. The first one becomes R1.</p>
        ) : (
          <ul className="rev-list">
            {item.revisions.map((rev) => (
              <li key={rev.id}>
                <span className="rev-chip" data-issued="true">
                  {formatRevision(rev.revision)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="text-2xs text-tertiary">
                    {formatIso(rev.issuedDate, settings.locale)}
                    {rev.issuedBy && ` · ${rev.issuedBy.name}`}
                  </div>
                  {rev.notes && <p className="comment-text">{rev.notes}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Comments ------------------------------------------------------- */}
      <section style={{ marginTop: 'var(--space-5)' }}>
        <span className="eyebrow">Comments</span>

        {canComment && (
          <form
            className="stack gap-2"
            style={{ margin: 'var(--space-3) 0 var(--space-4)' }}
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft.trim()) return;
              addComment.mutate(
                { id: item.id, body: draft.trim() },
                {
                  onSuccess: () => setDraft(''),
                  onError: (error) =>
                    toast.error(
                      'Could not post that comment',
                      error instanceof ApiRequestError ? error.message : undefined,
                    ),
                },
              );
            }}
          >
            <label className="visually-hidden" htmlFor="comment-body">
              Add a comment
            </label>
            <textarea
              id="comment-body"
              className="textarea"
              rows={2}
              placeholder="Add a comment…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={!draft.trim()}
              loading={addComment.isPending}
              style={{ alignSelf: 'flex-start' }}
            >
              Comment
            </Button>
          </form>
        )}

        {item.comments.length === 0 ? (
          <p className="comment-empty">
            Nothing yet. Notes left when approving a drawing or changing a status appear here too.
          </p>
        ) : (
          <ul className="comment-list">
            {item.comments.map((comment) => (
              <li key={comment.id} className="comment">
                <Avatar name={comment.author?.name ?? '?'} size="sm" />
                <div className="comment-body">
                  <div className="comment-head">
                    <span className="comment-author">{comment.author?.name ?? 'Removed user'}</span>
                    {comment.kind !== 'NOTE' && (
                      <Badge tone={COMMENT_KIND_TONE[comment.kind]}>
                        {COMMENT_KIND_LABELS[comment.kind]}
                      </Badge>
                    )}
                    <span className="comment-time">
                      {formatTimestamp(comment.createdAt, settings.locale)}
                    </span>
                  </div>

                  {/* The transition the comment explains, when it explains one. */}
                  {comment.statusFrom && comment.statusTo && (
                    <div className="comment-transition">
                      {ACTIVITY_STATUS_LABELS[comment.statusFrom]}
                      <IconArrowUpRight size={10} />
                      {ACTIVITY_STATUS_LABELS[comment.statusTo]}
                    </div>
                  )}

                  <p className="comment-text">{comment.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  );
}

/**
 * Asks for a note while confirming a change.
 *
 * The comment is optional. Forcing one would produce a column of "done" and
 * "ok" — a required field people cannot skip is a field they defeat — so the
 * prompt is offered at the moment it is cheapest to answer and left optional.
 */
export function CommentPrompt({
  title,
  message,
  confirmLabel,
  loading,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  loading?: boolean;
  onConfirm: (comment: string | undefined) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState('');

  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            loading={loading}
            onClick={() => onConfirm(comment.trim() || undefined)}
          >
            <IconCheck size={14} />
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-secondary">{message}</p>
      <div className="field">
        <label className="label" htmlFor="change-comment">
          Add a note <span className="text-tertiary">(optional)</span>
        </label>
        <textarea
          id="change-comment"
          className="textarea"
          rows={3}
          autoFocus
          placeholder="Why now? Anything the next person should know?"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <p className="text-2xs text-tertiary">
          Stored against this change, so the reason stays attached to it.
        </p>
      </div>
    </Modal>
  );
}
