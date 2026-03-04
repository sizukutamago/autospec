import type { ContractMeta } from "./discovery.js";

export interface TopoGroup {
  level: number;
  contractIds: string[];
}

export class CyclicDependencyError extends Error {
  constructor(remainingIds: string[]) {
    super(
      `Cyclic dependency detected among contracts: ${remainingIds.join(", ")}`,
    );
    this.name = "CyclicDependencyError";
  }
}

/**
 * Kahn's algorithm でコントラクトをトポロジカルソートし、
 * 同一レベル（= 並列実行可能）ごとにグループ化する。
 *
 * - 存在しない contract ID への依存は無視する
 * - 循環依存を検出した場合は CyclicDependencyError をスロー
 */
export function topoSort(contracts: ContractMeta[]): TopoGroup[] {
  if (contracts.length === 0) return [];

  const knownIds = new Set(contracts.map((c) => c.id));

  // 入次数カウント（known な依存のみ）
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep -> [ids that depend on dep]

  for (const c of contracts) {
    inDegree.set(c.id, 0);
    dependents.set(c.id, []);
  }

  for (const c of contracts) {
    for (const dep of c.depends_on) {
      if (!knownIds.has(dep)) continue; // 外部依存は無視
      inDegree.set(c.id, (inDegree.get(c.id) ?? 0) + 1);
      dependents.get(dep)!.push(c.id);
    }
  }

  const groups: TopoGroup[] = [];
  let remaining = contracts.length;

  // 入次数 0 のノードを最初のキューに
  let currentLevel: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) currentLevel.push(id);
  }

  let level = 0;
  while (currentLevel.length > 0) {
    currentLevel.sort(); // アルファベット順で安定性確保
    groups.push({ level, contractIds: currentLevel });
    remaining -= currentLevel.length;

    const nextLevel: string[] = [];
    for (const id of currentLevel) {
      for (const dependent of dependents.get(id) ?? []) {
        const newDeg = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDeg);
        if (newDeg === 0) nextLevel.push(dependent);
      }
    }

    currentLevel = nextLevel;
    level++;
  }

  if (remaining > 0) {
    const cycleIds = [...inDegree.entries()]
      .filter(([, deg]) => deg > 0)
      .map(([id]) => id);
    throw new CyclicDependencyError(cycleIds);
  }

  return groups;
}

/**
 * 配列を n 個のチャンクに分割する。
 * 要素数が n で割り切れない場合、先頭チャンクに余りを分配する。
 *
 * 例: splitIntoChunks([a,b,c,d,e,f,g], 3) => [[a,b,c],[d,e,f],[g]]
 */
export function splitIntoChunks<T>(items: T[], n: number): T[][] {
  if (items.length === 0 || n <= 0) return [];

  const actualChunks = Math.min(n, items.length);
  const chunkSize = Math.ceil(items.length / actualChunks);
  const result: T[][] = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    result.push(items.slice(i, i + chunkSize));
  }

  return result;
}
