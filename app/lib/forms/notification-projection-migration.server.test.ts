import { describe, expect, it } from 'effect-bun-test';
import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/unstable/sql/SqlClient';

import { Database } from '../database.server';

import {
  defaultContactForm,
  defaultRegistrationForm,
  defaultVolunteerForm,
} from './defaults';
import { FormDefinition } from './definition';
import { migrate, ProjectionMappings } from './notification-projection-migration.server';

const encode = Schema.encodeSync(Schema.fromJsonString(FormDefinition));
const encodeDefinition = Schema.encodeSync(FormDefinition);
const decodeDefinition = Schema.decodeUnknownSync(FormDefinition);

const withoutNotification = (definition: FormDefinition) => {
  const { notification: _, ...historical } = encodeDefinition(definition);
  return historical;
};

describe('notification projection preflight migration', () => {
  it.effect('requires an explicit mapping for renamed historical fields, then applies it', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      const contactBase = withoutNotification(defaultContactForm);
      const historicalContact = decodeDefinition({
        ...contactBase,
        fields: contactBase.fields.map((field) => {
          switch (field.name) {
            case 'name':
              return { ...field, name: 'fullName' };
            case 'method':
              return { ...field, name: 'contactMethod' };
            case 'email':
              return { ...field, name: 'emailAddress' };
            case 'phone':
              return { ...field, name: 'phoneNumber' };
            case 'message':
              return { ...field, name: 'inquiry' };
            default:
              return field;
          }
        }),
        rules: contactBase.rules?.map((rule) => ({
          ...rule,
          when: 'contactMethod',
          target:
            rule.target === 'email' ? 'emailAddress' : 'phoneNumber',
        })),
      });
      const historical = {
        contact: historicalContact,
        volunteer: decodeDefinition(withoutNotification(defaultVolunteerForm)),
        registration: decodeDefinition(
          withoutNotification(defaultRegistrationForm),
        ),
      } as const;

      for (const [form, definition] of Object.entries(historical)) {
        const version = `legacy-${form}`;
        yield* sql`
          INSERT INTO forms (form_id, current_version_id)
          VALUES (${form}, NULL)
        `;
        yield* sql`
          INSERT INTO form_definition_versions (form_id, version_id, definition)
          VALUES (${form}, ${version}, ${encode(definition)}::jsonb)
        `;
        yield* sql`
          UPDATE forms SET current_version_id = ${version} WHERE form_id = ${form}
        `;
      }

      const emptyMappings = Schema.decodeUnknownSync(ProjectionMappings)({});
      const blocked = yield* migrate({ apply: false, mappings: emptyMappings });
      const contactEntry = blocked.entries.find(
        (entry) => entry.form === 'contact',
      );
      expect(contactEntry?.status).toBe('needs-mapping');
      expect(contactEntry?.issues.join('\n')).toContain('missing top-level field');

      const mappings = Schema.decodeUnknownSync(ProjectionMappings)({
        contact: {
          _tag: 'contact',
          name: 'fullName',
          method: 'contactMethod',
          email: 'emailAddress',
          phone: 'phoneNumber',
          message: 'inquiry',
        },
      });
      const preflight = yield* migrate({ apply: false, mappings });
      expect(preflight.entries.every((entry) => entry.status === 'ready')).toBe(
        true,
      );
      yield* migrate({ apply: true, mappings });

      const rows = yield* sql<{ definition: string }>`
        SELECT version.definition::text AS definition
        FROM forms AS form
        JOIN form_definition_versions AS version
          ON version.form_id = form.form_id
         AND version.version_id = form.current_version_id
        WHERE form.form_id = 'contact'
      `;
      const migrated = Schema.decodeUnknownSync(Schema.fromJsonString(FormDefinition))(
        rows[0]?.definition,
      );
      expect(migrated.notification).toEqual(mappings.contact);
    }).pipe(Effect.provide(Database.layerTest)),
  );
});
