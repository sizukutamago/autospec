import { describe, expect, it } from "vitest";
import {
  topoSort,
  splitIntoChunks,
  CyclicDependencyError,
} from "../../src/contracts/topo-sort.js";
import type { ContractMeta } from "../../src/contracts/discovery.js";

/**
 * Helper to build a ContractMeta with sensible defaults.
 * Only `id` and `depends_on` are meaningful for topoSort,
 * but we include `type` and `filePath` for structural completeness.
 */
function makeContract(
  id: string,
  dependsOn: string[] = [],
): ContractMeta {
  return {
    id,
    type: "internal",
    filePath: `src/contracts/${id}.yaml`,
    depends_on: dependsOn,
  } as ContractMeta;
}

// ---------------------------------------------------------------------------
// topoSort
// ---------------------------------------------------------------------------
describe("topoSort", () => {
  it("returns an empty array when given an empty array", () => {
    const result = topoSort([]);

    expect(result).toEqual([]);
  });

  it("returns a single group at level 0 for a contract with no dependencies", () => {
    const contracts = [makeContract("auth")];

    const result = topoSort(contracts);

    expect(result).toHaveLength(1);
    expect(result[0]?.level).toBe(0);
    expect(result[0]?.contractIds).toEqual(["auth"]);
  });

  it("groups all independent contracts into a single level-0 group", () => {
    const contracts = [
      makeContract("auth"),
      makeContract("billing"),
      makeContract("notifications"),
    ];

    const result = topoSort(contracts);

    expect(result).toHaveLength(1);
    expect(result[0]?.level).toBe(0);
    expect(result[0]?.contractIds).toEqual(
      expect.arrayContaining(["auth", "billing", "notifications"]),
    );
    expect(result[0]?.contractIds).toHaveLength(3);
  });

  it("produces 3 levels for a linear dependency chain A -> B -> C", () => {
    // A depends on B, B depends on C, C has no deps
    const contracts = [
      makeContract("A", ["B"]),
      makeContract("B", ["C"]),
      makeContract("C"),
    ];

    const result = topoSort(contracts);

    expect(result).toHaveLength(3);

    // Level 0: C (no dependencies)
    expect(result[0]?.level).toBe(0);
    expect(result[0]?.contractIds).toEqual(["C"]);

    // Level 1: B (depends on C)
    expect(result[1]?.level).toBe(1);
    expect(result[1]?.contractIds).toEqual(["B"]);

    // Level 2: A (depends on B)
    expect(result[2]?.level).toBe(2);
    expect(result[2]?.contractIds).toEqual(["A"]);
  });

  it("produces 3 levels for a diamond dependency pattern", () => {
    // A depends on B and C; B and C both depend on D
    const contracts = [
      makeContract("A", ["B", "C"]),
      makeContract("B", ["D"]),
      makeContract("C", ["D"]),
      makeContract("D"),
    ];

    const result = topoSort(contracts);

    expect(result).toHaveLength(3);

    // Level 0: D (no dependencies)
    expect(result[0]?.level).toBe(0);
    expect(result[0]?.contractIds).toEqual(["D"]);

    // Level 1: B and C (both depend only on D)
    expect(result[1]?.level).toBe(1);
    expect(result[1]?.contractIds).toHaveLength(2);
    expect(result[1]?.contractIds).toEqual(
      expect.arrayContaining(["B", "C"]),
    );

    // Level 2: A (depends on B and C)
    expect(result[2]?.level).toBe(2);
    expect(result[2]?.contractIds).toEqual(["A"]);
  });

  it("ignores external dependencies that reference non-existent contract IDs", () => {
    // "app" depends on "external-lib" which is not in the contracts list
    const contracts = [
      makeContract("app", ["external-lib"]),
      makeContract("core"),
    ];

    const result = topoSort(contracts);

    // Both should be at level 0 since external-lib is not a known contract
    expect(result).toHaveLength(1);
    expect(result[0]?.level).toBe(0);
    expect(result[0]?.contractIds).toHaveLength(2);
    expect(result[0]?.contractIds).toEqual(
      expect.arrayContaining(["app", "core"]),
    );
  });

  it("throws CyclicDependencyError for cyclic dependencies", () => {
    const contracts = [
      makeContract("A", ["B"]),
      makeContract("B", ["A"]),
    ];

    expect(() => topoSort(contracts)).toThrow(CyclicDependencyError);
  });

  it("sorts contractIds alphabetically within each group", () => {
    // All independent — should appear in a single group, sorted
    const contracts = [
      makeContract("zebra"),
      makeContract("apple"),
      makeContract("mango"),
      makeContract("banana"),
    ];

    const result = topoSort(contracts);

    expect(result).toHaveLength(1);
    expect(result[0]?.contractIds).toEqual([
      "apple",
      "banana",
      "mango",
      "zebra",
    ]);
  });
});

// ---------------------------------------------------------------------------
// splitIntoChunks
// ---------------------------------------------------------------------------
describe("splitIntoChunks", () => {
  it("splits 6 items into 3 equal chunks of 2", () => {
    const items = ["a", "b", "c", "d", "e", "f"];

    const result = splitIntoChunks(items, 3);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(["a", "b"]);
    expect(result[1]).toEqual(["c", "d"]);
    expect(result[2]).toEqual(["e", "f"]);
  });

  it("distributes remainder across first chunks when not evenly divisible", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g"];

    const result = splitIntoChunks(items, 3);

    expect(result).toHaveLength(3);
    // 7 / 3 = 2 remainder 1 → first chunk gets the extra item
    // Acceptable distributions: [3,2,2] or [3,3,1] — we assert [3,3,1] per spec
    const lengths = result.map((chunk) => chunk.length);
    expect(lengths).toEqual([3, 3, 1]);
    // All items preserved
    expect(result.flat()).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("returns only as many chunks as there are items when n exceeds item count", () => {
    const items = ["x", "y"];

    const result = splitIntoChunks(items, 5);

    // More chunks than items → each item gets its own chunk
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(["x"]);
    expect(result[1]).toEqual(["y"]);
  });

  it("returns an empty array when given an empty input", () => {
    const result = splitIntoChunks([], 3);

    expect(result).toEqual([]);
  });
});
