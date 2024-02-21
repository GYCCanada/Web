import { CollectionConfig } from "payload/types";

const Menus: CollectionConfig = {
  slug: "menus",
  fields: [
    {
      name: "menuSlug",
      type: "text",
      // label: "Menu Slu"
      required: true,
      unique: true,
    },
    {
      name: "items",
      type: "array",
      fields: [
        {
          name: "itemTitle",
          type: "text",
          label: "Item Title",
        },
        {
          name: "target",
          type: "relationship",
          relationTo: ["pages"],
        },
      ],
    },
  ],
};

export default Menus;
