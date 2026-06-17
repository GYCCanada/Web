import * as React from 'react';

import type { RichTextRun } from '~/lib/content/pages/project';

import { ExternalLink } from './external-link';

/**
 * Render a projected `RichText` run sequence (`~/lib/content/pages/project`) to
 * DOM. A `RichText` value is a CLOSED token model (text / bold / italic / link) —
 * never arbitrary HTML — so this renderer is the only place page copy becomes markup,
 * and every link `href` already crossed the `ExternalHttpsUrl` / `MailtoHref`
 * brand on decode (`make-impossible-states-unrepresentable`, `boundary-discipline`).
 *
 * Paragraph breaks: the legacy flat-key copy used literal `<br/><br/>` between
 * paragraphs (e.g. the FAQ answers). That carries through the token model as a
 * `\n\n` inside a `text` / `bold` run; `renderText` turns each `\n\n` back into a
 * `<br/><br/>` pair so the rendered output is identical to the pre-migration
 * routes (`derive-dont-sync` — the break is data in the copy, not re-encoded JSX).
 */

const renderText = (value: string): React.ReactNode =>
  value.split('\n\n').map((part, index, parts) => (
    <React.Fragment key={index}>
      {part}
      {index < parts.length - 1 ? (
        <>
          <br />
          <br />
        </>
      ) : null}
    </React.Fragment>
  ));

export function RichText({ runs }: { runs: readonly RichTextRun[] }) {
  return (
    <>
      {runs.map((run, index) => {
        switch (run.kind) {
          case 'text':
            return (
              <React.Fragment key={index}>
                {renderText(run.value)}
              </React.Fragment>
            );
          case 'bold':
            return (
              <span className="font-bold" key={index}>
                {renderText(run.value)}
              </span>
            );
          case 'italic':
            return (
              <span className="italic" key={index}>
                {renderText(run.value)}
              </span>
            );
          case 'link':
            return (
              <ExternalLink href={run.href} key={index}>
                {run.text}
              </ExternalLink>
            );
        }
      })}
    </>
  );
}
