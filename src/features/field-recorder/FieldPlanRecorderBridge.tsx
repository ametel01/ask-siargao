"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { FieldDayPlanner } from "@/features/field-planning/FieldDayPlanner";
import type {
  FieldCoverageSnapshot,
  FieldPlanSnapshot,
  PlannerInputs,
  PlannerProtocol,
} from "@/features/field-planning/field-planning-types";
import { useFieldSecuritySession } from "@/features/field-security/FieldSecuritySessionProvider";
import { OfflineFieldUnlock } from "@/features/field-security/OfflineFieldUnlock";

import { FieldRecorderRepository } from "./field-recorder-repository";
import { createRecorderWork } from "./field-recorder-state";

export function FieldPlanRecorderBridge(props: {
  applicationVersion: string;
  protocol: PlannerProtocol;
  coverageSnapshot: FieldCoverageSnapshot;
  initialInputs: PlannerInputs;
}) {
  const router = useRouter();
  const security = useFieldSecuritySession();
  const claims = security.claims;

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
      <FieldDayPlanner
        confirmationIdentity={
          claims ? { deviceId: claims.deviceId, researcherId: claims.accountId } : undefined
        }
        coverageSnapshot={props.coverageSnapshot}
        initialInputs={props.initialInputs}
        onConfirm={confirm}
        protocol={props.protocol}
      />
    </>
  );
}
