import { readFileSync } from "node:fs";
import path from "node:path";

export function loadPromptTemplate(rootDir, name) {
  return readFileSync(path.join(rootDir, "prompts", `${name}.md`), "utf8");
}

export function interpolateTemplate(template, values) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`Missing template value: ${key}`);
    }
    return String(values[key]);
  });
}
