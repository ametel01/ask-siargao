import Image from "next/image";
import Link from "next/link";
import type { AnchorHTMLAttributes, ComponentType, HTMLAttributes, ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<{
  "aria-hidden"?: boolean;
  className?: string;
  size?: number;
}>;

const appBackdropClass = "min-h-screen bg-[image:var(--gradient-app-backdrop)] text-text-on-dark";

const sunsetBackdropClass =
  "min-h-screen bg-[image:var(--gradient-sunset-backdrop)] bg-cover bg-center bg-no-repeat text-text-on-dark";

export const appShellClass = "mx-auto grid w-full max-w-[1180px] gap-6 px-5 py-7 md:px-8 md:py-12";

export const appPanelClass =
  "rounded-none border border-border-on-dark bg-surface-glass p-5 text-text-default shadow-panel md:p-6";

export const appNightPanelClass =
  "rounded-md border border-border-on-dark bg-surface-night-panel p-5 text-text-on-dark shadow-strong backdrop-blur-md md:p-6";

export const appCardClass =
  "grid gap-2 rounded-none border-0 border-border-default border-t bg-transparent p-0 pt-4 shadow-none first:border-t-0 first:pt-0";

export const appCardContentClass = "grid gap-2 p-0";
export const appLabelClass = "m-0 text-xs leading-tight font-extrabold text-brand-lagoon-700";
export const appBodyClass = "m-0 text-sm leading-[1.65] text-text-muted";
export const appMetaClass = "m-0 text-xs leading-[1.55] font-extrabold text-text-default";
export const appOutlineBadgeClass = "border-border-strong bg-surface-default text-text-default";

export function PalmMark({ className }: { className?: string }) {
  return (
    <Avatar
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border-0 bg-transparent shadow-night-card",
        className,
      )}
    >
      <Image
        alt=""
        className="block size-full object-contain"
        height={36}
        src="/ask_siargao_palm_icon.svg"
        width={36}
      />
    </Avatar>
  );
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-3 text-text-on-dark no-underline", className)}
    >
      <PalmMark className="size-12" />
      <span className="font-heading text-[1.7rem] leading-none font-bold">Ask Siargao</span>
    </span>
  );
}

export function AppBackdrop({
  children,
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLElement> & { variant?: "default" | "sunset" }) {
  return (
    <main
      className={cn(variant === "sunset" ? sunsetBackdropClass : appBackdropClass, className)}
      {...props}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  actions,
  children,
  className,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header
      className={cn(
        "grid gap-4 border-border-on-dark border-b pb-5 text-text-on-dark md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
        className,
      )}
    >
      <div className="grid max-w-[840px] gap-3">
        {eyebrow ? (
          <p className="m-0 text-sm leading-tight font-extrabold text-brand-lagoon-300">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="m-0 text-balance font-heading text-4xl leading-[0.98] font-semibold text-text-on-dark md:text-5xl">
          {title}
        </h1>
        {description ? (
          <p className="m-0 max-w-[760px] text-sm leading-[1.7] font-bold text-text-on-dark-muted md:text-base">
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}

export function BrandHeader({
  action,
  className,
  label = "Ask Siargao",
}: {
  action?: ReactNode;
  className?: string;
  label?: ReactNode;
}) {
  return (
    <header
      className={cn(
        "flex min-w-0 flex-wrap items-center justify-between gap-4 border-border-on-dark border-b pb-5",
        className,
      )}
    >
      <Link aria-label="Ask Siargao home" className="min-w-0 no-underline" href="/">
        <BrandLockup />
      </Link>
      {action ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3">{action}</div>
      ) : (
        <span className="inline-flex shrink-0 rounded-md border border-border-on-dark bg-surface-night-card px-3 py-2 text-xs font-extrabold text-text-on-dark-muted">
          {label}
        </span>
      )}
    </header>
  );
}

export function SectionHeading({ icon: Icon, title }: { icon?: IconComponent; title: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      {Icon ? (
        <span className="inline-flex size-10 items-center justify-center rounded-md bg-brand-lagoon-100 text-brand-lagoon-700">
          <Icon aria-hidden={true} size={21} />
        </span>
      ) : null}
      <h2 className="m-0 text-xl leading-tight font-extrabold text-text-strong">{title}</h2>
    </div>
  );
}

export function GradientLink({
  children,
  className,
  href,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
  href: string;
}) {
  return (
    <Button
      asChild
      className={cn(
        "min-h-[42px] rounded-md bg-[image:var(--gradient-cta)] px-4 font-extrabold text-text-on-dark shadow-cta transition-[box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:-translate-y-px hover:shadow-lagoon-glow focus-visible:ring-brand-lagoon-300",
        className,
      )}
    >
      <Link href={href} {...props}>
        {children}
      </Link>
    </Button>
  );
}

export function SignalBadge({
  children,
  tone = "fresh",
}: {
  children: ReactNode;
  tone?: "fresh" | "high" | "medium" | "local";
}) {
  const toneClass = {
    fresh: "bg-brand-lagoon-100 text-brand-lagoon-700",
    high: "bg-confidence-high-soft text-confidence-high",
    medium: "bg-confidence-medium-soft text-confidence-medium",
    local: "bg-brand-lagoon-100 text-brand-lagoon-700",
  }[tone];

  return (
    <Badge
      className={cn(
        "min-h-[22px] rounded-full border-transparent px-2 text-[0.6875rem] font-extrabold whitespace-nowrap",
        toneClass,
      )}
    >
      {children}
    </Badge>
  );
}
