import type { Configuration, GroupId, ProductGroup } from "../types/product";

export const BASE_SKU = "base:s4";

export const productGroups: ProductGroup[] = [
  {
    id: "color",
    name: "机身颜色",
    summary: "外壳阳极氧化与喷砂配色",
    options: [
      { id: "graphite", name: "石墨灰", description: "耐脏、适合办公环境", price: 0, swatch: "#343941" },
      { id: "ivory", name: "雾光白", description: "柔和明亮，适合居住空间", price: 0, swatch: "#e9e5dc" },
      { id: "sage", name: "鼠尾草绿", description: "低饱和限定配色", price: 180, swatch: "#758f7d" },
      { id: "ocean", name: "深海蓝", description: "限定批次，库存较少", price: 240, swatch: "#385a78" },
    ],
  },
  {
    id: "material",
    name: "外壳材质",
    summary: "影响触感、耐用度和净化结构",
    options: [
      { id: "matte", name: "哑光复合材质", description: "轻量且抗指纹", price: 0 },
      { id: "metal", name: "拉丝铝合金", description: "更高结构强度与金属质感", price: 680 },
      { id: "wood", name: "天然胡桃木", description: "手工饰面，不支持医疗滤芯", price: 980 },
    ],
  },
  {
    id: "filter",
    name: "滤芯系统",
    summary: "根据房间面积和敏感人群选择",
    options: [
      { id: "standard", name: "标准复合滤芯", description: "适合 25-45㎡ 空间", price: 0 },
      { id: "hepa", name: "H13 医疗级滤芯", description: "高效过滤细颗粒物", price: 860 },
      { id: "formaldehyde", name: "除醛增强滤芯", description: "新装修空间推荐", price: 720 },
    ],
  },
  {
    id: "battery",
    name: "续航模块",
    summary: "选择移动使用方式与续航时间",
    options: [
      { id: "none", name: "纯电源供电", description: "标准桌面使用", price: 0 },
      { id: "standard", name: "标准电池", description: "约 5 小时续航", price: 520 },
      { id: "extended", name: "长续航双电池", description: "约 11 小时，仅金属机身可选", price: 980 },
    ],
  },
  {
    id: "stand",
    name: "支架形态",
    summary: "落地支架依赖铝合金材质",
    options: [
      { id: "desktop", name: "桌面橡胶底座", description: "重心稳定，占地面积小", price: 0 },
      { id: "floor", name: "立式铝合金支架", description: "升高 92cm，仅金属机身可选", price: 760 },
    ],
  },
  {
    id: "trim",
    name: "控制环",
    summary: "顶部触控环的视觉与触感",
    options: [
      { id: "subtle", name: "同色控制环", description: "一体化外观", price: 0 },
      { id: "copper", name: "暖铜控制环", description: "拉丝金属点缀", price: 260, swatch: "#b5744d" },
      { id: "graphite-ring", name: "深色镀铬环", description: "高对比控制区域", price: 220, swatch: "#20242a" },
    ],
  },
];

export const GROUP_IDS: GroupId[] = productGroups.map((group) => group.id);

export const defaultConfiguration: Configuration = {
  color: "graphite",
  material: "matte",
  filter: "standard",
  battery: "standard",
  stand: "desktop",
  trim: "subtle",
};

export function optionSku(groupId: GroupId, optionId: string): string {
  return `${groupId}:${optionId}`;
}

export function parseSku(sku: string): { group: GroupId; option: string } | null {
  const index = sku.indexOf(":");
  if (index < 0) return null;
  return { group: sku.slice(0, index) as GroupId, option: sku.slice(index + 1) };
}

const optionIndex = new Map(productGroups.flatMap((group) => group.options.map((option) => [optionSku(group.id, option.id), option])));

export function getOption(sku: string) {
  return optionIndex.get(sku);
}

export function optionName(groupId: GroupId, optionId: string): string {
  return productGroups.find((group) => group.id === groupId)?.options.find((option) => option.id === optionId)?.name ?? optionId;
}

export function sanitizeConfig(input: Partial<Configuration> | null | undefined): Configuration {
  const next = { ...defaultConfiguration };
  if (!input) return next;
  for (const group of productGroups) {
    const value = input[group.id];
    if (typeof value === "string" && group.options.some((option) => option.id === value)) {
      next[group.id] = value;
    }
  }
  return next;
}

export function specsOf(config: Configuration) {
  const batteryCopy: Record<string, string> = { none: "电源供电", standard: "5 小时", extended: "11 小时" };
  const coverage: Record<string, string> = { standard: "25-45㎡", hepa: "35-65㎡", formaldehyde: "30-55㎡" };
  return [
    { label: "建议面积", value: coverage[config.filter] ?? "—" },
    { label: "颗粒物 CADR", value: config.filter === "hepa" ? "620m³/h" : "480m³/h" },
    { label: "运行噪声", value: config.material === "metal" ? "20-48 dB" : "22-51 dB" },
    { label: "续航", value: batteryCopy[config.battery] ?? "—" },
    { label: "机身重量", value: config.material === "metal" ? "8.6kg" : "6.9kg" },
    { label: "控制方式", value: config.trim === "subtle" ? "触控 + App" : "旋钮 + App" },
  ];
}
