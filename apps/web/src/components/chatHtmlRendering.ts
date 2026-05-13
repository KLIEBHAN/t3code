import { fromHtml } from "hast-util-from-html";
import { defaultSchema, sanitize, type Schema as HastSanitizeSchema } from "hast-util-sanitize";
import { toJsxRuntime, type Components as HastComponents } from "hast-util-to-jsx-runtime";
import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

const CHAT_HTML_EXTRA_TAG_NAMES = [
  "article",
  "aside",
  "figcaption",
  "figure",
  "footer",
  "header",
  "main",
  "nav",
  "small",
] as const;

const CHAT_HTML_STRIPPED_TAG_NAMES = [
  "embed",
  "head",
  "iframe",
  "link",
  "meta",
  "object",
  "script",
  "style",
  "title",
] as const;

const CHAT_HTML_WRAPPER_TAG_NAMES = ["body", "html"] as const;

const CHAT_HTML_RENDER_TAG_NAMES = [
  ...new Set([...(defaultSchema.tagNames ?? []), ...CHAT_HTML_EXTRA_TAG_NAMES]),
];

const CHAT_HTML_DETECTION_TAG_NAMES = [
  ...new Set([
    ...CHAT_HTML_RENDER_TAG_NAMES,
    ...CHAT_HTML_STRIPPED_TAG_NAMES,
    ...CHAT_HTML_WRAPPER_TAG_NAMES,
  ]),
];

const LEADING_HTML_FRAGMENT_PATTERN = new RegExp(
  `^\\s*(?:<!doctype\\s+html\\b|<\\/?(?:${CHAT_HTML_DETECTION_TAG_NAMES.join("|")})\\b[^>]*>)`,
  "i",
);

const chatHtmlSanitizeSchema: HastSanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...new Set([...(defaultSchema.protocols?.href ?? []), "file"])],
  },
  strip: [...new Set([...(defaultSchema.strip ?? []), ...CHAT_HTML_STRIPPED_TAG_NAMES])],
  tagNames: CHAT_HTML_RENDER_TAG_NAMES,
};

export function shouldRenderHtmlFragment(text: string): boolean {
  return LEADING_HTML_FRAGMENT_PATTERN.test(text);
}

export function renderSanitizedHtmlFragment(
  text: string,
  components: Partial<HastComponents>,
): ReactNode {
  const unsafeTree = fromHtml(text, { fragment: true });
  const safeTree = sanitize(unsafeTree, chatHtmlSanitizeSchema);
  return toJsxRuntime(safeTree, {
    Fragment,
    jsx,
    jsxs,
    components,
    passNode: true,
  });
}
