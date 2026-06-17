import type { Locale } from '../../localization/localization';
import type {
  AboutPage,
  ArchivePage,
  ContactPage,
  FaqPage,
  GivePage,
  HomePage,
  RichText,
  RichTextNode,
  VolunteerPage,
} from './schema';

/**
 * The per-locale BOUNDARY projection for the evergreen Page objects
 * (registration-launch Branch 5.4, ADR 0008). `Content.getPage(id)` returns the
 * bilingual document content (`Text` = `{ en, fr }`, `RichText` = a token
 * sequence over `Text`); the routes render ONE locale and must never touch the
 * other half. These converters collapse a decoded page to this locale's plain
 * strings + a `RichTextRun[]` the renderer maps to DOM — exactly the role
 * `toConference` plays for the Conference boundary (`boundary-discipline`).
 *
 * Why a dedicated module rather than methods on `Content`: keeping the service
 * interface small (`getPage` only) and the heterogeneous per-page projection in
 * one boundary module honors `small-interface-deep-implementation`. A route does
 * `toAboutView(yield* content.getPage('about'), locale)`; React sees only the
 * view type, never a bilingual `Text` or a branded `href` (`derive-dont-sync`:
 * the projection is computed from the one decoded object, not re-declared).
 */

// ---------------------------------------------------------------------------
// RichText — projected to per-locale renderable runs
// ---------------------------------------------------------------------------

/**
 * One inline run of projected rich copy: a plain/bold/italic text run, or a link
 * with its label and an already-validated `https:` / `mailto:` `href` (the brand
 * was earned on decode, so the string is XSS-safe here — `boundary-discipline`).
 * A discriminated union (`kind`) the renderer (`~/ui/rich-text`) switches on.
 */
export type RichTextRun =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'bold'; readonly value: string }
  | { readonly kind: 'italic'; readonly value: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

const toRun = (node: RichTextNode, locale: Locale): RichTextRun => {
  switch (node._tag) {
    case 'text':
      return { kind: 'text', value: node.value[locale] };
    case 'bold':
      return { kind: 'bold', value: node.value[locale] };
    case 'italic':
      return { kind: 'italic', value: node.value[locale] };
    case 'link':
      return { kind: 'link', text: node.text[locale], href: node.href };
  }
};

/** Project a bilingual `RichText` token sequence to this locale's runs. */
export const toRichText = (
  rich: RichText,
  locale: Locale,
): readonly RichTextRun[] => rich.map((node) => toRun(node, locale));

// ---------------------------------------------------------------------------
// Per-page view types (what the routes render — plain per-locale strings)
// ---------------------------------------------------------------------------

export interface AboutView {
  readonly title: string;
  readonly paragraphs: readonly { readonly id: string; readonly text: string }[];
  readonly disclaimer: string;
  readonly quotes: readonly {
    readonly id: string;
    readonly text: string;
    readonly attribution: string;
  }[];
}

export interface FaqView {
  readonly title: string;
  readonly items: readonly {
    readonly id: string;
    readonly question: string;
    readonly answer: readonly RichTextRun[];
  }[];
}

export interface GiveView {
  readonly title: string;
  readonly reason: string;
  readonly directions: readonly { readonly id: string; readonly text: string }[];
  readonly donateUrl: string;
}

export interface ContactView {
  readonly title: string;
  readonly directions: readonly RichTextRun[];
}

export interface VolunteerView {
  readonly title: readonly RichTextRun[];
  readonly subtitle: string;
  readonly directions: string;
}

export interface ArchiveView {
  readonly title: string;
  readonly entries: readonly {
    readonly id: string;
    readonly label: string;
    readonly url: string;
  }[];
}

export interface HomeView {
  readonly tagline: string;
  readonly mission: { readonly readStoryLabel: string };
  readonly join: {
    readonly title: string;
    readonly subtitle: string;
    readonly donateLabel: string;
    readonly volunteerLabel: string;
  };
  readonly newsletter: {
    readonly title: string;
    readonly subtitle: string;
    readonly socials: string;
  };
}

// ---------------------------------------------------------------------------
// Per-page converters (document → this-locale view)
// ---------------------------------------------------------------------------

export const toAboutView = (page: AboutPage, locale: Locale): AboutView => ({
  title: page.title[locale],
  paragraphs: page.paragraphs.map((p) => ({
    id: p.id,
    text: p.text[locale],
  })),
  disclaimer: page.disclaimer[locale],
  quotes: page.quotes.map((q) => ({
    id: q.id,
    text: q.text[locale],
    attribution: q.attribution[locale],
  })),
});

export const toFaqView = (page: FaqPage, locale: Locale): FaqView => ({
  title: page.title[locale],
  items: page.items.map((item) => ({
    id: item.id,
    question: item.question[locale],
    answer: toRichText(item.answer, locale),
  })),
});

export const toGiveView = (page: GivePage, locale: Locale): GiveView => ({
  title: page.title[locale],
  reason: page.reason[locale],
  directions: page.directions.map((d) => ({ id: d.id, text: d.text[locale] })),
  donateUrl: page.donateUrl,
});

export const toContactView = (
  page: ContactPage,
  locale: Locale,
): ContactView => ({
  title: page.title[locale],
  directions: toRichText(page.directions, locale),
});

export const toVolunteerView = (
  page: VolunteerPage,
  locale: Locale,
): VolunteerView => ({
  title: toRichText(page.title, locale),
  subtitle: page.subtitle[locale],
  directions: page.directions[locale],
});

export const toArchiveView = (
  page: ArchivePage,
  locale: Locale,
): ArchiveView => ({
  title: page.title[locale],
  entries: page.entries.map((e) => ({
    id: e.id,
    label: e.label[locale],
    url: e.url,
  })),
});

export const toHomeView = (page: HomePage, locale: Locale): HomeView => ({
  tagline: page.tagline[locale],
  mission: { readStoryLabel: page.mission.readStoryLabel[locale] },
  join: {
    title: page.join.title[locale],
    subtitle: page.join.subtitle[locale],
    donateLabel: page.join.donateLabel[locale],
    volunteerLabel: page.join.volunteerLabel[locale],
  },
  newsletter: {
    title: page.newsletter.title[locale],
    subtitle: page.newsletter.subtitle[locale],
    socials: page.newsletter.socials[locale],
  },
});
