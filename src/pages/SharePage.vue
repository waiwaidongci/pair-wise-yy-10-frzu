<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useConfiguratorStore } from "../stores/configurator";
import { decodeShare, formatPrice } from "../utils/share";
import { productGroups } from "../data/catalog";
import ProductScene from "../components/ProductScene.vue";
import { quoteTotal } from "../domain/configLogic";
import { mockServer } from "../data/mockServer";
import type { ConfigRevision, Configuration } from "../types/product";

const route = useRoute();
const router = useRouter();
const store = useConfiguratorStore();
const valid = ref(true);
const resolvedRevision = ref<ConfigRevision | null>(null);
const backfilled = ref(false);
const viewConfig = computed(() => resolvedRevision.value?.config ?? store.configuration);

const effectiveOptions = computed(() =>
  productGroups.map((group) => ({
    label: group.name,
    value: group.options.find((option) => option.id === viewConfig.value[group.id])?.name ?? viewConfig.value[group.id],
  })),
);

const reasons = computed(() => (resolvedRevision.value ? store.revisionInvalidations(resolvedRevision.value) : []));
const total = computed(() =>
  resolvedRevision.value ? quoteTotal(resolvedRevision.value.config, resolvedRevision.value.basePrice, resolvedRevision.value.priceBook) : 0,
);

onMounted(async () => {
  const decoded = decodeShare(String(route.params.payload ?? ""));
  if (!Object.keys(decoded.config).length) {
    valid.value = false;
    return;
  }
  await store.init();

  if (decoded.legacy) {
    // 旧分享链接没有修订号：补成首版
    const result = await mockServer.backfillLegacy(decoded.config as Configuration);
    store.applyServerState(result.state);
    resolvedRevision.value = result.revision;
    backfilled.value = result.created;
  } else {
    const found =
      store.server?.revisions.find((revision) => revision.id === decoded.revisionId) ??
      store.server?.revisions.find((revision) => JSON.stringify(revision.config) === JSON.stringify(decoded.config)) ??
      store.headRevision;
    resolvedRevision.value = found ?? null;
  }
  if (resolvedRevision.value) store.setSceneOverride({ ...resolvedRevision.value.config });
});

onUnmounted(() => {
  store.setSceneOverride(null);
});
</script>

<template>
  <div class="min-h-screen bg-[#eef1f4] p-5">
    <div v-if="valid && resolvedRevision" class="mx-auto max-w-6xl">
      <header class="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="text-xs font-black uppercase tracking-[0.2em] text-blue-600">Shared Configuration</p>
          <h1 class="mt-1 text-3xl font-black text-slate-900">您的 AeroStation S4 配置</h1>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span class="rounded-lg bg-slate-900 px-2.5 py-1 font-black text-white">当前修订 {{ resolvedRevision.id }}</span>
            <span class="text-slate-500">第 {{ resolvedRevision.number }} 版</span>
            <span v-if="resolvedRevision.id === store.headRevision?.id" class="rounded-full bg-blue-100 px-2 py-1 font-black text-blue-700">最新</span>
            <span v-else class="rounded-full bg-slate-200 px-2 py-1 font-bold text-slate-600">历史修订</span>
            <span v-if="backfilled" class="rounded-full bg-amber-100 px-2 py-1 font-bold text-amber-700">旧链接无修订号，已补录为首版</span>
          </div>
        </div>
        <button class="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white" @click="router.push('/')">继续调整配置</button>
      </header>

      <div v-if="reasons.length" class="mb-4 space-y-2">
        <p class="text-xs font-black uppercase tracking-wider text-slate-500">该修订相对当前门店数据的失效原因</p>
        <div
          v-for="(reason, index) in reasons"
          :key="index"
          class="rounded-xl border px-4 py-2.5 text-xs font-bold"
          :class="{
            'border-red-200 bg-red-50 text-red-800': reason.kind === 'conflict' || reason.kind === 'stock',
            'border-amber-200 bg-amber-50 text-amber-800': reason.kind === 'rule' || reason.kind === 'batch' || reason.kind === 'base',
          }"
        >
          [{{ { conflict: '冲突', stock: '库存', rule: '规则', batch: '批次', base: '基础价' }[reason.kind] }}]
          {{ reason.reason }}
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div class="h-[620px]">
          <ProductScene preview />
        </div>
        <aside class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-black uppercase tracking-wider text-slate-400">配置摘要 · {{ resolvedRevision.id }}</p>
          <div class="mt-5 space-y-4">
            <div v-for="group in effectiveOptions" :key="group.label" class="flex justify-between border-b border-slate-100 pb-3 text-sm">
              <span class="text-slate-500">{{ group.label }}</span>
              <span class="font-bold text-slate-900">{{ group.value }}</span>
            </div>
          </div>
          <div class="mt-5 rounded-xl p-4" :class="reasons.length ? 'bg-amber-50' : 'bg-blue-50'">
            <p class="text-xs" :class="reasons.length ? 'text-amber-600' : 'text-blue-600'">
              {{ reasons.length ? "报价已失效（修订落定口径展示）" : "配置总价" }}
            </p>
            <p class="mt-1 text-2xl font-black" :class="reasons.length ? 'text-amber-800 line-through decoration-2' : 'text-blue-800'">
              {{ formatPrice(total) }}
            </p>
            <p v-if="reasons.length" class="mt-1 text-[10px] font-bold text-amber-700">库存批次/依赖规则已变化，打开配置页重算后方可锁定库存。</p>
          </div>
          <p class="mt-4 text-[10px] leading-relaxed text-slate-400">
            冻结口径：基础价 ¥{{ resolvedRevision.basePrice }} · 规则 r{{ resolvedRevision.ruleVersion }} · 库存 v{{ resolvedRevision.inventoryVersion }}
          </p>
        </aside>
      </div>
    </div>
    <div v-else-if="!valid" class="mx-auto mt-32 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 class="text-xl font-black text-slate-900">分享链接无效</h1>
      <p class="mt-2 text-sm text-slate-500">链接参数已损坏或来自不兼容版本。</p>
      <button class="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white" @click="router.push('/')">创建新配置</button>
    </div>
  </div>
</template>
