<script setup lang="ts">
import { onMounted } from "vue";
import ConfigPanel from "../components/ConfigPanel.vue";
import AdminPanel from "../components/AdminPanel.vue";
import ProductScene from "../components/ProductScene.vue";
import SpecOverlay from "../components/SpecOverlay.vue";
import { useConfiguratorStore } from "../stores/configurator";

const store = useConfiguratorStore();
onMounted(() => {
  if (!store.server) void store.init();
});
</script>

<template>
  <div class="min-h-screen bg-[#eef1f4] p-3 sm:p-5">
    <div v-if="store.loading" class="flex h-[70vh] items-center justify-center text-sm font-bold text-slate-400">
      正在打开配置，冻结基础价、依赖规则与库存版本…
    </div>
    <div v-else class="mx-auto flex max-w-[1600px] flex-col gap-4">
      <AdminPanel />
      <div class="flex flex-col-reverse gap-4 lg:h-[calc(100vh-232px)] lg:flex-row">
        <ConfigPanel />
        <main class="flex min-w-0 flex-1 flex-col gap-4">
          <div class="config-grid min-h-[480px] flex-1">
            <ProductScene />
          </div>
          <SpecOverlay />
        </main>
      </div>
    </div>
  </div>
</template>
