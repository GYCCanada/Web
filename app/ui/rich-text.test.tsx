import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { Locale } from '~/lib/localization/localization';
import { defaultFaqPage } from '~/lib/content/pages/defaults';
import type { RichTextRun } from '~/lib/content/pages/project';
import { toFaqView } from '~/lib/content/pages/project';

import { RichText } from './rich-text';

/**
 * The `RichText` renderer is the ONLY place page copy becomes markup (the token
 * model is closed — text / bold / link — never arbitrary HTML). These render
 * tests pin the load-bearing behaviour the FAQ / contact / volunteer migration
 * depends on (`prove-it-works`):
 *   - a `bold` run renders `<strong class="font-bold">` (matching the old
 *     `<span className="font-bold">`),
 *   - an `italic` run renders `<span class="italic">` (matching the old FAQ refund
 *     footnote `<span className="italic">`),
 *   - a `link` run renders an external anchor with the validated href,
 *   - a `\n\n` inside a text run renders back as `<br/><br/>` (the legacy
 *     paragraph break carried through the token model as data).
 */

const render = (runs: readonly RichTextRun[]): string =>
  renderToStaticMarkup(<RichText runs={runs} />);

describe('RichText', () => {
  it('renders a plain text run verbatim', () => {
    expect(render([{ kind: 'text', value: 'hello world' }])).toBe(
      'hello world',
    );
  });

  it('renders a bold run as a bold span', () => {
    const html = render([{ kind: 'bold', value: 'BEFORE' }]);
    expect(html).toContain('font-bold');
    expect(html).toContain('BEFORE');
  });

  it('renders an italic run as an italic span', () => {
    const html = render([{ kind: 'italic', value: 'footnote' }]);
    expect(html).toContain('italic');
    expect(html).toContain('footnote');
  });

  it('renders a link run as an external anchor with its href', () => {
    const html = render([
      { kind: 'link', text: 'hello@gyccanada.org', href: 'mailto:hello@gyccanada.org' },
    ]);
    expect(html).toContain('href="mailto:hello@gyccanada.org"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('hello@gyccanada.org');
  });

  it('turns a `\\n\\n` inside a text run into a `<br/><br/>` paragraph break', () => {
    const html = render([{ kind: 'text', value: 'first\n\nsecond' }]);
    expect(html).toContain('first');
    expect(html).toContain('second');
    expect(html).toContain('<br/><br/>');
    // The literal newline characters do NOT leak into the markup.
    expect(html).not.toContain('\n\n');
  });

  it('FAQ refund footnote renders inside an italic span (content -> token -> DOM parity)', () => {
    // Closes the loop the 5.4 review flagged: the pre-migration FAQ route rendered the
    // refund footnote in `<span className="italic">`. This pipes the real FAQ default
    // through the projection + renderer and asserts the footnote text lands inside an
    // italic span — not a bare/non-italic run.
    const faq = toFaqView(defaultFaqPage, Locale.En);
    const refundAnswer = faq.items.find((item) =>
      item.answer.some(
        (run) => run.kind === 'italic' && run.value.startsWith('* The ONLY'),
      ),
    )?.answer;
    expect(refundAnswer).toBeDefined();

    const html = render(refundAnswer ?? []);
    const match = html.match(/<span class="italic">([^<]*)<\/span>/);
    expect(match?.[1]).toContain('* The ONLY exception');
  });

  it('renders a full sequence in order', () => {
    const html = render([
      { kind: 'bold', value: 'BEFORE' },
      { kind: 'text', value: ' registering, email ' },
      { kind: 'link', text: 'us', href: 'mailto:hello@gyccanada.org' },
    ]);
    expect(html.indexOf('BEFORE')).toBeLessThan(
      html.indexOf('registering'),
    );
    expect(html.indexOf('registering')).toBeLessThan(html.indexOf('mailto'));
  });
});
