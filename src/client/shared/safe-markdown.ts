function appendInline(target: HTMLElement, source: string): void {
  const tokenPattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;
  let cursor = 0;
  for (const match of source.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) target.append(document.createTextNode(source.slice(cursor, index)));
    const token = match[0];
    if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      target.append(strong);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      target.append(code);
    } else if (token.startsWith("*")) {
      const emphasis = document.createElement("em");
      emphasis.textContent = token.slice(1, -1);
      target.append(emphasis);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      const anchor = document.createElement("a");
      anchor.textContent = link?.[1] ?? token;
      anchor.href = link?.[2] ?? "#";
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer nofollow";
      target.append(anchor);
    }
    cursor = index + token.length;
  }
  if (cursor < source.length) target.append(document.createTextNode(source.slice(cursor)));
}

function paragraph(lines: readonly string[]): HTMLElement {
  const node = document.createElement("p");
  lines.forEach((line, index) => {
    if (index) node.append(document.createElement("br"));
    appendInline(node, line);
  });
  return node;
}

/** Renders a deliberately small Markdown subset without interpreting raw HTML. */
export function renderSafeMarkdown(target: HTMLElement, markdown: unknown): void {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const output = document.createDocumentFragment();
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    if (!line.trim()) { index += 1; continue; }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith("```")) codeLines.push(lines[index++]!);
      if (index < lines.length) index += 1;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (language) code.dataset["language"] = language;
      code.textContent = codeLines.join("\n");
      pre.append(code);
      output.append(pre);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const node = document.createElement(`h${heading[1]!.length}`);
      appendInline(node, heading[2]!);
      output.append(node);
      index += 1;
      continue;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const list = document.createElement(ordered ? "ol" : "ul");
      const matcher = ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*]\s+(.+)$/;
      while (index < lines.length) {
        const item = lines[index]!.match(matcher);
        if (!item) break;
        const listItem = document.createElement("li");
        appendInline(listItem, item[1]!);
        list.append(listItem);
        index += 1;
      }
      output.append(list);
      continue;
    }
    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index]!.trim() && !/^(#{1,3})\s+|^```|^[-*]\s+|^\d+[.)]\s+/.test(lines[index]!)) paragraphLines.push(lines[index++]!);
    output.append(paragraph(paragraphLines));
  }
  target.replaceChildren(output);
}
