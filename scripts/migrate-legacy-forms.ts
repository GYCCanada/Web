import { Cause, Effect, Exit, Layer } from 'effect';

import { Database } from '../app/lib/database.server';
import { Env } from '../app/lib/env.server';
import {
  migrate,
  Rejected,
  type Report,
} from '../app/lib/forms/legacy-migration.server';
import { Storage } from '../app/lib/storage.server';

const help = `Usage: bun run migrate:legacy-forms [options]

Validate legacy forms/*.json and submissions/**/*.json objects, then import
them into the versioned relational Form store. The default is a dry run.

Options:
  --apply       Apply the validated migration atomically
  --dry-run     Validate and report without writing (default)
  --json        Emit the report as JSON
  -h, --help    Show this help

Examples:
  bun run migrate:legacy-forms
  bun run migrate:legacy-forms --dry-run --json
  bun run migrate:legacy-forms --apply --json
`;

interface Options {
  readonly apply: boolean;
  readonly json: boolean;
}

const parseOptions = (args: readonly string[]): Options | string => {
  let apply = false;
  let dryRun = false;
  let json = false;
  for (const arg of args) {
    switch (arg) {
      case '--apply':
        apply = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--json':
        json = true;
        break;
      default:
        return `Unknown option: ${arg}`;
    }
  }
  return apply && dryRun
    ? 'Choose either --apply or --dry-run, not both.'
    : { apply, json };
};

const writeReport = (report: Report, json: boolean): void => {
  if (json) {
    console.log(JSON.stringify(report));
    return;
  }
  console.log(report.applied ? 'Legacy Form migration applied.' : 'Dry run complete; no changes made.');
  console.log(`definitions: ${report.definitions}`);
  console.log(`legacy_definition_objects: ${report.legacyDefinitionObjects}`);
  console.log(`submissions: ${report.submissions}`);
  console.log(`already_imported_submissions: ${report.alreadyImportedSubmissions}`);
  console.log(`ignored_draft_objects: ${report.ignoredDraftObjects}`);
  if (!report.applied) {
    console.log('Run with --apply to commit this migration.');
  }
};

const args = Bun.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(help);
} else {
  const options = parseOptions(args);
  if (typeof options === 'string') {
    console.error(`Error: ${options}\n\n${help}`);
    process.exitCode = 2;
  } else {
    const storageLayer = Storage.layer.pipe(Layer.provide(Env.layer));
    const runtimeLayer = Layer.merge(storageLayer, Database.layer);
    const exit = await Effect.runPromiseExit(
      migrate({ apply: options.apply }).pipe(Effect.provide(runtimeLayer)),
    );
    if (Exit.isSuccess(exit)) {
      writeReport(exit.value, options.json);
    } else {
      const failure = Cause.findErrorOption(exit.cause);
      if (failure._tag === 'Some' && Rejected.is(failure.value)) {
        console.error('Error: Legacy Form migration validation failed.');
        for (const issue of failure.value.issues) console.error(`- ${issue}`);
        console.error('Fix the listed legacy objects, then rerun the dry run.');
      } else {
        console.error(`Error: Legacy Form migration failed.\n${Cause.pretty(exit.cause)}`);
      }
      process.exitCode = 1;
    }
  }
}
