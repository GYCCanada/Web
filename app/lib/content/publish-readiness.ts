/** Bilingual text is publish-ready when both locales are non-empty. */
export const hasBilingualText = (
  text: { readonly en?: string; readonly fr?: string } | undefined,
): boolean =>
  Boolean(text?.en?.trim() && text?.fr?.trim());

/** An image ref is publish-ready when it has a key and bilingual alt text. */
export const hasPhoto = (
  photo:
    | {
        readonly key?: string;
        readonly alt?: { readonly en?: string; readonly fr?: string };
      }
    | undefined,
): boolean => Boolean(photo?.key?.trim() && hasBilingualText(photo.alt));

export type DraftSpeakerFields = {
  readonly name?: { readonly en?: string; readonly fr?: string };
  readonly activity?: { readonly en?: string; readonly fr?: string };
  readonly bio?: { readonly en?: string; readonly fr?: string };
  readonly photo?: {
    readonly key?: string;
    readonly alt?: { readonly en?: string; readonly fr?: string };
  };
};

export type DraftSeminarFields = {
  readonly title?: { readonly en?: string; readonly fr?: string };
  readonly description?: { readonly en?: string; readonly fr?: string };
  readonly speaker?: {
    readonly name?: { readonly en?: string; readonly fr?: string };
    readonly bio?: { readonly en?: string; readonly fr?: string };
    readonly photo?: {
      readonly key?: string;
      readonly alt?: { readonly en?: string; readonly fr?: string };
    };
  };
};

/** Whether a plenary speaker has every field strict `SiteContent` requires. */
export const isSpeakerPublishReady = (speaker: DraftSpeakerFields): boolean =>
  hasBilingualText(speaker.name) &&
  hasBilingualText(speaker.activity) &&
  hasBilingualText(speaker.bio) &&
  hasPhoto(speaker.photo);

/** Whether a seminar has every field strict `SiteContent` requires. */
export const isSeminarPublishReady = (seminar: DraftSeminarFields): boolean =>
  hasBilingualText(seminar.title) &&
  hasBilingualText(seminar.description) &&
  hasBilingualText(seminar.speaker?.name) &&
  hasBilingualText(seminar.speaker?.bio) &&
  hasPhoto(seminar.speaker?.photo);
