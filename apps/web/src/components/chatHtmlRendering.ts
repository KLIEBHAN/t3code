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
const CHAT_HTML_VOID_TAG_NAMES = [
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
] as const;

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

const CHAT_HTML_DETECTION_TAG_NAME_SET = new Set<string>(CHAT_HTML_DETECTION_TAG_NAMES);
const CHAT_HTML_VOID_TAG_NAME_SET = new Set<string>(CHAT_HTML_VOID_TAG_NAMES);
const LEADING_HTML_DOCTYPE_PATTERN = /^\s*<!doctype\s+html\b/i;
const LEADING_HTML_OPEN_TAG_PATTERN = /^\s*<([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/;

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
  if (LEADING_HTML_DOCTYPE_PATTERN.test(text)) return true;

  const match = text.match(LEADING_HTML_OPEN_TAG_PATTERN);
  if (!match) return false;

  const tagName = match[1]?.toLowerCase();
  if (!tagName || !CHAT_HTML_DETECTION_TAG_NAME_SET.has(tagName)) return false;

  const openingTag = match[0];
  if (/\/>\s*$/.test(openingTag) || CHAT_HTML_VOID_TAG_NAME_SET.has(tagName)) {
    return true;
  }

  return new RegExp(`</${tagName}\\s*>`, "i").test(text.slice(openingTag.length));
}

export function createSanitizedHtmlFragment(text: string) {
  return sanitize(fromHtml(text, { fragment: true }), chatHtmlSanitizeSchema);
}

export type SanitizedHtmlFragment = ReturnType<typeof createSanitizedHtmlFragment>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function collectLinkHrefs(node: unknown, hrefs: string[]): void {
  if (!isRecord(node)) return;

  if (node.type === "element" && node.tagName === "a" && isRecord(node.properties)) {
    const href = node.properties.href;
    if (typeof href === "string") {
      hrefs.push(href);
    }
  }

  if (!Array.isArray(node.children)) return;
  for (const child of node.children) {
    collectLinkHrefs(child, hrefs);
  }
}

export function extractSanitizedHtmlLinkHrefs(fragment: SanitizedHtmlFragment): string[] {
  const hrefs: string[] = [];
  collectLinkHrefs(fragment, hrefs);
  return hrefs;
}

export function renderSanitizedHtmlFragment(
  fragment: SanitizedHtmlFragment,
  components: Partial<HastComponents>,
): ReactNode {
  return toJsxRuntime(fragment, {
    Fragment,
    jsx,
    jsxs,
    components,
    passNode: true,
  });
}
