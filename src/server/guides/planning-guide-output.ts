import type { PlanningGuide } from "@/server/guides/planning-guide-types";
import { buildCanonicalSiteUrl } from "@/server/public-pages/canonical-urls";

export const planningGuidesPath = "/guides";

export function planningGuidePath(guideOrSlug: PlanningGuide | string) {
  const slug = typeof guideOrSlug === "string" ? guideOrSlug : guideOrSlug.slug;
  return `${planningGuidesPath}/${slug}`;
}

export function planningGuideMarkdownPath(guideOrSlug: PlanningGuide | string) {
  return `${planningGuidePath(guideOrSlug)}/llm.md`;
}

export function planningGuideSitemapEntries(guides: readonly PlanningGuide[]) {
  const latestChecked = guides
    .map((guide) => guide.lastChecked)
    .toSorted()
    .at(-1);

  return [
    { path: planningGuidesPath, lastModified: latestChecked },
    ...guides.map((guide) => ({
      path: planningGuidePath(guide),
      lastModified: guide.lastChecked,
    })),
  ];
}

export function planningGuideLlmsLines(guides: readonly PlanningGuide[]) {
  return [
    "## Planning guides",
    "Editorial guides show author and reviewer roles, a last-checked date, visible sources, known limitations, and planning-estimate caveats. They do not assign fact confidence scores or source types.",
    "",
    ...guides.map(
      (guide) =>
        `- [${guide.title}](${buildCanonicalSiteUrl(planningGuidePath(guide))}): [LLM-ready Markdown](${buildCanonicalSiteUrl(planningGuideMarkdownPath(guide))}).`,
    ),
  ];
}

export function buildPlanningGuideJsonLd(guide: PlanningGuide) {
  const canonicalUrl = buildCanonicalSiteUrl(planningGuidePath(guide));
  const organizationId = `${buildCanonicalSiteUrl("/")}#organization`;
  const destinationId = `${buildCanonicalSiteUrl(planningGuidesPath)}#siargao`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: guide.title,
        description: guide.description,
        image: buildCanonicalSiteUrl(guide.image.src),
        mainEntityOfPage: canonicalUrl,
        about: { "@id": destinationId },
        author: { "@type": "Organization", name: guide.author.name },
        reviewedBy: { "@type": "Organization", name: guide.reviewer.name },
        publisher: { "@id": organizationId },
        citation: guide.sources.map((source) => source.url),
      },
      {
        "@type": "Organization",
        "@id": organizationId,
        name: "Ask Siargao",
        url: buildCanonicalSiteUrl("/"),
        logo: buildCanonicalSiteUrl("/ask_siargao_palm_icon.svg"),
      },
      {
        "@type": "TouristDestination",
        "@id": destinationId,
        name: "Siargao Island",
        description:
          "A Philippine island destination covered by Ask Siargao's practical planning guides.",
        url: buildCanonicalSiteUrl(planningGuidesPath),
        containedInPlace: { "@type": "Country", name: "Philippines" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Ask Siargao",
            item: buildCanonicalSiteUrl("/"),
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Planning guides",
            item: buildCanonicalSiteUrl(planningGuidesPath),
          },
          {
            "@type": "ListItem",
            position: 3,
            name: guide.title,
            item: canonicalUrl,
          },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: guide.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      },
    ],
  };
}

export function buildPlanningGuideMarkdown(guide: PlanningGuide) {
  const sections = guide.sections.flatMap((section) => [
    `## ${section.title}`,
    "",
    section.introduction,
    "",
    ...section.items.map(
      (content) =>
        `- **${content.title}:** ${content.body}${content.note ? ` ${content.note}` : ""}`,
    ),
    "",
  ]);
  const times = guide.travelTimes.map(
    (time) => `- ${time.from} → ${time.to}: ${time.estimate}. ${time.planFor}`,
  );
  const sources = guide.sources.map(
    (source) => `- [${source.name}](${source.url}) — ${source.publisher}. ${source.usedFor}`,
  );
  const faqs = guide.faqs.flatMap((faq) => [`### ${faq.question}`, "", faq.answer, ""]);

  return [
    `# ${guide.title}`,
    "",
    guide.description,
    "",
    `Canonical: ${buildCanonicalSiteUrl(planningGuidePath(guide))}`,
    `Last checked: ${guide.lastChecked}`,
    `Author: ${guide.author.name} — ${guide.author.role}`,
    `Reviewer: ${guide.reviewer.name} — ${guide.reviewer.role}`,
    "",
    "## Quick recommendation",
    "",
    guide.quickRecommendation,
    "",
    ...sections,
    "## Realistic travel-time guide",
    "",
    ...times,
    "",
    "## Frequently asked questions",
    "",
    ...faqs,
    "## Sources",
    "",
    ...sources,
    "",
    "## Limitations",
    "",
    ...guide.limitations.map((limitation) => `- ${limitation}`),
    "",
  ].join("\n");
}
