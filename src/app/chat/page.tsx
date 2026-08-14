import type { Metadata } from "next";

import { ClerkProviderBoundary } from "@/features/auth/ClerkProviderBoundary";
import { ChatWorkspace } from "@/features/chat/ChatWorkspace";
import { buildNoIndexPageMetadata } from "@/server/seo/metadata";

export const metadata: Metadata = buildNoIndexPageMetadata({
  title: "Siargao Travel Chat | Ask Siargao",
  description: "Chat with Ask Siargao about your current island travel plans and constraints.",
});

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
