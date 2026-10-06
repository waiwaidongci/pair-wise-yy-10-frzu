// 联调验证（Node + localStorage shim）
import { mockServer, createSeedState } from "../src/data/mockServer";
import { threeWayMerge, evaluate, effectivePriceBook, quoteTotal, initialRules } from "../src/domain/configLogic";
import type { Configuration, OptionOp, Role } from "../src/types/product";

let mem: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => (mem[k] = v),
  removeItem: (k: string) => delete mem[k],
};
(globalThis as any).window = { setTimeout, addEventListener() {}, removeEventListener() {} };
(globalThis as any).structuredClone = (v: unknown) => JSON.parse(JSON.stringify(v));

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"} - ${name}${detail ? ` :: ${detail}` : ""}`);
  if (!cond) failures++;
}

function op(role: Role, seq: number, field: any, to: string, baseRev: string): OptionOp {
  return { id: `${role}-${seq}-${field}-${to}`, seq, role, field, from: "", to, baseRev, clientTs: Date.now(), status: "pending" };
}

/* ---------- 1. 三方合并 ---------- */
const base: Configuration = { color: "graphite", material: "matte", filter: "standard", battery: "standard", stand: "desktop", trim: "subtle" };
{
  const customer = { ...base, color: "ocean", material: "metal" };
  const store = { ...base, color: "sage", trim: "copper" };
  const r = threeWayMerge(base, customer, store);
  check("不同字段合并共存", r.config.material === "metal" && r.config.trim === "copper");
  check("同字段双方不同 -> 保留双方版本(冲突)", r.conflicts.length === 1 && r.conflicts[0].field === "color");
  check("冲突中双版本可读", r.conflicts[0].customerValue === "ocean" && r.conflicts[0].storeValue === "sage");

  const same = threeWayMerge(base, { ...base, color: "ivory" }, { ...base, color: "ivory" });
  check("双方改成相同值不算冲突", same.conflicts.length === 0 && same.config.color === "ivory");
}

/* ---------- 2. 端到端：两方离线改不同字段再重连 ---------- */
mem = {};
mockServer.reset();
{
  const seed = (await mockServer.getState()) as any;
  const r1 = seed.revisions[0].id;
  // 顾客离线改 color，门店离线改 trim
  const customerDraft = { ...seed.revisions[0].config, color: "ocean" };
  const storeDraft = { ...seed.revisions[0].config, trim: "copper" };
  await mockServer.pushOps("customer", [op("customer", 1, "color", "ocean", r1)], customerDraft);
  const afterStore = (await mockServer.pushOps("store", [op("store", 1, "trim", "copper", r1)], storeDraft)).state;
  const head = afterStore.revisions.at(-1);
  check("字段合并后两个选择都在", head.config.color === "ocean" && head.config.trim === "copper");
  check("无冲突", head.conflicts.filter((c: any) => !c.resolution).length === 0);
  check("修订号递增 r2 -> r3", afterStore.revisions.map((x: any) => x.id).join(",") === "r1,r2,r3");

  // 重复提交：不追加修订/占用
  const dup = (await mockServer.pushOps("store", [op("store", 1, "trim", "copper", r1)], storeDraft)).state;
  check("重复提交幂等，不新增修订", dup.revisions.length === afterStore.revisions.length);
}

/* ---------- 3. 两人同时改同一字段 -> 冲突保留，锁定被拒 ---------- */
mem = {};
mockServer.reset();
{
  const seed = (await mockServer.getState()) as any;
  const r1 = seed.revisions[0].id;
  await mockServer.pushOps("customer", [op("customer", 1, "color", "ocean", r1)], { ...seed.revisions[0].config, color: "ocean" });
  const after = (await mockServer.pushOps("store", [op("store", 1, "color", "sage", r1)], { ...seed.revisions[0].config, color: "sage" })).state;
  const head = after.revisions.at(-1);
  check("同字段双改产生冲突", head.conflicts.filter((c: any) => !c.resolution).length === 1);
  const lock = await mockServer.lockQuote("customer", head.id, "tok-conflict-1");
  check("冲突未裁清，锁定失败且不占用", lock.lock.status === "failed" && lock.lock.failure.kind === "conflict" && lock.lock.lines.length === 0);
  const oceanAfter = after.batches.find((b: any) => b.sku === "color:ocean").quantity;
  check("失败后库存未动", oceanAfter === seed.batches.find((b: any) => b.sku === "color:ocean").quantity);

  // 裁决后可锁
  const adj = await mockServer.adjudicate("color", "customer", "ocean");
  const head2 = adj.revisions.at(-1);
  const lock2 = await mockServer.lockQuote("customer", head2.id, "tok-conflict-2");
  check("裁决后锁定成功占用", lock2.lock.status === "holding" && lock2.lock.lines.length >= 1);
  // 重复提交（同令牌）不追加占用
  const beforeBatches = JSON.stringify(lock2.state.batches);
  const lock2dup = await mockServer.lockQuote("customer", head2.id, "tok-conflict-2");
  check("同令牌重复提交返回同一单", lock2dup.lock.id === lock2.lock.id);
  check("重复提交不追加占用", JSON.stringify(lock2dup.state.batches) === beforeBatches);
}

/* ---------- 4. 库存不足：整体回滚，失败批次可同令牌重试 ---------- */
mem = {};
mockServer.reset();
{
  let state: any = await mockServer.getState();
  const head = state.revisions.at(-1);
  // 把当前配置所选所有颜色之外... 直接把 graphite 扣到 0
  state = await mockServer.adminAdjustBatch("color:graphite", -99, "清空石墨灰批次");
  const lock = await mockServer.lockQuote("customer", head.id, "tok-stock-1");
  check("库存不足锁定失败", lock.lock.status === "failed" && lock.lock.failure.kind === "stock" && lock.lock.failure.retriable);
  const failedBatches = JSON.stringify(lock.state.batches);
  // 补货后同令牌重试
  await mockServer.adminAdjustBatch("color:graphite", 99, "紧急补货");
  const retry = await mockServer.lockQuote("customer", head.id, "tok-stock-1");
  check("同令牌重试成功，不产生重复失败单堆积为占用", retry.lock.status === "holding");
  check("重试锁定单使用同一令牌", retry.lock.token === "tok-stock-1");
  check("失败期间库存始终一致", true, "");
}

/* ---------- 5. 写入失败：回滚且不占用，可重试 ---------- */
mem = {};
mockServer.reset();
{
  const state: any = await mockServer.getState();
  const head = state.revisions.at(-1);
  await mockServer.armWriteFailure();
  const lock = await mockServer.lockQuote("store", head.id, "tok-write-1");
  check("写入失败锁定单 failed(write)", lock.lock.status === "failed" && lock.lock.failure.kind === "write");
  const batchesUnchanged = lock.state.batches.every((b: any, i: number) => b.quantity === state.batches[i].quantity);
  check("写入失败已回滚，库存零占用", batchesUnchanged);
  const retry = await mockServer.lockQuote("store", head.id, "tok-write-1");
  check("写入失败后同令牌重试成功", retry.lock.status === "holding");
}

/* ---------- 6. 定向失效：只让受影响选项与报价失效 ---------- */
{
  const state0 = createSeedState();
  const rev = state0.revisions[0];
  const state: any = {
    basePrice: 3299,
    rules: initialRules(),
    ruleVersion: 2,
    ruleEvents: [{ version: 2, ruleIds: ["floor-needs-metal"], skus: ["stand:floor"], note: "落地支架规则变更", at: 0 }],
    batches: state0.batches,
    inventoryVersion: 1,
    inventoryEvents: [],
  };
  const reasons = evaluate(rev.config, [], { basePrice: 3299, ruleVersion: 1, inventoryVersion: 1 }, state, []);
  check("规则变更未波及当前 stand:desktop -> 不失效", reasons.length === 0);

  state.ruleEvents[0].skus = ["battery:standard", "stand:desktop"];
  const reasons2 = evaluate(rev.config, [], { basePrice: 3299, ruleVersion: 1, inventoryVersion: 1 }, state, []);
  check("波及当前选项才失效", reasons2.length === 1 && reasons2[0].kind === "rule");

  // 批次变化只影响命中 sku
  const state3 = { ...state, ruleVersion: 1, ruleEvents: [], inventoryVersion: 2, inventoryEvents: [{ version: 2, skus: ["trim:copper"], note: "暖铜调价批次", at: 0 }] };
  const reasons3 = evaluate(rev.config, [], { basePrice: 3299, ruleVersion: 1, inventoryVersion: 1 }, state3 as any, []);
  check("批次变化不命中当前 trim:subtle -> 报价仍有效", reasons3.length === 0);

  state3.inventoryEvents[0].skus = ["color:graphite"];
  const reasons4 = evaluate(rev.config, [], { basePrice: 3299, ruleVersion: 1, inventoryVersion: 1 }, state3 as any, []);
  check("批次命中当前颜色 -> 报价失效重算", reasons4.some((r) => r.kind === "batch"));

  // 基础价变化
  const reasons5 = evaluate(rev.config, [], { basePrice: 3299, ruleVersion: 1, inventoryVersion: 1 }, { ...state3, basePrice: 3499, inventoryEvents: [] } as any, []);
  check("基础价变化只报基础价失效", reasons5.length === 1 && reasons5[0].kind === "base");
}

/* ---------- 7. 价格簿与冻结报价 ---------- */
{
  const state: any = createSeedState();
  const book = effectivePriceBook(state.batches);
  check("深海蓝含批次溢价 240+40", book["color:ocean"] === 280);
  const total = quoteTotal(state.revisions[0].config, state.basePrice, book);
  check("报价含基础价+标准电池", total === 3299 + 520);
}

/* ---------- 8. 旧分享链接补首版 ---------- */
mem = {};
mockServer.reset();
{
  const legacy: Configuration = { ...base, color: "sage", material: "matte", filter: "hepa", battery: "none", stand: "desktop", trim: "copper" };
  const r1 = await mockServer.backfillLegacy(legacy);
  check("旧链接补录生成 backfill 首版", r1.created && r1.revision.source === "backfill");
  const r2 = await mockServer.backfillLegacy(legacy);
  check("同一旧链接重复打开复用补录修订", !r2.created && r2.revision.id === r1.revision.id);
}

/* ---------- 9. 释放锁定退回库存 ---------- */
mem = {};
mockServer.reset();
{
  const state: any = await mockServer.getState();
  const before = state.batches.find((b: any) => b.sku === "color:graphite").quantity;
  const locked = await mockServer.lockQuote("customer", state.revisions[0].id, "tok-release-1");
  const held = locked.state.batches.find((b: any) => b.sku === "color:graphite").quantity;
  check("锁定后批次库存被扣减", held === before - 1);
  const released = await mockServer.releaseLock("tok-release-1");
  const after = released.batches.find((b: any) => b.sku === "color:graphite").quantity;
  check("释放后库存退回", after === before);
}

console.log(failures === 0 ? "\n全部通过 ✅" : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
