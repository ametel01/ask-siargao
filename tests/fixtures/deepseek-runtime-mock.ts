import { createClient } from "redis";

const hostname = "127.0.0.1";
const port = Number(process.env.DEEPSEEK_RUNTIME_MOCK_PORT ?? "3210");
const redisUrl = "redis://127.0.0.1:6379/15";

const redis = createClient({ url: redisUrl });
redis.on("error", (error) => {
  console.error("Runtime smoke Redis setup failed.", error);
});
await redis.connect();
await redis.flushDb();
await redis.quit();

Bun.serve({
  hostname,
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("ok");
    }

    if (request.method === "POST" && url.pathname === "/chat/completions") {
      await request.json();
      return Response.json({
        id: "chatcmpl_runtime_smoke",
        object: "chat.completion",
        created: 1_784_006_400,
        model: "deepseek-v4-flash-runtime-smoke",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "Runtime smoke answer from the deterministic model fixture.",
            },
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20,
        },
      });
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  },
});

console.log(`DeepSeek runtime mock listening on http://${hostname}:${port}`);
