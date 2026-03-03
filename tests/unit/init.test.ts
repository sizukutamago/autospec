import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initAutospec } from "../../src/config/init.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "init-test-"));
}

describe("initAutospec", () => {
  it("creates .autospec/ directory structure", () => {
    const tmpDir = makeTmpDir();
    initAutospec(tmpDir);

    expect(fs.existsSync(path.join(tmpDir, ".autospec"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".autospec", "autospec.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".autospec", "contracts"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".autospec", "contracts", "api"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".autospec", "contracts", "external"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".autospec", "contracts", "files"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".autospec", "contracts", "internal"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".autospec", "concepts"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".autospec", "decisions"))).toBe(true);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("generates a valid autospec.yaml", () => {
    const tmpDir = makeTmpDir();
    initAutospec(tmpDir);

    const yamlContent = fs.readFileSync(
      path.join(tmpDir, ".autospec", "autospec.yaml"),
      "utf-8",
    );
    expect(yamlContent).toContain("pipeline:");
    expect(yamlContent).toContain("mode: full");
    expect(yamlContent).toContain("gates:");

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("does not overwrite existing autospec.yaml", () => {
    const tmpDir = makeTmpDir();
    const bpDir = path.join(tmpDir, ".autospec");
    fs.mkdirSync(bpDir, { recursive: true });
    fs.writeFileSync(path.join(bpDir, "autospec.yaml"), "custom: true\n");

    initAutospec(tmpDir);

    const content = fs.readFileSync(path.join(bpDir, "autospec.yaml"), "utf-8");
    expect(content).toBe("custom: true\n");

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("creates directories even if autospec.yaml exists", () => {
    const tmpDir = makeTmpDir();
    const bpDir = path.join(tmpDir, ".autospec");
    fs.mkdirSync(bpDir, { recursive: true });
    fs.writeFileSync(path.join(bpDir, "autospec.yaml"), "custom: true\n");

    initAutospec(tmpDir);

    expect(fs.existsSync(path.join(bpDir, "contracts", "api"))).toBe(true);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
