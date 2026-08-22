import { loadRecorderProtocol } from "@/features/field-recorder/load-recorder-protocol";
import { OfflineFieldUnlock } from "@/features/field-security/OfflineFieldUnlock";
import { FieldOfflineAreas } from "@/features/field-workspace/FieldOfflineAreas";

function FieldOfflineShell(props: { children?: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-stone-50 px-6 py-12 text-stone-950">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
        Field Workspace · Offline
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Protected fieldwork is locked</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-stone-700">
        This generic shell contains no Field Researcher identity or Protected Field Data. Unlock
        requires an unexpired device-bound Offline Field Grant and local user verification.
      </p>
      <OfflineFieldUnlock>{props.children}</OfflineFieldUnlock>
    </main>
  );
}

export default async function FieldOfflineShellPage() {
  const protocol = await loadRecorderProtocol();
  return (
    <FieldOfflineShell>
      <FieldOfflineAreas protocol={protocol} />
    </FieldOfflineShell>
  );
}
