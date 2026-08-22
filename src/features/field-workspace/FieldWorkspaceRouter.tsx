"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { discoverPreparedFieldDevice } from "@/features/field-security/prepared-device";
import { IndexedDbFieldVault } from "@/features/field-security/vault";

export type FieldWorkspaceDestination =
  | "/operator/field/capture"
  | "/operator/field/plan"
  | "/operator/field/security-workspace";

type FieldWorkspaceRoutingDiscovery = {
  discoverPreparedDevice: () => Promise<{ prepared: boolean }>;
  getRecorderPointer: () => Promise<unknown | undefined>;
};

export async function discoverFieldWorkspaceDestination(
  discovery: FieldWorkspaceRoutingDiscovery = createBrowserDiscovery(),
): Promise<FieldWorkspaceDestination> {
  try {
    const device = await discovery.discoverPreparedDevice();
    if (!device.prepared) return "/operator/field/security-workspace";

    const pointer = await discovery.getRecorderPointer();
    return pointer ? "/operator/field/capture" : "/operator/field/plan";
  } catch {
    return "/operator/field/security-workspace";
  }
}

export function FieldWorkspaceRouter() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    discoverFieldWorkspaceDestination().then((destination) => {
      if (active) router.replace(destination);
    });
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-stone-50 px-6 py-12 text-stone-950">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
        Field Workspace
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Opening protected fieldwork</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-stone-700" role="status">
        Checking this device for prepared offline state. No Field Researcher identity or protected
        field data is being displayed.
      </p>
    </main>
  );
}

function createBrowserDiscovery(): FieldWorkspaceRoutingDiscovery {
  const vault = new IndexedDbFieldVault();
  return {
    discoverPreparedDevice: () => discoverPreparedFieldDevice(vault),
    getRecorderPointer: () => vault.getRecorderPointer(),
  };
}
