import Image from "next/image";
import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function BrowserDots() {
  return (
    <div aria-hidden="true" className="absolute top-4 left-4 z-4 flex gap-2 md:top-5 md:left-5">
      {[
        ["close", "bg-[#ff6b6b]"],
        ["minimize", "bg-brand-sunset-gold"],
        ["zoom", "bg-[#8b8aa7]"],
      ].map(([label, colorClass]) => (
        <span
          className={cn(
            "block size-[10px] rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.2)]",
            colorClass,
          )}
          key={label}
        />
      ))}
    </div>
  );
}

export function PalmMark({ className }: { className?: string }) {
  return (
    <Avatar
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border-0 bg-transparent shadow-[0_8px_20px_rgba(0,0,0,0.22)]",
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
      <PalmMark />
      <span className="font-heading text-lg leading-none font-bold">Ask Siargao</span>
    </span>
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
        "min-h-[42px] rounded-md bg-[image:var(--gradient-cta)] px-4 font-extrabold text-text-on-dark shadow-cta transition-[box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:-translate-y-px hover:shadow-violet-glow focus-visible:ring-brand-violet-400",
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
    fresh: "bg-confidence-high-soft text-confidence-high",
    high: "bg-confidence-high-soft text-confidence-high",
    medium: "bg-confidence-medium-soft text-confidence-medium",
    local: "bg-[rgba(108,70,232,0.08)] text-brand-violet-650",
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
