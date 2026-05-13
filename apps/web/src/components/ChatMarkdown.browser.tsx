import "../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const { openInPreferredEditorMock, readLocalApiMock } = vi.hoisted(() => ({
  openInPreferredEditorMock: vi.fn(async () => "vscode"),
  readLocalApiMock: vi.fn(() => ({
    server: { getConfig: vi.fn(async () => ({ availableEditors: ["vscode"] })) },
    shell: { openInEditor: vi.fn(async () => undefined) },
  })),
}));

vi.mock("../editorPreferences", () => ({
  openInPreferredEditor: openInPreferredEditorMock,
  preferredTerminalEditor: vi.fn(() => "vscode"),
}));

vi.mock("../localApi", () => ({
  ensureLocalApi: vi.fn(() => {
    throw new Error("ensureLocalApi not implemented in browser test");
  }),
  readLocalApi: readLocalApiMock,
}));

import ChatMarkdown from "./ChatMarkdown";

describe("ChatMarkdown", () => {
  afterEach(() => {
    openInPreferredEditorMock.mockClear();
    readLocalApiMock.mockClear();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("rewrites file uri hrefs into direct paths before rendering", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts](file://${filePath})`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", filePath);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(expect.anything(), filePath);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("keeps line anchors working after rewriting file uri hrefs", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts:1](file://${filePath}#L1)`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts · L1" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", `${filePath}:1`);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(expect.anything(), `${filePath}:1`);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("shows column information inline when present", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts](file://${filePath}#L1C7)`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts · L1:C7" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", `${filePath}:1:7`);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(
          expect.anything(),
          `${filePath}:1:7`,
        );
      });
    } finally {
      await screen.unmount();
    }
  });

  it("disambiguates duplicate file basenames inline", async () => {
    const firstPath = "/Users/yashsingh/p/t3code/apps/web/src/components/chat/MessagesTimeline.tsx";
    const secondPath = "/Users/yashsingh/p/t3code/apps/web/src/components/MessagesTimeline.tsx";
    const screen = await render(
      <ChatMarkdown
        text={`See [MessagesTimeline.tsx](file://${firstPath}) and [MessagesTimeline.tsx](file://${secondPath}).`}
        cwd="/repo/project"
      />,
    );

    try {
      await expect
        .element(page.getByRole("link", { name: "MessagesTimeline.tsx · components/chat" }))
        .toBeInTheDocument();
      await expect
        .element(page.getByRole("link", { name: "MessagesTimeline.tsx · src/components" }))
        .toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps normal web links unchanged", async () => {
    const screen = await render(
      <ChatMarkdown text="[OpenAI](https://openai.com/docs)" cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "OpenAI" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", "https://openai.com/docs");
      await expect.element(link).toHaveAttribute("target", "_blank");
    } finally {
      await screen.unmount();
    }
  });

  it("renders completed raw HTML fragments as chat content", async () => {
    const screen = await render(
      <ChatMarkdown
        text="<section><h1>T3 Code</h1><p>Minimal web GUI for coding agents.</p></section>"
        cwd="/repo/project"
      />,
    );

    try {
      await expect.element(page.getByRole("heading", { name: "T3 Code" })).toBeInTheDocument();
      await expect
        .element(page.getByText("Minimal web GUI for coding agents."))
        .toBeInTheDocument();
      expect(document.querySelector(".chat-markdown section")).not.toBeNull();
    } finally {
      await screen.unmount();
    }
  });

  it("renders indented nested raw HTML without turning it into a code block", async () => {
    const screen = await render(
      <ChatMarkdown
        text={`<section>
  <article>
    <p>
      Inline <strong>strong</strong> and <em>em</em>.
    </p>

    <footer>
      <p>Footer inside an article.</p>
    </footer>
  </article>
</section>`}
        cwd="/repo/project"
      />,
    );

    try {
      await expect.element(page.getByText("Footer inside an article.")).toBeInTheDocument();
      expect(document.querySelector(".chat-markdown pre")).toBeNull();
      expect(document.querySelector(".chat-markdown strong")?.textContent).toBe("strong");
      expect(document.querySelector(".chat-markdown footer")).not.toBeNull();
    } finally {
      await screen.unmount();
    }
  });

  it("does not treat inline tag mentions as raw HTML fragments", async () => {
    const screen = await render(
      <ChatMarkdown text="Use <section> for semantic grouping." cwd="/repo/project" />,
    );

    try {
      expect(document.querySelector(".chat-markdown section")).toBeNull();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps mixed markdown with later tag examples on the markdown path", async () => {
    const screen = await render(
      <ChatMarkdown
        text={`Example:
<section><p>This is shown as source, not rendered HTML.</p></section>`}
        cwd="/repo/project"
      />,
    );

    try {
      expect(document.querySelector(".chat-markdown section")).toBeNull();
      expect(document.body.textContent ?? "").toContain("This is shown as source");
    } finally {
      await screen.unmount();
    }
  });

  it("sanitizes raw HTML before rendering", async () => {
    const screen = await render(
      <ChatMarkdown
        text={`<section><img src="https://example.com/image.png" alt="example" onerror="alert('x')" /><script>alert("x")</script><p>Safe content</p></section>`}
        cwd="/repo/project"
      />,
    );

    try {
      await expect.element(page.getByText("Safe content")).toBeInTheDocument();
      const image = document.querySelector(".chat-markdown img");
      expect(image).not.toBeNull();
      expect(image?.getAttribute("onerror")).toBeNull();
      expect(document.querySelector(".chat-markdown script")).toBeNull();
      expect(document.body.textContent ?? "").not.toContain("alert(");
    } finally {
      await screen.unmount();
    }
  });

  it("neutralizes anchors whose href is removed by sanitizing", async () => {
    const screen = await render(
      <ChatMarkdown
        text={`<section><p>Unsafe link: <a href="javascript:alert('blocked')">javascript URL probe</a></p></section>`}
        cwd="/repo/project"
      />,
    );

    try {
      await expect.element(page.getByText("javascript URL probe")).toBeInTheDocument();
      const unsafeAnchor = Array.from(document.querySelectorAll(".chat-markdown a")).find(
        (element) => element.textContent === "javascript URL probe",
      );
      expect(unsafeAnchor).toBeUndefined();
      const disabledLink = document.querySelector(".chat-markdown-disabled-link");
      expect(disabledLink?.textContent).toBe("javascript URL probe");
    } finally {
      await screen.unmount();
    }
  });

  it("keeps editor-aware file links inside raw HTML fragments", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown
        text={`<section><a href="file://${filePath}">PermissionRule.ts</a></section>`}
        cwd="/repo/project"
      />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", filePath);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(expect.anything(), filePath);
      });
    } finally {
      await screen.unmount();
    }
  });
});
