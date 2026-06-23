import { Schema } from 'effect';

import { root } from '../localization/translations';

/**
 * The leaf submit-tokens + message-key brand shared by the form schema
 * (`definition.ts`), the pricing dimension (`pricing.ts`), and the party section
 * (`party.ts`). They live in their own leaf module so the higher schemas can all
 * depend on them WITHOUT forming an import cycle: pricing keys its rules off
 * `FieldName`/`OptionValue`, `party` keys its chrome off `MessageKey`, and
 * `FormDefinition` carries both as siblings — a mutual `definition ↔ pricing` or
 * `definition ↔ party` import would otherwise hit a module-init temporal-dead-zone
 * on these brands. `definition.ts` re-exports all three so existing importers
 * (`decode`, `render`, the admin routes, the party-scope spike) are untouched.
 */

/** The closed set of valid translation keys, consulted at decode time. */
const TRANSLATION_KEYS: ReadonlySet<string> = new Set(Object.keys(root.en));

const messageKeyFilter = Schema.makeFilter<string>(
  (key) =>
    TRANSLATION_KEYS.has(key)
      ? undefined
      : `MessageKey must be a known TranslationKey; "${key}" is not in translations`,
  { title: 'MessageKey' },
);

/**
 * A form-validation error message: a real `TranslationKey`, validated at the
 * boundary against the live `translations` object (`derive-dont-sync`). The
 * generic decoder emits these keys verbatim on each failure path, so an off-list
 * key would render blank in `FieldErrors` — it is rejected here instead
 * (`make-impossible-states-unrepresentable`). The brand keeps the guarantee
 * load-bearing past the decoder; the generic decoder hands a decoded `MessageKey`
 * to `translate()` knowing the boundary already proved it is a real
 * `TranslationKey`.
 */
export const MessageKey = Schema.NonEmptyString.check(messageKeyFilter).pipe(
  Schema.brand('MessageKey'),
);
export type MessageKey = typeof MessageKey.Type;

/**
 * A field's submit-name — the key the browser POSTs and the path segment the
 * decoder addresses. Constrained to a JS-identifier-like token (`a-z`, `A-Z`,
 * `0-9`, `_`) so a hand-edited definition cannot smuggle a dotted path, a `[`, or
 * whitespace into a name the decoder interpolates into a form-data path
 * (`boundary-discipline`).
 */
export const FieldName = Schema.NonEmptyString.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/, { title: 'FieldName' }),
).pipe(Schema.brand('FieldName'));
export type FieldName = typeof FieldName.Type;

/**
 * A `literal` / `arrayOfLiteral` option value — the token submitted when an
 * option is chosen (e.g. `"attendee"`, `"t-shirt"`, `"male"`). A constrained
 * token (no whitespace, the URL-safe-ish set) so it is safe in a radio `value`
 * and an off-list value is a hard decode error in the generated codec.
 */
export const OptionValue = Schema.NonEmptyString.check(
  Schema.isPattern(/^[A-Za-z0-9_-]+$/, { title: 'OptionValue' }),
).pipe(Schema.brand('OptionValue'));
export type OptionValue = typeof OptionValue.Type;
