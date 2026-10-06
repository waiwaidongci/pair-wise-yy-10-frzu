import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  BASE_PRICE,
  defaultConfiguration,
  dependencyRules,
  evaluateInvalidOptions,
  productGroups,
  server,
  stockKey,
  type CameraPreset,
  type Configuration,
  type FieldConflict,
  type FieldOp,
  type FrozenSnapshot,
  type GroupId,
  type InvalidOption,
  type ProductGroup,
  type QuoteLock,
  type Revision,
  type SharePayload,
} from "../data/configData";

interface ProductSpec {
  label: string;
  value: string;
}

const LOCAL_CLIENT_ID = "customer";

function buildBaseRevision(frozen: FrozenSnapshot): Revision {
  const fields = {} as Revision["fields"];
  for (const group of productGroups) {
    fields[group.id] = { field: group.id, value: frozen.config[group.id] };
  }
  const { invalidOptions, invalidReasons } = evaluateInvalidOptions(
    frozen.config,
    frozen.dependencyRulesVersion,
    { version: frozen.inventoryVersion, stock: frozen.inventoryStock },
  );
  return {
    revisionId: frozen.revisionId,
    basePrice: frozen.basePrice,
    dependencyRulesVersion: frozen.dependencyRulesVersion,
    inventoryVersion: frozen.inventoryVersion,
    fields,
    config: { ...frozen.config },
    conflicts: [],
    invalidOptions,
    invalidReasons,
    affectedOptions: [],
  };
}

export const useConfiguratorStore = defineStore("configurator", () => {
  // 每次打开先冻结：基础价、依赖规则版本、库存版本
  const frozen = ref<FrozenSnapshot>(server.openSnapshot());
  const revision = ref<Revision>(buildBaseRevision(frozen.value));
  // 本地改动按选项操作号记录
  const localOps = ref<FieldOp[]>([]);
  let localOpCounter = 0;

  const cameraPreset = ref<CameraPreset>("hero");
  const modelRotation = ref(-0.35);
  const shareNotice = ref("");
  const syncNotice = ref("");
  const lockError = ref("");
  const quote = ref<QuoteLock | null>(null);

  const configuration = computed(() => revision.value.config);
  const conflicts = computed<FieldConflict[]>(() => revision.value.conflicts);
  const invalidOptions = computed<InvalidOption[]>(() => revision.value.invalidOptions);
  const invalidReasons = computed<Record<string, string>>(() => revision.value.invalidReasons);
  const affectedOptions = computed<string[]>(() => revision.value.affectedOptions);
  const isDirty = computed(() => localOps.value.length > 0);

  const options = computed(() =>
    Object.fromEntries(
      productGroups.map((group) => [
        group.id,
        group.options.find((option) => option.id === configuration.value[group.id])!,
      ]),
    ) as Record<ProductGroup["id"], ProductGroup["options"][number]>,
  );

  const dependencyMessage = computed(() => invalidOptions.value[0]?.reason ?? "");

  const price = computed(() => {
    const total =
      revision.value.basePrice +
      Object.values(options.value).reduce((sum, option) => sum + option.price, 0);
    return total;
  });

  const specs = computed<ProductSpec[]>(() => {
    const batteryCopy: Record<Configuration["battery"], string> = {
      none: "电源供电",
      standard: "5 小时",
      extended: "11 小时",
    };
    const coverage: Record<Configuration["filter"], string> = {
      standard: "25-45㎡",
      hepa: "35-65㎡",
      formaldehyde: "30-55㎡",
    };
    return [
      { label: "建议面积", value: coverage[configuration.value.filter] },
      { label: "颗粒物 CADR", value: configuration.value.filter === "hepa" ? "620m³/h" : "480m³/h" },
      { label: "运行噪声", value: configuration.value.material === "metal" ? "20-48 dB" : "22-51 dB" },
      { label: "续航", value: batteryCopy[configuration.value.battery] },
      { label: "机身重量", value: configuration.value.material === "metal" ? "8.6kg" : "6.9kg" },
      { label: "控制方式", value: configuration.value.trim === "subtle" ? "触控 + App" : "旋钮 + App" },
    ];
  });

  /** 本地依赖规则（冻结版本内）禁止的组合 */
  const isOptionDisabled = (groupId: GroupId, optionId: string): boolean => {
    const config = configuration.value;
    if (groupId === "battery" && optionId === "extended" && config.material !== "metal") return true;
    if (groupId === "stand" && optionId === "floor" && config.material !== "metal") return true;
    if (groupId === "filter" && optionId === "hepa" && config.material === "wood") return true;
    if (
      groupId === "trim" &&
      optionId === "copper" &&
      config.material !== "metal" &&
      frozen.value.dependencyRulesVersion >= 2
    )
      return true;
    return false;
  };

  /** 离线本地更新修订：应用本地操作 + 自动修正，按冻结版本判定失效 */
  function rebuildRevisionFromLocal(): void {
    const config = { ...frozen.value.config };
    for (const op of localOps.value) {
      config[op.field] = op.value;
    }
    // 材质变化时的自动修正（与原逻辑一致）
    if (config.material !== "metal") {
      if (config.battery === "extended") config.battery = "standard";
      if (config.stand === "floor") config.stand = "desktop";
    }
    if (config.material === "wood" && config.filter === "hepa") {
      config.filter = "standard";
    }

    const fields = {} as Revision["fields"];
    for (const group of productGroups) {
      fields[group.id] = { field: group.id, value: config[group.id] };
    }
    const { invalidOptions: invalid, invalidReasons: reasons } = evaluateInvalidOptions(
      config,
      frozen.value.dependencyRulesVersion,
      { version: frozen.value.inventoryVersion, stock: frozen.value.inventoryStock },
    );

    revision.value = {
      revisionId: frozen.value.revisionId,
      basePrice: frozen.value.basePrice,
      dependencyRulesVersion: frozen.value.dependencyRulesVersion,
      inventoryVersion: frozen.value.inventoryVersion,
      fields,
      config,
      conflicts: [],
      invalidOptions: invalid,
      invalidReasons: reasons,
      affectedOptions: [],
    };
  }

  function selectOption(groupId: GroupId, optionId: string): void {
    if (isOptionDisabled(groupId, optionId)) {
      shareNotice.value = dependencyMessage.value || "当前组合不支持该选项。";
      return;
    }
    localOpCounter += 1;
    localOps.value.push({
      opNo: localOpCounter,
      field: groupId,
      value: optionId,
      clientId: LOCAL_CLIENT_ID,
      ts: Date.now(),
    });
    shareNotice.value = "";
    lockError.value = "";
    quote.value = null; // 配置变更 → 报价失效，需重新锁定
    rebuildRevisionFromLocal();
  }

  /** 断网改动重连：按字段合并，选择不互相覆盖 */
  function sync(): void {
    const result = server.sync(LOCAL_CLIENT_ID, frozen.value, localOps.value);
    revision.value = result.revision;
    frozen.value = {
      ...frozen.value,
      revisionId: result.revision.revisionId,
      basePrice: result.revision.basePrice,
      dependencyRulesVersion: result.revision.dependencyRulesVersion,
      inventoryVersion: result.revision.inventoryVersion,
      inventoryStock: server.getInventory().stock,
      config: { ...result.revision.config },
    };
    localOps.value = [];
    localOpCounter = 0;
    quote.value = null;
    lockError.value = "";
    const changed = result.remoteChangedFields.length;
    const conflictCount = result.revision.conflicts.length;
    const invalidCount = result.revision.invalidOptions.length;
    const parts: string[] = [];
    if (changed) parts.push(`远程改动 ${changed} 处字段`);
    if (conflictCount) parts.push(`${conflictCount} 处冲突待裁清`);
    if (invalidCount) parts.push(`${invalidCount} 个选项失效`);
    syncNotice.value = parts.length ? `已同步：${parts.join("，")}。` : "已同步，无远程改动。";
  }

  /** 裁清冲突：选择本地或远程版本 */
  function adjudicate(field: GroupId, choice: "local" | "remote"): void {
    const conflict = conflicts.value.find((c) => c.field === field);
    if (!conflict) return;
    const value = choice === "local" ? conflict.local.value : conflict.remote.value;
    localOpCounter += 1;
    localOps.value.push({
      opNo: localOpCounter,
      field,
      value,
      clientId: LOCAL_CLIENT_ID,
      ts: Date.now(),
    });
    lockError.value = "";
    quote.value = null;
    rebuildRevisionFromLocal();
    // 裁清后重连一次，让服务端 canonical 与本地一致
    sync();
  }

  /** 锁定报价单：冲突未裁清 / 库存不足 / 写入失败 均不占用库存 */
  function lockQuote(): void {
    lockError.value = "";
    if (conflicts.value.length > 0) {
      lockError.value = "存在未裁清的字段冲突，无法锁定报价。";
      return;
    }
    if (invalidOptions.value.length > 0) {
      lockError.value = "存在失效选项（库存不足或依赖冲突），无法锁定报价。";
      return;
    }
    const quoteId = `q-${Date.now()}`;
    // 幂等键：同一修订 + 同一配置 → 同一把锁，重复提交不追加占用
    const configKey = Object.entries(configuration.value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("|");
    const idempotencyKey = `quote:${revision.value.revisionId}:${configKey}`;
    const result = server.lockQuote({
      quoteId,
      revisionId: revision.value.revisionId,
      config: { ...configuration.value },
      idempotencyKey,
    });
    quote.value = result;
    if (result.status === "failed") {
      lockError.value = result.failureReason ?? "锁定失败";
    }
  }

  /** 重试失败批次：失败批次可重试，成功后才占用库存 */
  function retryLock(): void {
    if (!quote.value) return;
    const result = server.retryLock(quote.value.idempotencyKey);
    quote.value = result;
    if (result.status === "failed") {
      lockError.value = result.failureReason ?? "重试失败";
    } else {
      lockError.value = "";
    }
  }

  /** 应用分享载荷：旧链接无修订号 → 补成首版 */
  function applySharePayload(payload: SharePayload): void {
    const safe = { ...defaultConfiguration, ...payload.c };
    // 自动修正
    if (safe.material !== "metal") {
      if (safe.battery === "extended") safe.battery = "standard";
      if (safe.stand === "floor") safe.stand = "desktop";
    }
    if (safe.material === "wood" && safe.filter === "hepa") safe.filter = "standard";

    const isLegacy = !payload.rev;
    const revisionId = payload.rev ?? "rev-1"; // 旧链接补成首版
    const basePrice = payload.base ?? BASE_PRICE;
    const rulesVersion = payload.drv ?? 1;
    const inventoryVersion = payload.inv ?? 1;

    const frozenSnapshot: FrozenSnapshot = {
      revisionId,
      basePrice,
      dependencyRulesVersion: rulesVersion,
      inventoryVersion,
      inventoryStock: { ...server.getInventory().stock },
      config: { ...safe },
    };
    frozen.value = frozenSnapshot;
    localOps.value = [];
    localOpCounter = 0;
    quote.value = null;
    lockError.value = "";
    revision.value = buildBaseRevision(frozenSnapshot);
    if (isLegacy) {
      syncNotice.value = "旧分享链接已补成首版修订（rev-1）。";
    }
  }

  function reset(): void {
    frozen.value = server.openSnapshot();
    revision.value = buildBaseRevision(frozen.value);
    localOps.value = [];
    localOpCounter = 0;
    cameraPreset.value = "hero";
    modelRotation.value = -0.35;
    shareNotice.value = "";
    syncNotice.value = "";
    lockError.value = "";
    quote.value = null;
  }

  return {
    // state
    frozen,
    revision,
    localOps,
    cameraPreset,
    modelRotation,
    shareNotice,
    syncNotice,
    lockError,
    quote,
    // derived
    configuration,
    conflicts,
    invalidOptions,
    invalidReasons,
    affectedOptions,
    isDirty,
    options,
    price,
    specs,
    dependencyMessage,
    // actions
    selectOption,
    isOptionDisabled,
    sync,
    adjudicate,
    lockQuote,
    retryLock,
    applySharePayload,
    reset,
  };
});

export type { ProductSpec };
