/**
 * Lightweight chat markdown -> React (no extra deps).
 * Covers what agents typically emit (LLM markdown / WhatsApp-style emphasis).
 */
import { createElement, Fragment } from "react";
import AuthenticatedApiLink from "../components/AuthenticatedApiLink.jsx";
import { isAuthenticatedApiPath, normalizeApiPath } from "./authenticatedApiUrl";

function ChatLink({ href, children }) {
  const url = String(href || "").trim();
  if (!url) return createElement("span", null, children);
  if (isAuthenticatedApiPath(url)) {
    return createElement(AuthenticatedApiLink, { href: normalizeApiPath(url) }, children);
  }
  const external = /^https?:\/\//i.test(url) || url.startsWith("//");
  return createElement(
    "a",
    {
      href: url,
      target: external ? "_blank" : undefined,
      rel: external ? "noopener noreferrer" : undefined,
      className: "chat-md-link",
    },
    children
  );
}

/**
 * Inline: **bold**, *italic*, `code`, ~~strike~~, [label](url), bare http(s) links.
 */
export function renderInlineMarkdown(text, keyPrefix = "i") {
  const src = String(text ?? "");
  if (!src) return [];

  const re =
    /(`[^`\n]+`)|(\*\*\*[^*\n]+?\*\*\*)|(\*\*[^*\n]+?\*\*)|(__[^_\n]+?__)|(\*[^*\n]+?\*)|(_[^_\n]+?_)|(~~[^~\n]+?~~)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>"'`]+)/g;

  const nodes = [];
  let last = 0;
  let m;
  let n = 0;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) {
      nodes.push(createElement("span", { key: keyPrefix + "-t" + n++ }, src.slice(last, m.index)));
    }
    const token = m[0];
    const k = keyPrefix + "-m" + n++;

    if (m[1]) {
      nodes.push(createElement("code", { key: k, className: "chat-md-code" }, token.slice(1, -1)));
    } else if (m[2]) {
      nodes.push(
        createElement(
          "strong",
          { key: k, className: "chat-md-strong" },
          createElement("em", null, token.slice(3, -3))
        )
      );
    } else if (m[3] || m[4]) {
      const inner = token.slice(2, -2);
      nodes.push(
        createElement("strong", { key: k, className: "chat-md-strong" }, renderInlineMarkdown(inner, k + "-b"))
      );
    } else if (m[5] || m[6]) {
      const inner = token.slice(1, -1);
      nodes.push(
        createElement("em", { key: k, className: "chat-md-em" }, renderInlineMarkdown(inner, k + "-e"))
      );
    } else if (m[7]) {
      nodes.push(createElement("del", { key: k, className: "chat-md-del" }, token.slice(2, -2)));
    } else if (m[8]) {
      const lm = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (lm) {
        nodes.push(createElement(ChatLink, { key: k, href: lm[2] }, lm[1]));
      } else {
        nodes.push(createElement("span", { key: k }, token));
      }
    } else if (m[9]) {
      const href = token.replace(/[),.;:!?]+$/g, "");
      const trailing = token.slice(href.length);
      nodes.push(createElement(ChatLink, { key: k, href: href }, href));
      if (trailing) nodes.push(createElement("span", { key: k + "-trail" }, trailing));
    } else {
      nodes.push(createElement("span", { key: k }, token));
    }
    last = m.index + token.length;
  }
  if (last < src.length) {
    nodes.push(createElement("span", { key: keyPrefix + "-t" + n++ }, src.slice(last)));
  }
  return nodes;
}

function isListLine(line) {
  return /^(\s*)([-*+]|\d+\.)\s+/.test(line);
}

function isBlockQuote(line) {
  return /^\s*>\s?/.test(line);
}

function isHeading(line) {
  return /^\s{0,3}(#{1,6})\s+/.test(line);
}

function isHr(line) {
  return /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

/**
 * Full message body: fenced code, headings, lists, quotes, paragraphs with inline markdown.
 */
export function renderChatMarkdown(text) {
  const src = String(text ?? "");
  if (!src) return null;

  const chunks = [];
  const fenceRe = /```([a-zA-Z0-9_+-]*)\r?\n?([\s\S]*?)```/g;
  let last = 0;
  let fm;
  while ((fm = fenceRe.exec(src)) !== null) {
    if (fm.index > last) chunks.push({ type: "md", value: src.slice(last, fm.index) });
    chunks.push({ type: "code", lang: fm[1] || "", value: fm[2].replace(/\n$/, "") });
    last = fm.index + fm[0].length;
  }
  if (last < src.length) chunks.push({ type: "md", value: src.slice(last) });
  if (!chunks.length) chunks.push({ type: "md", value: src });

  const out = [];
  let bi = 0;

  for (const chunk of chunks) {
    if (chunk.type === "code") {
      out.push(
        createElement(
          "pre",
          { key: "code-" + bi++, className: "chat-md-pre" },
          createElement("code", { className: chunk.lang ? "language-" + chunk.lang : undefined }, chunk.value)
        )
      );
      continue;
    }

    const lines = chunk.value.replace(/\r\n/g, "\n").split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        out.push(createElement("div", { key: "sp-" + bi++, className: "chat-md-spacer" }));
        i += 1;
        continue;
      }

      if (isHr(line)) {
        out.push(createElement("hr", { key: "hr-" + bi++, className: "chat-md-hr" }));
        i += 1;
        continue;
      }

      const head = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
      if (head) {
        const level = head[1].length;
        const tag = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
        out.push(
          createElement(
            tag,
            { key: "h-" + bi++, className: "chat-md-h chat-md-h" + level },
            renderInlineMarkdown(head[2], "h" + bi)
          )
        );
        i += 1;
        continue;
      }

      if (isBlockQuote(line)) {
        const quoteLines = [];
        while (i < lines.length && isBlockQuote(lines[i])) {
          quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
          i += 1;
        }
        out.push(
          createElement(
            "blockquote",
            { key: "q-" + bi++, className: "chat-md-quote" },
            renderChatMarkdown(quoteLines.join("\n"))
          )
        );
        continue;
      }

      if (isListLine(line)) {
        const items = [];
        const ordered = /^\s*\d+\.\s+/.test(line);
        while (i < lines.length && isListLine(lines[i])) {
          items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
          i += 1;
        }
        const listTag = ordered ? "ol" : "ul";
        const listKey = "l-" + bi++;
        out.push(
          createElement(
            listTag,
            { key: listKey, className: ordered ? "chat-md-ol" : "chat-md-ul" },
            items.map(function (item, j) {
              return createElement(
                "li",
                { key: j, className: "chat-md-li" },
                renderInlineMarkdown(item, "li" + bi + "-" + j)
              );
            })
          )
        );
        continue;
      }

      const para = [line];
      i += 1;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !isListLine(lines[i]) &&
        !isBlockQuote(lines[i]) &&
        !isHeading(lines[i]) &&
        !isHr(lines[i]) &&
        !lines[i].startsWith("```")
      ) {
        const prev = para[para.length - 1];
        if (prev.endsWith("  ")) {
          para[para.length - 1] = prev.replace(/\s+$/, "");
          para.push("\n");
          para.push(lines[i]);
        } else {
          para.push(lines[i]);
        }
        i += 1;
      }
      const joined = para
        .map(function (p, idx) {
          if (p === "\n") return "\n";
          if (idx === 0) return p;
          if (para[idx - 1] === "\n") return p;
          return " " + p.trim();
        })
        .join("");

      const parts = joined.split("\n");
      const pKey = "p-" + bi++;
      out.push(
        createElement(
          "p",
          { key: pKey, className: "chat-md-p" },
          parts.map(function (part, j) {
            return createElement(
              Fragment,
              { key: j },
              j > 0 ? createElement("br") : null,
              renderInlineMarkdown(part, "p" + bi + "-" + j)
            );
          })
        )
      );
    }
  }

  return out;
}