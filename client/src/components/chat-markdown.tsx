/**
 * Minimal, dependency-free markdown renderer for chat messages.
 *
 * Supports the small subset models actually emit: **bold**, *italic*,
 * `inline code`, [links](url), bullet/numbered lists and paragraphs.
 * Everything is rendered as React nodes (no dangerouslySetInnerHTML), so it is
 * safe against HTML injection from model or visitor text.
 */

import { Fragment, type ReactNode } from "react";

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Order matters: links first, then code, bold, italic.
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last, m.index)}</Fragment>);
    if (m[1]) {
      nodes.push(
        <a key={`${keyBase}-a${i}`} href={m[3]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-words">
          {m[2]}
        </a>,
      );
    } else if (m[4]) {
      nodes.push(<code key={`${keyBase}-c${i}`} className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[0.85em]">{m[5]}</code>);
    } else if (m[6]) {
      nodes.push(<strong key={`${keyBase}-b${i}`}>{m[7]}</strong>);
    } else if (m[8]) {
      nodes.push(<em key={`${keyBase}-i${i}`}>{m[9]}</em>);
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) nodes.push(<Fragment key={`${keyBase}-end`}>{text.slice(last)}</Fragment>);
  return nodes;
}

export function ChatMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items;
    blocks.push(
      list.ordered ? (
        <ol key={`l${key++}`} className="list-decimal pl-5 space-y-0.5 my-1">
          {items.map((it, idx) => <li key={idx}>{renderInline(it, `o${key}-${idx}`)}</li>)}
        </ol>
      ) : (
        <ul key={`l${key++}`} className="list-disc pl-5 space-y-0.5 my-1">
          {items.map((it, idx) => <li key={idx}>{renderInline(it, `u${key}-${idx}`)}</li>)}
        </ul>
      ),
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet) {
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]);
    } else if (numbered) {
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(numbered[1]);
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={`p${key++}`} className="my-0.5">{renderInline(line, `p${key}`)}</p>);
    }
  }
  flushList();

  return <div className="space-y-1 leading-relaxed">{blocks}</div>;
}
