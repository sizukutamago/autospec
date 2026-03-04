import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import yaml from "js-yaml";
import {
  discoverContracts,
  type ContractMeta,
} from "../../src/contracts/discovery.js";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contract-discovery-"));
  tmpDirs.push(dir);
  return dir;
}

function makeContractsDir(projectRoot: string, ...subdirs: string[]): string {
  const contractsDir = path.join(
    projectRoot,
    ".autospec",
    "contracts",
    ...subdirs,
  );
  fs.mkdirSync(contractsDir, { recursive: true });
  return contractsDir;
}

function writeContractYaml(
  dir: string,
  filename: string,
  content: Record<string, unknown>,
): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, yaml.dump(content), "utf-8");
  return filePath;
}

describe("discoverContracts", () => {
  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("returns empty array when .autospec/contracts/ does not exist", () => {
    const projectRoot = makeTmpDir();

    const result = discoverContracts(projectRoot);

    expect(result).toEqual([]);
  });

  it("returns empty array when contracts directory is empty", () => {
    const projectRoot = makeTmpDir();
    makeContractsDir(projectRoot);

    const result = discoverContracts(projectRoot);

    expect(result).toEqual([]);
  });

  it("discovers a single contract YAML file in root of contracts/", () => {
    const projectRoot = makeTmpDir();
    const contractsDir = makeContractsDir(projectRoot);
    writeContractYaml(contractsDir, "order-create.contract.yaml", {
      id: "CON-order-create",
      type: "api",
      version: "1.0.0",
      status: "draft",
      links: {
        depends_on: ["CON-product-list"],
      },
    });

    const result = discoverContracts(projectRoot);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual<ContractMeta>({
      id: "CON-order-create",
      type: "api",
      depends_on: ["CON-product-list"],
      filePath: path.join(contractsDir, "order-create.contract.yaml"),
    });
  });

  it("discovers contracts in subdirectories (api/, internal/, external/, files/)", () => {
    const projectRoot = makeTmpDir();

    const apiDir = makeContractsDir(projectRoot, "api");
    writeContractYaml(apiDir, "order-create.contract.yaml", {
      id: "CON-order-create",
      type: "api",
      version: "1.0.0",
      status: "draft",
    });

    const internalDir = makeContractsDir(projectRoot, "internal");
    writeContractYaml(internalDir, "auth-service.contract.yaml", {
      id: "CON-auth-service",
      type: "internal",
      version: "1.0.0",
      status: "draft",
    });

    const externalDir = makeContractsDir(projectRoot, "external");
    writeContractYaml(externalDir, "payment-gateway.contract.yaml", {
      id: "CON-payment-gateway",
      type: "external",
      version: "1.0.0",
      status: "draft",
    });

    const filesDir = makeContractsDir(projectRoot, "files");
    writeContractYaml(filesDir, "upload-config.contract.yaml", {
      id: "CON-upload-config",
      type: "file",
      version: "1.0.0",
      status: "draft",
    });

    const result = discoverContracts(projectRoot);

    expect(result).toHaveLength(4);

    const ids = result.map((c) => c.id).sort();
    expect(ids).toEqual([
      "CON-auth-service",
      "CON-order-create",
      "CON-payment-gateway",
      "CON-upload-config",
    ]);

    const types = result.map((c) => c.type).sort();
    expect(types).toEqual(["api", "external", "file", "internal"]);
  });

  it("extracts depends_on from links.depends_on array", () => {
    const projectRoot = makeTmpDir();
    const contractsDir = makeContractsDir(projectRoot);
    writeContractYaml(contractsDir, "order-create.contract.yaml", {
      id: "CON-order-create",
      type: "api",
      version: "1.0.0",
      status: "draft",
      links: {
        depends_on: ["CON-product-list", "CON-auth-service", "CON-inventory"],
      },
    });

    const result = discoverContracts(projectRoot);

    expect(result).toHaveLength(1);
    expect(result[0]!.depends_on).toEqual([
      "CON-product-list",
      "CON-auth-service",
      "CON-inventory",
    ]);
  });

  it("returns empty depends_on when links field is absent", () => {
    const projectRoot = makeTmpDir();
    const contractsDir = makeContractsDir(projectRoot);
    writeContractYaml(contractsDir, "simple.contract.yaml", {
      id: "CON-simple",
      type: "internal",
      version: "1.0.0",
      status: "draft",
    });

    const result = discoverContracts(projectRoot);

    expect(result).toHaveLength(1);
    expect(result[0]!.depends_on).toEqual([]);
  });

  it("skips non-YAML files (e.g., .md, .txt)", () => {
    const projectRoot = makeTmpDir();
    const contractsDir = makeContractsDir(projectRoot);

    writeContractYaml(contractsDir, "valid.contract.yaml", {
      id: "CON-valid",
      type: "api",
      version: "1.0.0",
      status: "draft",
    });

    fs.writeFileSync(
      path.join(contractsDir, "README.md"),
      "# Contracts\nDocumentation file",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(contractsDir, "notes.txt"),
      "Some notes about contracts",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(contractsDir, "data.json"),
      JSON.stringify({ id: "not-a-contract" }),
      "utf-8",
    );

    const result = discoverContracts(projectRoot);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("CON-valid");
  });

  it("skips malformed YAML files without crashing", () => {
    const projectRoot = makeTmpDir();
    const contractsDir = makeContractsDir(projectRoot);

    writeContractYaml(contractsDir, "valid.contract.yaml", {
      id: "CON-valid",
      type: "api",
      version: "1.0.0",
      status: "draft",
    });

    fs.writeFileSync(
      path.join(contractsDir, "malformed.contract.yaml"),
      "{{{{invalid: yaml: content\n  - broken\n    indent: [",
      "utf-8",
    );

    const result = discoverContracts(projectRoot);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("CON-valid");
  });
});
