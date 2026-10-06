<script setup lang="ts">
import { computed } from "vue";
import { TresCanvas } from "@tresjs/core";
import { OrbitControls } from "@tresjs/cientos";
import { storeToRefs } from "pinia";
import CameraRig from "./CameraRig.vue";
import { useConfiguratorStore } from "../stores/configurator";

const store = useConfiguratorStore();
const { configuration, cameraPreset, headRevision, invalidations } = storeToRefs(store);

const props = defineProps<{ preview?: boolean }>();

const palette: Record<string, string> = {
  graphite: "#343941",
  ivory: "#e9e5dc",
  sage: "#758f7d",
  ocean: "#385a78",
};

const bodyColor = computed(() => palette[configuration.value.color] ?? "#343941");
const materialProps = computed(() => {
  if (configuration.value.material === "metal") return { metalness: 0.72, roughness: 0.28 };
  if (configuration.value.material === "wood") return { metalness: 0.02, roughness: 0.82 };
  return { metalness: 0.12, roughness: 0.62 };
});
const trimColor = computed(() => {
  if (configuration.value.trim === "copper") return "#b5744d";
  if (configuration.value.trim === "graphite-ring") return "#20242a";
  return bodyColor.value;
});
const accentColor = computed(() => {
  if (configuration.value.filter === "hepa") return "#2e9c74";
  if (configuration.value.filter === "formaldehyde") return "#c48a48";
  return "#79a3c5";
});
const isLongBody = computed(() => configuration.value.stand === "floor");
</script>

<template>
  <div class="relative h-full min-h-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-[#e9edf2]">
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div class="relative h-[430px] w-[300px]">
        <div
          class="absolute bottom-8 left-1/2 h-[330px] w-[210px] -translate-x-1/2 rounded-[72px_72px_42px_42px] border border-black/10 shadow-2xl"
          :style="{ background: `linear-gradient(110deg, ${bodyColor}, ${bodyColor}cc 58%, #ffffff55)` }"
        >
          <div class="absolute left-1/2 top-10 h-40 w-24 -translate-x-1/2 rounded-full border border-white/20 bg-black/10 p-3">
            <div v-for="index in 7" :key="index" class="mb-2 h-px bg-white/35" />
          </div>
          <div class="absolute bottom-8 left-1/2 h-10 w-28 -translate-x-1/2 rounded-lg border border-white/15 bg-black/15" />
        </div>
        <div
          class="absolute left-1/2 top-[40px] h-8 w-[222px] -translate-x-1/2 rounded-full border-4 shadow-xl"
          :style="{ borderColor: trimColor, background: '#111821' }"
        />
        <div
          class="absolute left-1/2 top-[46px] h-3 w-24 -translate-x-1/2 rounded-full bg-white/20"
        />
        <div
          v-if="configuration.stand === 'floor'"
          class="absolute bottom-0 left-1/2 h-18 w-16 -translate-x-1/2 border-x-8 border-slate-500"
        />
      </div>
    </div>
    <div class="absolute inset-0 z-10">
    <TresCanvas clear-color="#e9edf2" :shadows="true" :alpha="false" window-size>
      <CameraRig :preset="cameraPreset" />
      <OrbitControls :enable-damping="true" :min-distance="4" :max-distance="12" :max-polar-angle="1.45" />
      <TresAmbientLight :intensity="1.35" />
      <TresHemisphereLight :intensity="1.7" color="#ffffff" ground-color="#aab3c0" />
      <TresDirectionalLight :intensity="3.2" :position="[5, 8, 6]" cast-shadow />
      <TresDirectionalLight :intensity="1.4" :position="[-5, 4, -4]" color="#8ca6c9" />

      <TresGroup :position="[0, isLongBody ? 0.4 : 0.8, 0]" :rotation="[0, -0.35, 0]">
        <TresMesh :position="[0, 1.5, 0]" cast-shadow receive-shadow>
          <TresCylinderGeometry :args="[1.12, 1.3, isLongBody ? 3.1 : 2.45, 64]" />
          <TresMeshStandardMaterial :color="bodyColor" v-bind="materialProps" />
        </TresMesh>

        <TresMesh :position="[0, isLongBody ? 3.16 : 2.84, 0]" cast-shadow>
          <TresTorusGeometry :args="[1.08, 0.11, 20, 80]" />
          <TresMeshStandardMaterial :color="trimColor" :metalness="configuration.trim === 'subtle' ? 0.2 : 0.82" :roughness="0.25" />
        </TresMesh>
        <TresMesh :position="[0, isLongBody ? 3.17 : 2.85, 0]" cast-shadow>
          <TresCylinderGeometry :args="[1.0, 1.0, 0.09, 64]" />
          <TresMeshStandardMaterial color="#111821" :roughness="0.22" :metalness="0.45" />
        </TresMesh>

        <TresMesh :position="[0, 1.48, -1.16]" cast-shadow>
          <TresBoxGeometry :args="[0.8, isLongBody ? 2.18 : 1.72, 0.09]" />
          <TresMeshStandardMaterial :color="accentColor" :roughness="0.42" transparent :opacity="0.82" />
        </TresMesh>
        <TresMesh :position="[0, 0.55, -1.2]">
          <TresBoxGeometry :args="[0.54, 0.04, 0.04]" />
          <TresMeshStandardMaterial color="#dce9f0" emissive="#8dc6e8" :emissive-intensity="1.3" />
        </TresMesh>

        <TresMesh v-if="configuration.trim !== 'subtle'" :position="[0, 3.32, 0]">
          <TresCylinderGeometry :args="[0.18, 0.18, 0.12, 32]" />
          <TresMeshStandardMaterial :color="trimColor" :metalness="0.8" :roughness="0.24" />
        </TresMesh>

        <TresGroup :position="[0, 0.18, 0]">
          <TresMesh v-for="index in 4" :key="index" :position="[Math.cos((index - 1) * Math.PI / 2 + Math.PI / 4) * 0.82, -0.1, Math.sin((index - 1) * Math.PI / 2 + Math.PI / 4) * 0.82]" cast-shadow>
            <TresCylinderGeometry :args="[0.11, 0.13, 0.22, 20]" />
            <TresMeshStandardMaterial color="#20252c" :roughness="0.86" />
          </TresMesh>
        </TresGroup>

        <TresGroup v-if="configuration.stand === 'floor'" :position="[0, -2.1, 0]">
          <TresMesh :position="[0, 0.9, 0]" cast-shadow>
            <TresCylinderGeometry :args="[0.12, 0.18, 2.4, 32]" />
            <TresMeshStandardMaterial color="#626a74" :metalness="0.76" :roughness="0.26" />
          </TresMesh>
          <TresMesh :position="[0, -0.32, 0]" cast-shadow>
            <TresCylinderGeometry :args="[0.9, 0.92, 0.12, 48]" />
            <TresMeshStandardMaterial color="#5d6570" :metalness="0.72" :roughness="0.3" />
          </TresMesh>
        </TresGroup>
      </TresGroup>

      <TresMesh :position="[0, -1.13, 0]" :rotation="[-Math.PI / 2, 0, 0]" receive-shadow>
        <TresCircleGeometry :args="[5.8, 64]" />
        <TresMeshStandardMaterial color="#d9dee5" :roughness="0.94" />
      </TresMesh>
    </TresCanvas>
    </div>

    <div class="pointer-events-none absolute left-4 top-4 rounded-xl border border-white/70 bg-white/80 px-3 py-2 shadow-sm backdrop-blur">
      <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">AeroStation S4</p>
      <p class="mt-1 text-sm font-black text-slate-800">{{ store.options.color.name }} · {{ store.options.material.name }}</p>
      <p class="mt-0.5 text-[10px] font-bold text-blue-700">
        {{ props.preview ? "预览修订（按链接快照）" : `当前修订 ${headRevision?.id}（第 ${headRevision?.number} 版）` }}
      </p>
    </div>

    <!-- 三维预览内联失效原因：只显示受影响项 -->
    <div v-if="!props.preview && invalidations.length" class="pointer-events-none absolute right-4 top-4 z-20 w-[250px] space-y-1.5">
      <div
        v-for="(reason, index) in invalidations.slice(0, 4)"
        :key="index"
        class="rounded-lg border px-2.5 py-1.5 text-[10px] font-bold shadow-sm backdrop-blur"
        :class="{
          'border-red-200 bg-red-50/90 text-red-800': reason.kind === 'conflict' || reason.kind === 'stock',
          'border-amber-200 bg-amber-50/90 text-amber-800': reason.kind === 'rule' || reason.kind === 'batch' || reason.kind === 'base',
        }"
      >
        <span class="font-black">[{{ { conflict: '冲突', stock: '库存', rule: '规则', batch: '批次', base: '基础价' }[reason.kind] }}]</span>
        {{ reason.reason }}
      </div>
      <p v-if="invalidations.length > 4" class="text-right text-[10px] font-bold text-amber-700">等 {{ invalidations.length }} 条失效原因…</p>
    </div>
    <div class="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-slate-900/80 px-3 py-2 text-[11px] text-white backdrop-blur">
      <span class="h-2 w-2 rounded-full bg-emerald-400" /> 拖拽旋转 · 滚轮缩放
    </div>
  </div>
</template>
