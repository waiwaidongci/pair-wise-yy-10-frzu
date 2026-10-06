<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import OptionGroup from "./OptionGroup.vue";
import { productGroups, server, stockKey, type GroupId, type SharePayload } from "../data/configData";
import { useConfiguratorStore } from "../stores/configurator";
import { createShareUrl, formatPrice } from "../utils/share";

const store = useConfiguratorStore();
const { configuration, conflicts, invalidOptions, invalidReasons, quote, syncNotice, lockError, isDirty } =
  storeToRefs(store);
const copied = ref(false);
const writeFailureArmed = ref(false);

const optionName = (groupId: GroupId, optionId: string): string =>
  productGroups.find((g) => g.id === groupId)?.options.find((o) => o.id === optionId)?.name ?? optionId;

const fieldName = (groupId: GroupId): string =>
  productGroups.find((g) => g.id === groupId)?.name ?? groupId;

const stockOf = (groupId: GroupId, optionId: string): number =>
  store.frozen.inventoryStock[stockKey(groupId, optionId)] ?? 0;

async function copyShareLink() {
  const payload: SharePayload = {
    v: 2,
    rev: store.revision.revisionId,
    base: store.revision.basePrice,
    drv: store.revision.dependencyRulesVersion,
    inv: store.revision.inventoryVersion,
    c: { ...configuration.value },
  };
  const url = createShareUrl(payload);
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    window.prompt("复制分享链接", url);
  }
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 1800);
}

// ---- 演练：模拟门店（远程）改动 ----
function remoteEdit(field: GroupId, value: string) {
  server.remoteEdit(field, value);
  store.sync();
}
function advanceInventory() {
  server.advanceInventory("color:ocean", 0);
  store.sync();
}
function bumpRules() {
  server.bumpRules();
  store.sync();
}
function armWriteFailure() {
  server.setNextWriteFailure(true);
  writeFailureArmed.value = true;
}
function reconnect() {
  writeFailureArmed.value = false;
  store.sync();
}
function resetDrill() {
  window.location.reload();
}

const quoteStatusText = computed(() => {
  if (!quote.value) return "";
  if (quote.value.status === "locked") return "已锁定 · 库存已占用";
  if (quote.value.status === "failed") return "锁定失败 · 未占用库存";
  return "锁定中…";
});
</script>

<template>
  <aside class="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:w-[430px]">
    <div class="border-b border-slate-200 p-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">AeroStation Configurator</p>
          <h1 class="mt-2 text-2xl font-black tracking-tight text-slate-900">模块化空气净化器 S4</h1>
          <p class="mt-1 text-xs text-slate-400">三维实时配置 · 修订 / 库存批次 / 报价联动</p>
        </div>
        <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50" @click="store.reset">重置</button>
      </div>

      <!-- 当前修订 -->
      <div class="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
        <span class="font-black uppercase tracking-wider text-slate-400">当前修订</span>
        <span class="rounded-full bg-slate-900 px-2 py-0.5 font-mono font-bold text-white">{{ store.revision.revisionId }}</span>
        <span class="text-slate-300">|</span>
        <span>基础价 {{ formatPrice(store.revision.basePrice) }}</span>
        <span class="text-slate-300">|</span>
        <span>规则 v{{ store.revision.dependencyRulesVersion }}</span>
        <span class="text-slate-300">|</span>
        <span>库存批次 v{{ store.revision.inventoryVersion }}</span>
        <span v-if="isDirty" class="ml-auto rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700">有未同步改动</span>
      </div>

      <div class="mt-4 rounded-xl bg-slate-900 p-4 text-white">
        <div class="flex items-end justify-between">
          <div>
            <p class="text-[10px] uppercase tracking-wider text-slate-400">配置价格</p>
            <p class="mt-1 text-2xl font-black">{{ formatPrice(store.price) }}</p>
          </div>
          <p class="text-[10px] text-slate-400">含基础主机与选配模块</p>
        </div>
      </div>

      <!-- 同步提示 -->
      <p v-if="syncNotice" class="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
        {{ syncNotice }}
      </p>

      <!-- 失效选项 -->
      <div v-if="invalidOptions.length" class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
        <p class="text-xs font-black text-red-700">失效选项（{{ invalidOptions.length }}）</p>
        <ul class="mt-2 space-y-1">
          <li v-for="inv in invalidOptions" :key="`${inv.groupId}:${inv.optionId}`" class="text-[11px] text-red-700">
            <span class="font-bold">{{ optionName(inv.groupId, inv.optionId) }}</span>：{{ inv.reason }}
          </li>
        </ul>
      </div>

      <!-- 冲突裁清 -->
      <div v-if="conflicts.length" class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p class="text-xs font-black text-amber-800">字段冲突（{{ conflicts.length }}）· 双方版本均保留，请裁清</p>
        <div v-for="c in conflicts" :key="c.field" class="mt-2 rounded-lg bg-white p-2 text-[11px]">
          <p class="font-bold text-slate-700">{{ fieldName(c.field) }}</p>
          <div class="mt-1 grid grid-cols-2 gap-2">
            <div class="rounded border border-slate-200 p-2">
              <p class="text-[10px] text-slate-400">本店版本（操作号 {{ c.local.opNo }}）</p>
              <p class="font-bold text-slate-800">{{ optionName(c.field, c.local.value) }}</p>
              <button class="mt-1 w-full rounded bg-slate-900 px-2 py-1 text-[10px] font-bold text-white" @click="store.adjudicate(c.field, 'local')">保留本店</button>
            </div>
            <div class="rounded border border-slate-200 p-2">
              <p class="text-[10px] text-slate-400">门店版本</p>
              <p class="font-bold text-slate-800">{{ optionName(c.field, c.remote.value) }}</p>
              <button class="mt-1 w-full rounded bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700" @click="store.adjudicate(c.field, 'remote')">采用门店</button>
            </div>
          </div>
        </div>
      </div>

      <p v-if="store.shareNotice || store.dependencyMessage" class="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {{ store.shareNotice || store.dependencyMessage }}
      </p>
    </div>

    <div class="scroll-area min-h-0 flex-1 overflow-y-auto px-5">
      <OptionGroup
        v-for="group in productGroups"
        :key="group.id"
        :group="group"
        :selected="configuration[group.id]"
        :disabled="(optionId) => store.isOptionDisabled(group.id, optionId)"
        :stock-of="(optionId) => stockOf(group.id, optionId)"
        :invalid-reason="invalidReasons[`${group.id}:${configuration[group.id]}`]"
        @select="(optionId) => store.selectOption(group.id, optionId)"
      />
    </div>

    <!-- 报价锁定单 -->
    <div class="border-t border-slate-200 p-4">
      <div v-if="quote" class="mb-3 rounded-lg p-3 text-xs" :class="quote.status === 'locked' ? 'bg-emerald-50 text-emerald-800' : quote.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'">
        <div class="flex items-center justify-between">
          <span class="font-black">{{ quoteStatusText }}</span>
          <span class="font-mono">{{ quote.quoteId }}</span>
        </div>
        <p v-if="quote.status === 'failed'" class="mt-1">{{ quote.failureReason }}</p>
        <p v-if="quote.status === 'locked'" class="mt-1">已占用 {{ Object.keys(quote.occupied).length }} 项库存 · 尝试 {{ quote.attempts }} 次</p>
      </div>
      <p v-if="lockError" class="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700">{{ lockError }}</p>
      <div class="grid grid-cols-2 gap-2">
        <button
          class="rounded-xl px-4 py-3 text-sm font-black text-white shadow-lg transition"
          :class="quote?.status === 'failed' ? 'bg-amber-600 shadow-amber-600/20 hover:bg-amber-700' : 'bg-slate-900 shadow-slate-900/20 hover:bg-slate-800'"
          @click="quote?.status === 'failed' ? store.retryLock() : store.lockQuote()"
        >
          {{ quote?.status === 'failed' ? '重试锁定' : '锁定报价单' }}
        </button>
        <button
          class="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
          @click="copyShareLink"
        >
          {{ copied ? "链接已复制" : "生成分享链接" }}
        </button>
      </div>
      <p class="mt-2 text-center text-[10px] text-slate-400">旧链接无修订号将自动补成首版 · 锁定失败不占用库存</p>
    </div>

    <!-- 演练控制台 -->
    <details class="border-t border-slate-200 bg-slate-50 p-3 text-[11px]">
      <summary class="cursor-pointer font-black uppercase tracking-wider text-slate-400">演练控制台（模拟门店 / 服务端）</summary>
      <div class="mt-2 grid grid-cols-2 gap-1.5">
        <button class="rounded border border-slate-200 bg-white px-2 py-1.5 font-bold text-slate-600 hover:bg-slate-100" @click="remoteEdit('color', 'ocean')">门店改颜色→深海蓝</button>
        <button class="rounded border border-slate-200 bg-white px-2 py-1.5 font-bold text-slate-600 hover:bg-slate-100" @click="remoteEdit('battery', 'extended')">门店改电池→长续航</button>
        <button class="rounded border border-slate-200 bg-white px-2 py-1.5 font-bold text-slate-600 hover:bg-slate-100" @click="remoteEdit('material', 'metal')">门店改材质→拉丝铝</button>
        <button class="rounded border border-slate-200 bg-white px-2 py-1.5 font-bold text-slate-600 hover:bg-slate-100" @click="advanceInventory()">库存批次→深海蓝缺货</button>
        <button class="rounded border border-slate-200 bg-white px-2 py-1.5 font-bold text-slate-600 hover:bg-slate-100" @click="bumpRules()">依赖规则→暖铜需金属</button>
        <button class="rounded border px-2 py-1.5 font-bold" :class="writeFailureArmed ? 'border-red-300 bg-red-100 text-red-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'" @click="armWriteFailure()">
          {{ writeFailureArmed ? '已设置下次写入失败' : '设置下次写入失败' }}
        </button>
        <button class="col-span-2 rounded bg-blue-600 px-2 py-1.5 font-black text-white hover:bg-blue-700" @click="reconnect()">重新连接并同步</button>
        <button class="col-span-2 rounded border border-slate-200 bg-white px-2 py-1.5 font-bold text-slate-500 hover:bg-slate-100" @click="resetDrill()">重置演练（刷新）</button>
      </div>
    </details>
  </aside>
</template>
