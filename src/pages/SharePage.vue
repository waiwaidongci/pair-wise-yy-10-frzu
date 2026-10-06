<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useConfiguratorStore } from "../stores/configurator";
import { decodeSharePayload, formatPrice } from "../utils/share";
import ProductScene from "../components/ProductScene.vue";

const route = useRoute();
const router = useRouter();
const store = useConfiguratorStore();
const { invalidOptions, conflicts } = storeToRefs(store);
const valid = ref(true);
const isLegacy = ref(false);

onMounted(() => {
  const payload = decodeSharePayload(String(route.params.payload ?? ""));
  if (!payload) {
    valid.value = false;
    return;
  }
  isLegacy.value = !payload.rev;
  store.applySharePayload(payload);
});
</script>

<template>
  <div class="min-h-screen bg-[#eef1f4] p-5">
    <div v-if="valid" class="mx-auto max-w-6xl">
      <header class="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="text-xs font-black uppercase tracking-[0.2em] text-blue-600">Shared Configuration</p>
          <h1 class="mt-1 text-3xl font-black text-slate-900">您的 AeroStation S4 配置</h1>
          <p class="mt-1 text-sm text-slate-500">分享链接已还原颜色、部件、滤芯、电池和支架。</p>
        </div>
        <button class="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white" @click="router.push('/')">继续调整配置</button>
      </header>

      <!-- 修订与失效状态 -->
      <div class="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs shadow-sm">
        <span class="font-black uppercase tracking-wider text-slate-400">当前修订</span>
        <span class="rounded-full bg-slate-900 px-2 py-0.5 font-mono font-bold text-white">{{ store.revision.revisionId }}</span>
        <span v-if="isLegacy" class="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700">旧链接已补成首版</span>
        <span class="text-slate-300">|</span>
        <span>基础价 {{ formatPrice(store.revision.basePrice) }}</span>
        <span class="text-slate-300">|</span>
        <span>规则 v{{ store.revision.dependencyRulesVersion }}</span>
        <span class="text-slate-300">|</span>
        <span>库存批次 v{{ store.revision.inventoryVersion }}</span>
      </div>

      <div v-if="invalidOptions.length" class="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
        <p class="text-sm font-black text-red-700">该配置有 {{ invalidOptions.length }} 个选项失效，无法锁定报价</p>
        <ul class="mt-2 list-inside list-disc text-xs text-red-700">
          <li v-for="inv in invalidOptions" :key="`${inv.groupId}:${inv.optionId}`">{{ inv.reason }}</li>
        </ul>
      </div>
      <div v-if="conflicts.length" class="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p class="text-sm font-black text-amber-800">该配置有 {{ conflicts.length }} 处字段冲突待裁清</p>
      </div>

      <div class="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div class="h-[620px]"><ProductScene /></div>
        <aside class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-black uppercase tracking-wider text-slate-400">配置摘要</p>
          <div class="mt-5 space-y-4">
            <div v-for="group in [
              { label: '机身颜色', value: store.options.color.name },
              { label: '外壳材质', value: store.options.material.name },
              { label: '滤芯系统', value: store.options.filter.name },
              { label: '续航模块', value: store.options.battery.name },
              { label: '支架形态', value: store.options.stand.name },
              { label: '控制环', value: store.options.trim.name },
            ]" :key="group.label" class="flex justify-between border-b border-slate-100 pb-3 text-sm">
              <span class="text-slate-500">{{ group.label }}</span>
              <span class="font-bold text-slate-900">{{ group.value }}</span>
            </div>
          </div>
          <div class="mt-5 rounded-xl bg-blue-50 p-4">
            <p class="text-xs text-blue-600">配置总价</p>
            <p class="mt-1 text-2xl font-black text-blue-800">{{ formatPrice(store.price) }}</p>
          </div>
          <div class="mt-4 grid grid-cols-2 gap-3">
            <div v-for="spec in store.specs.slice(0, 4)" :key="spec.label" class="rounded-lg bg-slate-50 p-3">
              <p class="text-[10px] text-slate-400">{{ spec.label }}</p>
              <p class="mt-1 text-xs font-bold text-slate-800">{{ spec.value }}</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
    <div v-else class="mx-auto mt-32 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 class="text-xl font-black text-slate-900">分享链接无效</h1>
      <p class="mt-2 text-sm text-slate-500">链接参数已损坏或来自不兼容版本。</p>
      <button class="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white" @click="router.push('/')">创建新配置</button>
    </div>
  </div>
</template>
