import { createCn } from "cn/config";

/**
 * clsx + tailwind-merge. Taught the Slotwren type scale (docs/design/globals.css)
 * so `text-label` is merged as a font size, not mistaken for a text colour that
 * would silently drop `text-primary-foreground`.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "hero",
            "display",
            "heading",
            "title",
            "body",
            "body-sm",
            "label",
            "caption",
            "mono-lg",
            "mono",
            "mono-sm",
          ],
        },
      ],
    },
  },
});
