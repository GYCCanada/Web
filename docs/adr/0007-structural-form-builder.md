# Structural form-builder with equivalence-harness migration

**Status:** accepted

## Context

The three site forms (contact, volunteer, registration) are hand-tuned Effect Schema
modules — notably `registration-schema.ts` (~350 lines: a 2-way discriminated union with
~10 cross-field validators, checkbox-boolean codecs, and error messages that must each
emit a real `TranslationKey` that `FieldErrors` renders). The CMS expansion calls for
forms to become editable *data* ("the form itself is part of the schema"). Registration is
also the end-of-week launch deliverable, so a careless migration risks the registration
decode path silently dropping or rejecting a valid submission.

## Decision

Replace the three hand-tuned form schemas with **data-driven Form definitions** (fields,
bilingual labels/placeholders, validation) rendered by a generic renderer and decoded by a
generic server-side decoder. The field *kinds* are a **closed, specified set** (~8:
required/optional text, email, URL, literal/radio, checkbox-boolean, array-of-literal,
nested group) plus discriminated-union + cross-field rules — a Form definition cannot
invent an arbitrary field type (`make-impossible-states-unrepresentable`).

The migration is made provably behaviour-preserving by a **spec doc + tests authored
alongside the builder, plus an old-vs-new equivalence harness**: the old code schema is
kept in the tree as an oracle while a test feeds a payload corpus (valid + every invalid
variant) through both old and new and asserts identical decoded output *and* identical
emitted `TranslationKey` sets. The oracle is removed once registration is fully migrated.

Submissions persist as bucket objects (`submissions/<form>/<id>.json`) + email
notification, seeding a possible future first-party registrar. For 2026 the **live
registration channel is RegFox** (the Conference's `registrationUrl`); the on-site form is
built and proven but not load-bearing for the launch, so a mid-flight builder cannot block
Friday.

## Consequences

- The registration pipeline's correctness is gated by the equivalence harness, not by a
  from-spec rewrite alone.
- Form copy (labels, placeholders, intro, button, banners) becomes CMS-editable; the field
  *graph* is editable only within the closed kind-set.
- A later first-party registrar reads the registration Submission log.
