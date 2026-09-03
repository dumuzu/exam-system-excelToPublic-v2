import { useLayoutEffect, useRef } from "react";

import { renderSafeMarkdown } from "../safe-markdown.ts";

export function SafeMarkdown({ markdown, className = "" }: { markdown: unknown; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (containerRef.current) renderSafeMarkdown(containerRef.current, markdown);
  }, [markdown]);

  return <div className={`markdownContent ${className}`.trim()} ref={containerRef} />;
}
