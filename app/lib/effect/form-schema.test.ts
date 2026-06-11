import { describe, expect, it } from 'bun:test';
import { Schema } from 'effect';

import { formatSchemaResult, parseSchema } from './form-schema';

describe('formatSchemaResult', () => {
  it('returns null when the payload decodes successfully', () => {
    const schema = Schema.Struct({ email: Schema.String });
    const result = parseSchema(schema, { email: 'ada@example.com' });

    expect(formatSchemaResult(result)).toBeNull();
  });

  it('buckets a missing required field under its field name', () => {
    const schema = Schema.Struct({
      email: Schema.String.check(
        Schema.isMinLength(1, { message: 'volunteer.form.email.required' }),
      ),
    });
    const result = parseSchema(schema, { email: '' });

    const formatted = formatSchemaResult(result);
    expect(formatted).not.toBeNull();
    expect(formatted?.formErrors).toEqual([]);
    expect(formatted?.fieldErrors?.['email']).toEqual([
      'volunteer.form.email.required',
    ]);
  });

  it('round-trips a nested array path as a conform field name (registrants[0].email)', () => {
    const schema = Schema.Struct({
      registrants: Schema.Array(
        Schema.Struct({
          email: Schema.String.check(
            Schema.isMinLength(1, { message: 'registration.email.required' }),
          ),
        }),
      ),
    });
    const result = parseSchema(schema, { registrants: [{ email: '' }] });

    const formatted = formatSchemaResult(result);
    expect(formatted).not.toBeNull();
    // Must be the bracket-notation conform name, never the dotted
    // `registrants.0.email`, or the error would never attach to the field.
    expect(formatted?.fieldErrors?.['registrants[0].email']).toEqual([
      'registration.email.required',
    ]);
    expect(formatted?.fieldErrors?.['registrants.0.email']).toBeUndefined();
  });

  it('buckets a top-level (path-less) issue as a form error', () => {
    // A non-struct schema produces an issue with an empty path.
    const schema = Schema.String.check(
      Schema.isMinLength(1, { message: 'form.required' }),
    );
    const result = parseSchema(schema, '');

    const formatted = formatSchemaResult(result);
    expect(formatted?.formErrors).toEqual(['form.required']);
    expect(formatted?.fieldErrors).toEqual({});
  });
});
