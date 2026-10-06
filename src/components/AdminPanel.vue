<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import { useConfiguratorStore } from "../stores/configurator";
import { productGroups } from "../data/catalog";
import { formatPrice } from "../utils/share";

const store = useConfiguratorStore();
const router = useRouter();
const { server } = storeToRefs(store);

const batchSku = ref("color:ocean");
const batchDelta = ref(-3);
const rulePick = ref<"relax-floor" | "tighten-filter">("relax-floor");
const baseNext = ref(3499);

async function adjustBatch(delta: number) {
  const note = delta < 0 ? "批次盘点扣减（模拟出库/损耗）" : "批次补货入库";
  await store.adminAdjustBatch(batchSku.value, delta, note);
}

async function addPricedBatch() {
  await store.adminAdjustBatch(batchSku.value, 5, "新批次到货（含调价）", 120);
}

async function changeRules() {
  if (rulePick.value === "relax-floor") {
    // 落地支架不再强制金属机身：波及 stand:floor 与 material 相关选项
    await store.adminChangeRules(
      [{ id: "floor-needs-metal", patch: { require: { field: "material", in: ["metal", "matte"] } } }],
      ["stand:floor", "material:metal", "material:matte"],
      "落地支架兼容哑光复合材质",
    );
  } else {
    // 除醛滤芯也不支持胡桃木：波及 material:wood 与 filter:formaldehyde
    await store.adminChangeRules(
      [{ id: "hepa-not-wood", patch: { require: { field: "filter", in: ["standard"] } } }],
      ["material:wood", "filter:formaldehyde", "filter:hepa"],
      "胡桃木饰面仅兼容标准滤芯",
    );
  }
}
</script>

<template>
  <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">门店后台模拟</p>
        <p class="mt-0.5 text-xs font-bold text-slate-700">
          库存 v{{ server?.inventoryVersion }} · 规则 r{{ server?.ruleVersion }} · 基础价 {{ formatPrice(server?.basePrice ?? 0) }}
        </p>
      </div>
      <div class="flex gap-2">
        <button class="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-black text-white" @click="router.push('/revisions')">修订列表</button>
        <button class="rounded-lg border border-red-200 px-3 py-1.5 text-[11px] font-black text-red-600 hover:bg-red-50" @click="store.resetServer()">
          重置全部数据
        </button>
      </div>
    </div>

    <div class="mt-3 grid gap-2 lg:grid-cols-4">
      <!-- 库存批次 -->
      <div class="rounded-xl border border-slate-200 p-3">
        <p class="text-[10px] font-black text-slate-500">库存批次变化</p>
        <select v-model="batchSku" class="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px]">
          <template v-for="group in productGroups" :key="group.id">
            <option v-for="option in group.options" :key="option.id" :value="`${group.id}:${option.id}`">
              {{ group.name }} / {{ option.name }}
            </option>
          </template>
        </select>
        <div class="mt-2 flex gap-1.5">
          <input v-model.number="batchDelta" type="number" class="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px]" />
          <button class="flex-1 rounded-lg bg-amber-500 px-2 py-1.5 text-[11px] font-black text-white" @click="adjustBatch(batchDelta)">应用增减</button>
        </div>
        <button class="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-600" @click="addPricedBatch">
          新增 +5 调价批次(+¥120)
        </button>
      </div>

      <!-- 依赖规则 -->
      <div class="rounded-xl border border-slate-200 p-3">
        <p class="text-[10px] font-black text-slate-500">依赖规则变更</p>
        <select v-model="rulePick" class="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px]">
          <option value="relax-floor">放宽：落地支架兼容哑光材质</option>
          <option value="tighten-filter">收紧：胡桃木仅兼容标准滤芯</option>
        </select>
        <button class="mt-2 w-full rounded-lg bg-indigo-600 px-2 py-1.5 text-[11px] font-black text-white" @click="changeRules">
          发布规则新版本
        </button>
        <p class="mt-1.5 text-[10px] text-slate-400">仅受影响选项与报价失效重算</p>
      </div>

      <!-- 基础价 -->
      <div class="rounded-xl border border-slate-200 p-3">
        <p class="text-[10px] font-black text-slate-500">基础价冻结维度</p>
        <input v-model.number="baseNext" type="number" class="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px]" />
        <button class="mt-2 w-full rounded-lg bg-slate-800 px-2 py-1.5 text-[11px] font-black text-white" @click="store.adminSetBasePrice(baseNext)">
          调整基础价
        </button>
        <p class="mt-1.5 text-[10px] text-slate-400">只让报价失效，不动库存版本</p>
      </div>

      <!-- 写入故障 -->
      <div class="rounded-xl border border-slate-200 p-3">
        <p class="text-[10px] font-black text-slate-500">写入故障演练</p>
        <button class="mt-2 w-full rounded-lg bg-red-600 px-2 py-1.5 text-[11px] font-black text-white" @click="store.armWriteFailure()">
          下一次写入失败
        </button>
        <p class="mt-1.5 text-[10px] leading-relaxed text-slate-400">
          合并/重算/锁定命中故障：报价不占用库存，失败批次可同令牌重试，重复提交不追加占用
        </p>
      </div>
    </div>

    <!-- 锁定单流水 -->
    <div v-if="server?.locks.length" class="mt-3">
      <p class="text-[10px] font-black uppercase tracking-wider text-slate-400">报价锁定单（最近）</p>
      <div class="mt-1.5 flex flex-wrap gap-2">
        <span
          v-for="lock in server.locks.slice(-5)"
          :key="lock.id"
          class="rounded-full px-2.5 py-1 text-[10px] font-bold"
          :class="{
            'bg-emerald-100 text-emerald-700': lock.status === 'holding',
            'bg-red-100 text-red-700': lock.status === 'failed',
            'bg-slate-100 text-slate-500': lock.status === 'released',
          }"
        >
          {{ lock.id }} · {{ lock.revision }} · {{ { holding: '占用中', failed: '失败(未占用)', released: '已释放' }[lock.status] }}
        </span>
      </div>
    </div>
  </div>
</template>
