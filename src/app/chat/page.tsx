import { ChatWorkspace } from "@/features/chat/ChatWorkspace";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string; savedItemId?: string; threadId?: string }>;
}) {
  const { prompt, savedItemId, threadId } = await searchParams;

  return (
    <ChatWorkspace
      initialPrompt={prompt}
      initialSavedItemId={savedItemId}
      initialThreadId={threadId}
    />
  );
}
