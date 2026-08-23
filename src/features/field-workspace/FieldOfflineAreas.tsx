"use client";

import { useEffect, useState } from "react";
import { FieldDesk } from "@/features/field-desk/FieldDesk";
import { FieldExports } from "@/features/field-exports/FieldExports";
import { LegacyImportDiagnostics } from "@/features/field-ingestion/LegacyImportDiagnostics";
import type { PlannerProtocol } from "@/features/field-planning/field-planning-types";
import { FieldPlanRecorderBridge } from "@/features/field-recorder/FieldPlanRecorderBridge";
import { FieldRecorderShell } from "@/features/field-recorder/FieldRecorderShell";
import type { RecorderProtocol } from "@/features/field-recorder/load-recorder-protocol";

type OfflineArea = "plan" | "recorder" | "review" | "exports" | "diagnostics";

export function FieldOfflineAreas(props: {
  plannerProtocol: PlannerProtocol;
  protocol: RecorderProtocol;
}) {
  const [area, setArea] = useState<OfflineArea>("recorder");

  useEffect(() => {
    void Promise.all([
      import("@/features/field-desk/FieldDesk"),
      import("@/features/field-exports/FieldExports"),
      import("@/features/field-recorder/FieldPlanRecorderBridge"),
      import("@/features/field-ingestion/LegacyImportDiagnostics"),
    ]);
  }, []);

  return (
    <div data-field-offline-areas="plan recorder review exports diagnostics-recovery">
      <nav aria-label="Offline Field Workspace areas" className="mb-8 flex flex-wrap gap-2">
        {(
          [
            ["plan", "Plan"],
            ["recorder", "Recorder"],
            ["review", "Review"],
            ["exports", "Exports"],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-current={area === value ? "page" : undefined}
            className="min-h-11 rounded-lg border border-stone-400 bg-white px-4 py-2 text-sm font-semibold"
            key={value}
            onClick={() => setArea(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>
      <p className="sr-only">
        Prepared offline areas: Plan, Recorder, Review, and Exports. Diagnostics and Recovery is an
        exceptional recovery surface.
      </p>
      {area === "plan" ? (
        <FieldPlanRecorderBridge
          applicationVersion="0.1.0"
          embedded
          protocol={props.plannerProtocol}
        />
      ) : null}
      {area === "recorder" ? <FieldRecorderShell embedded protocol={props.protocol} /> : null}
      {area === "review" ? <FieldDesk embedded /> : null}
      {area === "exports" ? <FieldExports embedded /> : null}
      {area === "diagnostics" ? (
        <section aria-labelledby="offline-legacy-import-heading" id="offline-legacy-import">
          <h2 className="sr-only" id="offline-legacy-import-heading">
            Offline Diagnostics and Recovery destination
          </h2>
          <LegacyImportDiagnostics />
        </section>
      ) : null}
      <section
        aria-labelledby="offline-exceptional-heading"
        className="mt-8 border-t border-stone-300 pt-6"
      >
        <h2 className="text-sm font-semibold" id="offline-exceptional-heading">
          Exceptional recovery
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          Legacy Capture is isolated from ordinary Recorder, Plan, Review, and Exports work.
        </p>
        <button
          className="mt-3 min-h-11 rounded-lg border border-stone-500 bg-white px-4 py-2 text-sm font-semibold"
          onClick={() => setArea("diagnostics")}
          type="button"
        >
          Open Diagnostics and Recovery
        </button>
      </section>
    </div>
  );
}
