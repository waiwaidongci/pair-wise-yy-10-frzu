import type { Configuration, SharePayload } from "../data/configData";

function toBase64Url(value: string): string {
  return btoa(unescape(encodeURIComponent(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return decodeURIComponent(escape(atob(padded)));
}

const CONFIG_KEYS: Array<keyof Configuration> = ["color", "material", "filter", "battery", "stand", "trim"];

/** 新链接：携带修订号与冻结版本 */
export function encodeSharePayload(payload: SharePayload): string {
  return toBase64Url(JSON.stringify(payload));
}

/**
 * 解码分享链接。
 * - 新格式（带 c）：返回 SharePayload。
 * - 旧格式（扁平配置，无修订号）：返回 v=1 且不带 rev，由 store 补成首版。
 * - 损坏：返回 null。
 */
export function decodeSharePayload(raw: string): SharePayload | null {
  try {
    const parsed = JSON.parse(fromBase64Url(raw)) as Partial<SharePayload> & Record<string, unknown>;
    if (parsed && typeof parsed === "object" && parsed.c && typeof parsed.c === "object") {
      const c = parsed.c as Record<string, unknown>;
      if (CONFIG_KEYS.every((key) => typeof c[key] === "string")) {
        return {
          v: typeof parsed.v === "number" ? parsed.v : 2,
          rev: typeof parsed.rev === "string" ? parsed.rev : undefined,
          base: typeof parsed.base === "number" ? parsed.base : undefined,
          drv: typeof parsed.drv === "number" ? parsed.drv : undefined,
          inv: typeof parsed.inv === "number" ? parsed.inv : undefined,
          c: c as Configuration,
        };
      }
      return null;
    }
    // 旧格式：扁平 { v:1, color, material, ... }
    if (CONFIG_KEYS.every((key) => typeof parsed[key] === "string")) {
    const c = {} as Configuration;
      for (const key of CONFIG_KEYS) c[key] = parsed[key] as string;
      return { v: 1, c };
    }
    return null;
  } catch {
    return null;
  }
}

/** 兼容旧调用：仅编码配置（新代码请用 encodeSharePayload） */
export function encodeConfiguration(configuration: Configuration): string {
  return toBase64Url(JSON.stringify({ v: 1, ...configuration }));
}

export function createShareUrl(payload: SharePayload): string {
  return `${window.location.origin}${window.location.pathname}#/share/${encodeSharePayload(payload)}`;
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(price);
}
