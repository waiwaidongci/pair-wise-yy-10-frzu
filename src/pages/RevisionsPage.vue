<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useConfiguratorStore } from "../stores/configurator";
import { productGroups } from "../data/catalog";
import { formatPrice } from "../utils/share";
import { quoteTotal } from "../domain/configLogic";

const store = useConfiguratorStore();
const router = useRouter();

onMounted(() => {
  if (!store.server) void store.init();
});

const sourceLabel: Record<string, string> = {
  seed: "首版冻结",
  merge: "断网重连合并",
  adjudication: "冲突裁决",
  recompute: "失效重算",
  backfill: "旧链接补录",
};

const rows = computed(() =>
  [...(store.server?.revisions ?? [])].reverse().map((revision) => {
    const reasons = store.revisionInvalidations(revision);
    const total = quoteTotal(revision.config, revision.basePrice, revision.priceBook);
    return { revision, reasons, total };
  }),
);
</script>

<template>
  <div class="min-h-screen bg-[#eef1f4] p-4 sm:p-6">
    <div class="mx-auto max-w-5xl">
      <header class="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">Revision Timeline</p>
          <h1 class="mt-1 text-2xl font-black text-slate-900">配置修订列表</h1>
          <p class="mt-1 text-xs text-slate-500">每次合并、裁决、重算生成新修订号；下方展示当前修订与失效原因。</p>
        </div>
        <button class="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white" @click="router.push('/')">返回配置页</button>
      </header>

      <div v-if="store.loading" class="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
        正在加载修订…
      </div>

      <div v-else class="space-y-3">
        <article
          v-for="row in rows"
          :key="row.revision.id"
          class="rounded-2xl border bg-white p-4 shadow-sm"
          :class="row.revision.id === store.headRevision?.id ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="rounded-lg bg-slate-900 px-2 py-1 text-xs font-black text-white">{{ row.revision.id }}</span>
                <span class="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
                  {{ sourceLabel[row.revision.source] ?? row.revision.source }}
                </span>
                <span v-if="row.revision.id === store.headRevision?.id" class="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-black text-blue-700">
                  当前修订
                </span>
              </div>
              <p class="mt-2 text-[11px] text-slate-500">{{ row.revision.note }}</p>
              <p class="mt-1 text-[10px] text-slate-400">
                {{ new Date(row.revision.createdAt).toLocaleString("zh-CN") }} · 基础价 ¥{{ row.revision.basePrice }} · 规则 r{{ row.revision.ruleVersion }} · 库存 v{{ row.revision.inventoryVersion }}
              </p>
            </div>
            <div class="text-right">
              <p class="text-[10px] text-slate-400">落定报价</p>
              <p class="text-lg font-black text-slate-900">{{ formatPrice(row.total) }}</p>
            </div>
          </div>

          <div class="mt-3 flex flex-wrap gap-1.5">
            <span
              v-for="group in productGroups"
              :key="group.id"
              class="rounded-md bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600"
            >
              {{ group.name }}:
              {{ group.options.find((option) => option.id === row.revision.config[group.id])?.name }}
            </span>
          </div>

          <div v-if="row.revision.conflicts.some((conflict) => !conflict.resolution)" class="mt-3">
            <p
              v-for="conflict in row.revision.conflicts.filter((item) => !item.resolution)"
              :key="conflict.field"
              class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-bold text-red-700"
            >
              未裁清冲突：{{ productGroups.find((group) => group.id === conflict.field)?.name }}
              顾客/门店双版本并存
            </p>
          </div>

          <div v-if="row.reasons.length" class="mt-3 space-y-1">
            <p
              v-for="(reason, index) in row.reasons"
              :key="index"
              class="rounded-lg border px-2.5 py-1.5 text-[11px] font-bold"
              :class="{
                'border-red-200 bg-red-50 text-red-800': reason.kind === 'conflict' || reason.kind === 'stock',
                'border-amber-200 bg-amber-50 text-amber-800': reason.kind === 'rule' || reason.kind === 'batch' || reason.kind === 'base',
              }"
            >
              失效原因 · [{{ { conflict: '冲突', stock: '库存', rule: '规则', batch: '批次', base: '基础价' }[reason.kind] }}]
              {{ reason.reason }}
            </p>
          </div>
          <p v-else-if="row.revision.id === store.headRevision?.id" class="mt-3 text-[11px] font-black text-emerald-600">
            当前修订有效，报价可按规则占用库存。
          </p>
        </article>
      </div>
    </div>
  </div>
</template>
