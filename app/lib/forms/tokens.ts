import { Schema } from 'effect';

/**
 * The two leaf submit-tokens shared by the form schema (`definition.ts`) and the
 * pricing dimension (`pricing.ts`). They live in their own leaf module so the two
 * higher schemas can both depend on them WITHOUT forming an import cycle: pricing
 * keys its rules off `FieldName`/`OptionValue`, and `FormDefinition` carries the
 * `pricing` sibling — a mutual `definition ↔ pricing` import would otherwise hit a
 * module-init temporal-dead-zone on these brands. `definition.ts` re-exports both
 * so existing importers (`decode`, `render`, the admin routes) are untouched.
 */

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
