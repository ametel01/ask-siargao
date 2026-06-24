import Image from "next/image";
import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { css } from "../../../styled-system/css/css";
import { cx } from "../../../styled-system/css/cx";

export function BrowserFrame({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <section
      aria-label={label}
      className={cx(
        css({
          bg: "rgba(5, 8, 42, 0.62)",
          borderColor: "rgba(180, 160, 255, 0.34)",
          borderRadius: { base: "lg", md: "xl" },
          borderWidth: "1px",
          boxShadow: "coastalFrame",
          color: "text.onDark",
          overflow: "hidden",
          position: "relative",
        }),
        className,
      )}
    >
      <BrowserDots />
      {children}
    </section>
  );
}

export function BrowserDots() {
  return (
    <div
      aria-hidden="true"
      className={css({
        display: "flex",
        gap: "2",
        left: { base: "4", md: "5" },
        position: "absolute",
        top: { base: "4", md: "5" },
        zIndex: 4,
        "& span:nth-child(1)": { bg: "#ff6b6b" },
        "& span:nth-child(2)": { bg: "#ffd65a" },
        "& span:nth-child(3)": { bg: "#8b8aa7" },
      })}
    >
      {["close", "minimize", "zoom"].map((label) => (
        <span
          className={css({
            borderRadius: "pill",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.2)",
            display: "block",
            h: "10px",
            width: "10px",
          })}
          key={label}
        />
      ))}
    </div>
  );
}

export function PalmMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        css({
          alignItems: "center",
          bg: "transparent",
          borderColor: "rgba(255,255,255,0.5)",
          borderRadius: "pill",
          borderWidth: "0",
          boxShadow: "0 8px 20px rgba(0,0,0,0.22)",
          display: "inline-flex",
          flexShrink: 0,
          h: "9",
          justifyContent: "center",
          overflow: "hidden",
          width: "9",
          "& img": {
            display: "block",
            h: "100%",
            objectFit: "contain",
            width: "100%",
          },
        }),
        className,
      )}
    >
      <Image alt="" height={36} src="/ask_siargao_palm_icon.svg" width={36} />
    </span>
  );
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        css({
          alignItems: "center",
          color: "text.onDark",
          display: "inline-flex",
          gap: "3",
          textDecoration: "none",
          "& > span:last-child": {
            fontFamily: "display",
            fontSize: "lg",
            fontWeight: "700",
            lineHeight: "1",
          },
        }),
        className,
      )}
    >
      <PalmMark />
      <span>Ask Siargao</span>
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
    <Link
      className={cx(
        css({
          alignItems: "center",
          background: "token(gradients.cta)",
          borderRadius: "md",
          boxShadow: "cta",
          color: "text.onDark",
          display: "inline-flex",
          fontSize: "sm",
          fontWeight: "800",
          gap: "2",
          justifyContent: "center",
          minH: "42px",
          px: "4",
          textDecoration: "none",
          transition:
            "box-shadow token(durations.fast) token(easings.standard), transform token(durations.fast) token(easings.standard)",
          _focusVisible: {
            outline: "3px solid token(colors.violet.400)",
            outlineOffset: "3px",
          },
          _hover: {
            boxShadow: "violetGlow",
            transform: "translateY(-1px)",
          },
        }),
        className,
      )}
      href={href}
      {...props}
    >
      {children}
    </Link>
  );
}

export function SignalBadge({
  children,
  tone = "fresh",
}: {
  children: ReactNode;
  tone?: "fresh" | "high" | "medium" | "local";
}) {
  const palette = {
    fresh: { bg: "confidence.highSoft", color: "confidence.high" },
    high: { bg: "confidence.highSoft", color: "confidence.high" },
    medium: { bg: "confidence.mediumSoft", color: "confidence.medium" },
    local: { bg: "rgba(108,70,232,0.08)", color: "violet.650" },
  }[tone];

  return (
    <span
      className={css({
        alignItems: "center",
        bg: palette.bg,
        borderRadius: "pill",
        color: palette.color,
        display: "inline-flex",
        fontSize: "2xs",
        fontWeight: "800",
        minH: "22px",
        px: "2",
        whiteSpace: "nowrap",
      })}
    >
      {children}
    </span>
  );
}
