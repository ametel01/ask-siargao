"use client";

import { useEffect } from "react";

import { FieldRecorderShell } from "@/features/field-recorder/FieldRecorderShell";
import type { RecorderProtocol } from "@/features/field-recorder/load-recorder-protocol";

export function FieldOfflineAreas(props: { protocol: RecorderProtocol }) {
  useEffect(() => {
    void Promise.all([
      import("@/features/field-desk/FieldDesk"),
      import("@/features/field-exports/FieldExports"),
    ]);
  }, []);

  return (
    <div data-field-offline-areas="recorder review exports">
      <p className="sr-only">Prepared offline areas: Recorder, Review, and Exports.</p>
      <FieldRecorderShell protocol={props.protocol} />
    </div>
  );
}
