<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import OptionGroup from "./OptionGroup.vue";
import { productGroups } from "../data/catalog";
import { optionName, optionSku } from "../data/catalog";
import { useConfiguratorStore } from "../stores/configurator";
import { createShareUrl, formatPrice } from "../utils/share";
import type { GroupId, Role } from "../types/product";
import { ROLE_LABEL } from "../types/product";

const store = useConfiguratorStore();
const { configuration, ws, workspaces, activeRole, invalidations, quoteBlocked, canLock, canRetryLock, needsRecompute, hasStockIssue, hasConflict, syncing, lockBusy, frozenBadge, currentLock, headRevision, unresolvedConflicts } =
  storeToRefs(store);
const copied = ref(false);

const invalidByField = computed(() => {
  const map = {} as Partial<Record<GroupId, Set<string>>>;
  for (const reason of invalidations.value) {
    if (reason.field) {
      (map[reason.field] ??= new Set()).add(configuration.value[reason.field]);
    }
  }
  return map;
});

function invalidSetFor(groupId: GroupId) {
  return invalidByField.value[groupId] ?? new Set<string>();
}

function stockFor(groupId: GroupId) {
  return (optionId: string) => store.stockOfSku(optionSku(groupId, optionId));
}

async function copyShareLink() {
  const url = createShareUrl(configuration.value, headRevision.value ?? undefined);
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    window.prompt("复制分享链接", url);
  }
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 1800);
}

function conflictValue(role: Role, field: GroupId) {
  const conflict = unresolvedConflicts.value.find((item) => item.field === field);
  if (!conflict) return "";
  return optionName(field, role === "customer" ? conflict.customerValue : conflict.storeValue);
}
</script>

<template>
  <aside class="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:w-[440px]">
    <!-- 角色与冻结状态 -->
    <div class="border-b border-slate-200 p-5">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">AeroStation 修订流</p>
          <h1 class="mt-2 text-xl font-black tracking-tight text-slate-900">模块化空气净化器 S4</h1>
        </div>
        <button class="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50" @click="store.reopenFreeze">
          重新打开冻结
        </button>
      </div>

      <div class="mt-3 grid grid-cols-2 gap-2">
        <button
          v-for="role in (['customer', 'store'] as Role[])"
          :key="role"
          class="rounded-xl border px-3 py-2 text-left transition"
          :class="activeRole === role ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'"
          @click="store.switchRole(role)"
        >
          <p class="text-xs font-black" :class="activeRole === role ? 'text-blue-700' : 'text-slate-700'">{{ ROLE_LABEL[role] }}配置</p>
          <p class="mt-0.5 text-[10px]" :class="workspaces[role].online ? 'text-emerald-600' : 'text-amber-600'">
            {{ workspaces[role].online ? "● 在线" : "○ 断网" }} · 待同步 {{ workspaces[role].pending.filter((op) => op.status !== 'synced').length }}
          </p>
        </button>
      </div>

      <div class="mt-3 rounded-lg bg-slate-50 px-3 py-2">
        <p class="text-[9px] font-black uppercase tracking-wider text-slate-400">打开时冻结（{{ ROLE_LABEL[activeRole] }}）</p>
        <p class="mt-0.5 text-[11px] font-bold text-slate-600">{{ frozenBadge }}</p>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <button
          class="rounded-lg px-3 py-1.5 text-[11px] font-black"
          :class="ws.online ? 'bg-slate-100 text-slate-600' : 'bg-emerald-600 text-white'"
          @click="store.setNetwork(true)"
        >
          恢复联网
        </button>
        <button
          class="rounded-lg px-3 py-1.5 text-[11px] font-black"
          :class="!ws.online ? 'bg-slate-100 text-slate-600' : 'bg-amber-500 text-white'"
          @click="store.setNetwork(false)"
        >
          模拟断网
        </button>
        <button
          class="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-40"
          :disabled="syncing || !ws.pending.some((op) => op.status !== 'synced')"
          @click="store.syncNow()"
        >
          {{ syncing ? "合并中…" : "重连并按字段合并" }}
        </button>
      </div>
    </div>

    <!-- 报价与失效 -->
    <div class="border-b border-slate-200 px-5 py-4">
      <div class="flex items-end justify-between rounded-xl p-4 text-white" :class="quoteBlocked ? 'bg-slate-500' : 'bg-slate-900'">
        <div>
          <p class="text-[10px] uppercase tracking-wider text-slate-400">配置报价（冻结口径）</p>
          <p class="mt-1 text-2xl font-black">{{ formatPrice(store.price) }}</p>
        </div>
        <span class="rounded-full px-2 py-1 text-[10px] font-black" :class="quoteBlocked ? 'bg-red-500' : 'bg-emerald-500'">
          {{ quoteBlocked ? "报价失效" : "可锁定" }}
        </span>
      </div>
      <p class="mt-1.5 text-[10px] text-slate-400">当前修订 {{ headRevision?.id }} · 修订号 {{ headRevision?.number }}</p>

      <div v-if="ws.notice" class="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
        {{ ws.notice }}
      </div>

      <div v-if="invalidations.length" class="mt-3 space-y-1.5">
        <p class="text-[10px] font-black uppercase tracking-wider text-red-500">失效原因（仅受影响选项/报价需重算）</p>
        <div
          v-for="(reason, index) in invalidations"
          :key="index"
          class="rounded-lg border px-3 py-2 text-[11px]"
          :class="{
            'border-red-200 bg-red-50 text-red-800': reason.kind === 'conflict' || reason.kind === 'stock',
            'border-amber-200 bg-amber-50 text-amber-800': reason.kind === 'rule' || reason.kind === 'batch' || reason.kind === 'base',
          }"
        >
          <span class="font-black">[{{ { conflict: '冲突', stock: '库存', rule: '规则', batch: '批次', base: '基础价' }[reason.kind] }}]</span>
          {{ reason.reason }}
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <button
          class="rounded-lg bg-amber-500 px-3 py-2 text-[11px] font-black text-white disabled:opacity-40"
          :disabled="!needsRecompute || hasStockIssue || hasConflict || syncing"
          @click="store.recompute()"
        >
          按最新数据失效重算
        </button>
        <button
          class="rounded-lg bg-blue-600 px-3 py-2 text-[11px] font-black text-white shadow-lg shadow-blue-600/20 disabled:opacity-40"
          :disabled="!canLock"
          @click="store.lockQuote()"
        >
          {{ lockBusy ? "锁定中…" : canRetryLock ? "重试失败批次（同令牌）" : currentLock?.status === 'failed' ? "重试报价锁定单" : "锁定报价并占用库存" }}
        </button>
        <button
          v-if="currentLock?.status === 'holding'"
          class="rounded-lg border border-slate-300 px-3 py-2 text-[11px] font-black text-slate-600"
          @click="store.releaseLock()"
        >
          释放锁定单 {{ currentLock.id }}
        </button>
      </div>
      <p v-if="currentLock?.status === 'holding'" class="mt-2 text-[10px] font-bold text-emerald-600">
        锁定单 {{ currentLock.id }} 占用中：{{ formatPrice(currentLock.total) }}（重复提交不追加占用）
      </p>
      <p v-if="currentLock?.status === 'failed'" class="mt-2 text-[10px] font-bold text-red-600">
        锁定单 {{ currentLock.id }} 失败：{{ currentLock.failure?.reason }}
      </p>
    </div>

    <!-- 冲突裁决：双方版本都保留 -->
    <div v-if="unresolvedConflicts.length" class="border-b border-red-200 bg-red-50/60 px-5 py-4">
      <p class="text-xs font-black text-red-700">同字段双版本冲突（{{ unresolvedConflicts.length }}）</p>
      <div v-for="conflict in unresolvedConflicts" :key="conflict.field" class="mt-3 rounded-xl border border-red-200 bg-white p-3">
        <p class="text-[11px] font-black text-slate-700">
          {{ productGroups.find((group) => group.id === conflict.field)?.name }}：两人同时修改，双方版本均保留
        </p>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <button
            class="rounded-lg border px-2 py-2 text-[11px] font-bold"
            :class="configuration[conflict.field] === conflict.customerValue ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'"
            @click="store.adjudicate(conflict.field, 'customer', conflict.customerValue)"
          >
            顾客版本<br />{{ conflictValue('customer', conflict.field) }}
          </button>
          <button
            class="rounded-lg border px-2 py-2 text-[11px] font-bold"
            :class="configuration[conflict.field] === conflict.storeValue ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'"
            @click="store.adjudicate(conflict.field, 'store', conflict.storeValue)"
          >
            门店版本<br />{{ conflictValue('store', conflict.field) }}
          </button>
        </div>
      </div>
    </div>

    <!-- 选项列表 -->
    <div class="scroll-area min-h-0 flex-1 overflow-y-auto px-5">
      <OptionGroup
        v-for="group in productGroups"
        :key="group.id"
        :group="group"
        :selected="configuration[group.id]"
        :disabled="(optionId) => !!store.isOptionBlocked(group.id, optionId)"
        :stock-of="stockFor(group.id)"
        :invalid-option-ids="invalidSetFor(group.id)"
        @select="(optionId) => store.selectOption(group.id, optionId)"
      />
    </div>

    <!-- 本地操作号日志 + 分享 -->
    <div class="border-t border-slate-200 p-4">
      <div v-if="ws.pending.length" class="mb-3 max-h-24 overflow-y-auto rounded-lg bg-slate-50 p-2">
        <p class="text-[9px] font-black uppercase tracking-wider text-slate-400">{{ ROLE_LABEL[activeRole] }}本地选项操作号</p>
        <div v-for="op in ws.pending.slice(-6)" :key="op.id" class="mt-1 flex justify-between text-[10px] text-slate-500">
          <span>#{{ op.seq }} · {{ productGroups.find((group) => group.id === op.field)?.name }} → {{ optionName(op.field, op.to) }}</span>
          <span :class="{ 'text-amber-600': op.status === 'pending', 'text-red-600': op.status === 'failed', 'text-emerald-600': op.status === 'synced' }">
            {{ { pending: "待重连", syncing: "同步中", synced: "已入修订", failed: "可重试" }[op.status] }}
          </span>
        </div>
      </div>
      <button
        class="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
        @click="copyShareLink"
      >
        {{ copied ? "链接已复制" : `生成分享链接（当前修订 ${headRevision?.id}）` }}
      </button>
      <p class="mt-2 text-center text-[10px] text-slate-400">链接携带修订号；旧链接打开时自动补录为首版</p>
    </div>
  </aside>
</template>
