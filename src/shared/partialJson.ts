export function extractPartialJsonStringValue(buffer: string, key: string): string | undefined {
  const source = extractPartialJsonSource(buffer);
  const keyStart = findJsonObjectKey(source, key);
  if (keyStart < 0) return undefined;

  let index = keyStart + key.length + 2;
  while (index < source.length && /\s/u.test(source[index] ?? "")) index += 1;
  if (source[index] !== ":") return undefined;
  index += 1;
  while (index < source.length && /\s/u.test(source[index] ?? "")) index += 1;
  if (source[index] !== "\"") return undefined;

  return readPartialJsonString(source, index + 1);
}

export function extractPartialJsonSource(buffer: string): string {
  const trimmed = buffer.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*)/i);
  return fenceMatch?.[1] ?? trimmed;
}

function findJsonObjectKey(source: string, key: string): number {
  const quotedKey = `"${key}"`;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (source.startsWith(quotedKey, index)) return index;
    if (char === "\"") inString = true;
  }

  return -1;
}

function readPartialJsonString(source: string, start: number): string {
  let value = "";
  let index = start;

  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === "\"") return value;

    if (char !== "\\") {
      value += char;
      index += 1;
      continue;
    }

    const next = source[index + 1];
    if (!next) return value;
    if (next === "n") value += "\n";
    else if (next === "r") value += "\r";
    else if (next === "t") value += "\t";
    else if (next === "b") value += "\b";
    else if (next === "f") value += "\f";
    else if (next === "u") {
      const hex = source.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/u.test(hex)) return value;
      value += String.fromCharCode(parseInt(hex, 16));
      index += 6;
      continue;
    } else {
      value += next;
    }
    index += 2;
  }

  return value;
}
