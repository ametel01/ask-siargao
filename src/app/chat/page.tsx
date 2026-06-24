import { ChatWorkspace } from "@/features/chat/ChatWorkspace";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const { prompt } = await searchParams;

  return <ChatWorkspace initialPrompt={prompt} />;
}
