type ParseModelJsonOptions = {
  prefer?: (value: unknown) => boolean;
  errorPrefix: string;
};

export function parseModelJson(raw: string, options: ParseModelJsonOptions): unknown {
  // 空输入时 "没有找到 JSON 对象" 会把「模型什么都没返回」误报成「返回了但没 JSON」，
  // 诊断上看不出是传输层丢了正文。这里把两种情况分开报。
  if (!raw.trim()) throw new Error(`${options.errorPrefix}：模型返回内容为空`);

  const jsonTexts = extractJsonTextCandidates(raw);
  let firstParsed: unknown;
  let lastError: unknown;

  for (const jsonText of jsonTexts) {
    for (const candidate of buildJsonRepairCandidates(jsonText)) {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        firstParsed ??= parsed;
        if (!options.prefer || options.prefer(parsed)) return parsed;
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (firstParsed !== undefined) return firstParsed;

  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? "没有找到 JSON 对象");
  throw new Error(`${options.errorPrefix}：${detail}`);
}

function buildJsonRepairCandidates(jsonText: string): string[] {
  const candidates = new Set<string>();
  const add = (value: string): void => {
    const addVariant = (candidate: string): void => {
      const withCommas = insertMissingCommasBetweenObjectPropertiesOutsideStrings(candidate);
      const quotedWithCommas = quoteUnquotedObjectKeysOutsideStrings(withCommas);
      const repairedQuotedWithCommas = insertMissingColonsAfterQuotedObjectKeysOutsideStrings(quotedWithCommas);
      candidates.add(candidate);
      candidates.add(stripTrailingCommasOutsideStrings(candidate));
      candidates.add(withCommas);
      candidates.add(stripTrailingCommasOutsideStrings(withCommas));
      candidates.add(quotedWithCommas);
      candidates.add(stripTrailingCommasOutsideStrings(quotedWithCommas));
      candidates.add(repairedQuotedWithCommas);
      candidates.add(stripTrailingCommasOutsideStrings(repairedQuotedWithCommas));
    };
    const quotedKeysWithColons = insertMissingColonsAfterQuotedObjectKeysOutsideStrings(value);
    const unquotedKeys = quoteUnquotedObjectKeysOutsideStrings(value);
    const repairedKeys = insertMissingColonsAfterQuotedObjectKeysOutsideStrings(unquotedKeys);
    addVariant(value);
    addVariant(unquotedKeys);
    addVariant(quotedKeysWithColons);
    addVariant(repairedKeys);
  };
  add(jsonText);
  add(escapeControlCharactersInStrings(jsonText));
  return Array.from(candidates);
}

function stripTrailingCommasOutsideStrings(jsonText: string): string {
  let repaired = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < jsonText.length; index += 1) {
    const char = jsonText[index];

    if (inString) {
      repaired += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      repaired += char;
      continue;
    }

    if (char === ",") {
      let next = index + 1;
      while (/\s/.test(jsonText[next] ?? "")) next += 1;
      if (jsonText[next] === "}" || jsonText[next] === "]") continue;
    }

    repaired += char;
  }

  return repaired;
}

function escapeControlCharactersInStrings(jsonText: string): string {
  let repaired = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < jsonText.length; index += 1) {
    const char = jsonText[index];

    if (inString) {
      if (escaped) {
        repaired += char;
        escaped = false;
      } else if (char === "\\") {
        repaired += char;
        escaped = true;
      } else if (char === "\"") {
        repaired += char;
        inString = false;
      } else if (char === "\n") {
        repaired += "\\n";
      } else if (char === "\r") {
        repaired += "\\r";
      } else if (char === "\t") {
        repaired += "\\t";
      } else if (char < " ") {
        repaired += `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
      } else {
        repaired += char;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    }
    repaired += char;
  }

  return repaired;
}

function quoteUnquotedObjectKeysOutsideStrings(jsonText: string): string {
  let repaired = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < jsonText.length; index += 1) {
    const char = jsonText[index];

    if (inString) {
      repaired += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      repaired += char;
      continue;
    }

    if (char === "{" || char === ",") {
      repaired += char;
      let cursor = index + 1;
      let whitespace = "";
      while (/\s/.test(jsonText[cursor] ?? "")) {
        whitespace += jsonText[cursor];
        cursor += 1;
      }
      const keyStart = cursor;
      if (/[A-Za-z_]/.test(jsonText[cursor] ?? "")) {
        cursor += 1;
        while (/[A-Za-z0-9_]/.test(jsonText[cursor] ?? "")) cursor += 1;
        const key = jsonText.slice(keyStart, cursor);
        let afterKey = "";
        while (/\s/.test(jsonText[cursor] ?? "")) {
          afterKey += jsonText[cursor];
          cursor += 1;
        }
        if (jsonText[cursor] === ":") {
          repaired += `${whitespace}"${key}"${afterKey}:`;
          index = cursor;
          continue;
        }
      }
      repaired += whitespace;
      index = keyStart - 1;
      continue;
    }

    repaired += char;
  }

  return repaired;
}

function insertMissingColonsAfterQuotedObjectKeysOutsideStrings(jsonText: string): string {
  let repaired = "";
  const stack: Array<{ type: "object" | "array"; expectingKey: boolean }> = [];

  const top = (): { type: "object" | "array"; expectingKey: boolean } | undefined => stack[stack.length - 1];
  const isValueStart = (char: string | undefined): boolean => Boolean(char && "\"{[-0123456789tfn".includes(char));

  for (let index = 0; index < jsonText.length; index += 1) {
    const char = jsonText[index];

    if (char === "\"") {
      const stringStart = index;
      index += 1;
      let escaped = false;
      while (index < jsonText.length) {
        const nextChar = jsonText[index];
        if (escaped) {
          escaped = false;
        } else if (nextChar === "\\") {
          escaped = true;
        } else if (nextChar === "\"") {
          break;
        }
        index += 1;
      }
      repaired += jsonText.slice(stringStart, index + 1);

      const context = top();
      if (context?.type === "object" && context.expectingKey) {
        let cursor = index + 1;
        let whitespace = "";
        while (/\s/.test(jsonText[cursor] ?? "")) {
          whitespace += jsonText[cursor];
          cursor += 1;
        }
        if (jsonText[cursor] !== ":" && isValueStart(jsonText[cursor])) {
          repaired += `${whitespace}:`;
          context.expectingKey = false;
          index = cursor - 1;
        }
      }
      continue;
    }

    repaired += char;
    if (char === "{") {
      stack.push({ type: "object", expectingKey: true });
    } else if (char === "[") {
      stack.push({ type: "array", expectingKey: false });
    } else if (char === "}" || char === "]") {
      stack.pop();
    } else if (char === ":" && top()?.type === "object") {
      top()!.expectingKey = false;
    } else if (char === "," && top()?.type === "object") {
      top()!.expectingKey = true;
    }
  }

  return repaired;
}

function insertMissingCommasBetweenObjectPropertiesOutsideStrings(jsonText: string): string {
  let repaired = "";
  const stack: Array<"object" | "array"> = [];

  const top = (): "object" | "array" | undefined => stack[stack.length - 1];
  const previousSignificant = (beforeIndex: number): string | undefined => {
    let cursor = beforeIndex - 1;
    while (/\s/.test(jsonText[cursor] ?? "")) cursor -= 1;
    return jsonText[cursor];
  };
  const appendCommaBeforeNextKey = (cursor: number): void => {
    if (top() !== "object") return;
    if (isNextObjectPropertyKey(jsonText, cursor)) repaired += ",";
  };

  for (let index = 0; index < jsonText.length; index += 1) {
    const char = jsonText[index];

    if (char === "\"") {
      const stringStart = index;
      index += 1;
      let escaped = false;
      while (index < jsonText.length) {
        const nextChar = jsonText[index];
        if (escaped) {
          escaped = false;
        } else if (nextChar === "\\") {
          escaped = true;
        } else if (nextChar === "\"") {
          break;
        }
        index += 1;
      }
      repaired += jsonText.slice(stringStart, index + 1);
      if (!["{", ","].includes(previousSignificant(stringStart) ?? "")) {
        appendCommaBeforeNextKey(index + 1);
      }
      continue;
    }

    repaired += char;
    if (char === "{") {
      stack.push("object");
    } else if (char === "[") {
      stack.push("array");
    } else if (char === "}" || char === "]") {
      stack.pop();
      appendCommaBeforeNextKey(index + 1);
    } else if (/[0-9eE.+-]/.test(char) && !/[0-9eE.+-]/.test(jsonText[index + 1] ?? "")) {
      appendCommaBeforeNextKey(index + 1);
    } else if (/[a-z]/i.test(char)) {
      const wordStart = index;
      while (/[a-z]/i.test(jsonText[index + 1] ?? "")) index += 1;
      const word = jsonText.slice(wordStart, index + 1);
      repaired += word.slice(1);
      if (word === "true" || word === "false" || word === "null") appendCommaBeforeNextKey(index + 1);
    }
  }

  return repaired;
}

function isNextObjectPropertyKey(jsonText: string, start: number): boolean {
  let cursor = start;
  while (/\s/.test(jsonText[cursor] ?? "")) cursor += 1;
  if (jsonText[cursor] === "}") return false;

  if (jsonText[cursor] === "\"") {
    cursor += 1;
    let escaped = false;
    while (cursor < jsonText.length) {
      const char = jsonText[cursor];
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        break;
      }
      cursor += 1;
    }
    cursor += 1;
  } else if (/[A-Za-z_]/.test(jsonText[cursor] ?? "")) {
    cursor += 1;
    while (/[A-Za-z0-9_]/.test(jsonText[cursor] ?? "")) cursor += 1;
  } else {
    return false;
  }

  while (/\s/.test(jsonText[cursor] ?? "")) cursor += 1;
  return jsonText[cursor] === ":";
}

function extractJsonTextCandidates(raw: string): string[] {
  const candidates = new Set<string>();
  const add = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed) candidates.add(trimmed);
  };

  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) add(fenceMatch[1]);

  const firstObject = raw.indexOf("{");
  const lastObject = raw.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) add(raw.slice(firstObject, lastObject + 1));

  const firstArray = raw.indexOf("[");
  const lastArray = raw.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) add(raw.slice(firstArray, lastArray + 1));

  for (const jsonText of extractBalancedJsonTexts(raw)) {
    add(jsonText);
  }

  add(raw);
  return Array.from(candidates);
}

function extractBalancedJsonTexts(raw: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

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

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      if (depth === 0) start = index;
      depth += 1;
    } else if ((char === "}" || char === "]") && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}
