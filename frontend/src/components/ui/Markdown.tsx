import { Fragment, type ReactNode } from "react";
import { openExternal } from "../../lib/api";

/**
 * Markdown shows the Markdown a release's notes are written in: headings,
 * paragraphs, bulleted and numbered lists, fenced code, and inline code,
 * bold, italics and links (bare URLs too), as GitHub writes them. It
 * builds elements, never HTML, so nothing in the text can run; links leave
 * for the browser, http and https ones alone.
 */
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  return <div className={`flex flex-col gap-3 ${className}`}>{blocks(text)}</div>;
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "rule" };

function parse(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "paragraph", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) code.push(lines[i]);
      out.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      out.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      flush();
      out.push({ kind: "rule" });
      continue;
    }
    const item = trimmed.match(/^([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      flush();
      const ordered = /\d/.test(item[1]);
      const last = out[out.length - 1];
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item[2]);
      else out.push({ kind: "list", ordered, items: [item[2]] });
      continue;
    }
    // A line under a list item, indented, carries it on
    const last = out[out.length - 1];
    if (!para.length && last?.kind === "list" && /^\s/.test(line)) {
      last.items[last.items.length - 1] += ` ${trimmed}`;
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return out;
}

function blocks(text: string): ReactNode {
  return parse(text).map((b, i) => {
    switch (b.kind) {
      case "heading":
        // The notes' own sections, at the size of a list's group names
        return (
          <h3 key={i} className={`font-semibold ${b.level <= 2 ? "mt-1 text-[15px]" : "text-sm"}`}>
            {inline(b.text)}
          </h3>
        );
      case "paragraph":
        return (
          <p key={i} className="leading-relaxed text-foreground/85">
            {inline(b.text)}
          </p>
        );
      case "list": {
        const List = b.ordered ? "ol" : "ul";
        return (
          <List
            key={i}
            className={`flex flex-col gap-1.5 pl-5 leading-relaxed text-foreground/85 ${b.ordered ? "list-decimal" : "list-disc"} marker:text-muted-foreground`}
          >
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </List>
        );
      }
      case "code":
        return (
          <pre key={i} className="selectable overflow-x-auto rounded-lg bg-muted px-3 py-2.5 font-mono text-xs">
            {b.text}
          </pre>
        );
      case "rule":
        return <hr key={i} className="border-border" />;
    }
  });
}

// Underscores aren't emphasis here: they're common inside names (snake_case) in notes
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s)<>]+)|(\*[^*\s][^*]*\*)/g;

function inline(text: string): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > at) out.push(text.slice(at, i));
    const [whole, code, bold, link, url, em] = m;
    const k = out.length;
    if (code)
      out.push(
        <code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {code.slice(1, -1)}
        </code>,
      );
    else if (bold)
      out.push(
        <strong key={k} className="font-semibold text-foreground">
          {inline(bold.slice(2, -2))}
        </strong>,
      );
    else if (link) {
      const [, label, href] = link.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      out.push(
        <Link key={k} href={href}>
          {inline(label)}
        </Link>,
      );
    } else if (url) {
      // A sentence's full stop or comma after a bare URL isn't part of it
      const clean = url.replace(/[.,;:!?]+$/, "");
      out.push(
        <Link key={k} href={clean}>
          {clean}
        </Link>,
      );
      if (clean.length < url.length) out.push(url.slice(clean.length));
    } else if (em) out.push(<em key={k}>{inline(em.slice(1, -1))}</em>);
    else out.push(whole);
    at = i + whole.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out.map((n, i) => <Fragment key={i}>{n}</Fragment>);
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  const web = /^https?:\/\//i.test(href);
  if (!web) return <>{children}</>;
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        openExternal(href);
      }}
      className="cursor-pointer text-brand hover:underline"
    >
      {children}
    </a>
  );
}
