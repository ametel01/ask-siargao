import { ArrowRight, CheckCircle2 } from "lucide-react";

import { siteConfig } from "@/lib/site";
import { css } from "../../styled-system/css";
import { button, panel } from "../../styled-system/recipes";

export default function Home() {
  return (
    <main
      className={css({
        minH: "100vh",
        px: { base: "4", md: "6" },
        py: { base: "5", md: "8" },
      })}
    >
      <section
        className={css({
          display: "grid",
          gap: { base: "8", lg: "12" },
          gridTemplateColumns: { base: "1fr", lg: "1.05fr 0.95fr" },
          maxW: "1180px",
          mx: "auto",
          pt: { base: "12", md: "18" },
        })}
      >
        <div>
          <p
            className={css({
              color: "text.onDarkMuted",
              fontSize: "sm",
              fontWeight: "700",
              mb: "4",
            })}
          >
            Siargao Trip Risk Audit
          </p>
          <h1
            className={css({
              color: "text.onDark",
              fontSize: { base: "3xl", md: "4xl" },
              fontWeight: "800",
              lineHeight: "1.08",
              maxW: "760px",
              mb: "5",
            })}
          >
            Find the trip risks before they become expensive problems.
          </h1>
          <p
            className={css({
              color: "text.onDarkMuted",
              fontSize: { base: "md", md: "lg" },
              lineHeight: "1.65",
              maxW: "640px",
              mb: "7",
            })}
          >
            {siteConfig.promise}
          </p>
          <a className={button({ variant: "primary" })} href="#audit-start">
            Start audit <ArrowRight aria-hidden="true" size={18} />
          </a>
        </div>

        <aside
          aria-label="Audit preview"
          className={panel({
            className: css({
              p: { base: "5", md: "6" },
            }),
          })}
        >
          <div
            className={css({
              alignItems: "center",
              display: "flex",
              gap: "3",
              mb: "4",
            })}
          >
            <CheckCircle2 aria-hidden="true" color="#2e8a38" size={22} />
            <h2
              className={css({
                color: "text.strong",
                fontSize: "xl",
                fontWeight: "800",
                lineHeight: "1.2",
                m: 0,
              })}
            >
              Quality gates are online
            </h2>
          </div>
          <p
            className={css({
              color: "text.muted",
              fontSize: "sm",
              lineHeight: "1.65",
              m: 0,
            })}
          >
            This scaffold proves the app shell, Panda CSS, type checking, Bun tests, production
            build, and Playwright smoke coverage before product implementation begins.
          </p>
        </aside>
      </section>
    </main>
  );
}
