# Deep adversarial review — WHOLE PR: `reg-launch/conference-detail` (Branch 3)

You are Codex doing a **holistic, adversarial** `--deep` review of an entire stacked-PR
branch, assembled from all four of its sub-commits (3.1 → 3.4). This is NOT a per-commit
review — judge the branch as one reviewable PR a human will merge.

## What this PR is

Branch 3 of a 7-branch stacked PR program ("Registration Launch + CMS Expansion") for the
GYC Canada site (React Router 7 + Effect v4 + Effect Schema, content stored as JSON in a
bucket, decoded at a `Content` boundary). This branch is the **launch headline**: collapse
THREE forked ~620-line conference detail pages (`/2024`, `/2025`, `/2026`) into one
data-driven `ConferenceDetail` module, grow the `Conference` schema with optional
detail-page data (registration/schedule/map URLs + hotels), project those `Option`s to
`string | undefined` at the boundary, and add the 2026 RegFox register button.

It builds on Branch 1 (`DraftEditor`) and Branch 2 (`ListEdit` + `ListItemId` id-keyed merge
+ read-path id-backfill). Its diff base is the parent branch `list-edit`.

## Read these for full context

1. **The full synthesized plan**: `docs/registration-launch-plan.md` — read the whole thing
   to understand the stack, the principles, and how Branch 3 relates to Branches 2 and 4.
2. **The branch's PR-plan section**: in that plan, the section titled
   **"Branch 3 — `reg-launch/conference-detail` (Candidate 1, settled #4)"** — this is the
   contract this PR must fully realize. Pay attention to its sub-commit list (3.1–3.4),
   the schema-growth requirements (`OptionFromOptionalKey`, the per-component URL XSS
   brands), the boundary projection convention, the "collapse ALL THREE forks incl. 2025"
   blocker, the home-route divergence concern, and the test-surface + deletion demands.
3. **The settled decisions / non-goals**: `docs/registration-launch-brief.md` — especially
   settled #4 (standardize detail page), #9 (2026 = RegFox), and the non-goals (section-skip
   is **Branch 4**, not this branch; on-site registration is not the Friday channel).
4. **The whole-PR diff**: `docs/.counsel/conference-detail-WHOLE.diff` — the assembled diff of
   all four sub-commits vs the parent `list-edit` branch (counsel-artifact files excluded;
   this is pure code + tests).

## What I need: a holistic, adversarial verdict

Judge the **assembled** PR, not individual commits. Be adversarial — assume there is a
defect and try to find it. Specifically:

### 1. Does the PR fully realize its plan section?
- **Interface depth** (`small-interface-deep-implementation`): is `ConferenceDetail` a
  genuinely deep module (one prop: the boundary `Conference`), with every section + the
  framer-motion card machinery hidden inside? Are the three loaders truly thin pass-throughs?
- **ALL deletions made** (`subtract-before-you-add`): the plan demands the ~600 lines of
  forked JSX in **each of all three** forks (`2024`, `2025`, `2026`) be deleted and the forks
  collapse to ~15-line loaders. Confirm NONE of the three retains a forked detail page, dead
  JSX comment blocks, or dormant `eslint-disable no-unused-vars` scaffolding. Is any forked
  code left half-migrated?
- **Complete test surface**: does the PR test what the plan demands — a fully-populated
  conference renders all sections; the RegFox button uses `registrationUrl`; the iframe uses
  `mapEmbedUrl`; `ExternalHttpsUrl` rejects `http:`/`javascript:`/`data:`/credentialed URLs;
  `GoogleMapsEmbedUrl` rejects non-`www.google.com` hosts AND `https://www.google.com/anything`
  (the path-not-origin case); the boundary `Option → string|undefined` projection for
  2024/2025/2026?
- **No behavior regression**: the plan's launch-critical proof is "byte-identical 2024 render
  vs pre-branch (the forked file was the spec)". Scrutinize whether the extracted
  `ConferenceDetail` preserves the 2024 fork's exact rendering — any subtle divergence (a
  dropped attribute, a changed `target`, a lost class, a different `key`) is a regression.

### 2. Does it cohere across its sub-commits?
- No half-migrated caller: every `/YYYY` route renders the shared module; no fourth code path
  still renders the old forked sections.
- No dead code left between slices: e.g. an exported symbol from 3.1/3.2 that 3.3/3.4 no
  longer use; a `toHotel`/projection helper that's unused; orphaned imports.
- The **home-route audit** (plan's codex→claude CONCERN): the plan demands "no fourth
  divergence point survives this branch". The home `_index.tsx` renders the Current
  Conference. Verify the audit's conclusion is sound: does home render only a hero teaser
  (acceptably left as-is), or does it duplicate `ConferenceDetail` sections (which the plan
  says must route through the shared module)? Is leaving home's own `Hero`/`MobileHero`/
  `DesktopHero` a defensible "teaser, not a fork" call, or an unaddressed fourth divergence?

### 3. Scrutinize the riskiest parts hardest

- **(B3, this branch's core) `Option → string | undefined` projection**: `toConference`
  uses `Option.getOrUndefined` for the three URLs and maps `hotels` per-locale. Is this
  projection correct and total? Does React ever risk seeing an `Option`? Is `undefined`
  vs `''` handled so Branch 4's section-skip discriminator (`!== undefined`, `.length > 0`)
  will be sound? Is the boundary interface (`Conference` in `content.server.ts`) grown
  consistently (`registrationUrl: string | undefined` etc.)?
- **The per-component URL XSS brands** (`ExternalHttpsUrl`, `GoogleMapsEmbedUrl`): these are
  the security-load-bearing part. The filters **parse** the URL (`new URL`) and check
  `protocol === 'https:'`, reject embedded credentials, and for maps require
  `host === 'www.google.com'` AND `pathname.startsWith('/maps/embed')`. Adversarially probe:
  can a malicious `mapEmbedUrl`/`registrationUrl` slip through? Consider host-spoofing
  (`www.google.com.evil.com`, `www.google.com@evil.com`), `pathname` tricks
  (`/maps/embed/../../evil`), backslashes, unicode/punycode hosts, `\t`/newline injection,
  protocol-relative URLs, `https:` with a userinfo that `new URL` parses oddly. Is the brand
  a watertight boundary, or is there a bypass? Is `https://www.google.com/maps/embedFOO`
  (a path that *starts with* `/maps/embed` but isn't the embed endpoint) a real risk worth
  tightening, or acceptable?
- **(B2 carryover) id-backfill for the new required `hotels`**: Branch 3.1 adds a **required**
  `hotels: IdListArray(Hotel)` to `Conference`. A `content/site.json` published before this
  branch has NO `hotels` key, so a naive required field would FAIL decode on the next read and
  silently fall back to bundled defaults — discarding live CMS content on deploy. The fix
  extends `id-backfill.ts` to supply `hotels: []` to any conference lacking the key (and
  backfill ids on present hotels). Scrutinize this hardest: is the backfill correct,
  idempotent, and does it actually prevent the live-document decode break? Does the test
  (`a pre-3.1 document (no hotels key) decodes after backfill`, asserting `decodes(pre31)`
  is `false` WITHOUT and `true` WITH backfill) genuinely prove the hazard is closed? Is there
  any OTHER newly-required field added this branch that lacks the same backfill safety?
  (The URL fields are `OptionFromOptionalKey` so absence → `Option.none()` — confirm that
  reasoning holds and no URL field is accidentally required.)

### 4. Principles audit
Flag any violation of: `make-impossible-states-unrepresentable`, `boundary-discipline`,
`derive-dont-sync`, `subtract-before-you-add`, `migrate-callers-then-delete-legacy-apis`,
`correctness-over-pragmatism` (NO cast-to-any, NO stubs, NO commenting-out). Note: section-skip
gating is deferred to Branch 4 **by design** — do NOT flag the absence of section-skip here as
a gap (the component currently flows absent data through: an absent `href` omits the attribute,
empty `hotels` maps to nothing). Likewise on-site registration persistence is Branches 6–7, not
this branch.

## Output format

Give me:
- A **verdict**: ship / ship-with-fixes / block.
- **Blocking issues** (must-fix before merge): plan deviations, incomplete deletions, security
  bypasses in the URL brands, a behavior regression vs the 2024 spec, a broken id-backfill, any
  half-migrated caller or dead code. For each, cite the file + line and explain the concrete
  failure mode.
- **Non-blocking concerns**: lower-priority polish, test-coverage gaps, naming.
- Be specific and cite receipts (file:line). If you believe something is correct, say so
  briefly rather than padding. Prioritize finding the ONE thing that's actually wrong over
  enumerating things that are fine.
