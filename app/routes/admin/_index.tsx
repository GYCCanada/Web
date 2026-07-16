import { Link } from 'react-router';

import { adminMeta, adminSecurityHeaders } from '~/lib/admin-headers';
import { PAGE_IDS, PAGE_LABELS } from '~/lib/content/pages/registry';
import { FORM_IDS, type FormId } from '~/lib/forms/definition';

export const meta = adminMeta;

export const headers = adminSecurityHeaders;

const FORM_LABELS = {
  contact: 'Contact',
  volunteer: 'Volunteer',
  registration: 'Registration',
} as const satisfies Record<FormId, string>;

/**
 * The authenticated admin landing page. Reaching it means the `_layout` guard
 * already validated the session cookie. Links into the site-content editor (C5)
 * and each per-Page editor (registration-launch Branch 5.5): the page set is
 * driven by `PAGE_IDS` (the same closed registry the editor + read path use), so
 * adding a Page surfaces its editor link automatically (`derive-dont-sync`).
 */
export default function AdminIndex() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-neutral-600">You are signed in.</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Conference &amp; team
        </h2>
        <Link
          to="/admin/content"
          className="inline-flex min-h-11 items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
        >
          Edit site content
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Registration channel
        </h2>
        <Link
          to="/admin/registration"
          className="inline-flex min-h-11 items-center rounded-md bg-red-700 px-4 text-sm font-medium text-white transition-colors hover:bg-red-800"
        >
          Manage registration launch
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Forms
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {FORM_IDS.map((form) => (
            <li key={form}>
              <Link
                to={`/admin/forms/${form}`}
                className="flex min-h-11 items-center justify-between rounded-md border border-neutral-300 px-4 text-sm font-medium transition-colors hover:bg-neutral-100"
              >
                <span>{FORM_LABELS[form]}</span>
                <span aria-hidden className="text-neutral-400">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Pages
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {PAGE_IDS.map((page) => (
            <li key={page}>
              <Link
                to={`/admin/pages/${page}`}
                className="flex min-h-11 items-center justify-between rounded-md border border-neutral-300 px-4 text-sm font-medium transition-colors hover:bg-neutral-100"
              >
                <span>{PAGE_LABELS[page]}</span>
                <span aria-hidden className="text-neutral-400">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
