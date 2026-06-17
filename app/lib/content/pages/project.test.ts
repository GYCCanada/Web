import { describe, expect, it } from 'bun:test';

import { Locale } from '../../localization/localization';
import {
  defaultAboutPage,
  defaultContactPage,
  defaultFaqPage,
  defaultGivePage,
  defaultHomePage,
  defaultVolunteerPage,
} from './defaults';
import {
  toAboutView,
  toContactView,
  toFaqView,
  toGiveView,
  toHomeView,
  toRichText,
  toVolunteerView,
} from './project';
import { MailtoHref, RichText, RichTextNode } from './schema';

/**
 * The per-locale boundary projection (registration-launch Branch 5.4): the
 * evergreen routes render ONE locale and must never see the bilingual `Text`
 * (`{ en, fr }`) the document carries. These tests pin that each `toXView`
 * collapses the decoded page to this locale's plain strings + projected
 * `RichTextRun`s, and that a `link` token's `href` (the validated brand) survives
 * the projection so the renderer interpolates an XSS-safe string. This is the
 * `toConference` analogue for Pages (`boundary-discipline`, `prove-it-works`).
 */

describe('toRichText', () => {
  it('projects each token kind to this locale + carries the link href through', () => {
    const rich: RichText = [
      RichTextNode.cases.text.make({ value: { en: 'before ', fr: 'avant ' } }),
      RichTextNode.cases.bold.make({ value: { en: 'BOLD', fr: 'GRAS' } }),
      RichTextNode.cases.link.make({
        text: { en: 'email', fr: 'courriel' },
        // The brand was earned at the boundary; the projection must keep it verbatim.
        href: MailtoHref.make('mailto:hello@gyccanada.org'),
      }),
    ];

    expect(toRichText(rich, Locale.En)).toEqual([
      { kind: 'text', value: 'before ' },
      { kind: 'bold', value: 'BOLD' },
      { kind: 'link', text: 'email', href: 'mailto:hello@gyccanada.org' },
    ]);
    expect(toRichText(rich, Locale.Fr)).toEqual([
      { kind: 'text', value: 'avant ' },
      { kind: 'bold', value: 'GRAS' },
      { kind: 'link', text: 'courriel', href: 'mailto:hello@gyccanada.org' },
    ]);
  });
});

describe('per-page projection', () => {
  it('about: titles, paragraphs, disclaimer, quotes collapse to the locale', () => {
    const en = toAboutView(defaultAboutPage, Locale.En);
    expect(en.title).toBe(defaultAboutPage.title.en);
    expect(en.paragraphs).toHaveLength(defaultAboutPage.paragraphs.length);
    expect(en.paragraphs[0]?.text).toBe(defaultAboutPage.paragraphs[0]?.text.en);
    expect(en.paragraphs[0]?.id).toBe(defaultAboutPage.paragraphs[0]!.id);
    expect(en.disclaimer).toBe(defaultAboutPage.disclaimer.en);
    expect(en.quotes[0]?.attribution).toBe(
      defaultAboutPage.quotes[0]?.attribution.en,
    );

    const fr = toAboutView(defaultAboutPage, Locale.Fr);
    expect(fr.title).toBe(defaultAboutPage.title.fr);
    expect(fr.paragraphs[0]?.text).toBe(defaultAboutPage.paragraphs[0]?.text.fr);
  });

  it('faq: questions stay plain, answers project to RichText runs', () => {
    const en = toFaqView(defaultFaqPage, Locale.En);
    expect(en.items).toHaveLength(defaultFaqPage.items.length);
    expect(en.items[0]?.question).toBe(defaultFaqPage.items[0]?.question.en);
    // The first answer is a token sequence; projection yields runs, not a string.
    expect(Array.isArray(en.items[0]?.answer)).toBe(true);
    expect(en.items[0]?.answer.length).toBeGreaterThan(0);
    // A link token in the answer carries its already-validated mailto href.
    const link = en.items[0]?.answer.find((run) => run.kind === 'link');
    expect(link).toBeDefined();
    expect(link && link.kind === 'link' && link.href).toBe(
      'mailto:hello@gyccanada.org',
    );
  });

  it('faq: the refund footnote projects to an `italic` run (parity with the old `<span className="italic">`)', () => {
    // Render-parity pin: the pre-migration FAQ route wrapped the refund footnote
    // (`faq.question.2.answer.2`, "* The ONLY exception …") in `<span className="italic">`.
    // The migrated default carries it as an `italic` token, so the projection must
    // yield an `italic` run whose value is the footnote — guarding the regression that
    // a plain `text` run (rendered non-italic) would silently reintroduce.
    const en = toFaqView(defaultFaqPage, Locale.En);
    const refundItem = en.items.find((item) =>
      item.answer.some(
        (run) => run.kind === 'italic' && run.value.startsWith('* The ONLY'),
      ),
    );
    expect(refundItem).toBeDefined();

    const fr = toFaqView(defaultFaqPage, Locale.Fr);
    const refundItemFr = fr.items.find((item) =>
      item.answer.some(
        (run) => run.kind === 'italic' && run.value.startsWith('* La SEULE'),
      ),
    );
    expect(refundItemFr).toBeDefined();
  });

  it('faq: a `\\n\\n` paragraph break stays in the projected text run', () => {
    // The legacy FAQ copy used `<br/><br/>` between paragraphs; the token model
    // carries that as a literal `\n\n` inside a text run (the renderer turns it
    // back into `<br/><br/>`). The projection must NOT strip it.
    const en = toFaqView(defaultFaqPage, Locale.En);
    const hasBreak = en.items.some((item) =>
      item.answer.some(
        (run) => run.kind !== 'link' && run.value.includes('\n\n'),
      ),
    );
    expect(hasBreak).toBe(true);
  });

  it('give: reason + directions collapse, donateUrl carries the brand through', () => {
    const en = toGiveView(defaultGivePage, Locale.En);
    expect(en.reason).toBe(defaultGivePage.reason.en);
    expect(en.directions).toHaveLength(defaultGivePage.directions.length);
    expect(en.directions[0]?.text).toBe(defaultGivePage.directions[0]?.text.en);
    expect(en.donateUrl).toBe(defaultGivePage.donateUrl);
  });

  it('contact: directions project to RichText runs', () => {
    const en = toContactView(defaultContactPage, Locale.En);
    expect(en.title).toBe(defaultContactPage.title.en);
    expect(en.directions.some((run) => run.kind === 'link')).toBe(true);
  });

  it('volunteer: the bold title projects to RichText runs', () => {
    const en = toVolunteerView(defaultVolunteerPage, Locale.En);
    expect(en.title.some((run) => run.kind === 'bold')).toBe(true);
    expect(en.subtitle).toBe(defaultVolunteerPage.subtitle.en);
    expect(en.directions).toBe(defaultVolunteerPage.directions.en);
  });

  it('home: nested evergreen copy collapses to the locale', () => {
    const en = toHomeView(defaultHomePage, Locale.En);
    expect(en.tagline).toBe(defaultHomePage.tagline.en);
    expect(en.mission.readStoryLabel).toBe(
      defaultHomePage.mission.readStoryLabel.en,
    );
    expect(en.join.donateLabel).toBe(defaultHomePage.join.donateLabel.en);
    expect(en.newsletter.socials).toBe(defaultHomePage.newsletter.socials.en);

    const fr = toHomeView(defaultHomePage, Locale.Fr);
    expect(fr.join.volunteerLabel).toBe(
      defaultHomePage.join.volunteerLabel.fr,
    );
  });
});
