<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import OptionGroup from "./OptionGroup.vue";
import { productGroups, useConfiguratorStore } from "../stores/configurator";
import { createShareUrl, formatPrice } from "../utils/share";

const store = useConfiguratorStore();
const { configuration, shareNotice } = storeToRefs(store);
const copied = ref(false);

async function copyShareLink() {
  const url = createShareUrl(configuration.value);
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    window.prompt("复制分享链接", url);
  }
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 1800);
}
</script>

<template>
  <aside class="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:w-[430px]">
    <div class="border-b border-slate-200 p-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">AeroStation Configurator</p>
          <h1 class="mt-2 text-2xl font-black tracking-tight text-slate-900">模块化空气净化器 S4</h1>
          <p class="mt-1 text-xs text-slate-400">三维实时配置 · 所有选项本地计算</p>
        </div>
        <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50" @click="store.reset">重置</button>
      </div>

      <div class="mt-5 rounded-xl bg-slate-900 p-4 text-white">
        <div class="flex items-end justify-between">
          <div>
            <p class="text-[10px] uppercase tracking-wider text-slate-400">配置价格</p>
            <p class="mt-1 text-2xl font-black">{{ formatPrice(store.price) }}</p>
          </div>
          <p class="text-[10px] text-slate-400">含基础主机与选配模块</p>
        </div>
      </div>

      <p v-if="shareNotice || store.dependencyMessage" class="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {{ shareNotice || store.dependencyMessage }}
      </p>
    </div>

    <div class="scroll-area min-h-0 flex-1 overflow-y-auto px-5">
      <OptionGroup
        v-for="group in productGroups"
        :key="group.id"
        :group="group"
        :selected="configuration[group.id]"
        :disabled="(optionId) => store.isOptionDisabled(group.id, optionId)"
        @select="(optionId) => store.selectOption(group.id, optionId)"
      />
    </div>

    <div class="border-t border-slate-200 p-4">
      <button
        class="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
        @click="copyShareLink"
      >
        {{ copied ? "链接已复制" : "生成并复制分享链接" }}
      </button>
      <p class="mt-2 text-center text-[10px] text-slate-400">打开分享链接会还原全部配置和兼容性修正</p>
    </div>
  </aside>
</template>
