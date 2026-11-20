export function findScriptJson(doc: Document, variableName: string): unknown {
  for (const script of Array.from(doc.scripts)) {
    const text = script.textContent ?? "";
    const index = text.indexOf(variableName);
    if (index < 0) continue;

    const start = text.indexOf("{", index);
    if (start < 0) continue;

    const jsonText = extractBalancedObject(text, start);
    if (!jsonText) continue;

    try {
      return JSON.parse(jsonText) as unknown;
    } catch {
      continue;
    }
  }

  return undefined;
}

function extractBalancedObject(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") inString = false;
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }

  return undefined;
}
