import type { ReactNode } from "react";

/**
 * Renders the Markdown subset the editor can produce — paragraphs, emphasis,
 * scene breaks, blockquotes and lists. Headings and code blocks are disabled
 * in the editor, so they are not handled here.
 *
 * Written by hand rather than pulled in as a dependency so the reading view
 * never emits raw HTML, which rules out injection from pasted prose.
 */

type Token = { text: string; bold: boolean; italic: boolean; code: boolean };

// `[\s\S]` rather than `.` with the `s` flag, which the project's ES2017
// target does not allow. Emphasis may still span a soft line break.
const INLINE = /(\*\*|__)([\s\S]+?)\1|(\*|_)([\s\S]+?)\3|`([^`]+)`|\\([\s\S])/g;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  INLINE.lastIndex = 0;

  const push = (text: string, style: Partial<Token> = {}) => {
    if (!text) return;
    tokens.push({ text, bold: false, italic: false, code: false, ...style });
  };

  while ((match = INLINE.exec(source)) !== null) {
    push(source.slice(last, match.index));
    if (match[2] !== undefined) push(match[2], { bold: true });
    else if (match[4] !== undefined) push(match[4], { italic: true });
    else if (match[5] !== undefined) push(match[5], { code: true });
    else if (match[6] !== undefined) push(match[6]); // escaped character
    last = match.index + match[0].length;
  }
  push(source.slice(last));
  return tokens;
}

function Inline({ source }: { source: string }) {
  return (
    <>
      {tokenize(source).map((token, i) => {
        if (token.code) {
          return (
            <code key={i} className="rounded bg-muted px-1 font-mono text-[0.9em]">
              {token.text}
            </code>
          );
        }
        let node: ReactNode = token.text;
        if (token.italic) node = <em key={i}>{node}</em>;
        if (token.bold) node = <strong key={i}>{node}</strong>;
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

export function MarkdownProse({ markdown }: { markdown: string }) {
  const blocks = markdown.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  return (
    <div className="manuscript space-y-4">
      {blocks.map((block, i) => {
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(block)) {
          return <hr key={i} />;
        }
        if (block.split("\n").every((line) => /^>\s?/.test(line))) {
          return (
            <blockquote key={i}>
              <Inline source={block.replace(/^>\s?/gm, "")} />
            </blockquote>
          );
        }
        const lines = block.split("\n");
        if (lines.every((line) => /^\s*[-*+]\s+/.test(line))) {
          return (
            <ul key={i}>
              {lines.map((line, j) => (
                <li key={j}>
                  <Inline source={line.replace(/^\s*[-*+]\s+/, "")} />
                </li>
              ))}
            </ul>
          );
        }
        if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
          return (
            <ol key={i}>
              {lines.map((line, j) => (
                <li key={j}>
                  <Inline source={line.replace(/^\s*\d+[.)]\s+/, "")} />
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i}>
            <Inline source={block.replace(/\n/g, " ")} />
          </p>
        );
      })}
    </div>
  );
}
