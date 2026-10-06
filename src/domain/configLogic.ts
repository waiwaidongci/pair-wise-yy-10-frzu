import { GROUP_IDS, optionName, optionSku, productGroups } from "../data/catalog";
import type {
  ConfigRevision,
  Configuration,
  DependencyRule,
  FrozenSnapshot,
  GroupId,
  InvalidationReason,
  InventoryBatch,
  InventoryEvent,
  RevisionConflict,
  Role,
  RuleEvent,
} from "../types/product";

/* ================= 依赖规则 ================= */

export function initialRules(): DependencyRule[] {
  return [
    {
      id: "extended-needs-metal",
      version: 1,
      when: { field: "battery", equals: "extended" },
      require: { field: "material", in: ["metal"] },
      message: "长续航双电池需要搭配拉丝铝合金机身。",
    },
    {
      id: "floor-needs-metal",
      version: 1,
      when: { field: "stand", equals: "floor" },
      require: { field: "material", in: ["metal"] },
      message: "立式支架需要铝合金机身提供结构强度。",
    },
    {
      id: "hepa-not-wood",
      version: 1,
      when: { field: "material", equals: "wood" },
      require: { field: "filter", in: ["standard", "formaldehyde"] },
      message: "医疗级滤芯不支持天然胡桃木饰面。",
    },
  ];
}

export function violatedRules(config: Configuration, rules: DependencyRule[]): DependencyRule[] {
  return rules.filter((rule) => config[rule.when.field] === rule.when.equals && !rule.require.in.includes(config[rule.require.field]));
}

/** 某选项在「当前配置」下是否违反冻结的依赖规则 */
export function firstBlockingRule(field: GroupId, optionId: string, config: Configuration, rules: DependencyRule[]): DependencyRule | null {
  const tentative: Configuration = { ...config, [field]: optionId };
  return violatedRules(tentative, rules)[0] ?? null;
}

/* ================= 价格簿与报价 ================= */

/** 每个选项的生效单价 = 目录价 + 最低批次价差（取最优批次） */
export function effectivePriceBook(batches: InventoryBatch[]): Record<string, number> {
  const book: Record<string, number> = {};
  for (const group of productGroups) {
    for (const option of group.options) {
      const sku = optionSku(group.id, option.id);
      const deltas = batches.filter((batch) => batch.sku === sku).map((batch) => batch.priceDelta);
      book[sku] = option.price + (deltas.length ? Math.min(...deltas) : 0);
    }
  }
  return book;
}

export function quoteLines(config: Configuration, priceBook: Record<string, number>) {
  return GROUP_IDS.map((field) => {
    const sku = optionSku(field, config[field]);
    return { sku, qty: 1, unitPrice: priceBook[sku] ?? 0 };
  });
}

export function quoteTotal(config: Configuration, basePrice: number, priceBook: Record<string, number>): number {
  return basePrice + quoteLines(config, priceBook).reduce((sum, line) => sum + line.unitPrice, 0);
}

/* ================= 三方字段合并（按字段合并，选择不互相覆盖） ================= */

export interface MergeResult {
  config: Configuration;
  conflicts: RevisionConflict[];
  changedFields: GroupId[];
}

export function threeWayMerge(base: Configuration, customer: Configuration, store: Configuration): MergeResult {
  const merged: Configuration = { ...base };
  const conflicts: RevisionConflict[] = [];
  const changedFields: GroupId[] = [];

  for (const field of GROUP_IDS) {
    const mineChanged = customer[field] !== base[field];
    const theirsChanged = store[field] !== base[field];
    if (!mineChanged && !theirsChanged) continue;
    changedFields.push(field);
    if (mineChanged && !theirsChanged) {
      merged[field] = customer[field];
    } else if (!mineChanged && theirsChanged) {
      merged[field] = store[field];
    } else if (customer[field] === store[field]) {
      // 双方改成同一个值，不算冲突
      merged[field] = customer[field];
    } else {
      // 同一字段双方都改且不一致：两个版本都保留，报价挂起等待裁决
      merged[field] = customer[field];
      conflicts.push({
        field,
        baseValue: base[field],
        customerValue: customer[field],
        storeValue: store[field],
      });
    }
  }
  return { config: merged, conflicts, changedFields };
}

/* ================= 失效判定 ================= */

export interface DomainState {
  basePrice: number;
  rules: DependencyRule[];
  ruleVersion: number;
  ruleEvents: RuleEvent[];
  batches: InventoryBatch[];
  inventoryVersion: number;
  inventoryEvents: InventoryEvent[];
}

interface Basis {
  basePrice: number;
  ruleVersion: number;
  inventoryVersion: number;
}

export function configSkus(config: Configuration): Set<string> {
  return new Set(GROUP_IDS.map((field) => optionSku(field, config[field])));
}

/** 某 sku 当前总可用库存（扣除占用中的锁定单） */
export function skuAvailable(sku: string, batches: InventoryBatch[], holdingLines: Array<{ sku: string; qty: number }>): number {
  const onHand = batches.filter((batch) => batch.sku === sku).reduce((sum, batch) => sum + batch.quantity, 0);
  const held = holdingLines.filter((line) => line.sku === sku).reduce((sum, line) => sum + line.qty, 0);
  return onHand - held;
}

function conflictReason(conflict: RevisionConflict): InvalidationReason {
  return {
    kind: "conflict",
    field: conflict.field,
    reason: `顾客选择「${optionName(conflict.field, conflict.customerValue)}」、门店选择「${optionName(
      conflict.field,
      conflict.storeValue,
    )}」，冲突未裁清，等待裁决。`,
  };
}

/**
 * 核心判定：相对打开时冻结（或修订落定）的基础，
 * 库存批次 / 依赖规则变化只让受影响选项与报价失效。
 */
export function evaluate(
  config: Configuration,
  unresolvedConflicts: RevisionConflict[],
  basis: Basis,
  state: DomainState,
  holdingLines: Array<{ sku: string; qty: number }> = [],
): InvalidationReason[] {
  const reasons: InvalidationReason[] = [];
  const skus = configSkus(config);

  for (const conflict of unresolvedConflicts) {
    reasons.push(conflictReason(conflict));
  }

  for (const field of GROUP_IDS) {
    const sku = optionSku(field, config[field]);
    const available = skuAvailable(sku, state.batches, holdingLines);
    if (available <= 0) {
      reasons.push({ kind: "stock", field, reason: `「${optionName(field, config[field])}」所在批次库存不足（可用 0 件）。` });
    }
  }

  for (const rule of violatedRules(config, state.rules)) {
    reasons.push({ kind: "rule", field: rule.when.field, reason: rule.message });
  }

  for (const event of state.ruleEvents) {
    if (event.version <= basis.ruleVersion) break;
    const hit = event.skus.filter((sku) => skus.has(sku));
    if (hit.length) {
      reasons.push({
        kind: "rule",
        reason: `依赖规则已更新至 r${event.version}（${event.note}），受影响选项：${hit
          .map((sku) => optionNameFromSku(sku))
          .join("、")}，需重新确认。`,
      });
    }
  }

  for (const event of state.inventoryEvents) {
    if (event.version <= basis.inventoryVersion) break;
    const hit = event.skus.filter((sku) => skus.has(sku));
    if (hit.length) {
      reasons.push({
        kind: "batch",
        reason: `库存批次已更新至 v${event.version}（${event.note}），受影响选项：${hit
          .map((sku) => optionNameFromSku(sku))
          .join("、")}，报价需重算。`,
      });
    }
  }

  if (state.basePrice !== basis.basePrice) {
    reasons.push({ kind: "base", reason: `基础价已由 ¥${basis.basePrice} 调整为 ¥${state.basePrice}，报价需重算。` });
  }

  return dedupeReasons(reasons);
}

function optionNameFromSku(sku: string): string {
  const [group, option] = sku.split(":");
  return optionName(group as GroupId, option);
}

function dedupeReasons(reasons: InvalidationReason[]): InvalidationReason[] {
  const seen = new Set<string>();
  return reasons.filter((item) => {
    const key = `${item.kind}:${item.field ?? ""}:${item.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 修订页/分享页：相对该修订落定时刻判定当前失效原因 */
export function evaluateRevision(revision: ConfigRevision, state: DomainState, holdingLines: Array<{ sku: string; qty: number }> = []) {
  return evaluate(
    revision.config,
    revision.conflicts.filter((conflict) => !conflict.resolution),
    { basePrice: revision.basePrice, ruleVersion: revision.ruleVersion, inventoryVersion: revision.inventoryVersion },
    state,
    holdingLines,
  );
}

/** 工作台：相对打开时冻结的版本判定 */
export function evaluateWorking(
  config: Configuration,
  revision: ConfigRevision,
  snapshot: FrozenSnapshot,
  state: DomainState,
  holdingLines: Array<{ sku: string; qty: number }> = [],
) {
  return evaluate(
    config,
    revision.conflicts.filter((conflict) => !conflict.resolution),
    { basePrice: snapshot.basePrice, ruleVersion: snapshot.ruleVersion, inventoryVersion: snapshot.inventoryVersion },
    state,
    holdingLines,
  );
}

/** 报价能否占用库存：冲突未裁清 / 库存不足 / 规则漂移 / 批次漂移 一律拒绝 */
export function blockingKinds(reasons: InvalidationReason[]): Set<string> {
  return new Set(reasons.map((reason) => reason.kind));
}

export function adjudicationNote(conflict: RevisionConflict, by: Role): string {
  return `${by === "customer" ? "顾客" : "门店"}裁决：${
    by === "customer" ? "保留顾客版本" : "保留门店版本"
  }「${optionName(conflict.field, by === "customer" ? conflict.customerValue : conflict.storeValue)}」`;
}
