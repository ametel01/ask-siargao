import { sampleReport } from "@/server/audit/sample-report";
import { publicKnowledgePages } from "@/server/public-pages/public-content";

export type ReleaseCandidateDemoPath = {
  label: string;
  path: string;
  purpose: string;
};

export type ReleaseCandidateDemoScenario = {
  id: string;
  title: string;
  dataPolicy: "synthetic_or_permitted_only";
  paths: ReleaseCandidateDemoPath[];
  evidenceIds: string[];
  publicEvidenceIds: string[];
};

export const releaseCandidateDemoScenario: ReleaseCandidateDemoScenario = {
  id: "siargao-rc-local",
  title: "Siargao release-candidate local QA scenario",
  dataPolicy: "synthetic_or_permitted_only",
  paths: [
    { label: "Landing and intake", path: "/", purpose: "Submit the minimum viable audit intake." },
    {
      label: "Checkout return status",
      path: "/audits/audit_123/status?state=awaiting_payment",
      purpose: "Confirm return from Checkout does not unlock reports.",
    },
    {
      label: "Paid report fixture",
      path: "/audits/audit_123/report",
      purpose: "Verify evidence-backed report rendering and limitations.",
    },
    {
      label: "Admin diagnostics",
      path: "/admin/diagnostics",
      purpose: "Inspect redacted operator diagnostics locally.",
    },
    {
      label: "Public accommodation page",
      path: "/accommodations/example-surf-stay",
      purpose: "Verify public human content from republishable facts.",
    },
    {
      label: "Agent Markdown",
      path: "/accommodations/example-surf-stay/llm.md",
      purpose: "Verify LLM-readable content matches the human facts.",
    },
    {
      label: "Public JSON",
      path: "/api/public/accommodations/example-surf-stay.json",
      purpose: "Verify machine-readable public facts.",
    },
    { label: "Sitemap", path: "/sitemap.xml", purpose: "Verify public crawl discovery." },
    { label: "LLMs index", path: "/llms.txt", purpose: "Verify agent-readable index discovery." },
    { label: "Robots", path: "/robots.txt", purpose: "Verify private crawl exclusions." },
  ],
  evidenceIds: sampleReport.evidence.map((evidence) => evidence.evidenceId),
  publicEvidenceIds: publicKnowledgePages.flatMap((page) =>
    page.facts.map((fact) => fact.evidenceId),
  ),
};

export function validateReleaseCandidateDemoScenario(
  scenario: ReleaseCandidateDemoScenario = releaseCandidateDemoScenario,
) {
  const errors: string[] = [];

  if (scenario.dataPolicy !== "synthetic_or_permitted_only") {
    errors.push("demo_data_policy_not_synthetic_or_permitted");
  }

  if (!scenario.paths.some((entry) => entry.path === "/")) {
    errors.push("landing_path_missing");
  }

  if (!scenario.paths.some((entry) => entry.path === "/robots.txt")) {
    errors.push("robots_path_missing");
  }

  for (const evidenceId of scenario.evidenceIds) {
    if (!evidenceId.startsWith("ev_")) {
      errors.push(`unexpected_private_evidence_id:${evidenceId}`);
    }
  }

  for (const evidenceId of scenario.publicEvidenceIds) {
    if (!evidenceId.startsWith("public_ev_")) {
      errors.push(`unexpected_public_evidence_id:${evidenceId}`);
    }
  }

  for (const page of publicKnowledgePages) {
    for (const fact of page.facts) {
      if (
        !fact.publicRepublishAllowed ||
        fact.containsPrivateUserData ||
        fact.includesRawProviderPayload
      ) {
        errors.push(`unsafe_public_fact:${fact.id}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
