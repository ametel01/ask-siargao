import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";

export const fieldControlClass =
  "mt-1 min-h-11 w-full rounded-lg border border-[var(--brand-lavender-300)] bg-[var(--surface-default)] px-3 py-2 text-base text-[var(--text-default)] outline-none focus-visible:border-[var(--brand-lagoon-700)] focus-visible:ring-3 focus-visible:ring-[var(--brand-lagoon-300)]/50";

export function Field(props: { children: ReactNode; hint?: string; label: string; name: string }) {
  const hintId = props.hint ? `${props.name}-hint` : undefined;
  return (
    <label className="block text-sm font-medium text-[var(--text-strong)]" htmlFor={props.name}>
      {props.label}
      <span className="block">{props.children}</span>
      {props.hint ? (
        <span id={hintId} className="mt-1 block text-xs font-normal text-[var(--text-muted)]">
          {props.hint}
        </span>
      ) : null}
    </label>
  );
}

export function TextField(props: {
  defaultValue?: string;
  hint?: string;
  label: string;
  name: string;
  required?: boolean;
  type?: "date" | "datetime-local" | "email" | "number" | "text" | "url";
}) {
  return (
    <Field hint={props.hint} label={props.label} name={props.name}>
      <Input
        aria-describedby={props.hint ? `${props.name}-hint` : undefined}
        className="mt-1 border-[var(--brand-lavender-300)] bg-[var(--surface-default)]"
        defaultValue={props.defaultValue}
        id={props.name}
        name={props.name}
        required={props.required}
        type={props.type ?? "text"}
      />
    </Field>
  );
}

export function TextAreaField(props: {
  hint?: string;
  label: string;
  name: string;
  required?: boolean;
  rows?: number;
}) {
  return (
    <Field hint={props.hint} label={props.label} name={props.name}>
      <textarea
        aria-describedby={props.hint ? `${props.name}-hint` : undefined}
        className={fieldControlClass}
        id={props.name}
        name={props.name}
        required={props.required}
        rows={props.rows ?? 3}
      />
    </Field>
  );
}

export function SelectField(props: {
  defaultValue?: string;
  hint?: string;
  label: string;
  name: string;
  options: readonly (readonly [string, string])[];
  required?: boolean;
}) {
  return (
    <Field hint={props.hint} label={props.label} name={props.name}>
      <select
        aria-describedby={props.hint ? `${props.name}-hint` : undefined}
        className={fieldControlClass}
        defaultValue={props.defaultValue}
        id={props.name}
        name={props.name}
        required={props.required}
      >
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckboxField(props: { label: string; name: string; value?: string }) {
  return (
    <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--brand-lavender-200)] bg-[var(--surface-default)] px-3 py-2 text-sm text-[var(--text-default)]">
      <input
        className="size-5 accent-[var(--brand-lagoon-700)]"
        name={props.name}
        type="checkbox"
        value={props.value}
      />
      <span>{props.label}</span>
    </label>
  );
}

export function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

export function options(values: readonly string[]) {
  return values.map((value) => [value, humanize(value)] as const);
}

export function strings(data: FormData, name: string): string[] {
  return data
    .getAll(name)
    .map(String)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function string(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

export function number(data: FormData, name: string): number {
  return Number(string(data, name));
}

export function checked(data: FormData, name: string): boolean {
  return data.get(name) === "on";
}
