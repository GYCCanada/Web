import { Cause, Clock, Effect } from 'effect';

import { adminRedirectWithStatus } from '../admin-headers';
import {
  DraftEditor,
  type ContentScope,
  type IssueError,
} from './draft-editor.server';
import {
  imageUploadTarget,
  isAcceptedImageType,
  uploadedImageKey,
  type Json,
} from './admin-form';
import { prepareImage } from './image-optimize.server';
import { collectListOps } from './list-edit';
import { Storage } from '../storage.server';

export interface AdminEditRequest {
  readonly scope: ContentScope;
  readonly form: FormData;
  readonly redirectTo: string;
  readonly buildOverride: (form: FormData) => Json;
}

/** Map a `DraftEditor` validation/storage failure to the admin JSON contract. */
const issueResponse = (error: IssueError): Response =>
  Response.json(
    { ok: false, error: error.message, issues: error.issues },
    { status: error.status },
  );

/**
 * Execute the shared admin edit protocol after a route has authenticated and
 * selected a typed content scope. This module owns intent dispatch and the
 * upload/list/draft/publish ordering; callers supply only their form-to-document
 * projection and redirect location.
 */
export const handleAdminEditRequest = Effect.fn(
  'AdminEditRequest.handle',
)(function* ({ scope, form, redirectTo, buildOverride }: AdminEditRequest) {
  const editor = yield* DraftEditor.Service;
  const storage = yield* Storage.Service;
  const intent = String(form.get('intent') ?? 'save-draft');

  const uploadTarget = imageUploadTarget(intent);
  if (uploadTarget !== null) {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return Response.json(
        { ok: false, error: 'Choose an image before uploading.', issues: [] },
        { status: 400 },
      );
    }
    if (!isAcceptedImageType(file.type)) {
      return Response.json(
        {
          ok: false,
          error: 'Upload a JPEG, PNG, WebP, GIF, or AVIF image.',
          issues: [],
        },
        { status: 400 },
      );
    }

    const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()));
    const prepared = yield* prepareImage(bytes, file.type);
    const now = yield* Clock.currentTimeMillis;
    const key = uploadedImageKey(uploadTarget, prepared.contentType, now);
    const putExit = yield* Effect.exit(
      storage.put(key, prepared.bytes, prepared.contentType),
    );
    if (putExit._tag === 'Failure') {
      return Response.json(
        {
          ok: false,
          error:
            'Image upload failed — is the bucket configured? ' +
            Cause.pretty(putExit.cause),
          issues: [],
        },
        { status: 502 },
      );
    }

    const applied = yield* editor
      .applyImageUpload(scope, uploadTarget, key)
      .pipe(Effect.result);
    if (applied._tag === 'Failure') {
      const compensated = yield* storage.delete(key).pipe(Effect.result);
      if (compensated._tag === 'Failure') {
        return Response.json(
          {
            ok: false,
            error:
              'The image reference failed and the uploaded object could not be cleaned up. ' +
              String(compensated.failure),
            issues: applied.failure.issues,
          },
          { status: 502 },
        );
      }
      return issueResponse(applied.failure);
    }
    return adminRedirectWithStatus(redirectTo, `Image uploaded: ${key}`);
  }

  if (intent === 'list-op') {
    const ops = collectListOps(form.entries());
    if (ops.length === 0) {
      return Response.json(
        { ok: false, error: 'No list change to apply.', issues: [] },
        { status: 400 },
      );
    }
    const applied = yield* editor.applyListOps(scope, ops).pipe(Effect.result);
    if (applied._tag === 'Failure') return issueResponse(applied.failure);
    return Response.json({ ok: true as const });
  }

  if (intent !== 'save-draft' && intent !== 'publish') {
    return Response.json(
      { ok: false, error: 'Unknown submit intent.', issues: [] },
      { status: 400 },
    );
  }

  const edited = yield* editor
    .editDocument(scope, buildOverride(form))
    .pipe(Effect.result);
  if (edited._tag === 'Failure') return issueResponse(edited.failure);
  if (intent === 'save-draft') {
    return adminRedirectWithStatus(redirectTo, 'Draft saved.');
  }

  const published = yield* editor.publish(scope).pipe(Effect.result);
  if (published._tag === 'Failure') return issueResponse(published.failure);
  return adminRedirectWithStatus(
    redirectTo,
    'Published. Live on the next page load.',
  );
});
