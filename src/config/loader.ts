import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { AutospecConfigSchema, type AutospecConfig } from "./schema.js";
import { DEFAULT_CONFIG } from "./defaults.js";

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (val !== undefined && val !== null && typeof val === "object" && !Array.isArray(val)) {
      result[key] = deepMerge(
        (result[key] as Record<string, unknown>) ?? {},
        val as Record<string, unknown>,
      );
    } else if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

export function loadConfig(projectRoot: string): AutospecConfig {
  const configPath = path.join(projectRoot, ".autospec", "autospec.yaml");

  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = yaml.load(raw);

    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_CONFIG;
    }

    const validated = AutospecConfigSchema.safeParse(parsed);
    if (!validated.success) {
      return DEFAULT_CONFIG;
    }

    // Deep merge user config onto defaults
    const merged = deepMerge(
      DEFAULT_CONFIG as unknown as Record<string, unknown>,
      validated.data as unknown as Record<string, unknown>,
    );

    return merged as unknown as AutospecConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}
