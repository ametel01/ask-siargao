import { ArrowLeft, MessageCircle, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  tripPassDifferentiators,
  tripPassPolicyPoints,
  tripPassPublicOffer,
} from "@/features/trip-pass/public-copy";
import { appSurfacePanelClass } from "@/ui/components/ask-siargao";

export function TripPassLegalPage() {
  return (
    <main className="min-h-screen bg-brand-lavender-50 px-4 py-5 text-text-default sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto grid w-full max-w-5xl gap-5">
        <Link
          className="inline-flex min-h-10 w-fit items-center gap-2 rounded-md text-sm font-extrabold text-brand-lagoon-700 no-underline outline-none focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
          href="/"
        >
          <ArrowLeft aria-hidden="true" size={18} />
          Back to Ask Siargao
        </Link>

        <section className={`${appSurfacePanelClass} grid gap-5 p-5 md:p-7`}>
          <div className="grid gap-3">
            <p className="m-0 text-xs font-extrabold tracking-[0.16em] text-brand-lagoon-700 uppercase">
              Trip Pass terms
            </p>
            <h1 className="m-0 font-heading text-[clamp(2.4rem,8vw,4.25rem)] leading-none font-semibold text-text-strong">
              {tripPassPublicOffer.label}
            </h1>
            <p className="m-0 max-w-3xl text-base leading-[1.5] font-semibold text-text-muted md:text-lg">
              This page summarizes the launch offer, activation boundary, refund/dispute behavior,
              privacy limits, provider availability, and support expectations before checkout.
            </p>
          </div>

          <div className="grid gap-3 rounded-lg border border-border-default bg-white p-4 md:grid-cols-2">
            <SummaryItem
              label="Free trial"
              value={`${tripPassPublicOffer.freeLimits.chat} chat / ${tripPassPublicOffer.freeLimits.live} live / ${tripPassPublicOffer.freeLimits.heavy} heavy over ${tripPassPublicOffer.freeWindowDays} days`}
            />
            <SummaryItem
              label={`${tripPassPublicOffer.durationDays}-day Trip Pass`}
              value={`${tripPassPublicOffer.priceLabel}: ${tripPassPublicOffer.paidLimits.chat} chat / ${tripPassPublicOffer.paidLimits.live} live / ${tripPassPublicOffer.paidLimits.heavy} heavy / ${tripPassPublicOffer.paidLimits.weather} weather / ${tripPassPublicOffer.paidLimits.route} route`}
            />
          </div>

          <section aria-labelledby="trip-pass-policy-title" className="grid gap-3">
            <h2 className="m-0 text-xl font-semibold text-text-strong" id="trip-pass-policy-title">
              Checkout, limits, and support
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {tripPassPolicyPoints.map((point) => (
                <article
                  className="grid content-start gap-2 rounded-lg border border-border-default bg-white p-4"
                  key={point.title}
                >
                  <h3 className="m-0 text-base font-semibold text-text-strong">{point.title}</h3>
                  <p className="m-0 text-sm leading-[1.5] font-semibold text-text-muted">
                    {point.body}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="trip-pass-specific-title" className="grid gap-3">
            <h2
              className="m-0 text-xl font-semibold text-text-strong"
              id="trip-pass-specific-title"
            >
              Why it is Siargao-specific
            </h2>
            <ul className="m-0 grid list-none gap-2 p-0">
              {tripPassDifferentiators.map((item) => (
                <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3" key={item}>
                  <ShieldCheck
                    aria-hidden="true"
                    className="mt-0.5 text-brand-lagoon-700"
                    size={18}
                  />
                  <span className="text-sm leading-[1.5] font-semibold text-text-muted">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <p className="m-0 rounded-lg border border-brand-sunset-gold/45 bg-brand-sunset-gold/10 p-4 text-sm leading-[1.5] font-bold text-text-strong">
            Final production price, legal wording, refund policy, privacy wording, and checkout
            enablement remain explicit release approvals. This page describes the current launch
            behavior; it does not enable checkout by itself.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              className="min-h-11 rounded-md bg-brand-lagoon-600 px-4 text-sm font-extrabold text-white hover:bg-brand-lagoon-700 focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
            >
              <Link href={tripPassPublicOffer.links.chat}>
                <MessageCircle aria-hidden="true" size={18} />
                Start in chat
              </Link>
            </Button>
            <Button
              asChild
              className="min-h-11 rounded-md border-border-default bg-white px-4 text-sm font-extrabold text-text-strong hover:bg-brand-lagoon-100 focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
              variant="outline"
            >
              <Link href={tripPassPublicOffer.links.settings}>
                <Settings aria-hidden="true" size={18} />
                Manage in settings
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <p className="m-0 text-xs font-extrabold tracking-[0.12em] text-text-muted uppercase">
        {label}
      </p>
      <p className="m-0 text-base font-extrabold text-text-strong">{value}</p>
    </div>
  );
}
