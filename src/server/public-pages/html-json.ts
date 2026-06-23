const htmlUnsafeCharacters: Record<string, string> = {
  "&": "\\u0026",
  "<": "\\u003c",
  ">": "\\u003e",
};

export function serializeJsonForHtmlScript(value: unknown) {
  return JSON.stringify(value).replace(/[&<>]/g, (character) => htmlUnsafeCharacters[character]);
}
