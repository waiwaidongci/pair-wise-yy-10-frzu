<script setup lang="ts">
import ConfigPanel from "../components/ConfigPanel.vue";
import ProductScene from "../components/ProductScene.vue";
import SpecOverlay from "../components/SpecOverlay.vue";
</script>

<template>
  <div class="min-h-screen bg-[#eef1f4] p-3 sm:p-5">
    <div class="mx-auto flex max-w-[1600px] flex-col-reverse gap-4 lg:h-[calc(100vh-40px)] lg:flex-row">
      <ConfigPanel />
      <main class="flex min-w-0 flex-1 flex-col gap-4">
        <div class="config-grid min-h-[480px] flex-1">
          <ProductScene />
        </div>
        <SpecOverlay />
      </main>
    </div>
  </div>
</template>
