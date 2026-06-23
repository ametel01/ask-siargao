const sensitiveKeyPattern = /secret|token|password|api[_-]?key|rawpayload|rawevent|authorization/i;
const secretStringPattern = /(sk|rk|pk|whsec|sess|pi|cs)_(test|live)?_[A-Za-z0-9_]+/g;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function redactDiagnosticValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        sensitiveKeyPattern.test(key) ? "[redacted]" : redactDiagnosticValue(nestedValue),
      ]),
    );
  }

  return value;
}

export function redactString(value: string) {
  return value
    .replace(emailPattern, "[redacted-email]")
    .replace(secretStringPattern, "[redacted-secret]");
}
