<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useConfiguratorStore } from "../stores/configurator";
import type { CameraPreset } from "../types/product";

const store = useConfiguratorStore();
const { specs, cameraPreset } = storeToRefs(store);
const presets: Array<{ id: CameraPreset; label: string }> = [
  { id: "hero", label: "主视角" },
  { id: "front", label: "正视图" },
  { id: "top", label: "俯视图" },
  { id: "detail", label: "顶部细节" },
];
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div class="flex flex-wrap items-center gap-2">
      <span class="mr-1 text-[10px] font-black uppercase tracking-wider text-slate-400">相机预设</span>
      <button
        v-for="preset in presets"
        :key="preset.id"
        class="rounded-lg px-3 py-2 text-xs font-bold transition"
        :class="cameraPreset === preset.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
        @click="cameraPreset = preset.id"
      >
        {{ preset.label }}
      </button>
    </div>

    <div class="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 xl:grid-cols-6">
      <div v-for="spec in specs" :key="spec.label" class="min-w-[100px]">
        <p class="text-[9px] uppercase tracking-wider text-slate-400">{{ spec.label }}</p>
        <p class="mt-0.5 text-xs font-black text-slate-800">{{ spec.value }}</p>
      </div>
    </div>
  </div>
</template>
