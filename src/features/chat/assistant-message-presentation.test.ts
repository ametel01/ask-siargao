import { describe, expect, test } from "bun:test";
import {
  parseAssistantInlineTokens,
  parseAssistantMarkdownBlocks,
  projectAssistantTableToMobileCards,
} from "@/features/chat/assistant-message-presentation";

describe("assistant message presentation parsing", () => {
  test("parses assistant markdown blocks without mounting ChatWorkspace", () => {
    const blocks = parseAssistantMarkdownBlocks(
      [
        "# Cloud 9 plan",
        "",
        "Start near **Cloud 9** and keep it close.",
        "",
        "- Shaka for breakfast",
        "- Boardwalk if rain eases",
        "",
        "1. Check the sky",
        "2. Keep a covered fallback",
        "",
        "Checked: Open-Meteo forecast. Weather signal: Light rain. Not checked: crowding.",
        "",
        "| Stop | Area | Timing |",
        "| --- | :---: | ---: |",
        "| **Shaka** | Cloud 9 | Morning |",
      ].join("\n"),
    );

    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "source",
      "source",
      "source",
      "table",
    ]);
    expect(blocks[0]).toMatchObject({ type: "heading", text: "Cloud 9 plan" });
    expect(blocks[2]).toMatchObject({
      type: "list",
      ordered: false,
      items: [
        expect.objectContaining({ text: "Shaka for breakfast" }),
        expect.objectContaining({ text: "Boardwalk if rain eases" }),
      ],
    });
    expect(blocks[3]).toMatchObject({
      type: "list",
      ordered: true,
      items: [
        expect.objectContaining({ text: "Check the sky" }),
        expect.objectContaining({ text: "Keep a covered fallback" }),
      ],
    });
    expect(blocks[7]).toMatchObject({
      type: "table",
      headers: ["Stop", "Area", "Timing"],
      rows: [["**Shaka**", "Cloud 9", "Morning"]],
      alignments: ["left", "center", "right"],
    });
  });

  test("normalizes malformed markdown table lines back into paragraph text", () => {
    const blocks = parseAssistantMarkdownBlocks(
      ["| Stop | Area |", "| --- |", "| Shaka | Cloud 9 |"].join("\n"),
    );

    expect(blocks).toEqual([
      expect.objectContaining({
        type: "paragraph",
        text: "| Stop | Area |\n| --- |\n| Shaka | Cloud 9 |",
      }),
    ]);
  });

  test("detects compact assistant source lines for every supported source label", () => {
    const blocks = parseAssistantMarkdownBlocks(
      "Checked: Google Places. Weather signal: Thunderstorm. Not checked: bookings.",
    );

    expect(blocks).toMatchObject([
      { type: "source", label: "Checked", text: "Google Places." },
      { type: "source", label: "Weather signal", text: "Thunderstorm." },
      { type: "source", label: "Not checked", text: "bookings." },
    ]);
  });

  test("parses inline strong and links while trimming trailing URL punctuation", () => {
    const tokens = parseAssistantInlineTokens(
      "Try **Kermit https://kermit.example/menu.** then open https://maps.google.com/?cid=123),",
    );

    expect(tokens).toMatchObject([
      { type: "text", text: "Try " },
      {
        type: "strong",
        children: [
          { type: "text", text: "Kermit " },
          { type: "link", href: "https://kermit.example/menu", label: "kermit.example" },
          { type: "text", text: "." },
        ],
      },
      { type: "text", text: " then open " },
      { type: "link", href: "https://maps.google.com/?cid=123", label: "Google Maps" },
      { type: "text", text: ")," },
    ]);
  });

  test("projects markdown tables into mobile table cards with normalized cells", () => {
    const table = parseAssistantMarkdownBlocks(
      [
        "| Place | Area | Price |",
        "| --- | :---: | ---: |",
        "| Golden Bell | General Luna | ₱350 |",
        "| Backup | Catangnan | |",
      ].join("\n"),
    )[0];

    if (table?.type !== "table") {
      throw new Error("Expected parsed table.");
    }

    expect(projectAssistantTableToMobileCards(table)).toEqual([
      {
        key: expect.stringContaining("mobile-row-0"),
        cells: [
          expect.objectContaining({
            header: "Place",
            value: "Golden Bell",
            alignment: "left",
          }),
          expect.objectContaining({
            header: "Area",
            value: "General Luna",
            alignment: "center",
          }),
          expect.objectContaining({
            header: "Price",
            value: "₱350",
            alignment: "right",
          }),
        ],
      },
      {
        key: expect.stringContaining("mobile-row-1"),
        cells: [
          expect.objectContaining({ header: "Place", value: "Backup" }),
          expect.objectContaining({ header: "Area", value: "Catangnan" }),
          expect.objectContaining({ header: "Price", value: "" }),
        ],
      },
    ]);
  });
});
