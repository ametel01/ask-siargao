"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { canonicalLegacyImportRoute } from "@/features/field-ingestion/legacy-import-routing";

const ordinaryAreas = [
  ["Plan", "/operator/field/plan"],
  ["Capture", "/operator/field/capture"],
  ["Review", "/operator/field/review"],
  ["Exports", "/operator/field/exports"],
] as const;

export function FieldWorkspaceNavigation() {
  const pathname = usePathname();
  return (
    <div className="border-b border-[#ddd8ef] bg-[#fffdf7] px-4 py-3 text-[#0d104a]">
      <div className="mx-auto flex max-w-[73.75rem] flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Field Workspace ordinary areas"
          className="flex flex-wrap gap-1 text-sm font-bold"
        >
          {ordinaryAreas.map(([label, href]) => (
            <Link
              aria-current={pathname === href ? "page" : undefined}
              className={`min-h-11 rounded-lg px-4 py-3 ${pathname === href ? "bg-[#ddfbf4] text-[#062f35]" : "hover:bg-[#f5f3ff]"}`}
              href={href}
              key={href}
            >
              {label}
            </Link>
          ))}
        </nav>
        <nav
          aria-label="Diagnostics and Recovery"
          className="border-l-4 border-[#e2a23a] pl-3 text-sm"
        >
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#704314]">
            Exceptional area
          </p>
          <Link
            aria-current={pathname === canonicalLegacyImportRoute ? "page" : undefined}
            className="inline-flex min-h-11 items-center font-bold text-[#5d3ed1] underline decoration-2 underline-offset-4"
            href={canonicalLegacyImportRoute}
          >
            Diagnostics and Recovery
          </Link>
          <span className="ml-2 text-[#5f5f87]">
            Restoration, device diagnostics, or Legacy Capture only
          </span>
        </nav>
      </div>
    </div>
  );
}
