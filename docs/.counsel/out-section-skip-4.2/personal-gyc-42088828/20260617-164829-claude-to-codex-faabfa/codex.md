**blocking**:
- `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.test.tsx:344-348` gives false confidence for the `scheduleUrl` skip. It would still pass if the schedule button rendered unconditionally with `href={undefined}`, because React would omit the `href` and no `docs.google.com` string would appear. Since the plan says the schedule button is present-only at `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:150-154`, assert the rendered schedule label is gone too.

**concerns**:
- No production-code leak: commit `6b8d040` changes only `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.test.ts` and `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.test.tsx`.
- Interface discipline is good: render tests use `<ConferenceDetail conference={...} />` through `renderToString` at `/Users/cvr/Developer/personal/gyc/app/routes/($lang)+/conference-detail.test.tsx:90-127`, and schema tests use decode results at `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.test.ts:493-541`.
- The `unknown` fixture cast is legitimate test construction for invalid payloads, not a correctness dodge: `/Users/cvr/Developer/personal/gyc/app/lib/content/schema.test.ts:458-482`.
- 4.2 is not expected to delete subtract material; the plan puts that on the gating work, not tests: `/Users/cvr/Developer/personal/gyc/docs/registration-launch-plan.md:156-160`.
- I did not rerun the gate in this read-only sandbox; the prompt reports `265 pass / 0 fail`.

**verdict**: needs-work.