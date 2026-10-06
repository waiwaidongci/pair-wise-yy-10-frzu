// 数据层：产品数据、冻结快照、带版本的依赖规则、库存批次、
// 以及"配置修订 → 库存批次 → 报价锁定单"联动流程的本地模拟服务端。
// 本文件只负责数据；判定逻辑在 stores/configurator.ts，页面在 pages/ 与 components/。

// ---------- 产品数据 ----------
export interface ProductOption {
  id: string;
  name: string;
  description: string;
  price: number;
  swatch?: string;
}

export interface ProductGroup {
  id: GroupId;
  name: string;
  summary: string;
  options: ProductOption[];
}

export type GroupId = "color" | "material" | "filter" | "battery" | "stand" | "trim";
export type Configuration = Record<GroupId, string>;
export type CameraPreset = "hero" | "front" | "top" | "detail";

export const productGroups: ProductGroup[] = [
  {
    id: "color",
    name: "机身颜色",
    summary: "外壳阳极氧化与喷砂配色",
    options: [
      { id: "graphite", name: "石墨灰", description: "耐脏、适合办公环境", price: 0, swatch: "#343941" },
      { id: "ivory", name: "雾光白", description: "柔和明亮，适合居住空间", price: 0, swatch: "#e9e5dc" },
      { id: "sage", name: "鼠尾草绿", description: "低饱和限定配色", price: 180, swatch: "#758f7d" },
      { id: "ocean", name: "深海蓝", description: "限定批次，库存较少", price: 240, swatch: "#385a78" },
    ],
  },
  {
    id: "material",
    name: "外壳材质",
    summary: "影响触感、耐用度和净化结构",
    options: [
      { id: "matte", name: "哑光复合材质", description: "轻量且抗指纹", price: 0 },
      { id: "metal", name: "拉丝铝合金", description: "更高结构强度与金属质感", price: 680 },
      { id: "wood", name: "天然胡桃木", description: "手工饰面，不支持医疗滤芯", price: 980 },
    ],
  },
  {
    id: "filter",
    name: "滤芯系统",
    summary: "根据房间面积和敏感人群选择",
    options: [
      { id: "standard", name: "标准复合滤芯", description: "适合 25-45㎡ 空间", price: 0 },
      { id: "hepa", name: "H13 医疗级滤芯", description: "高效过滤细颗粒物", price: 860 },
      { id: "formaldehyde", name: "除醛增强滤芯", description: "新装修空间推荐", price: 720 },
    ],
  },
  {
    id: "battery",
    name: "续航模块",
    summary: "选择移动使用方式与续航时间",
    options: [
      { id: "none", name: "纯电源供电", description: "标准桌面使用", price: 0 },
      { id: "standard", name: "标准电池", description: "约 5 小时续航", price: 520 },
      { id: "extended", name: "长续航双电池", description: "约 11 小时，仅金属机身可选", price: 980 },
    ],
  },
  {
    id: "stand",
    name: "支架形态",
    summary: "落地支架依赖铝合金材质",
    options: [
      { id: "desktop", name: "桌面橡胶底座", description: "重心稳定，占地面积小", price: 0 },
      { id: "floor", name: "立式铝合金支架", description: "升高 92cm，仅金属机身可选", price: 760 },
    ],
  },
  {
    id: "trim",
    name: "控制环",
    summary: "顶部触控环的视觉与触感",
    options: [
      { id: "subtle", name: "同色控制环", description: "一体化外观", price: 0 },
      { id: "copper", name: "暖铜控制环", description: "拉丝金属点缀", price: 260, swatch: "#b5744d" },
      { id: "graphite-ring", name: "深色镀铬环", description: "高对比控制区域", price: 220, swatch: "#20242a" },
    ],
  },
];

export const defaultConfiguration: Configuration = {
  color: "graphite",
  material: "matte",
  filter: "standard",
  battery: "standard",
  stand: "desktop",
  trim: "subtle",
};

export const BASE_PRICE = 3299;

// ---------- 依赖规则（带版本，打开时冻结） ----------
export interface InvalidOption {
  groupId: GroupId;
  optionId: string;
  reason: string;
  ruleId: string;
}

export interface DependencyRule {
  id: string;
  /** 规则生效的版本号；冻结版本 >= 该值时才校验 */
  version: number;
  /** 该规则触及的字段，用于失效重算时只圈定受影响选项 */
  fields: GroupId[];
  evaluate: (config: Configuration) => InvalidOption[];
}

export const dependencyRules: DependencyRule[] = [
  {
    id: "battery-extended-needs-metal",
    version: 1,
    fields: ["battery", "material"],
    evaluate: (config) => {
      if (config.battery === "extended" && config.material !== "metal") {
        return [
          {
            groupId: "battery",
            optionId: "extended",
            reason: "长续航双电池需要搭配拉丝铝合金机身。",
            ruleId: "battery-extended-needs-metal",
          },
        ];
      }
      return [];
    },
  },
  {
    id: "stand-floor-needs-metal",
    version: 1,
    fields: ["stand", "material"],
    evaluate: (config) => {
      if (config.stand === "floor" && config.material !== "metal") {
        return [
          {
            groupId: "stand",
            optionId: "floor",
            reason: "立式支架需要铝合金机身提供结构强度。",
            ruleId: "stand-floor-needs-metal",
          },
        ];
      }
      return [];
    },
  },
  {
    id: "wood-no-hepa",
    version: 1,
    fields: ["material", "filter"],
    evaluate: (config) => {
      if (config.material === "wood" && config.filter === "hepa") {
        return [
          {
            groupId: "filter",
            optionId: "hepa",
            reason: "医疗级滤芯不支持天然胡桃木饰面。",
            ruleId: "wood-no-hepa",
          },
        ];
      }
      return [];
    },
  },
  {
    id: "copper-trim-needs-metal",
    version: 2,
    fields: ["trim", "material"],
    evaluate: (config) => {
      if (config.trim === "copper" && config.material !== "metal") {
        return [
          {
            groupId: "trim",
            optionId: "copper",
            reason: "暖铜控制环需要搭配拉丝铝合金机身（规则 v2 新增）。",
            ruleId: "copper-trim-needs-metal",
          },
        ];
      }
      return [];
    },
  },
];

// ---------- 库存批次（带版本，打开时冻结） ----------
export interface InventoryBatch {
  version: number;
  /** 键为 `${groupId}:${optionId}`，值为可用数量 */
  stock: Record<string, number>;
}

export const stockKey = (groupId: GroupId, optionId: string): string => `${groupId}:${optionId}`;

export const initialInventory: InventoryBatch = {
  version: 1,
  stock: {
    "color:graphite": 50,
    "color:ivory": 40,
    "color:sage": 12,
    "color:ocean": 3,
    "material:matte": 60,
    "material:metal": 25,
    "material:wood": 8,
    "filter:standard": 70,
    "filter:hepa": 15,
    "filter:formaldehyde": 20,
    "battery:none": 40,
    "battery:standard": 35,
    "battery:extended": 6,
    "stand:desktop": 80,
    "stand:floor": 9,
    "trim:subtle": 100,
    "trim:copper": 30,
    "trim:graphite-ring": 25,
  },
};

/**
 * 纯函数：依据冻结的规则版本与库存批次，判定当前配置下的失效选项。
 * 只校验"选中项"是否失效；未选中的选项不影响报价。
 */
export function evaluateInvalidOptions(
  config: Configuration,
  rulesVersion: number,
  inventory: InventoryBatch,
): { invalidOptions: InvalidOption[]; invalidReasons: Record<string, string> } {
  const result: InvalidOption[] = [];
  for (const rule of dependencyRules) {
    if (rule.version <= rulesVersion) {
      result.push(...rule.evaluate(config));
    }
  }
  for (const group of productGroups) {
    const optionId = config[group.id];
    const key = stockKey(group.id, optionId);
    const available = inventory.stock[key] ?? 0;
    if (available <= 0) {
      result.push({
        groupId: group.id,
        optionId,
        reason: `库存批次 v${inventory.version}：${group.options.find((o) => o.id === optionId)?.name ?? optionId} 库存不足。`,
        ruleId: "inventory",
      });
    }
  }
  const seen = new Set<string>();
  const invalidOptions = result.filter((r) => {
    const key = stockKey(r.groupId, r.optionId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const invalidReasons: Record<string, string> = {};
  for (const inv of invalidOptions) {
    invalidReasons[stockKey(inv.groupId, inv.optionId)] = inv.reason;
  }
  return { invalidOptions, invalidReasons };
}

// ---------- 冻结快照（每次打开先冻结） ----------
export interface FrozenSnapshot {
  revisionId: string;
  basePrice: number;
  dependencyRulesVersion: number;
  inventoryVersion: number;
  inventoryStock: Record<string, number>;
  config: Configuration;
}

// ---------- 本地操作（按选项操作号记录） ----------
export interface FieldOp {
  opNo: number;
  field: GroupId;
  value: string;
  clientId: string;
  ts: number;
}

// ---------- 字段冲突（双方改到同一字段且值不同） ----------
export interface FieldConflict {
  field: GroupId;
  local: { value: string; opNo: number; clientId: string };
  remote: { value: string; opNo: number; clientId: string };
}

export interface MergedField {
  field: GroupId;
  value: string;
  conflict?: FieldConflict;
}

// ---------- 修订（合并后的结果） ----------
export interface Revision {
  revisionId: string;
  basePrice: number;
  dependencyRulesVersion: number;
  inventoryVersion: number;
  fields: Record<GroupId, MergedField>;
  config: Configuration;
  conflicts: FieldConflict[];
  invalidOptions: InvalidOption[];
  invalidReasons: Record<string, string>;
  /** 受本次批次/规则变化影响的选项 stockKey 列表（用于只圈定受影响项） */
  affectedOptions: string[];
}

// ---------- 报价锁定单 ----------
export type QuoteStatus = "draft" | "locking" | "locked" | "failed";

export interface QuoteLock {
  quoteId: string;
  revisionId: string;
  status: QuoteStatus;
  occupied: Record<string, number>;
  failureReason?: string;
  idempotencyKey: string;
  attempts: number;
}

export interface SyncResult {
  revision: Revision;
  remoteChangedFields: GroupId[];
}

// ---------- 模拟服务端（内存态，演示用） ----------
class ConfigServer {
  private config: Configuration;
  private inventory: InventoryBatch;
  private rulesVersion = 1;
  private basePrice = BASE_PRICE;
  private revisionCounter = 0;
  private nextWriteFailure = false;
  private locks = new Map<string, QuoteLock>();
  readonly remoteClientId = "store";

  constructor() {
    this.config = { ...defaultConfiguration };
    this.inventory = { version: 1, stock: { ...initialInventory.stock } };
  }

  private nextRevisionId(): string {
    this.revisionCounter += 1;
    return `rev-${this.revisionCounter}`;
  }

  /** 打开配置：冻结基础价、依赖规则版本、库存版本 */
  openSnapshot(): FrozenSnapshot {
    return {
      revisionId: this.nextRevisionId(),
      basePrice: this.basePrice,
      dependencyRulesVersion: this.rulesVersion,
      inventoryVersion: this.inventory.version,
      inventoryStock: { ...this.inventory.stock },
      config: { ...this.config },
    };
  }

  /** 远程（门店）改动一个字段 */
  remoteEdit(field: GroupId, value: string): void {
    this.config[field] = value;
  }

  /** 库存批次变化：推进版本并调整某选项库存 */
  advanceInventory(key: string, qty: number): void {
    this.inventory.version += 1;
    this.inventory.stock[key] = qty;
  }

  /** 依赖规则变化：推进版本（启用新规则） */
  bumpRules(): void {
    this.rulesVersion += 1;
  }

  setNextWriteFailure(fail: boolean): void {
    this.nextWriteFailure = fail;
  }

  getInventory(): InventoryBatch {
    return this.inventory;
  }

  /**
   * 断网改动重连后按字段合并：
   * - 仅本地改 → 采用本地
   * - 仅远程改 → 采用远程
   * - 双方都改且值相同 → 不冲突，采用该值
   * - 双方都改且值不同 → 保留双方版本（冲突），待裁清
   */
  sync(clientId: string, base: FrozenSnapshot, localOps: FieldOp[]): SyncResult {
    const remoteChangedFields: GroupId[] = [];
    const mergedFields = {} as Record<GroupId, MergedField>;
    const resolvedConfig = {} as Configuration;
    const conflicts: FieldConflict[] = [];

    for (const group of productGroups) {
      const field = group.id;
      const baseVal = base.config[field];
      const serverVal = this.config[field];
      const localOp = [...localOps].reverse().find((op) => op.field === field);
      const localVal = localOp ? localOp.value : baseVal;

      const remoteChanged = serverVal !== baseVal;
      const localChanged = localVal !== baseVal;

      let value: string;
      let conflict: FieldConflict | undefined;

      if (remoteChanged && localChanged) {
        if (serverVal === localVal) {
          value = serverVal; // 双方改到同一值，不冲突
        } else {
          conflict = {
            field,
            local: { value: localVal, opNo: localOp!.opNo, clientId: localOp!.clientId },
            remote: { value: serverVal, opNo: 0, clientId: this.remoteClientId },
          };
          value = serverVal; // 占位，待裁清
          conflicts.push(conflict);
        }
      } else if (remoteChanged) {
        value = serverVal;
      } else if (localChanged) {
        value = localVal;
      } else {
        value = baseVal;
      }

      if (remoteChanged) remoteChangedFields.push(field);
      mergedFields[field] = { field, value, conflict };
      resolvedConfig[field] = value;
    }

    // 合并后更新服务端 canonical（非冲突字段不再互相覆盖）
    for (const group of productGroups) {
      if (!mergedFields[group.id].conflict) {
        this.config[group.id] = mergedFields[group.id].value;
      }
    }

    const { invalidOptions, invalidReasons } = evaluateInvalidOptions(
      resolvedConfig,
      this.rulesVersion,
      this.inventory,
    );

    // 受本次变化影响的选项：库存发生变化的选项 + 新规则触及字段的当前选中项
    const affectedOptions = this.computeAffected(base, resolvedConfig);

    const revision: Revision = {
      revisionId: this.nextRevisionId(),
      basePrice: this.basePrice,
      dependencyRulesVersion: this.rulesVersion,
      inventoryVersion: this.inventory.version,
      fields: mergedFields,
      config: resolvedConfig,
      conflicts,
      invalidOptions,
      invalidReasons,
      affectedOptions,
    };

    return { revision, remoteChangedFields };
  }

  private computeAffected(base: FrozenSnapshot, config: Configuration): string[] {
    const affected = new Set<string>();
    // 库存变化：库存数量发生改变的选项
    for (const group of productGroups) {
      for (const option of group.options) {
        const key = stockKey(group.id, option.id);
        const before = base.inventoryStock[key] ?? 0;
        const after = this.inventory.stock[key] ?? 0;
        if (before !== after) affected.add(key);
      }
    }
    // 规则变化：新启用规则触及字段的当前选中项
    for (const rule of dependencyRules) {
      if (rule.version > base.dependencyRulesVersion) {
        for (const field of rule.fields) {
          affected.add(stockKey(field, config[field]));
        }
      }
    }
    return [...affected];
  }

  /**
   * 锁定报价单并占用库存。幂等：同一 idempotencyKey 不重复占用。
   * 写入失败时不占用库存，可重试。
   */
  lockQuote(req: {
    quoteId: string;
    revisionId: string;
    config: Configuration;
    idempotencyKey: string;
  }): QuoteLock {
    const existing = this.locks.get(req.idempotencyKey);
    if (existing) return existing; // 重复提交不追加占用

    const occupied: Record<string, number> = {};
    for (const group of productGroups) {
      occupied[stockKey(group.id, req.config[group.id])] = 1;
    }

    const lock: QuoteLock = {
      quoteId: req.quoteId,
      revisionId: req.revisionId,
      status: "locking",
      occupied: { ...occupied },
      idempotencyKey: req.idempotencyKey,
      attempts: 1,
    };

    if (this.nextWriteFailure) {
      this.nextWriteFailure = false;
      lock.status = "failed";
      lock.failureReason = "写入失败：服务端暂时无法占用库存，请重试。";
      // 写入失败不扣减库存，occupied 保留为"拟占用"以便重试时真正占用
      this.locks.set(req.idempotencyKey, lock);
      return lock;
    }

    for (const key of Object.keys(occupied)) {
      this.inventory.stock[key] = Math.max(0, (this.inventory.stock[key] ?? 0) - 1);
    }
    lock.status = "locked";
    this.locks.set(req.idempotencyKey, lock);
    return lock;
  }

  /** 重试失败的批次：不重复占用，成功后才真正扣减库存 */
  retryLock(idempotencyKey: string): QuoteLock {
    const existing = this.locks.get(idempotencyKey);
    if (!existing) throw new Error("no lock to retry");
    if (existing.status === "locked") return existing;
    existing.attempts += 1;
    if (this.nextWriteFailure) {
      this.nextWriteFailure = false;
      existing.status = "failed";
      existing.failureReason = "写入失败：服务端暂时无法占用库存，请重试。";
      return existing;
    }
    for (const key of Object.keys(existing.occupied)) {
      this.inventory.stock[key] = Math.max(0, (this.inventory.stock[key] ?? 0) - 1);
    }
    existing.status = "locked";
    existing.failureReason = undefined;
    return existing;
  }
}

export const server = new ConfigServer();

// ---------- 分享链接载荷 ----------
export interface SharePayload {
  /** 载荷版本：1 = 旧链接（无修订号，补成首版）；2 = 新链接（带修订号） */
  v: number;
  rev?: string;
  base?: number;
  drv?: number;
  inv?: number;
  c: Configuration;
}
