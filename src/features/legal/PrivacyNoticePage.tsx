import { ArrowLeft, ExternalLink, MessageCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { appSurfacePanelClass } from "@/ui/components/ask-siargao";

const privacySections = [
  {
    title: "What chat sends to DeepSeek",
    body: "When you submit a chat question, Ask Siargao sends the text you entered, limited recent conversation context, and the instructions needed to produce an answer. It does not intentionally send your Clerk account email, payment details, or raw browser coordinates to the model provider.",
  },
  {
    title: "Where model processing happens",
    body: "DeepSeek is operated by Hangzhou DeepSeek Artificial Intelligence Co., Ltd. Its published policy says data is processed and stored in the People’s Republic of China. DeepSeek’s API context caching is enabled by default and may persist input and output prefixes on disk.",
  },
  {
    title: "How DeepSeek may use data",
    body: "DeepSeek’s published privacy policy says inputs may be retained while an account exists and may be used to operate, secure, improve, and train its services. Its public Open Platform terms do not state a fixed downstream API retention period. Do not submit sensitive personal data, passwords, payment information, health information, identity documents, or another person’s private information.",
  },
  {
    title: "Ask Siargao storage and controls",
    body: "Signed-in chat history and saved planning can be deleted from Settings. Ask Siargao does not intentionally put raw prompt text into analytics or operational logs. Account Closure removes active product data through the documented closure workflow, but it cannot retroactively control copies retained by an external provider under its own legal obligations.",
  },
  {
    title: "Other providers",
    body: "Ask Siargao may send a place query and an approximate or consented location to Google Places when that live lookup is needed. Clerk processes authentication data. Vercel, PlanetScale, Redis Cloud, and Sentry support hosting, storage, control state, and error monitoring. Checkout and product analytics are disabled for the initial controlled beta.",
  },
  {
    title: "Your choice and rights",
    body: "Model-backed chat is optional. Before the first production chat request, Ask Siargao asks you to acknowledge this processing. You can browse public pages without accepting. For access, correction, deletion, or other privacy requests concerning Ask Siargao data, use the controls in Settings. DeepSeek directs provider-side privacy requests to privacy@deepseek.com.",
  },
] as const;

export function PrivacyNoticePage() {
  return (
    <main
      className="min-h-screen bg-brand-lavender-50 px-4 py-5 text-text-default sm:px-6 lg:px-8 lg:py-8"
      id="main-content"
      tabIndex={-1}
    >
      <div className="mx-auto grid w-full max-w-5xl gap-5">
        <Link
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md text-sm font-extrabold text-brand-lagoon-700 no-underline outline-none focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
          href="/"
        >
          <ArrowLeft aria-hidden="true" size={18} />
          Back to Ask Siargao
        </Link>

        <section className={`${appSurfacePanelClass} grid gap-6 p-5 md:p-7`}>
          <div className="grid gap-3">
            <p className="m-0 text-xs font-extrabold tracking-[0.16em] text-brand-lagoon-700 uppercase">
              Privacy notice · effective August 13, 2026
            </p>
            <h1 className="m-0 font-heading text-[clamp(2.4rem,8vw,4.25rem)] leading-none font-semibold text-text-strong">
              Know where your chat goes
            </h1>
            <p className="m-0 max-w-3xl text-base leading-[1.55] font-semibold text-text-muted md:text-lg">
              Ask Siargao uses external services to answer travel questions. This notice explains
              the current controlled-beta data flow before you choose model-backed chat.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {privacySections.map((section) => (
              <article
                className="grid content-start gap-2 rounded-lg border border-border-default bg-white p-4"
                key={section.title}
              >
                <div className="flex items-start gap-2">
                  <ShieldCheck
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-brand-lagoon-700"
                    size={18}
                  />
                  <h2 className="m-0 text-base font-semibold text-text-strong">{section.title}</h2>
                </div>
                <p className="m-0 text-sm leading-[1.55] font-semibold text-text-muted">
                  {section.body}
                </p>
              </article>
            ))}
          </div>

          <section
            aria-labelledby="provider-policy-title"
            className="grid gap-3 rounded-lg border border-brand-sunset-gold/45 bg-brand-sunset-gold/10 p-4"
          >
            <h2 className="m-0 text-lg font-semibold text-text-strong" id="provider-policy-title">
              Read the provider terms
            </h2>
            <p className="m-0 text-sm leading-[1.55] font-bold text-text-muted">
              DeepSeek has not supplied Ask Siargao with a separately executed data-processing
              agreement or a complete public subprocessor register. Its published terms place the
              responsibility for downstream-user disclosure and legal basis on Ask Siargao.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-extrabold">
              <a
                className="inline-flex min-h-11 items-center gap-2 text-brand-lagoon-700"
                href="https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html"
                rel="noreferrer"
                target="_blank"
              >
                DeepSeek Open Platform terms
                <ExternalLink aria-hidden="true" size={16} />
              </a>
              <a
                className="inline-flex min-h-11 items-center gap-2 text-brand-lagoon-700"
                href="https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html"
                rel="noreferrer"
                target="_blank"
              >
                DeepSeek privacy policy
                <ExternalLink aria-hidden="true" size={16} />
              </a>
            </div>
          </section>

          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              className="min-h-11 rounded-md bg-brand-lagoon-600 px-4 text-sm font-extrabold hover:bg-brand-lagoon-700 focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
            >
              <Link href="/chat">
                <MessageCircle aria-hidden="true" size={18} />
                Return to chat
              </Link>
            </Button>
            <Button
              asChild
              className="min-h-11 rounded-md border-border-default bg-white px-4 text-sm font-extrabold text-text-strong hover:bg-brand-lagoon-100 focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
              variant="outline"
            >
              <Link href="/settings">Manage privacy controls</Link>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
