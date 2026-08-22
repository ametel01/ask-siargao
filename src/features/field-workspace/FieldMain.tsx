import type { ComponentPropsWithoutRef } from "react";

type FieldMainProps = Omit<ComponentPropsWithoutRef<"main">, "id" | "tabIndex"> & {
  /** Render content embedded inside another Field Workspace main landmark. */
  landmark?: boolean;
};

/** Shared keyboard destination for every Field Workspace surface. */
export function FieldMain(props: FieldMainProps) {
  const { landmark = true, ...elementProps } = props;
  if (!landmark) return <div {...elementProps} />;
  return <main {...elementProps} id="main-content" tabIndex={-1} />;
}
