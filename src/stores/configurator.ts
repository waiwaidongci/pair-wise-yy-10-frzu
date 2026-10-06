import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { mockServer } from "../data/mockServer";
import { optionName, sanitizeConfig, specsOf } from "../data/catalog";
import {
  evaluateRevision,
  evaluateWorking,
  firstBlockingRule,
  quoteTotal,
  skuAvailable,
  violatedRules,
} from "../domain/configLogic";
import type {
  CameraPreset,
  ConfigRevision,
  Configuration,
  FrozenSnapshot,
  GroupId,
  InvalidationReason,
  OptionOp,
  ProductSpec,
  QuoteLock,
  Role,
  ServerState,
} from "../types/product";
import { ROLE_LABEL } from "../types/product";

interface RoleWorkspace {
  role: Role;
  online: boolean;
  draft: Configuration;
  baseRevId: string;
  pending: OptionOp[];
  seq: number;
  snapshot: FrozenSnapshot | null;
  notice: string;
  lockToken: string;
}

function emptyWorkspace(role: Role): RoleWorkspace {
  return {
    role,
    online: true,
    draft: sanitizeConfig(null),
    baseRevId: "",
    pending: [],
    seq: 0,
    snapshot: null,
    notice: "",
    lockToken: `tok-${role}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

function makeSnapshot(role: Role, revision: ConfigRevision, state: ServerState): FrozenSnapshot {
  return {
    role,
    revision: revision.id,
    frozenAt: Date.now(),
    basePrice: state.basePrice,
    rules: JSON.parse(JSON.stringify(state.rules)) as FrozenSnapshot["rules"],
    ruleVersion: state.ruleVersion,
    inventoryVersion: state.inventoryVersion,
    priceBook: { ...revision.priceBook },
  };
}

export const useConfiguratorStore = defineStore("configurator", () => {
  const server = ref<ServerState | null>(null);
  const loading = ref(true);
  const activeRole = ref<Role>("customer");
  const cameraPreset = ref<CameraPreset>("hero");
  const modelRotation = ref(-0.35);
  const syncing = ref(false);
  const lockBusy = ref(false);
  const workspaces = ref<Record<Role, RoleWorkspace>>({
    customer: emptyWorkspace("customer"),
    store: emptyWorkspace("store"),
  });
  const bootAt = ref(0);
  /** 分享页预览时覆盖三维场景配置，工作台为 null */
  const sceneOverride = ref<Configuration | null>(null);
  let initPromise: Promise<void> | null = null;
  let unsubscribe: (() => void) | null = null;

  const ws = computed(() => workspaces.value[activeRole.value]);
  const revisions = computed(() => server.value?.revisions ?? []);
  const headRevision = computed<ConfigRevision | null>(() => revisions.value[revisions.value.length - 1] ?? null);
  const baseRevision = computed<ConfigRevision | null>(
    () => revisions.value.find((revision) => revision.id === ws.value.baseRevId) ?? headRevision.value,
  );

  const configuration = computed<Configuration>(() => sceneOverride.value ?? ws.value.draft);

  function setSceneOverride(config: Configuration | null) {
    sceneOverride.value = config;
  }

  const unresolvedConflicts = computed(() =>
    headRevision.value ? headRevision.value.conflicts.filter((conflict) => !conflict.resolution) : [],
  );

  const holdingLines = computed(() =>
    server.value ? server.value.locks.filter((lock) => lock.status === "holding").flatMap((lock) => lock.lines) : [],
  );

  const domain = computed(() =>
    server.value
      ? {
          basePrice: server.value.basePrice,
          rules: server.value.rules,
          ruleVersion: server.value.ruleVersion,
          ruleEvents: server.value.ruleEvents,
          batches: server.value.batches,
          inventoryVersion: server.value.inventoryVersion,
          inventoryEvents: server.value.inventoryEvents,
        }
      : null,
  );

  /** 工作台失效原因：相对本端打开时冻结的版本判定 */
  const invalidations = computed<InvalidationReason[]>(() => {
    if (!server.value || !headRevision.value || !ws.value.snapshot || !domain.value) return [];
    return evaluateWorking(ws.value.draft, headRevision.value, ws.value.snapshot, domain.value, holdingLines.value);
  });

  /** 报价是否挂起：冲突未裁清 / 库存不足 / 规则·批次·基础价漂移 */
  const quoteBlocked = computed(() => invalidations.value.length > 0 || syncing.value);

  /** 工作报价：沿用冻结基础价与冻结价格簿 */
  const price = computed(() => {
    const snapshot = ws.value.snapshot;
    if (!snapshot) return quoteTotal(ws.value.draft, 3299, {});
    return quoteTotal(ws.value.draft, snapshot.basePrice, snapshot.priceBook);
  });

  const frozenBadge = computed(() => {
    const snapshot = ws.value.snapshot;
    if (!snapshot) return "";
    return `基础价 ¥${snapshot.basePrice} · 规则 r${snapshot.ruleVersion} · 库存 v${snapshot.inventoryVersion}`;
  });

  const specs = computed<ProductSpec[]>(() => specsOf(ws.value.draft));

  const currentLock = computed<QuoteLock | null>(() => {
    if (!server.value) return null;
    return server.value.locks.filter((lock) => lock.token === ws.value.lockToken && lock.status !== "released").slice(-1)[0] ?? null;
  });

  const optionMap = computed(() => {
    const map: Record<string, { name: string; price: number }> = {};
    if (headRevision.value) {
      for (const [sku, value] of Object.entries(headRevision.value.priceBook)) {
        const [group, option] = sku.split(":");
        map[sku] = { name: optionName(group as GroupId, option), price: value };
      }
    }
    return map;
  });

  const options = computed(() => {
    const out = {} as Record<GroupId, { id: string; name: string; price: number }>;
    for (const field of ["color", "material", "filter", "battery", "stand", "trim"] as GroupId[]) {
      const sku = `${field}:${ws.value.draft[field]}`;
      out[field] = {
        id: ws.value.draft[field],
        name: optionMap.value[sku]?.name ?? optionName(field, ws.value.draft[field]),
        price: optionMap.value[sku]?.price ?? 0,
      };
    }
    return out;
  });

  /* ---------------- 打开：冻结基础价、依赖规则、库存版本 ---------------- */

  async function init(force = false) {
    if (initPromise && !force) return initPromise;
    const task = (async () => {
      if (server.value && !force) return;
      loading.value = true;
      const state = await mockServer.getState();
      server.value = state;
      bootAt.value = Date.now();
      const head = state.revisions[state.revisions.length - 1];
      for (const role of ["customer", "store"] as Role[]) {
        const workspace = workspaces.value[role];
        workspace.draft = { ...head.config };
        workspace.baseRevId = head.id;
        workspace.pending = [];
        workspace.seq = 0;
        workspace.snapshot = makeSnapshot(role, head, state);
        workspace.notice = `已打开配置：冻结${ROLE_LABEL[role]}视角的基础价、依赖规则与库存版本。`;
      }
      loading.value = false;
      unsubscribe ??= mockServer.subscribe(() => {
        void mockServer.getState().then((next) => {
          server.value = next;
        });
      });
    })();
    initPromise = task;
    return task;
  }

  function switchRole(role: Role) {
    activeRole.value = role;
    cameraPreset.value = "hero";
  }

  function setNetwork(online: boolean) {
    ws.value.online = online;
    ws.value.notice = online ? "网络已恢复，可以重连同步。" : "已断网：改动只记录在本地操作日志，重连后按字段合并。";
  }

  /* ---------------- 本地改动：按选项操作号记录 ---------------- */

  function isOptionBlocked(field: GroupId, optionId: string): null | string {
    if (!ws.value.snapshot) return null;
    const fieldConflict = unresolvedConflicts.value.find((conflict) => conflict.field === field);
    if (fieldConflict) {
      return "该字段存在双方冲突，请先在下方冲突面板裁清后再修改。";
    }
    const rule = firstBlockingRule(field, optionId, ws.value.draft, ws.value.snapshot.rules);
    if (rule) return rule.message;
    return null;
  }

  function selectOption(field: GroupId, optionId: string) {
    if (ws.value.draft[field] === optionId) return;
    const blocked = isOptionBlocked(field, optionId);
    if (blocked) {
      ws.value.notice = blocked;
      return;
    }
    ws.value.seq += 1;
    const op: OptionOp = {
      id: `${ws.value.role}-${ws.value.seq}-${optionId}-${Date.now().toString(36)}`,
      seq: ws.value.seq,
      role: ws.value.role,
      field,
      from: ws.value.draft[field],
      to: optionId,
      baseRev: ws.value.baseRevId,
      clientTs: Date.now(),
      status: ws.value.online ? "syncing" : "pending",
    };
    ws.value.draft = { ...ws.value.draft, [field]: optionId };
    ws.value.pending.push(op);
    ws.value.notice = ws.value.online
      ? `选项操作 #${op.seq}（${optionName(field, optionId)}）已记录，正在合并…`
      : `选项操作 #${op.seq} 已离线记录，重连后按字段合并。`;
    if (ws.value.online) void syncNow();
  }

  /* ---------------- 断网改动重连：按字段合并，选择不互相覆盖 ---------------- */

  async function syncNow() {
    if (!server.value || syncing.value) return;
    if (!ws.value.online) {
      ws.value.notice = "当前处于断网状态，恢复网络后才能同步。";
      return;
    }
    syncing.value = true;
    try {
      const pending = ws.value.pending.filter((op) => op.status !== "synced");
      let state: ServerState;
      if (pending.length) {
        const result = await mockServer.pushOps(ws.value.role, pending, { ...ws.value.draft });
        state = result.state;
        const syncedIds = new Set(result.merged);
        for (const op of ws.value.pending) {
          if (syncedIds.has(op.id)) op.status = "synced";
        }
      } else {
        state = await mockServer.pull(ws.value.role);
      }
      server.value = state;
      reconcileAfterServer(state);
    } catch (error) {
      for (const op of ws.value.pending) {
        if (op.status === "syncing") op.status = "failed";
        op.error = (error as Error).message;
      }
      ws.value.notice = `同步写入失败，本地改动未丢失，可重试：${(error as Error).message}`;
    } finally {
      syncing.value = false;
    }
  }

  /** 服务端返回后推进基线；本地未同步改动保留，双方版本同时呈现 */
  function reconcileAfterServer(state: ServerState) {
    const head = state.revisions[state.revisions.length - 1];
    const workspace = ws.value;
    const pendingFields = new Set(workspace.pending.filter((op) => op.status !== "synced").map((op) => op.field));
    if (!pendingFields.size) {
      workspace.draft = { ...head.config };
    } else {
      // 仍有未同步的本地改动：以 HEAD 为底，仅覆盖本端待提交字段
      workspace.draft = { ...head.config };
      for (const op of workspace.pending.filter((item) => item.status !== "synced")) {
        workspace.draft[op.field] = op.to;
      }
    }
    workspace.baseRevId = head.id;
    for (const op of workspace.pending) op.baseRev = head.id;
    if (workspace.snapshot) workspace.snapshot = { ...workspace.snapshot, revision: head.id };
    const conflictCount = head.conflicts.filter((conflict) => !conflict.resolution).length;
    workspace.notice = conflictCount
      ? `合并完成：检测到 ${conflictCount} 个同字段双版本冲突，已保留双方选择，等待裁决。`
      : "合并完成，已生成新修订。";
  }

  /* ---------------- 冲突裁决 ---------------- */

  async function adjudicate(field: GroupId, by: Role, value: string) {
    if (!server.value) return;
    syncing.value = true;
    try {
      const state = await mockServer.adjudicate(field, by, value);
      server.value = state;
      const head = state.revisions[state.revisions.length - 1];
      for (const role of ["customer", "store"] as Role[]) {
        const workspace = workspaces.value[role];
        workspace.draft = { ...head.config };
        workspace.baseRevId = head.id;
        if (workspace.snapshot) workspace.snapshot = { ...workspace.snapshot, revision: head.id };
      }
      ws.value.notice = `冲突已裁清，保留${ROLE_LABEL[by]}版本，生成 ${head.id}。`;
    } catch (error) {
      ws.value.notice = `裁决失败：${(error as Error).message}`;
    } finally {
      syncing.value = false;
    }
  }

  /* ---------------- 失效重算：只让受影响选项与报价重新落版 ---------------- */

  const needsRecompute = computed(() => invalidations.value.some((item) => ["batch", "rule", "base"].includes(item.kind)));
  const hasStockIssue = computed(() => invalidations.value.some((item) => item.kind === "stock"));
  const hasConflict = computed(() => invalidations.value.some((item) => item.kind === "conflict"));

  /** 硬失败（库存不足/写入失败）允许同令牌重试，即便重试路径带批次变化 */
  const canRetryLock = computed(
    () =>
      currentLock.value?.status === "failed" &&
      (currentLock.value.failure?.kind === "stock" || currentLock.value.failure?.kind === "write"),
  );
  const canLock = computed(() => !syncing.value && !lockBusy.value && !hasConflict.value && (!quoteBlocked.value || canRetryLock.value));

  async function recompute() {
    if (!server.value) return;
    if (hasConflict.value) {
      ws.value.notice = "冲突未裁清，不能重算报价。";
      return;
    }
    if (hasStockIssue.value) {
      ws.value.notice = "仍有选项库存不足，请先改选有库存批次的选项，再重算报价。";
      return;
    }
    if (server.value && violatedRules(ws.value.draft, server.value.rules).length) {
      ws.value.notice = "当前选择违反最新依赖规则，请先调整受影响选项，再重算报价。";
      return;
    }
    syncing.value = true;
    try {
      const state = await mockServer.recompute();
      server.value = state;
      const head = state.revisions[state.revisions.length - 1];
      for (const role of ["customer", "store"] as Role[]) {
        const workspace = workspaces.value[role];
        workspace.draft = { ...head.config };
        workspace.baseRevId = head.id;
        workspace.snapshot = makeSnapshot(role, head, state);
      }
      ws.value.notice = `已按最新基础价/规则/库存重算，生成修订 ${head.id}，报价恢复有效。`;
    } catch (error) {
      ws.value.notice = `重算失败：${(error as Error).message}`;
    } finally {
      syncing.value = false;
    }
  }

  /* ---------------- 报价锁定单 ---------------- */

  async function lockQuote() {
    if (!server.value || !headRevision.value) return;
    if (hasConflict.value) {
      ws.value.notice = "冲突未裁清，报价不能占用库存。";
      return;
    }
    if (quoteBlocked.value && !canRetryLock.value) {
      ws.value.notice = "库存不足或存在失效项时，报价不能占用库存。";
      return;
    }
    lockBusy.value = true;
    try {
      const result = await mockServer.lockQuote(ws.value.role, headRevision.value.id, ws.value.lockToken);
      server.value = result.state;
      ws.value.notice =
        result.lock.status === "holding"
          ? `报价锁定单 ${result.lock.id} 已占用库存，合计 ¥${result.lock.total}。`
          : `锁定失败（${result.lock.failure?.reason}），未占用库存${result.lock.failure?.retriable ? "，失败批次可重试" : ""}。`;
    } catch (error) {
      ws.value.notice = `锁定请求失败：${(error as Error).message}`;
    } finally {
      lockBusy.value = false;
    }
  }

  async function releaseLock() {
    if (!currentLock.value) return;
    const state = await mockServer.releaseLock(currentLock.value.token);
    server.value = state;
    ws.value.lockToken = `tok-${ws.value.role}-${Math.random().toString(36).slice(2, 10)}`;
    ws.value.notice = "已释放锁定单，库存退回批次。";
  }

  /* ---------------- 管理端模拟动作 ---------------- */

  async function adminAdjustBatch(sku: string, delta: number, note: string, priceDelta?: number) {
    server.value = await mockServer.adminAdjustBatch(sku, delta, note, priceDelta);
  }
  async function adminChangeRules(changes: Parameters<typeof mockServer.adminChangeRules>[0], skus: string[], note: string) {
    server.value = await mockServer.adminChangeRules(changes, skus, note);
  }
  async function adminSetBasePrice(next: number) {
    server.value = await mockServer.adminSetBasePrice(next, "基础主机调价");
  }
  async function armWriteFailure() {
    server.value = await mockServer.armWriteFailure();
  }
  async function resetServer() {
    server.value = mockServer.reset();
    await init(true);
  }

  function applyServerState(state: ServerState) {
    server.value = state;
  }

  function reopenFreeze() {
    if (!server.value || !headRevision.value) return;
    const head = headRevision.value;
    const workspace = ws.value;
    workspace.draft = { ...head.config };
    workspace.baseRevId = head.id;
    workspace.pending = [];
    workspace.seq = 0;
    workspace.snapshot = makeSnapshot(workspace.role, head, server.value);
    workspace.notice = "重新打开：已重新冻结基础价、依赖规则与库存版本。";
  }

  function stockOfSku(sku: string): number {
    if (!server.value) return 0;
    return skuAvailable(sku, server.value.batches, holdingLines.value);
  }

  function revisionInvalidations(revision: ConfigRevision): InvalidationReason[] {
    if (!domain.value) return [];
    return evaluateRevision(revision, domain.value, holdingLines.value);
  }

  function reset() {
    cameraPreset.value = "hero";
  }

  return {
    server,
    loading,
    bootAt,
    activeRole,
    cameraPreset,
    modelRotation,
    syncing,
    lockBusy,
    workspaces,
    ws,
    configuration,
    options,
    specs,
    price,
    revisions,
    headRevision,
    baseRevision,
    invalidations,
    quoteBlocked,
    needsRecompute,
    hasStockIssue,
    hasConflict,
    unresolvedConflicts,
    frozenBadge,
    currentLock,
    canRetryLock,
    canLock,
    holdingLines,
    init,
    switchRole,
    setNetwork,
    selectOption,
    isOptionBlocked,
    syncNow,
    adjudicate,
    recompute,
    lockQuote,
    releaseLock,
    adminAdjustBatch,
    adminChangeRules,
    adminSetBasePrice,
    armWriteFailure,
    resetServer,
    applyServerState,
    setSceneOverride,
    reopenFreeze,
    stockOfSku,
    revisionInvalidations,
    reset,
  };
});
