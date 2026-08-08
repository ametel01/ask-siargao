import { ClerkProviderBoundary } from "@/features/auth/ClerkProviderBoundary";
import { ChatWorkspace } from "@/features/chat/ChatWorkspace";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string; savedItemId?: string; threadId?: string }>;
}) {
  const { prompt, savedItemId, threadId } = await searchParams;

  return (
    <ClerkProviderBoundary>
      <ChatWorkspace
        initialPrompt={prompt}
        initialSavedItemId={savedItemId}
        initialThreadId={threadId}
      />
    </ClerkProviderBoundary>
  );
}
