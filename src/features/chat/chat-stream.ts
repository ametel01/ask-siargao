export const chatStreamContentType = "application/x-ndjson";

export type ChatProgressEvent = {
  type: "progress";
  stage: string;
  message: string;
  toolCount?: number;
};

export type ChatResultEvent<T = Record<string, unknown>> = {
  type: "result";
  status: number;
  body: T;
};

type ChatStreamEvent<T> = ChatProgressEvent | ChatResultEvent<T>;

export function isChatStreamResponse(response: Response) {
  return response.headers.get("content-type")?.includes(chatStreamContentType) === true;
}

export async function readChatStreamResponse<T>(
  response: Response,
  onProgress: (event: ChatProgressEvent) => void,
): Promise<ChatResultEvent<T>> {
  if (!response.body) {
    throw new Error("Chat stream did not include a response body.");
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let result: ChatResultEvent<T> | undefined;

  while (true) {
    const chunk = await reader.read();
    buffer += chunk.value ?? "";
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      result = consumeChatStreamLine(line, onProgress) ?? result;
    }
    if (chunk.done) {
      break;
    }
  }

  if (buffer.trim()) {
    result = consumeChatStreamLine(buffer, onProgress) ?? result;
  }
  if (!result) {
    throw new Error("Chat stream ended before returning a result.");
  }
  return result;
}

function consumeChatStreamLine<T>(line: string, onProgress: (event: ChatProgressEvent) => void) {
  if (!line.trim()) {
    return undefined;
  }
  const event = JSON.parse(line) as ChatStreamEvent<T>;
  if (event.type === "progress") {
    onProgress(event);
    return undefined;
  }
  if (event.type !== "result" || typeof event.status !== "number") {
    throw new Error("Chat stream returned an invalid event.");
  }
  return event;
}
