import { describe, expect, test } from 'bun:test';

import { adminFlashStatus, adminRedirectWithStatus } from './admin-headers';

describe('admin flash status helpers', () => {
  test('reads the status query param from the request URL', () => {
    const request = new Request(
      'http://localhost/admin/content?status=Published.%20Live%20on%20the%20next%20page%20load.',
    );
    expect(adminFlashStatus(request)).toBe(
      'Published. Live on the next page load.',
    );
  });

  test('builds a redirect carrying an encoded status message', () => {
    const response = adminRedirectWithStatus(
      '/admin/content',
      'Published. Live on the next page load.',
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      '/admin/content?status=Published.%20Live%20on%20the%20next%20page%20load.',
    );
  });
});
