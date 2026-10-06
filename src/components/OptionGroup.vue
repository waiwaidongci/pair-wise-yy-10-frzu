<script setup lang="ts">
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/vue";
import type { ProductGroup } from "../types/product";
import { formatPrice } from "../utils/share";

defineProps<{
  group: ProductGroup;
  selected: string;
  disabled: (optionId: string) => boolean;
}>();

const emit = defineEmits<{
  select: [optionId: string];
}>();
</script>

<template>
  <div class="border-b border-slate-100 py-4 last:border-0">
    <div class="mb-3 flex items-start justify-between gap-4">
      <div>
        <p class="text-xs font-black text-slate-800">{{ group.name }}</p>
        <p class="mt-1 text-[11px] text-slate-400">{{ group.summary }}</p>
      </div>
      <span class="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
        {{ group.options.find((item) => item.id === selected)?.name }}
      </span>
    </div>

    <Listbox :model-value="selected" @update:model-value="emit('select', $event)">
      <div class="relative">
        <ListboxButton class="group flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm outline-none transition hover:border-slate-300">
          <div class="flex min-w-0 items-center gap-3">
            <span
              class="h-5 w-5 shrink-0 rounded-full border border-black/10"
              :style="{ background: group.options.find((item) => item.id === selected)?.swatch ?? '#d9dee5' }"
            />
            <div class="min-w-0">
              <p class="truncate text-xs font-bold text-slate-800">{{ group.options.find((item) => item.id === selected)?.name }}</p>
              <p class="mt-0.5 truncate text-[10px] text-slate-400">{{ group.options.find((item) => item.id === selected)?.description }}</p>
            </div>
          </div>
          <span class="ml-3 text-slate-400 transition group-hover:text-slate-700">⌄</span>
        </ListboxButton>

        <transition
          enter-active-class="transition duration-100 ease-out"
          enter-from-class="scale-95 opacity-0"
          leave-active-class="transition duration-75 ease-in"
          leave-to-class="scale-95 opacity-0"
        >
          <ListboxOptions class="absolute z-30 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-2xl focus:outline-none">
            <ListboxOption
              v-for="option in group.options"
              :key="option.id"
              v-slot="{ active, selected: optionSelected }"
              :value="option.id"
              :disabled="disabled(option.id)"
              as="template"
            >
              <li
                class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-xs"
                :class="[active ? 'bg-slate-100' : '', disabled(option.id) ? 'cursor-not-allowed opacity-35' : '']"
              >
                <span class="h-5 w-5 shrink-0 rounded-full border border-black/10" :style="{ background: option.swatch ?? '#d9dee5' }" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="font-bold text-slate-800">{{ option.name }}</span>
                    <span v-if="optionSelected" class="text-blue-600">✓</span>
                  </div>
                  <p class="mt-0.5 text-[10px] text-slate-400">{{ option.description }}</p>
                </div>
                <span class="font-bold text-slate-500">{{ option.price ? `+${formatPrice(option.price)}` : "标配" }}</span>
              </li>
            </ListboxOption>
          </ListboxOptions>
        </transition>
      </div>
    </Listbox>
  </div>
</template>
