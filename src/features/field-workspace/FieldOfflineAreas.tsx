"use client";

import { useEffect } from "react";
import { LegacyImportDiagnostics } from "@/features/field-ingestion/LegacyImportDiagnostics";
import { FieldRecorderShell } from "@/features/field-recorder/FieldRecorderShell";
import type { RecorderProtocol } from "@/features/field-recorder/load-recorder-protocol";

export function FieldOfflineAreas(props: { protocol: RecorderProtocol }) {
  useEffect(() => {
    void Promise.all([
      import("@/features/field-desk/FieldDesk"),
      import("@/features/field-exports/FieldExports"),
      import("@/features/field-ingestion/LegacyImportDiagnostics"),
    ]);
  }, []);

  return (
    <div data-field-offline-areas="recorder review exports diagnostics-recovery">
      <p className="sr-only">
        Prepared offline areas: Recorder, Review, and Exports. Diagnostics and Recovery is an
        exceptional recovery surface.
      </p>
      <FieldRecorderShell embedded protocol={props.protocol} />
      <section
        aria-labelledby="offline-legacy-import-heading"
        className="mt-8"
        id="offline-legacy-import"
      >
        <h2 className="sr-only" id="offline-legacy-import-heading">
          Offline Diagnostics and Recovery destination
        </h2>
        <LegacyImportDiagnostics />
      </section>
    </div>
  );
}
