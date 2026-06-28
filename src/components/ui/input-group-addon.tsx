"use client";

import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

function InputGroupAddon({
  className,
  align = "inline-start",
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean;
  align?: "inline-start" | "inline-end" | "block-start" | "block-end";
}) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      data-slot="input-group-addon"
      data-align={align}
      className={cn(
        "flex h-auto cursor-text items-center justify-center gap-2 py-1.5 text-sm font-medium text-muted-foreground select-none group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*='size-'])]:size-4",
        className,
      )}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return;
        }
        const control = e.currentTarget.parentElement?.querySelector("input, textarea");
        if (control instanceof HTMLElement) {
          control.focus();
        }
      }}
      {...props}
    />
  );
}

export { InputGroupAddon };
