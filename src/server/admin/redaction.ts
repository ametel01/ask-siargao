const sensitiveKeyPattern =
  /authorization|body|cookie|email|identity|ip(?:address)?|latitude|longitude|message(?:content)?|paymentintent|precise.?location|prompt|provider.?payload|raw(?:payload|event|webhook)|requestid|secret|sessionid|stripe.?id|token|password|api[_-]?key|userid/i;
const secretStringPattern = /(sk|rk|pk|whsec|sess|pi|cs)_(test|live)?_[A-Za-z0-9_]+/g;
const hyphenatedSecretStringPattern = /\b(sk|rk|pk|whsec|sess|pi|cs)-[A-Za-z0-9_-]{12,}\b/g;
const bearerSecretPattern = /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi;
const keyValueSecretPattern = /\b(api[_-]?key|apikey|token|secret)\s*[=:]\s*[^,\s;]+/gi;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const ipAddressPattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const providerIdentifierPattern =
  /\b(?:acct|app|ch|cs|cus|dp|evt|in|ins|inv|org|pi|pm|price|prod|re|role|seti|sess|src|sub|user)_[A-Za-z0-9][A-Za-z0-9_]{7,}\b/g;

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

function redactString(value: string) {
  return value
    .replace(emailPattern, "[redacted-email]")
    .replace(ipAddressPattern, "[redacted-ip]")
    .replace(providerIdentifierPattern, "[redacted-provider-id]")
    .replace(bearerSecretPattern, "[redacted-secret]")
    .replace(secretStringPattern, "[redacted-secret]")
    .replace(hyphenatedSecretStringPattern, "[redacted-secret]")
    .replace(keyValueSecretPattern, "[redacted-secret]");
}
