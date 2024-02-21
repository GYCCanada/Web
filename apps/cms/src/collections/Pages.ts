import { CollectionConfig, Block } from "payload/types";

const TitleBlock: Block = {
  slug: "h1",
  fields: [
    {
      name: "text",
      type: "text",
    },
  ],
};

const SectionBlock: Block = {
  slug: "section",
  fields: [
    {
      name: "test",
      type: "blocks",
      blocks: [TitleBlock],
    },
  ],
};

const Pages: CollectionConfig = {
  slug: "pages",
  fields: [
    {
      name: "pageTitle",
      type: "text",
      label: "Page Title",
      required: true,
    },
    {
      name: "pageSlug",
      type: "text",
      label: "Page Slug",
      required: true,
      unique: true,
    },
    {
      name: "layout",
      type: "blocks",
      blocks: [TitleBlock, SectionBlock],
    },
  ],
};

export default Pages;
