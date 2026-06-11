import { Link } from 'react-router';

import { adminMeta, adminSecurityHeaders } from '~/lib/admin-headers';

export const meta = adminMeta;

export const headers = adminSecurityHeaders;

/**
 * The authenticated admin landing page. Reaching it means the `_layout` guard
 * already validated the session cookie. Links into the content editor (C5).
 */
export default function AdminIndex() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-neutral-600">You are signed in.</p>
      <Link
        to="/admin/content"
        className="inline-flex min-h-11 items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
      >
        Edit site content
      </Link>
    </div>
  );
}
