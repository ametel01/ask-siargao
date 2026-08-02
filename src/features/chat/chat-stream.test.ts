import { describe, expect, test } from "bun:test";

import {
  chatStreamContentType,
  isChatStreamResponse,
  readChatStreamResponse,
} from "@/features/chat/chat-stream";

describe("chat stream", () => {
  test("reads progress across chunk boundaries before returning the final result", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('{"type":"progress","stage":"model","message":"Understand'),
          );
          controller.enqueue(
            encoder.encode('ing"}\n{"type":"result","status":200,"body":{"message":"Done"}}\n'),
          );
          controller.close();
        },
      }),
      { headers: { "content-type": chatStreamContentType } },
    );
    const messages: string[] = [];

    const result = await readChatStreamResponse<{ message: string }>(response, (event) => {
      messages.push(event.message);
    });

    expect(isChatStreamResponse(response)).toBe(true);
    expect(messages).toEqual(["Understanding"]);
    expect(result).toEqual({ type: "result", status: 200, body: { message: "Done" } });
  });

  test("rejects a stream that ends without a result", async () => {
    const response = new Response(
      `${JSON.stringify({ type: "progress", stage: "model", message: "Working" })}\n`,
      { headers: { "content-type": chatStreamContentType } },
    );

    expect(readChatStreamResponse(response, () => {})).rejects.toThrow(
      "Chat stream ended before returning a result.",
    );
  });
});
