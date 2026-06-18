import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';

import { defaultTeamPage } from './defaults';
import { PAGE_IDS, PAGE_SPECS } from './registry';
import { DraftTeamPage, TeamPage } from './schema';

/**
 * The Page registry is the SINGLE registration point for an evergreen page (its
 * id, schema, draft boundary, and default). Adding `team` must surface it through
 * the one closed `PAGE_IDS` set (so the read path, the admin nav, and the editor
 * all derive it — `derive-dont-sync`) and wire it to the lax `DraftTeamPage` draft
 * boundary so the upload-first / fill-alt-second flow works (ADR 0006).
 */
describe('team page registration (ADR 0008)', () => {
  test('team is a registered PageId (8 pages total now)', () => {
    expect(PAGE_IDS).toContain('team');
    expect(PAGE_IDS.length).toBe(8);
  });

  test('PAGE_SPECS.team wires the strict + draft schemas and the default', () => {
    const spec = PAGE_SPECS.team;
    expect(spec.schema).toBe(TeamPage);
    expect(spec.draftSchema).toBe(DraftTeamPage);
    expect(spec.default).toBe(defaultTeamPage);
    // draft ≠ strict: team carries optional images whose alt may be unfilled.
    expect(spec.draftSchema).not.toBe(spec.schema);
  });

  test('the bundled defaultTeamPage decodes at module load (omitted images section-skip)', () => {
    // `defaults.ts` decodes through `decodeUnknownSync` at import, so a malformed
    // transcription would already have thrown; re-assert the decode-safe default
    // carries the chrome and NO image (the launch upload sets them).
    const reDecoded = Schema.decodeUnknownSync(TeamPage)(
      Schema.encodeUnknownSync(TeamPage)(defaultTeamPage),
    );
    expect(reDecoded.groupPhoto).toBeUndefined();
    expect(reDecoded.portrait).toBeUndefined();
    expect(reDecoded.subtitle.en.startsWith('We are GYC Canada')).toBe(true);
  });
});
