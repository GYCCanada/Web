import { adminMeta, adminSecurityHeaders } from '~/lib/admin-headers';

export const meta = adminMeta;

export const headers = adminSecurityHeaders;

/**
 * The authenticated admin landing page. Reaching it means the `_layout` guard
 * already validated the session cookie. The content editor itself lands in
 * sub-commit C5; for now this confirms the auth round-trip works.
 */
export default function AdminIndex() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-neutral-600">
        You are signed in. The content editor lands here next.
      </p>
    </div>
  );
}
