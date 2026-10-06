<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRenderLoop, useTresContext } from "@tresjs/core";
import * as THREE from "three";
import type { CameraPreset } from "../types/product";

const props = defineProps<{
  preset: CameraPreset;
}>();

const cameraTargets: Record<CameraPreset, { position: [number, number, number]; lookAt: [number, number, number] }> = {
  hero: { position: [4.8, 3.4, 6.2], lookAt: [0, 1.1, 0] },
  front: { position: [0, 1.45, 8.4], lookAt: [0, 1.1, 0] },
  top: { position: [0.8, 8.2, 1.4], lookAt: [0, 0.7, 0] },
  detail: { position: [2.8, 3.9, 3.6], lookAt: [0.3, 2.0, 0] },
};

const targetPosition = ref(new THREE.Vector3(...cameraTargets.hero.position));
const targetLookAt = ref(new THREE.Vector3(...cameraTargets.hero.lookAt));
const currentLookAt = ref(new THREE.Vector3(...cameraTargets.hero.lookAt));
const { camera } = useTresContext();
const { onLoop } = useRenderLoop();
let cameraRef: THREE.PerspectiveCamera | null = null;

watch(
  () => props.preset,
  (next) => {
    targetPosition.value.set(...cameraTargets[next].position);
    targetLookAt.value.set(...cameraTargets[next].lookAt);
  },
);

onMounted(() => {
  cameraRef = (camera as unknown as { value: THREE.PerspectiveCamera }).value;
});

onLoop(({ delta }) => {
  const activeCamera = cameraRef ?? (camera as unknown as { value: THREE.PerspectiveCamera }).value;
  if (!activeCamera) return;
  const blend = Math.min(1, delta * 4.2);
  activeCamera.position.lerp(targetPosition.value, blend);
  currentLookAt.value.lerp(targetLookAt.value, blend);
  activeCamera.lookAt(currentLookAt.value);
});
</script>

<template>
  <TresPerspectiveCamera :args="[42, 1, 0.1, 1000]" :position="cameraTargets.hero.position" make-default />
</template>
