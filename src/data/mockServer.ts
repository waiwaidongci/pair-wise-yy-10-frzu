import { defaultConfiguration, optionSku, sanitizeConfig } from "./catalog";
import {
  effectivePriceBook,
  evaluate,
  initialRules,
  quoteLines,
  quoteTotal,
  threeWayMerge,
  type DomainState,
} from "../domain/configLogic";
import type {
  ConfigRevision,
  Configuration,
  DependencyRule,
  GroupId,
  InventoryBatch,
  OptionOp,
  QuoteLock,
  Role,
  ServerState,
} from "../types/product";

const STORAGE_KEY = "aerostation:server:v1";

/* ---------------- 初始库存批次 ---------------- */

function initialBatches(): InventoryBatch[] {
  const batch: Array<[GroupId, string, number, number, string]> = [
    ["color", "graphite", 26, 0, "首批量产"],
    ["color", "ivory", 18, 0, "首批量产"],
    ["color", "sage", 6, 0, "限定配色批次"],
    ["color", "ocean", 3, 40, "深海蓝限定批次（含调色溢价）"],
    ["material", "matte", 32, 0, "常备料号"],
    ["material", "metal", 14, 0, "铝挤型材批次"],
    ["material", "wood", 4, 0, "胡桃木手工饰面批次"],
    ["filter", "standard", 40, 0, "常备批次"],
    ["filter", "hepa", 12, 0, "医疗滤芯进口批次"],
    ["filter", "formaldehyde", 9, 0, "除醛滤芯批次"],
    ["battery", "none", 20, 0, "常备批次"],
    ["battery", "standard", 24, 0, "锂电池批次"],
    ["battery", "extended", 7, 0, "双电池模组批次"],
    ["stand", "desktop", 30, 0, "常备批次"],
    ["stand", "floor", 8, 0, "铝合金支架批次"],
    ["trim", "subtle", 28, 0, "常备批次"],
    ["trim", "copper", 10, 0, "暖铜批次"],
    ["trim", "graphite-ring", 10, 0, "深色镀铬批次"],
  ];
  return batch.map(([group, option, quantity, priceDelta, note], index) => ({
    id: `B-${String(1001 + index)}`,
    sku: optionSku(group, option),
    quantity,
    priceDelta,
    note,
    createdAt: Date.now(),
  }));
}

export function createSeedState(): ServerState {
  const rules = initialRules();
  const batches = initialBatches();
  const basePrice = 3299;
  const now = Date.now();
  const revision: ConfigRevision = {
    id: "r1",
    number: 1,
    parent: null,
    config: { ...defaultConfiguration },
    source: "seed",
    actors: ["customer", "store"],
    conflicts: [],
    basePrice,
    ruleVersion: 1,
    inventoryVersion: 1,
    priceBook: effectivePriceBook(batches),
    note: "首版配置（初始冻结）",
    createdAt: now,
  };
  return {
    revisions: [revision],
    actors: {
      customer: { baseRev: "r1", appliedOpIds: [], lastSeenSeq: 0 },
      store: { baseRev: "r1", appliedOpIds: [], lastSeenSeq: 0 },
    },
    basePrice,
    rules,
    ruleVersion: 1,
    ruleEvents: [],
    batches,
    inventoryVersion: 1,
    inventoryEvents: [],
    locks: [],
    legacyBackfills: {},
    nextLockSeq: 1,
    writeFailureArmed: false,
  };
}

function load(): ServerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ServerState;
  } catch {
    // 损坏的持久化数据回退到种子状态
  }
  const seed = createSeedState();
  persist(seed);
  return seed;
}

function persist(state: ServerState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function domainState(state: ServerState): DomainState {
  return {
    basePrice: state.basePrice,
    rules: state.rules,
    ruleVersion: state.ruleVersion,
    ruleEvents: state.ruleEvents,
    batches: state.batches,
    inventoryVersion: state.inventoryVersion,
    inventoryEvents: state.inventoryEvents,
  };
}

function revisionById(state: ServerState, id: string): ConfigRevision {
  return state.revisions.find((revision) => revision.id === id) ?? state.revisions[0];
}

function holdingLines(state: ServerState) {
  return state.locks.filter((lock) => lock.status === "holding").flatMap((lock) => lock.lines);
}

function nextRevisionId(state: ServerState): string {
  return `r${state.revisions[state.revisions.length - 1].number + 1}`;
}

function appendRevision(state: ServerState, draft: Omit<ConfigRevision, "id" | "number" | "createdAt">): ConfigRevision {
  const revision: ConfigRevision = {
    ...draft,
    id: nextRevisionId(state),
    number: state.revisions[state.revisions.length - 1].number + 1,
    createdAt: Date.now(),
  };
  state.revisions.push(revision);
  return revision;
}

/** 模拟写入失败：开启后下一次写入抛错，不产生任何持久化副作用 */
function consumeWriteGate(state: ServerState) {
  if (state.writeFailureArmed) {
    state.writeFailureArmed = false;
    persist(state);
    throw Object.assign(new Error("模拟写入失败（网络抖动，未落库）"), { retriable: true });
  }
}

const delay = (ms = 220) => new Promise((resolve) => window.setTimeout(resolve, ms));

/* ---------------- Mock 服务端 ---------------- */

export const mockServer = {
  reset(): ServerState {
    const seed = createSeedState();
    persist(seed);
    return structuredClone(seed);
  },

  subscribe(handler: () => void): () => void {
    const listener = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) handler();
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  },

  async getState(): Promise<ServerState> {
    await delay(120);
    return structuredClone(load());
  },

  /**
   * 断网改动重连后按字段合并。
   * 以该角色上次同步的修订为共同祖先，做一次三方合并：
   * 单方改动直接落版；两人同时改同一字段且取值不同，保留双方版本，生成待裁决冲突。
   * 操作 id 幂等：整批重复提交不会产生第二次合并。
   */
  async pushOps(role: Role, ops: OptionOp[], mineDraft: Configuration): Promise<{ state: ServerState; merged: string[] }> {
    await delay();
    const state = load();
    const actor = state.actors[role];
    const fresh = ops.filter((op) => !actor.appliedOpIds.includes(op.id));
    const merged = ops.map((op) => op.id);
    if (!fresh.length) {
      return { state: structuredClone(state), merged };
    }

    consumeWriteGate(state);

    const base = revisionById(state, actor.baseRev).config;
    const head = state.revisions[state.revisions.length - 1];
    // 本端离线期间，HEAD 的变化全部来自对端
    const theirs = head.config;
    const result = threeWayMerge(base, role === "customer" ? mineDraft : theirs, role === "store" ? mineDraft : theirs);

    const seqText = fresh.map((op) => `#${op.seq}`).join("、");
    const fieldsText = [...new Set(fresh.map((op) => fieldLabel(op.field)))].join("、");
    const revision = appendRevision(state, {
      parent: head.id,
      config: result.config,
      source: "merge",
      actors: [role],
      conflicts: carryConflicts(state, result),
      basePrice: state.basePrice,
      ruleVersion: state.ruleVersion,
      inventoryVersion: state.inventoryVersion,
      priceBook: effectivePriceBook(state.batches),
      note: `${role === "customer" ? "顾客" : "门店"}重连提交选项操作 ${seqText}（${fieldsText}）`,
    });
    // 只推进本端同步基线；对端若离线，其基线仍停在离线前修订，重连时作为三方合并的共同祖先
    state.actors[role].baseRev = revision.id;
    for (const op of fresh) {
      actor.appliedOpIds.push(op.id);
      actor.lastSeenSeq = Math.max(actor.lastSeenSeq, op.seq);
    }
    persist(state);
    return { state: structuredClone(state), merged };
  },

  /** 无本地改动时拉取对端改动：本端基线推进到最新修订 */
  async pull(role: Role): Promise<ServerState> {
    await delay();
    const state = load();
    state.actors[role].baseRev = state.revisions[state.revisions.length - 1].id;
    persist(state);
    return structuredClone(state);
  },

  /** 冲突裁决：选定保留一方版本，落新版本 */
  async adjudicate(field: GroupId, by: Role, value: string): Promise<ServerState> {
    await delay();
    const state = load();
    consumeWriteGate(state);
    const head = state.revisions[state.revisions.length - 1];
    const conflict = head.conflicts.find((item) => item.field === field && !item.resolution);
    if (!conflict) throw new Error("该字段没有待裁清的冲突");

    const config = { ...head.config, [field]: value };
    const conflicts = head.conflicts.map((item) =>
      item.field === field ? { ...item, resolution: { by, value, at: Date.now() } } : item,
    );
    appendRevision(state, {
      parent: head.id,
      config,
      source: "adjudication",
      actors: ["customer", "store"],
      conflicts,
      basePrice: state.basePrice,
      ruleVersion: state.ruleVersion,
      inventoryVersion: state.inventoryVersion,
      priceBook: effectivePriceBook(state.batches),
      note: `冲突裁决：${fieldLabel(field)}保留${by === "customer" ? "顾客" : "门店"}版本`,
    });
    state.actors.customer.baseRev = state.revisions[state.revisions.length - 1].id;
    state.actors.store.baseRev = state.revisions[state.revisions.length - 1].id;
    persist(state);
    return structuredClone(state);
  },

  /** 失效重算：以最新基础价/规则/库存重新落版 */
  async recompute(): Promise<ServerState> {
    await delay();
    const state = load();
    consumeWriteGate(state);
    const head = state.revisions[state.revisions.length - 1];
    if (head.conflicts.some((item) => !item.resolution)) {
      throw Object.assign(new Error("仍有冲突未裁清，不能重算报价"), { retriable: false });
    }
    appendRevision(state, {
      parent: head.id,
      config: { ...head.config },
      source: "recompute",
      actors: ["customer", "store"],
      conflicts: [],
      basePrice: state.basePrice,
      ruleVersion: state.ruleVersion,
      inventoryVersion: state.inventoryVersion,
      priceBook: effectivePriceBook(state.batches),
      note: "库存批次/依赖规则/基础价变化后的失效重算",
    });
    state.actors.customer.baseRev = state.revisions[state.revisions.length - 1].id;
    state.actors.store.baseRev = state.revisions[state.revisions.length - 1].id;
    persist(state);
    return structuredClone(state);
  },

  /**
   * 报价锁定单：占用库存。
   * - 冲突未裁清/库存不足/规则或批次漂移/写入失败 → 不落任何占用
   * - 同一幂等令牌重复提交 → 返回原锁定单，不追加占用
   * - 失败批次可用同令牌重试
   */
  async lockQuote(role: Role, revisionId: string, token: string): Promise<{ state: ServerState; lock: QuoteLock }> {
    await delay();
    const state = load();

    const existing = state.locks.find((lock) => lock.token === token && lock.status === "holding");
    if (existing) {
      // 重复提交：返回占用中的同一锁定单，不追加占用
      return { state: structuredClone(state), lock: structuredClone(existing) };
    }
    // 库存失败的批次补货后用同令牌重试：显式重试吸纳新批次，按当前批次价分配
    const lastFailure = state.locks.filter((lock) => lock.token === token && lock.status === "failed").slice(-1)[0];
    const retryingStock = lastFailure?.failure?.kind === "stock";

    const revision = revisionById(state, revisionId);
    // 重试场景以最新价格簿计价（补货批次可能携带新价差）；其余沿用修订落定口径
    const activeBook = retryingStock ? effectivePriceBook(state.batches) : revision.priceBook;
    const reasons = evaluate(
      revision.config,
      revision.conflicts.filter((conflict) => !conflict.resolution),
      { basePrice: revision.basePrice, ruleVersion: revision.ruleVersion, inventoryVersion: revision.inventoryVersion },
      { ...domainState(state), batches: state.batches },
      holdingLines(state),
    );

    const fail = (kind: "conflict" | "drift" | "stock", reason: string, retriable: boolean): QuoteLock => {
      const lock: QuoteLock = {
        id: `Q-${String(state.nextLockSeq).padStart(4, "0")}`,
        token,
        revision: revisionId,
        role,
        status: "failed",
        lines: [],
        total: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        failure: { kind, reason, retriable, at: Date.now() },
      };
      state.nextLockSeq += 1;
      state.locks.push(lock);
      persist(state);
      return lock;
    };

    if (reasons.some((item) => item.kind === "conflict")) {
      return { state: structuredClone(state), lock: structuredClone(fail("conflict", "冲突未裁清，报价不能占用库存", false)) };
    }
    // 库存不足是硬失败：补货后失败批次可用同令牌重试
    if (reasons.some((item) => item.kind === "stock")) {
      return {
        state: structuredClone(state),
        lock: structuredClone(fail("stock", reasons.find((item) => item.kind === "stock")!.reason, true)),
      };
    }
    // 有货但批次/规则/基础价已漂移：报价失效，需先重算落新版（库存失败后的显式重试除外——补货即批次变化）
    const stale = retryingStock ? [] : reasons.filter((item) => ["rule", "batch", "base"].includes(item.kind));
    if (stale.length) {
      return { state: structuredClone(state), lock: structuredClone(fail("drift", stale.map((item) => item.reason).join("；"), false)) };
    }

    // 原子分配：逐批次扣减（优先低价差批次），任一 sku 不足整体回滚
    const lines: QuoteLock["lines"] = [];
    for (const line of quoteLines(revision.config, activeBook)) {
      let need = line.qty;
      const candidates = state.batches
        .filter((batch) => batch.sku === line.sku && batch.quantity > 0)
        .sort((a, b) => a.priceDelta - b.priceDelta || a.createdAt - b.createdAt);
      for (const batch of candidates) {
        const take = Math.min(need, batch.quantity);
        if (take <= 0) continue;
        batch.quantity -= take;
        need -= take;
        lines.push({ sku: line.sku, batchId: batch.id, qty: take, unitPrice: line.unitPrice });
        if (need === 0) break;
      }
      if (need > 0) {
        // 回滚本次已扣批次，不产生任何占用
        for (const made of lines) {
          const batch = state.batches.find((item) => item.id === made.batchId && item.sku === made.sku);
          if (batch) batch.quantity += made.qty;
        }
        lines.length = 0;
        return {
          state: structuredClone(state),
          lock: structuredClone(fail("stock", `选项 ${line.sku} 库存不足，未产生任何占用（失败批次可重试）`, true)),
        };
      }
    }

    try {
      consumeWriteGate(state);
    } catch (error) {
      // 写入失败：回滚已扣批次，报价不占用库存
      for (const made of lines) {
        const batch = state.batches.find((item) => item.id === made.batchId && item.sku === made.sku);
        if (batch) batch.quantity += made.qty;
      }
      lines.length = 0;
      const lock: QuoteLock = {
        id: `Q-${String(state.nextLockSeq).padStart(4, "0")}`,
        token,
        revision: revisionId,
        role,
        status: "failed",
        lines: [],
        total: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        failure: { kind: "write", reason: (error as Error).message, retriable: true, at: Date.now() },
      };
      state.nextLockSeq += 1;
      state.locks.push(lock);
      persist(state);
      return { state: structuredClone(state), lock: structuredClone(lock) };
    }

    const total = quoteTotal(revision.config, revision.basePrice, revision.priceBook);
    const lock: QuoteLock = {
      id: `Q-${String(state.nextLockSeq).padStart(4, "0")}`,
      token,
      revision: revisionId,
      role,
      status: "holding",
      lines,
      total,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.nextLockSeq += 1;
    state.locks.push(lock);
    persist(state);
    return { state: structuredClone(state), lock: structuredClone(lock) };
  },

  async releaseLock(token: string): Promise<ServerState> {
    await delay(120);
    const state = load();
    const lock = state.locks.find((item) => item.token === token);
    if (lock && lock.status === "holding") {
      for (const line of lock.lines) {
        const batch = state.batches.find((item) => item.id === line.batchId && item.sku === line.sku);
        if (batch) batch.quantity += line.qty;
      }
      lock.status = "released";
      lock.updatedAt = Date.now();
    }
    persist(state);
    return structuredClone(state);
  },

  /* ---------------- 管理端模拟：批次 / 规则 / 基础价 / 写入故障 ---------------- */

  async adminAdjustBatch(sku: string, quantityDelta: number, note: string, priceDelta?: number): Promise<ServerState> {
    await delay(120);
    const state = load();
    consumeWriteGate(state);
    if (typeof priceDelta === "number") {
      state.batches.push({
        id: `B-${2000 + state.inventoryVersion}-${Math.random().toString(36).slice(2, 6)}`,
        sku,
        quantity: Math.max(0, quantityDelta),
        priceDelta,
        note,
        createdAt: Date.now(),
      });
    } else {
      const target = [...state.batches].reverse().find((batch) => batch.sku === sku);
      if (target) target.quantity = Math.max(0, target.quantity + quantityDelta);
    }
    state.inventoryVersion += 1;
    state.inventoryEvents.push({ version: state.inventoryVersion, skus: [sku], note, at: Date.now() });
    persist(state);
    return structuredClone(state);
  },

  async adminChangeRules(changes: Array<{ id: string; patch: Partial<DependencyRule> }>, skus: string[], note: string): Promise<ServerState> {
    await delay(120);
    const state = load();
    consumeWriteGate(state);
    const ids: string[] = [];
    for (const change of changes) {
      const rule = state.rules.find((item) => item.id === change.id);
      if (!rule) continue;
      Object.assign(rule, change.patch);
      rule.version += 1;
      ids.push(rule.id);
    }
    state.ruleVersion += 1;
    state.ruleEvents.push({ version: state.ruleVersion, ruleIds: ids, skus, note, at: Date.now() });
    persist(state);
    return structuredClone(state);
  },

  async adminSetBasePrice(next: number, note: string): Promise<ServerState> {
    await delay(120);
    const state = load();
    consumeWriteGate(state);
    state.basePrice = next;
    // 基础价是独立冻结维度，不占用库存版本号
    persist(state);
    return structuredClone(state);
  },

  async armWriteFailure(): Promise<ServerState> {
    const state = load();
    state.writeFailureArmed = true;
    persist(state);
    return structuredClone(state);
  },

  /** 旧分享链接没有修订号：按配置补成首版（若已有相同首版则复用） */
  async backfillLegacy(config: Configuration): Promise<{ state: ServerState; revision: ConfigRevision; created: boolean }> {
    await delay(150);
    const state = load();
    const key = JSON.stringify(config);
    const cached = state.legacyBackfills[key];
    if (cached) {
      const found = revisionById(state, cached);
      return { state: structuredClone(state), revision: structuredClone(found), created: false };
    }
    const match = state.revisions.find(
      (revision) => revision.source === "backfill" && JSON.stringify(revision.config) === key,
    );
    if (match) {
      state.legacyBackfills[key] = match.id;
      persist(state);
      return { state: structuredClone(state), revision: structuredClone(match), created: false };
    }
    consumeWriteGate(state);
    const revision = appendRevision(state, {
      parent: state.revisions[state.revisions.length - 1].id,
      config: sanitizeConfig(config),
      source: "backfill",
      actors: ["customer", "store"],
      conflicts: [],
      basePrice: state.basePrice,
      ruleVersion: state.ruleVersion,
      inventoryVersion: state.inventoryVersion,
      priceBook: effectivePriceBook(state.batches),
      note: "旧分享链接无修订号，已补录为首版",
    });
    state.legacyBackfills[key] = revision.id;
    persist(state);
    return { state: structuredClone(state), revision: structuredClone(revision), created: true };
  },
};

/* ---------------- 服务端合并辅助 ---------------- */

/** 未裁清冲突沿修订链继续保留；本次合并新产生的冲突也并入 */
function carryConflicts(state: ServerState, result: ReturnType<typeof threeWayMerge>): ConfigRevision["conflicts"] {
  const head = state.revisions[state.revisions.length - 1];
  const carried = head.conflicts.filter((conflict) => !conflict.resolution && !result.conflicts.some((next) => next.field === conflict.field));
  return [...carried, ...result.conflicts];
}

function fieldLabel(field: GroupId): string {
  const labels: Record<GroupId, string> = {
    color: "机身颜色",
    material: "外壳材质",
    filter: "滤芯系统",
    battery: "续航模块",
    stand: "支架形态",
    trim: "控制环",
  };
  return labels[field];
}
