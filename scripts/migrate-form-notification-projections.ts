import { Cause, Effect, Exit, Schema } from 'effect';

import { Database } from '../app/lib/database.server';
import {
  migrate,
  ProjectionMappings,
  Rejected,
  type Report,
} from '../app/lib/forms/notification-projection-migration.server';

const help = `Usage: bun run migrate:form-notifications [options]

Preflight current relational Form definitions for the notification projection
contract. Canonical historical definitions are inferred automatically; renamed
historical fields require an explicit JSON mapping. The default is a dry run.

Options:
  --mapping <file>  JSON object with contact/volunteer/registration projections
  --apply           Publish repaired immutable versions atomically
  --dry-run         Inspect and report without writing (default)
  --json            Emit the report as JSON
  -h, --help        Show this help

Examples:
  bun run migrate:form-notifications --dry-run
  bun run migrate:form-notifications --mapping ./projection-map.json --dry-run
  bun run migrate:form-notifications --mapping ./projection-map.json --apply
`;

interface Options {
  readonly apply: boolean;
  readonly json: boolean;
  readonly mappingFile?: string;
}

const parseOptions = (args: readonly string[]): Options | string => {
  let apply = false;
  let dryRun = false;
  let json = false;
  let mappingFile: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
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
      case '--mapping':
        mappingFile = args[index + 1];
        if (mappingFile === undefined) return '--mapping requires a file path.';
        index += 1;
        break;
      default:
        return `Unknown option: ${arg}`;
    }
  }
  return apply && dryRun
    ? 'Choose either --apply or --dry-run, not both.'
    : { apply, json, mappingFile };
};

const readMappings = async (
  path: string | undefined,
): Promise<ProjectionMappings> => {
  const input = path === undefined ? {} : JSON.parse(await Bun.file(path).text());
  return Schema.decodeUnknownSync(ProjectionMappings)(input);
};

const writeReport = (report: Report, json: boolean): void => {
  if (json) {
    console.log(JSON.stringify(report));
    return;
  }
  for (const entry of report.entries) {
    console.log(
      `${entry.form}: ${entry.status} (${entry.currentVersion} -> ${entry.proposedVersion ?? 'unresolved'})`,
    );
    for (const issue of entry.issues) console.log(`  - ${issue}`);
  }
  if (!report.applied) {
    console.log('Dry run only. Resolve every needs-mapping entry, then rerun with --apply.');
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
    try {
      const mappings = await readMappings(options.mappingFile);
      const exit = await Effect.runPromiseExit(
        migrate({ apply: options.apply, mappings }).pipe(
          Effect.provide(Database.layer),
        ),
      );
      if (Exit.isSuccess(exit)) {
        writeReport(exit.value, options.json);
        if (exit.value.entries.some((entry) => entry.status === 'needs-mapping')) {
          process.exitCode = 1;
        }
      } else {
        const failure = Cause.findErrorOption(exit.cause);
        if (failure._tag === 'Some' && Rejected.is(failure.value)) {
          console.error('Error: notification projection migration rejected.');
          for (const issue of failure.value.issues) console.error(`- ${issue}`);
        } else {
          console.error(Cause.pretty(exit.cause));
        }
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(`Error: ${String(error)}\n\n${help}`);
      process.exitCode = 1;
    }
  }
}
