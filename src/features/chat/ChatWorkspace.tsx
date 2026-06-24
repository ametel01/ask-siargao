"use client";

import { Home, LoaderCircle, MessageSquarePlus, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup } from "@/components/ui/input-group";
import { InputGroupAddon } from "@/components/ui/input-group-addon";
import { InputGroupButton } from "@/components/ui/input-group-button";
import { InputGroupInput } from "@/components/ui/input-group-input";
import { BrandLockup, PalmMark } from "@/ui/components/ask-siargao";

const suggestedPrompts = [
  "What should I do near Cloud 9 today?",
  "Where should I eat in General Luna tonight?",
  "Help me plan a quiet Siargao day",
];

const chatErrorMessage = "Ask Siargao could not answer right now. Please try again.";
const chatTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

type InteractiveChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  status?: "pending" | "complete" | "error";
  model?: string;
  retryPrompt?: string;
};

type ChatComposerProps = {
  inputValue: string;
  isSending: boolean;
  onInputValueChange: (value: string) => void;
  onSubmitPrompt: (prompt: string) => void;
};

type AssistantMarkdownBlock =
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
      type: "list";
      items: Array<{
        key: string;
        text: string;
      }>;
    };
type AssistantMarkdownListItems = Extract<AssistantMarkdownBlock, { type: "list" }>["items"];

export function ChatWorkspace({ initialPrompt = "" }: { initialPrompt?: string }) {
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<InteractiveChatMessage[]>([]);
  const submittedInitialPromptRef = useRef(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const submitPrompt = useCallback(
    async (prompt: string) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt || isSending) {
        return;
      }

      const timestamp = formatTimestamp();
      const userMessage: InteractiveChatMessage = {
        id: createMessageId("user"),
        role: "user",
        text: trimmedPrompt,
        timestamp,
        status: "complete",
      };
      const pendingAssistantId = createMessageId("assistant");
      const pendingAssistant: InteractiveChatMessage = {
        id: pendingAssistantId,
        role: "assistant",
        text: "Thinking through that with Ask Siargao...",
        timestamp,
        status: "pending",
      };
      const requestMessages = [
        ...messages
          .filter((message) => message.status === "complete")
          .slice(-8)
          .map((message) => ({ role: message.role, content: message.text })),
        { role: "user" as const, content: trimmedPrompt },
      ];

      setInputValue("");
      setIsSending(true);
      setMessages((currentMessages) => [...currentMessages, userMessage, pendingAssistant]);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: requestMessages }),
        });
        const body = (await response.json()) as {
          message?: string;
          model?: string;
        };

        const responseMessage = body.message;
        const responseModel = body.model;

        if (!response.ok || !responseMessage) {
          throw new Error(chatErrorMessage);
        }

        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === pendingAssistantId
              ? {
                  ...message,
                  text: responseMessage,
                  timestamp: formatTimestamp(),
                  status: "complete",
                  model: responseModel,
                }
              : message,
          ),
        );
      } catch {
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === pendingAssistantId
              ? {
                  ...message,
                  text: chatErrorMessage,
                  timestamp: formatTimestamp(),
                  status: "error",
                  retryPrompt: trimmedPrompt,
                }
              : message,
          ),
        );
      } finally {
        setIsSending(false);
      }
    },
    [isSending, messages],
  );

  useEffect(() => {
    if (!initialPrompt || submittedInitialPromptRef.current) {
      return;
    }

    submittedInitialPromptRef.current = true;
    void submitPrompt(initialPrompt);
  }, [initialPrompt, submitPrompt]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  });

  const hasMessages = messages.length > 0;
  const handlePromptSubmit = (prompt: string) => {
    void submitPrompt(prompt);
  };

  return (
    <main
      aria-label="Ask Siargao chat workspace"
      className="h-dvh min-h-screen overflow-hidden bg-[radial-gradient(circle_at_18%_10%,rgba(135,92,246,0.22),transparent_28rem),linear-gradient(135deg,#05082a_0%,#091133_46%,#0e2c3d_100%)] text-text-on-dark"
    >
      <section className="mx-auto grid h-full min-h-0 w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)_auto]">
        <header className="flex min-h-[72px] items-center justify-between gap-4 border-white/12 border-b px-4 py-3 sm:px-6 lg:min-h-[88px] lg:px-8">
          <Link aria-label="Ask Siargao home" className="min-w-0 no-underline" href="/">
            <BrandLockup className="[&_span:last-child]:text-xl sm:[&_span:last-child]:text-[1.7rem]" />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-extrabold text-text-on-dark-muted sm:inline-flex">
              <span className="size-2 rounded-full bg-[#20d59b]" />
              GPT-backed assistant
            </span>
            <Button
              aria-label="Go to home"
              asChild
              className="size-10 rounded-md border-white/20 bg-white/10 text-text-on-dark hover:bg-white/15"
              size="icon"
              variant="outline"
            >
              <Link href="/">
                <Home aria-hidden="true" size={18} />
              </Link>
            </Button>
            <Button
              aria-label="Start a new chat"
              asChild
              className="size-10 rounded-md border-white/20 bg-white/10 text-text-on-dark hover:bg-white/15"
              size="icon"
              variant="outline"
            >
              <Link href="/chat">
                <MessageSquarePlus aria-hidden="true" size={18} />
              </Link>
            </Button>
          </div>
        </header>

        <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto grid min-h-full max-w-3xl content-start gap-5">
            {hasMessages ? (
              <>
                <SuggestedPromptBar
                  disabled={isSending}
                  onSubmitPrompt={handlePromptSubmit}
                  prompts={suggestedPrompts}
                />
                <div className="grid gap-4" role="log" aria-label="Conversation messages">
                  {messages.map((message) => (
                    <ChatMessage
                      disabled={isSending}
                      key={message.id}
                      message={message}
                      onRetryPrompt={handlePromptSubmit}
                    />
                  ))}
                </div>
              </>
            ) : (
              <ChatEmptyState
                disabled={isSending}
                onSubmitPrompt={handlePromptSubmit}
                prompts={suggestedPrompts}
              />
            )}
            <div ref={messageEndRef} />
          </div>
        </div>

        <ChatComposer
          inputValue={inputValue}
          isSending={isSending}
          onInputValueChange={setInputValue}
          onSubmitPrompt={handlePromptSubmit}
        />
      </section>
    </main>
  );
}

function ChatMessage({
  disabled,
  message,
  onRetryPrompt,
}: {
  disabled: boolean;
  message: InteractiveChatMessage;
  onRetryPrompt: (prompt: string) => void;
}) {
  const isUser = message.role === "user";
  const isPending = message.status === "pending";
  const isError = message.status === "error";

  if (isUser) {
    return (
      <article className="max-w-[min(88%,42rem)] justify-self-end rounded-lg bg-[image:var(--gradient-cta)] px-5 py-4 text-text-on-dark shadow-[0_18px_44px_rgba(76,49,184,0.25)]">
        <p className="m-0 text-sm leading-[1.55] font-extrabold sm:text-base">{message.text}</p>
        <time className="mt-2 block text-right text-xs font-bold text-brand-lavender-200">
          {message.timestamp}
        </time>
      </article>
    );
  }

  return (
    <article className="grid max-w-[min(92%,46rem)] grid-cols-[36px_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[44px_minmax(0,1fr)] sm:gap-4">
      <PalmMark className="mt-1 size-8 sm:size-10" />
      <div
        data-testid="assistant-message-bubble"
        className={
          isError
            ? "min-w-0 overflow-hidden rounded-lg border border-[#ffb4a8]/45 bg-[#421915]/82 px-5 py-4 shadow-[0_18px_44px_rgba(0,0,0,0.18)]"
            : "min-w-0 overflow-hidden rounded-lg border border-white/14 bg-white/95 px-5 py-4 text-text-default shadow-[0_18px_44px_rgba(0,0,0,0.16)]"
        }
      >
        <div className="flex min-w-0 items-start gap-3">
          {isPending ? (
            <LoaderCircle
              aria-hidden="true"
              className="mt-0.5 shrink-0 animate-spin text-brand-violet-650"
              size={18}
            />
          ) : null}
          <AssistantMarkdownText text={message.text} tone={isError ? "error" : "default"} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-extrabold">
          <time className={isError ? "text-[#ffd5ce]" : "text-text-soft"}>{message.timestamp}</time>
          {message.status === "complete" && message.model ? (
            <span className="rounded-full bg-brand-violet-600/8 px-2 py-1 text-brand-violet-650">
              {message.model}
            </span>
          ) : null}
        </div>
        {isError && message.retryPrompt ? (
          <Button
            className="mt-4 h-9 rounded-md border-[#ffd5ce]/45 bg-white/10 px-3 text-xs font-extrabold text-text-on-dark hover:bg-white/15"
            disabled={disabled}
            onClick={() => onRetryPrompt(message.retryPrompt ?? "")}
            type="button"
            variant="outline"
          >
            Retry last question
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function AssistantMarkdownText({ text, tone }: { text: string; tone: "default" | "error" }) {
  const blocks = parseAssistantMarkdownBlocks(text);
  const textClass = tone === "error" ? "text-text-on-dark" : "text-text-default";
  const strongClass =
    tone === "error" ? "font-extrabold text-white" : "font-extrabold text-text-strong";
  const linkClass =
    tone === "error"
      ? "font-extrabold text-white underline decoration-white/45 underline-offset-4 break-words"
      : "font-extrabold text-brand-violet-650 underline decoration-brand-violet-650/35 underline-offset-4 break-words";

  return (
    <div className="grid min-w-0 max-w-full flex-1 gap-3 overflow-hidden [overflow-wrap:anywhere]">
      {blocks.map((block) => {
        if (block.type === "heading") {
          return (
            <h3
              className={`m-0 max-w-full text-sm leading-[1.35] font-black break-words sm:text-base ${strongClass}`}
              key={block.key}
            >
              {block.text}
            </h3>
          );
        }

        return block.type === "list" ? (
          <ul
            className={`m-0 max-w-full list-disc space-y-1.5 pl-5 text-sm leading-[1.6] break-words sm:text-base ${textClass}`}
            key={block.key}
          >
            {block.items.map((item) => (
              <li className="min-w-0 break-words" key={item.key}>
                <InlineMarkdown linkClass={linkClass} strongClass={strongClass} value={item.text} />
              </li>
            ))}
          </ul>
        ) : (
          <p
            className={`m-0 max-w-full text-sm leading-[1.6] break-words sm:text-base ${textClass}`}
            key={block.key}
          >
            <InlineMarkdown linkClass={linkClass} strongClass={strongClass} value={block.text} />
          </p>
        );
      })}
    </div>
  );
}

function InlineMarkdown({
  linkClass,
  strongClass,
  value,
}: {
  linkClass: string;
  strongClass: string;
  value: string;
}) {
  return <>{buildInlineMarkdownNodes(value, strongClass, linkClass)}</>;
}

function parseAssistantMarkdownBlocks(text: string): AssistantMarkdownBlock[] {
  const normalizedText = text
    .replace(/\r\n?/g, "\n")
    .replace(/\s+-\s+(\*\*[^*]+?\*\*:)/g, "\n- $1");
  const blocks: AssistantMarkdownBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: AssistantMarkdownListItems = [];
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
      items: listItems,
    });
    blockKeyCount += 1;
    listItems = [];
  };

  for (const rawLine of normalizedText.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const bulletMatch = /^[-*]\s+(.+)$/.exec(line);
    const headingMatch = /^#{1,3}\s+(.+)$/.exec(line);

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

    if (bulletMatch) {
      flushParagraph();
      const itemText = bulletMatch[1] ?? "";
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

function createAssistantMarkdownKey(prefix: string, value: string, count: number) {
  return `${prefix}-${count}-${value.slice(0, 48)}`;
}

function buildInlineMarkdownNodes(
  value: string,
  strongClass: string,
  linkClass: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const boldPattern = /\*\*([^*]+)\*\*/g;
  let currentIndex = 0;
  let match = boldPattern.exec(value);

  while (match) {
    if (match.index > currentIndex) {
      nodes.push(...buildLinkedTextNodes(value.slice(currentIndex, match.index), linkClass));
    }

    nodes.push(
      <strong className={strongClass} key={`strong-${match.index}`}>
        {buildLinkedTextNodes(match[1] ?? "", linkClass)}
      </strong>,
    );
    currentIndex = match.index + match[0].length;
    match = boldPattern.exec(value);
  }

  if (currentIndex < value.length) {
    nodes.push(...buildLinkedTextNodes(value.slice(currentIndex), linkClass));
  }

  return nodes;
}

function buildLinkedTextNodes(value: string, linkClass: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const urlPattern = /https?:\/\/[^\s<>"']+/gi;
  let currentIndex = 0;
  let match = urlPattern.exec(value);

  while (match) {
    const rawUrl = match[0] ?? "";
    const normalizedUrl = normalizeAssistantUrl(rawUrl);

    if (match.index > currentIndex) {
      nodes.push(value.slice(currentIndex, match.index));
    }

    nodes.push(
      <a
        aria-label={`Open ${formatAssistantLinkText(normalizedUrl)} link`}
        className={linkClass}
        href={normalizedUrl}
        key={`link-${match.index}-${normalizedUrl}`}
        rel="noreferrer"
        target="_blank"
      >
        {formatAssistantLinkText(normalizedUrl)}
      </a>,
    );

    const trailingText = rawUrl.slice(normalizedUrl.length);
    if (trailingText) {
      nodes.push(trailingText);
    }

    currentIndex = match.index + rawUrl.length;
    match = urlPattern.exec(value);
  }

  if (currentIndex < value.length) {
    nodes.push(value.slice(currentIndex));
  }

  return nodes;
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

function ChatComposer({
  inputValue,
  isSending,
  onInputValueChange,
  onSubmitPrompt,
}: ChatComposerProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmitPrompt(inputValue);
  }

  return (
    <footer className="border-white/12 border-t bg-brand-navy-980/92 px-4 py-3 backdrop-blur-md sm:px-6 lg:px-8">
      <form aria-label="Ask Siargao composer" className="mx-auto max-w-3xl" onSubmit={handleSubmit}>
        <InputGroup className="min-h-[58px] grid-cols-[1fr_48px] rounded-lg border-white/18 bg-white/96 p-2 shadow-[0_22px_70px_rgba(0,0,0,0.28)]">
          <InputGroupInput
            aria-label="Ask anything about Siargao"
            className="h-11 px-3 text-base text-text-default placeholder:text-text-soft"
            disabled={isSending}
            onInput={(event) => onInputValueChange(event.currentTarget.value)}
            placeholder="Ask anything about Siargao..."
            value={inputValue}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label="Send question"
              className="size-11 rounded-md bg-brand-violet-650 text-white hover:bg-brand-violet-600"
              disabled={isSending || inputValue.trim().length === 0}
              size="icon-sm"
              type="submit"
            >
              {isSending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
              ) : (
                <Send aria-hidden="true" size={18} />
              )}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </footer>
  );
}

function SuggestedPromptBar({
  disabled,
  onSubmitPrompt,
  prompts,
}: {
  disabled: boolean;
  onSubmitPrompt: (prompt: string) => void;
  prompts: string[];
}) {
  return (
    <fieldset aria-label="Suggested prompts" className="m-0 flex flex-wrap gap-2 border-0 p-0">
      {prompts.map((prompt) => (
        <Button
          className="h-auto min-h-9 rounded-full border-white/20 bg-white/10 px-4 py-2 text-xs font-extrabold text-text-on-dark hover:bg-white/15"
          disabled={disabled}
          key={prompt}
          onClick={() => onSubmitPrompt(prompt)}
          type="button"
          variant="outline"
        >
          {prompt}
        </Button>
      ))}
    </fieldset>
  );
}

function ChatEmptyState({
  disabled,
  onSubmitPrompt,
  prompts,
}: {
  disabled: boolean;
  onSubmitPrompt: (prompt: string) => void;
  prompts: string[];
}) {
  return (
    <div className="grid min-h-full content-center gap-8 py-10 sm:py-14">
      <div className="grid max-w-2xl gap-4">
        <div className="inline-flex size-12 items-center justify-center rounded-lg bg-white/12 text-brand-violet-400">
          <Sparkles aria-hidden="true" size={24} />
        </div>
        <div className="grid gap-3">
          <p className="m-0 text-xs font-extrabold tracking-[0.08em] text-brand-lavender-200/75 uppercase">
            Ask Siargao
          </p>
          <h1 className="m-0 text-3xl leading-[1.05] font-black text-text-on-dark sm:text-5xl">
            Ask a real question about your Siargao trip.
          </h1>
          <p className="m-0 max-w-xl text-base leading-[1.7] text-text-on-dark-muted">
            This first chat version uses a GPT-backed response from Ask Siargao. Weather questions
            can use the configured Open-Meteo snapshot when available; bookings, saved places,
            reviews, and other local source evidence are not connected yet.
          </p>
        </div>
      </div>
      <SuggestedPromptBar disabled={disabled} onSubmitPrompt={onSubmitPrompt} prompts={prompts} />
    </div>
  );
}

function createMessageId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function formatTimestamp() {
  return chatTimeFormatter.format(new Date());
}
