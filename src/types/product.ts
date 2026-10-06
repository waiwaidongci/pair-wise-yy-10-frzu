export interface ProductOption {
  id: string;
  name: string;
  description: string;
  price: number;
  swatch?: string;
  value?: string | number | boolean;
}

export type GroupId = "color" | "material" | "filter" | "battery" | "stand" | "trim";

export interface ProductGroup {
  id: GroupId;
  name: string;
  summary: string;
  options: ProductOption[];
}

export type CameraPreset = "hero" | "front" | "top" | "detail";

export interface Configuration {
  color: string;
  material: string;
  filter: string;
  battery: string;
  stand: string;
  trim: string;
}

export interface ProductSpec {
  label: string;
  value: string;
}

/* ---------- 协作角色与修订 ---------- */

export type Role = "customer" | "store";

export const ROLE_LABEL: Record<Role, string> = {
  customer: "顾客",
  store: "门店",
};

export type RevisionId = string;

export type RevisionSource = "seed" | "merge" | "adjudication" | "recompute" | "backfill";

/** 未裁清的同字段冲突：双方版本都保留 */
export interface RevisionConflict {
  field: GroupId;
  baseValue: string;
  customerValue: string;
  storeValue: string;
  resolution?: { by: Role; value: string; at: number };
}

/** 配置修订：合并、裁决、重算都会生成新修订号 */
export interface ConfigRevision {
  id: RevisionId;
  number: number;
  parent: RevisionId | null;
  config: Configuration;
  source: RevisionSource;
  actors: Role[];
  conflicts: RevisionConflict[];
  basePrice: number;
  ruleVersion: number;
  inventoryVersion: number;
  /** 该修订落定时刻的选项单价（含批次价差），用于还原旧修订报价 */
  priceBook: Record<string, number>;
  note?: string;
  createdAt: number;
}

/* ---------- 选项操作号（断网本地改动日志） ---------- */

export interface OptionOp {
  /** 幂等键，重连重试不会重复合并 */
  id: string;
  /** 选项操作号：本端会话内递增 */
  seq: number;
  role: Role;
  field: GroupId;
  from: string;
  to: string;
  /** 操作发起时所基于的服务端修订号（三方合并的 base） */
  baseRev: RevisionId;
  clientTs: number;
  status: "pending" | "syncing" | "synced" | "failed";
  error?: string;
}

/* ---------- 冻结快照：每次打开先冻结基础价、依赖规则、库存版本 ---------- */

export interface FrozenSnapshot {
  role: Role;
  revision: RevisionId;
  frozenAt: number;
  basePrice: number;
  rules: DependencyRule[];
  ruleVersion: number;
  inventoryVersion: number;
  priceBook: Record<string, number>;
}

/* ---------- 依赖规则（版本化） ---------- */

export interface DependencyRule {
  id: string;
  version: number;
  when: { field: GroupId; equals: string };
  require: { field: GroupId; in: string[] };
  message: string;
}

export interface RuleEvent {
  version: number;
  ruleIds: string[];
  /** 本次规则变更波及的选项 sku */
  skus: string[];
  note: string;
  at: number;
}

/* ---------- 库存批次（版本化） ---------- */

export interface InventoryBatch {
  id: string;
  sku: string;
  quantity: number;
  /** 该批次相对目录价的价差（新批次可能调价） */
  priceDelta: number;
  note: string;
  createdAt: number;
}

export interface InventoryEvent {
  version: number;
  skus: string[];
  note: string;
  at: number;
}

/* ---------- 失效原因 ---------- */

export type InvalidationKind = "conflict" | "stock" | "rule" | "batch" | "base";

export interface InvalidationReason {
  kind: InvalidationKind;
  field?: GroupId;
  reason: string;
}

/* ---------- 报价锁定单 ---------- */

export interface QuoteLockLine {
  sku: string;
  batchId: string;
  qty: number;
  unitPrice: number;
}

export type LockFailureKind = "conflict" | "drift" | "stock" | "write";

export interface QuoteLock {
  id: string;
  /** 客户端幂等令牌：重复提交、失败重试都不追加占用 */
  token: string;
  revision: RevisionId;
  role: Role;
  status: "holding" | "failed" | "released";
  lines: QuoteLockLine[];
  total: number;
  createdAt: number;
  updatedAt: number;
  failure?: { kind: LockFailureKind; reason: string; retriable: boolean; at: number };
}

/* ---------- 服务端持久化状态（mock） ---------- */

export interface ActorServerState {
  baseRev: RevisionId;
  appliedOpIds: string[];
  lastSeenSeq: number;
}

export interface ServerState {
  revisions: ConfigRevision[];
  actors: Record<Role, ActorServerState>;
  basePrice: number;
  rules: DependencyRule[];
  ruleVersion: number;
  ruleEvents: RuleEvent[];
  batches: InventoryBatch[];
  inventoryVersion: number;
  inventoryEvents: InventoryEvent[];
  locks: QuoteLock[];
  legacyBackfills: Record<string, RevisionId>;
  nextLockSeq: number;
  writeFailureArmed: boolean;
}
