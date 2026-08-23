"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { FieldDayPlanner } from "@/features/field-planning/FieldDayPlanner";
import type {
  FieldCoverageSnapshot,
  FieldPlanSnapshot,
  PlannerInputs,
  PlannerProtocol,
} from "@/features/field-planning/field-planning-types";
import {
  type FieldPlannerReadinessHandoff,
  loadPlannerReadiness,
} from "@/features/field-planning/planner-readiness-vault";
import { useFieldSecuritySession } from "@/features/field-security/FieldSecuritySessionProvider";
import { OfflineFieldUnlock } from "@/features/field-security/OfflineFieldUnlock";
import { FieldMain } from "@/features/field-workspace/FieldMain";

import { FieldRecorderRepository } from "./field-recorder-repository";
import { createRecorderWork } from "./field-recorder-state";

export function FieldPlanRecorderBridge(props: {
  applicationVersion: string;
  protocol: PlannerProtocol;
  coverageSnapshot?: FieldCoverageSnapshot;
  initialInputs?: PlannerInputs;
}) {
  const router = useRouter();
  const security = useFieldSecuritySession();
  const claims = security.claims;
  const [readiness, setReadiness] = useState<
    Pick<FieldPlannerReadinessHandoff, "coverageSnapshot" | "inputs"> | undefined
  >(
    props.coverageSnapshot && props.initialInputs
      ? { coverageSnapshot: props.coverageSnapshot, inputs: props.initialInputs }
      : undefined,
  );
  const [readinessState, setReadinessState] = useState(
    "No approved Field Readiness handoff is available.",
  );

  useEffect(() => {
    if (security.status !== "unlocked" || readiness) return;
    let mounted = true;
    void security
      .withVaultKey((key) => loadPlannerReadiness(props.protocol, key))
      .then((handoff) => {
        if (!mounted) return;
        if (handoff) {
          setReadiness({ coverageSnapshot: handoff.coverageSnapshot, inputs: handoff.inputs });
          setReadinessState(`Approved local readiness ${handoff.source.id} loaded.`);
        } else {
          setReadinessState("Unlock the vault, then import an approved Field Readiness handoff.");
        }
      })
      .catch(() => {
        if (mounted)
          setReadinessState("Readiness handoff could not be verified. Planning is blocked.");
      });
    return () => {
      mounted = false;
    };
  }, [props.protocol, readiness, security]);

  const confirm = useCallback(
    async (snapshot: FieldPlanSnapshot) => {
      const now = new Date().toISOString();
      const work = createRecorderWork({ id: crypto.randomUUID(), now, snapshot });
      const repository = new FieldRecorderRepository({
        applicationVersion: props.applicationVersion,
      });
      await security.withVaultKey((key) => repository.initialize({ key, work }));
      router.push("/operator/field/capture");
    },
    [props.applicationVersion, router, security],
  );

  return (
    <>
      {security.status !== "unlocked" ? <OfflineFieldUnlock /> : null}
      {readiness ? (
        <FieldDayPlanner
          confirmationIdentity={
            claims ? { deviceId: claims.deviceId, researcherId: claims.accountId } : undefined
          }
          coverageSnapshot={readiness.coverageSnapshot}
          initialInputs={readiness.inputs}
          onConfirm={confirm}
          protocol={props.protocol}
        />
      ) : (
        <ReadinessHandoffPanel message={readinessState} />
      )}
    </>
  );
}

function ReadinessHandoffPanel(props: { message: string }) {
  return (
    <FieldMain className="mx-auto min-h-screen max-w-3xl bg-[var(--surface-soft)] px-6 py-12 text-[var(--text-default)]">
      <section className="rounded-2xl bg-[var(--surface-default)] p-6 shadow-[var(--shadow-panel)]">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--brand-reef-700)]">
          Protected Field Readiness
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-[var(--text-strong)]">
          Field Readiness is unavailable
        </h1>
        <p className="mt-3 text-[var(--text-muted)]">{props.message}</p>
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Unknown or mismatched evidence remains blocked and is never replaced with a fixture.
        </p>
        <a
          className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-[var(--brand-reef-700)] px-4 py-2 font-semibold text-white"
          href="/operator/field/diagnostics-recovery/legacy-import"
        >
          Open Diagnostics and Recovery
        </a>
      </section>
    </FieldMain>
  );
}
