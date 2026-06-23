import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

import { css, cx } from "../../../styled-system/css";
import { button as buttonRecipe } from "../../../styled-system/recipes";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return <button className={cx(buttonRecipe({ variant }), className)} type="button" {...props} />;
}

export function LinkButton({
  children,
  className,
  href,
  variant = "primary",
}: {
  children: ReactNode;
  className?: string;
  href: string;
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <a className={cx(buttonRecipe({ variant }), className)} href={href}>
      {children}
    </a>
  );
}

export function Badge({
  children,
  className,
  tone = "light",
}: {
  children: ReactNode;
  className?: string;
  tone?: "light" | "dark" | "sample";
}) {
  return (
    <span
      className={cx(
        css({
          alignItems: "center",
          bg:
            tone === "dark"
              ? "rgba(10, 13, 58, 0.34)"
              : tone === "sample"
                ? "lavender.100"
                : "surface.tint",
          borderColor: tone === "dark" ? "border.onDark" : "border",
          borderRadius: "pill",
          borderWidth: "1px",
          color: tone === "dark" ? "text.onDark" : "violet.650",
          display: "inline-flex",
          fontSize: "xs",
          fontWeight: "700",
          gap: "2",
          minH: "28px",
          px: "3",
          whiteSpace: "nowrap",
        }),
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

export function AccordionItem({
  answer,
  question,
}: {
  answer: string;
  question: string;
}) {
  return (
    <details
      className={css({
        borderBottomColor: "border",
        borderBottomWidth: "1px",
        _last: { borderBottomWidth: "0" },
      })}
    >
      <summary
        className={css({
          alignItems: "center",
          color: "text.strong",
          cursor: "pointer",
          display: "flex",
          fontSize: "sm",
          fontWeight: "700",
          justifyContent: "space-between",
          minH: "46px",
          px: "4",
          _focusVisible: {
            outline: "3px solid token(colors.violet.400)",
            outlineOffset: "-3px",
          },
        })}
      >
        {question}
        <span aria-hidden="true">+</span>
      </summary>
      <p
        className={css({
          color: "text.muted",
          fontSize: "sm",
          lineHeight: "1.6",
          m: 0,
          px: "4",
          pb: "4",
        })}
      >
        {answer}
      </p>
    </details>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        css({
          bg: "rgba(255,255,255,0.16)",
          borderColor: "rgba(255,255,255,0.22)",
          borderRadius: "md",
          borderWidth: "1px",
          color: "text.onDark",
          minH: "44px",
          minW: 0,
          px: "3",
          width: "100%",
          _placeholder: { color: "text.onDarkMuted" },
          _focusVisible: {
            outline: "3px solid token(colors.violet.400)",
            outlineOffset: "2px",
          },
        }),
        className,
      )}
      {...props}
    />
  );
}

export function Separator({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx(css({ bg: "border", h: "1px", width: "100%" }), className)}
    />
  );
}

export function Table({
  rows,
}: {
  rows: Array<{ label: string; status: string; tone: "low" | "medium" | "high" }>;
}) {
  return (
    <table className={css({ borderCollapse: "collapse", fontSize: "xs", width: "100%" })}>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th
              className={css({
                borderTopColor: "border",
                borderTopWidth: "1px",
                color: "text.muted",
                fontWeight: "600",
                py: "2",
                textAlign: "left",
              })}
              scope="row"
            >
              {row.label}
            </th>
            <td
              className={css({
                borderTopColor: "border",
                borderTopWidth: "1px",
                color:
                  row.tone === "low"
                    ? "risk.lowDark"
                    : row.tone === "medium"
                      ? "risk.medium"
                      : "risk.high",
                fontWeight: "800",
                py: "2",
                textAlign: "right",
              })}
            >
              {row.status}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Tooltip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span className={css({ position: "relative" })} title={label}>
      {children}
    </span>
  );
}

export function Sheet({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
