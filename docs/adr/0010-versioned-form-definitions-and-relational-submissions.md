# Versioned Form definitions and relational Submissions

**Status:** accepted
**Date:** 2026-07-16
**Supersedes:** ADR 0007's bucket-Submission decision and ADR 0008's per-form and
per-Submission object-storage decisions. ADR 0007's structural form builder and ADR 0008's
per-page/site object storage remain accepted.

## Context

A Submission is currently validated and encoded against whichever mutable Form definition
is current when it is written. The stored envelope does not identify that definition. Once
an administrator changes fields or validation, a future reader cannot reliably reconstruct
the schema that accepted an older Submission.

Object storage gives each Submission durable bytes, but it does not provide the relational
constraints, transactions, precise ordering, or query model a first-party registrar needs.
Multi-registrant registration currently writes records sequentially, so a partial failure can
persist only part of one registration. Its retry identity is derived from submitted content;
two intentional registrations with identical values can therefore be mistaken for one retry.

## Decision

PostgreSQL is the system of record for Form definitions and Submissions. Page, conference,
team, translation, and image content remain in object storage under ADR 0008.

Publishing a Form definition creates an immutable **Form definition version**. A stable Form
identifier points to its current published version; publishing never mutates a version that
may already be referenced. The version records the complete definition needed by the generic
decoder, and is assigned a stable identifier derived from its canonical encoded content.

Every Submission stores:

- its stable Submission identifier and Form identifier;
- the exact Form definition version that validated it;
- a timezone-aware submission timestamp;
- the decoded payload encoded under that immutable version; and
- an explicit caller-supplied idempotency token guarded by a unique constraint.

The write boundary loads the current published version, validates the input against it, and
inserts the version reference and payload in one database transaction. A multi-registrant
registration inserts the complete registration group atomically. Retrying with the same
idempotency token returns the already-committed result; equal payloads with different tokens
remain distinct submissions. Email is dispatched only after commit and remains a notification
of the durable record, never the record itself.

Existing object-storage records move through the offline
`bun run migrate:legacy-forms` command. It is a validation-only dry run unless
`--apply` is supplied. The command validates every published legacy Form and
Submission against the same definition-derived codecs as the application, then
imports the complete set in one database transaction. Draft Form objects are
reported but intentionally not published. Legacy Submission identifiers are
deterministically namespaced by Form on import because the old object-key model
only guaranteed uniqueness within a Form prefix, while the relational identifier
is globally unique. The original identifier remains recoverable from the
`legacy:<form>:<id>` idempotency token.

The migration is safe to rerun and refuses to replace a current definition that
has advanced beyond either the bundled definition or the legacy definition being
imported. Operators run and inspect `--dry-run --json`, back up both stores, run
`--apply --json`, then retain the bucket objects until relational backup and
registrar reads have been verified.

## Rejected alternatives

- **Continue writing bucket objects against the current definition.** Historical decoding
  remains dependent on mutable state, and grouped writes cannot be atomic.
- **Copy the complete definition into every Submission.** This preserves history but
  duplicates definitions, weakens referential integrity, and makes version-level queries
  expensive.
- **Use the payload hash as the retry key.** Equal data is not proof of the same user intent.
- **Keep definitions in object storage and only Submissions in PostgreSQL.** Publishing a
  definition and establishing the version referenced by new writes would cross two systems
  without a single transactional boundary.

## Consequences

- Historical Submissions remain decodable after a Form definition changes.
- Registration groups are all-or-nothing, and explicit retry identity cannot collapse two
  intentional equal submissions.
- Registrar reads gain indexed ordering, filtering, constraints, and stable version joins.
- The application gains a PostgreSQL dependency, migrations, backup/restore responsibilities,
  and an explicit dry-run-first migration command for existing Form objects and Submission
  objects.
- Form publishing and Submission persistence move behind one relational module; public form
  rendering continues to consume the current published Form definition through the existing
  application boundary.
