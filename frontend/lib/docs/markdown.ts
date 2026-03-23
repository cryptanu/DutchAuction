export type TocHeading = {
  id: string;
  text: string;
  level: 2 | 3;
};

const escapeHtml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const slugify = (value: string): string => {
  return value
    .toLowerCase()
    .trim()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
};

const withInlineFormatting = (rawValue: string): string => {
  const escaped = escapeHtml(rawValue);

  const withLinks = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer noopener" class="font-medium text-[#3b8bff] hover:underline">$1</a>',
  );
  const withStrong = withLinks.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-slate-900">$1</strong>');
  const withInlineCode = withStrong.replace(
    /`([^`]+)`/g,
    '<code class="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[13px] text-slate-800">$1</code>',
  );
  return withInlineCode;
};

const headingClassByDepth: Record<number, string> = {
  1: "mt-0 text-[36px] font-semibold leading-[1.15] tracking-[-0.03em] text-slate-950",
  2: "mt-10 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-slate-900 scroll-mt-24",
  3: "mt-7 text-[18px] font-semibold leading-tight tracking-[-0.01em] text-slate-900 scroll-mt-24",
};

export const extractTocHeadings = (markdown: string): TocHeading[] => {
  const seen = new Map<string, number>();
  const headings: TocHeading[] = [];

  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const match = /^(#{2,3})\s+(.+)$/.exec(line);
    if (!match) continue;

    const level = match[1].length as 2 | 3;
    const text = match[2].trim();
    const baseId = slugify(text);
    const count = seen.get(baseId) ?? 0;
    seen.set(baseId, count + 1);
    const id = count === 0 ? baseId : `${baseId}-${count + 1}`;

    headings.push({ id, text, level });
  }

  return headings;
};

export const renderMarkdownToHtml = (markdown: string): string => {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  const headingIds = new Map<string, number>();

  let paragraphBuffer: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join(" ").trim();
    paragraphBuffer = [];
    if (!text) return;
    blocks.push(
      `<p class="mt-4 text-[16px] leading-[1.7] text-slate-700 [&_a]:font-medium [&_a]:text-[#3b8bff] [&_a]:hover:underline">${withInlineFormatting(
        text,
      )}</p>`,
    );
  };

  const flushList = () => {
    if (!listType) return;
    blocks.push(`</${listType}>`);
    listType = null;
  };

  const flushCodeBlock = () => {
    if (!inCodeBlock) return;
    const codeContent = escapeHtml(codeLines.join("\n"));
    const languageClass = codeLanguage ? ` language-${escapeHtml(codeLanguage)}` : "";
    blocks.push(
      `<pre class="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-slate-950 p-4 text-[13px] leading-6 text-slate-100 shadow-sm"><code class="font-mono${languageClass}">${codeContent}</code></pre>`,
    );
    inCodeBlock = false;
    codeLanguage = "";
    codeLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    const codeFence = /^```([\w-]+)?$/.exec(line.trim());
    if (codeFence) {
      flushParagraph();
      flushList();
      if (inCodeBlock) {
        flushCodeBlock();
      } else {
        inCodeBlock = true;
        codeLanguage = (codeFence[1] ?? "").trim();
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine);
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      flushParagraph();
      flushList();

      const depth = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      const baseId = slugify(headingText);
      const occurrence = headingIds.get(baseId) ?? 0;
      headingIds.set(baseId, occurrence + 1);
      const headingId = occurrence === 0 ? baseId : `${baseId}-${occurrence + 1}`;

      const className = headingClassByDepth[depth] ?? headingClassByDepth[3];
      blocks.push(`<h${depth} id="${headingId}" class="${className}">${withInlineFormatting(headingText)}</h${depth}>`);
      continue;
    }

    const ulMatch = /^\s*-\s+(.+)$/.exec(rawLine);
    const olMatch = /^\s*\d+\.\s+(.+)$/.exec(rawLine);

    if (ulMatch || olMatch) {
      flushParagraph();
      const nextListType: "ul" | "ol" = ulMatch ? "ul" : "ol";
      if (listType !== nextListType) {
        flushList();
        const listClass =
          nextListType === "ul"
            ? "mt-4 list-disc space-y-2 pl-6 text-[16px] leading-[1.65] text-slate-700"
            : "mt-4 list-decimal space-y-2 pl-6 text-[16px] leading-[1.65] text-slate-700";
        blocks.push(`<${nextListType} class="${listClass}">`);
        listType = nextListType;
      }

      blocks.push(
        `<li class="pl-1 [&_a]:font-medium [&_a]:text-[#3b8bff] [&_a]:hover:underline">${withInlineFormatting(
          (ulMatch?.[1] ?? olMatch?.[1] ?? "").trim(),
        )}</li>`,
      );
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    paragraphBuffer.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushCodeBlock();

  return blocks.join("\n");
};
