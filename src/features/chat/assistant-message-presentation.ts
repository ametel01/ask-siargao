export type AssistantMarkdownTableAlignment = "left" | "center" | "right";

export type AssistantMarkdownBlock =
  | {
      key: string;
      type: "heading";
      text: string;
    }
  | {
      key: string;
      type: "paragraph";
      text: string;
    }
  | {
      key: string;
      type: "source";
      label: string;
      text: string;
    }
  | {
      key: string;
      type: "table";
      headers: string[];
      rows: string[][];
      alignments: AssistantMarkdownTableAlignment[];
    }
  | {
      key: string;
      type: "list";
      ordered: boolean;
      items: Array<{
        key: string;
        text: string;
      }>;
    };

export type AssistantInlineToken =
  | {
      key: string;
      type: "text";
      text: string;
    }
  | {
      key: string;
      type: "strong";
      children: AssistantInlineToken[];
    }
  | {
      key: string;
      type: "link";
      href: string;
      label: string;
    };

export type AssistantMobileTableCard = {
  key: string;
  cells: Array<{
    key: string;
    header: string;
    value: string;
    alignment: AssistantMarkdownTableAlignment;
  }>;
};

type AssistantMarkdownListItems = Extract<AssistantMarkdownBlock, { type: "list" }>["items"];
type AssistantMarkdownTableBlock = Extract<AssistantMarkdownBlock, { type: "table" }>;

export function parseAssistantMarkdownBlocks(text: string): AssistantMarkdownBlock[] {
  const normalizedText = text
    .replace(/\r\n?/g, "\n")
    .replace(/\s+-\s+(\*\*[^*]+?\*\*:)/g, "\n- $1")
    .replace(/(?<![A-Za-z])\s+(\d+\.\s+[A-Z][^:\n]{0,120})/g, "\n$1")
    .replace(/\s+(Weather signal:|Checked:|Not checked:)/g, "\n$1");
  const blocks: AssistantMarkdownBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: AssistantMarkdownListItems = [];
  let listOrdered = false;
  let tableLines: string[] = [];
  let blockKeyCount = 0;
  let itemKeyCount = 0;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    const paragraphText = paragraphLines.join(" ");
    blocks.push({
      key: createAssistantMarkdownKey("paragraph", paragraphText, blockKeyCount),
      type: "paragraph",
      text: paragraphText,
    });
    blockKeyCount += 1;
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    blocks.push({
      key: createAssistantMarkdownKey(
        "list",
        listItems.map((item) => item.text).join("|"),
        blockKeyCount,
      ),
      type: "list",
      ordered: listOrdered,
      items: listItems,
    });
    blockKeyCount += 1;
    listItems = [];
    listOrdered = false;
  };

  const flushTable = () => {
    if (tableLines.length === 0) {
      return;
    }

    const table = parseAssistantMarkdownTable(tableLines, blockKeyCount);
    if (table) {
      blocks.push(table);
      blockKeyCount += 1;
    } else {
      paragraphLines.push(...tableLines);
    }
    tableLines = [];
  };

  for (const rawLine of normalizedText.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }

    if (isMarkdownTableLine(line)) {
      flushParagraph();
      flushList();
      tableLines.push(line);
      continue;
    }

    flushTable();

    if (/^\s{2,}\S/.test(rawLine) && listItems.length > 0) {
      listItems[listItems.length - 1] = {
        ...listItems[listItems.length - 1],
        text: `${listItems[listItems.length - 1]?.text ?? ""}\n${line}`,
      };
      continue;
    }

    const bulletMatch = /^[-*]\s+(.+)$/.exec(line);
    const orderedMatch = /^\d+\.\s+(.+)$/.exec(line);
    const headingMatch = /^#{1,3}\s+(.+)$/.exec(line);
    const sourceMatch = /^(Checked|Weather signal|Not checked):\s*(.+)$/i.exec(line);

    if (headingMatch) {
      flushParagraph();
      flushList();
      const headingText = headingMatch[1] ?? "";
      blocks.push({
        key: createAssistantMarkdownKey("heading", headingText, blockKeyCount),
        type: "heading",
        text: headingText,
      });
      blockKeyCount += 1;
      continue;
    }

    if (sourceMatch) {
      flushParagraph();
      flushList();
      const label = sourceMatch[1] ?? "";
      const sourceText = sourceMatch[2] ?? "";
      blocks.push({
        key: createAssistantMarkdownKey("source", `${label}:${sourceText}`, blockKeyCount),
        type: "source",
        label,
        text: sourceText,
      });
      blockKeyCount += 1;
      continue;
    }

    if (bulletMatch) {
      flushParagraph();
      if (listItems.length > 0 && listOrdered) {
        flushList();
      }
      listOrdered = false;
      const itemText = bulletMatch[1] ?? "";
      listItems.push({
        key: createAssistantMarkdownKey("item", itemText, itemKeyCount),
        text: itemText,
      });
      itemKeyCount += 1;
      continue;
    }

    if (orderedMatch) {
      flushParagraph();
      if (listItems.length > 0 && !listOrdered) {
        flushList();
      }
      listOrdered = true;
      const itemText = orderedMatch[1] ?? "";
      listItems.push({
        key: createAssistantMarkdownKey("item", itemText, itemKeyCount),
        text: itemText,
      });
      itemKeyCount += 1;
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  flushTable();

  return blocks.length > 0
    ? blocks
    : [
        {
          key: "paragraph-fallback",
          type: "paragraph",
          text,
        },
      ];
}

export function parseAssistantInlineTokens(value: string): AssistantInlineToken[] {
  const tokens: AssistantInlineToken[] = [];
  const boldPattern = /\*\*([^*]+)\*\*/g;
  let currentIndex = 0;
  let match = boldPattern.exec(value);

  while (match) {
    if (match.index > currentIndex) {
      tokens.push(...parseAssistantLinkTokens(value.slice(currentIndex, match.index), "text"));
    }

    tokens.push({
      key: `strong-${match.index}`,
      type: "strong",
      children: parseAssistantLinkTokens(match[1] ?? "", `strong-${match.index}`),
    });
    currentIndex = match.index + match[0].length;
    match = boldPattern.exec(value);
  }

  if (currentIndex < value.length) {
    tokens.push(...parseAssistantLinkTokens(value.slice(currentIndex), "text"));
  }

  return tokens;
}

export function projectAssistantTableToMobileCards(
  table: AssistantMarkdownTableBlock,
): AssistantMobileTableCard[] {
  return table.rows.map((row, rowIndex) => ({
    key: `${table.key}-mobile-row-${rowIndex}`,
    cells: table.headers.map((header, cellIndex) => ({
      key: `${table.key}-mobile-row-${rowIndex}-cell-${cellIndex}`,
      header,
      value: row[cellIndex] ?? "",
      alignment: table.alignments[cellIndex] ?? "left",
    })),
  }));
}

function parseAssistantMarkdownTable(
  lines: readonly string[],
  blockKeyCount: number,
): AssistantMarkdownBlock | undefined {
  if (lines.length < 2) {
    return undefined;
  }

  const headers = parseMarkdownTableCells(lines[0] ?? "");
  const separatorCells = parseMarkdownTableCells(lines[1] ?? "");
  if (
    headers.length === 0 ||
    separatorCells.length !== headers.length ||
    !separatorCells.every(isMarkdownTableSeparatorCell)
  ) {
    return undefined;
  }

  const rows: string[][] = [];
  for (const line of lines.slice(2)) {
    const row = normalizeMarkdownTableRow(parseMarkdownTableCells(line), headers.length);
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }
  if (rows.length === 0) {
    return undefined;
  }

  return {
    key: createAssistantMarkdownKey("table", headers.join("|"), blockKeyCount),
    type: "table",
    headers,
    rows,
    alignments: separatorCells.map(markdownTableAlignment),
  };
}

function parseAssistantLinkTokens(value: string, keyPrefix: string): AssistantInlineToken[] {
  const tokens: AssistantInlineToken[] = [];
  const urlPattern = /https?:\/\/[^\s<>"']+/gi;
  let currentIndex = 0;
  let match = urlPattern.exec(value);

  while (match) {
    const rawUrl = match[0] ?? "";
    const normalizedUrl = normalizeAssistantUrl(rawUrl);

    if (match.index > currentIndex) {
      tokens.push({
        key: `${keyPrefix}-text-${currentIndex}`,
        type: "text",
        text: value.slice(currentIndex, match.index),
      });
    }

    tokens.push({
      key: `${keyPrefix}-link-${match.index}-${normalizedUrl}`,
      type: "link",
      href: normalizedUrl,
      label: formatAssistantLinkText(normalizedUrl),
    });

    const trailingText = rawUrl.slice(normalizedUrl.length);
    if (trailingText) {
      tokens.push({
        key: `${keyPrefix}-text-${match.index + normalizedUrl.length}`,
        type: "text",
        text: trailingText,
      });
    }

    currentIndex = match.index + rawUrl.length;
    match = urlPattern.exec(value);
  }

  if (currentIndex < value.length) {
    tokens.push({
      key: `${keyPrefix}-text-${currentIndex}`,
      type: "text",
      text: value.slice(currentIndex),
    });
  }

  return tokens;
}

function isMarkdownTableLine(line: string) {
  return /^\|.+\|$/.test(line) && line.split("|").length >= 3;
}

function parseMarkdownTableCells(line: string) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeMarkdownTableRow(cells: readonly string[], columnCount: number) {
  return Array.from({ length: columnCount }, (_, index) => cells[index] ?? "");
}

function isMarkdownTableSeparatorCell(cell: string) {
  return /^:?-{3,}:?$/.test(cell);
}

function markdownTableAlignment(cell: string): AssistantMarkdownTableAlignment {
  if (/^:-{3,}:$/.test(cell)) {
    return "center";
  }
  if (/^-{3,}:$/.test(cell)) {
    return "right";
  }
  return "left";
}

function createAssistantMarkdownKey(prefix: string, value: string, count: number) {
  return `${prefix}-${count}-${value.slice(0, 48)}`;
}

function normalizeAssistantUrl(value: string) {
  return value.replace(/[),.;:!?]+$/g, "");
}

function formatAssistantLinkText(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");

    if (
      host === "maps.google.com" ||
      (host.endsWith(".google.com") && url.pathname.startsWith("/maps"))
    ) {
      return "Google Maps";
    }

    return host;
  } catch {
    return value;
  }
}
