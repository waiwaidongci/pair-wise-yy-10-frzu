import { GROUP_IDS, sanitizeConfig } from "../data/catalog";
import type { ConfigRevision, Configuration } from "../types/product";

function toBase64Url(value: string): string {
  return btoa(unescape(encodeURIComponent(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return decodeURIComponent(escape(atob(padded)));
}

/** 新分享链接：携带修订号 r 与落定版本，用于列表/预览/分享页定位当前修订 */
export function encodeConfiguration(configuration: Configuration, revision?: ConfigRevision): string {
  return toBase64Url(
    JSON.stringify({
      v: 2,
      r: revision?.id ?? "",
      rn: revision?.number ?? 0,
      c: { ...configuration },
    }),
  );
}

export interface DecodedShare {
  legacy: boolean;
  revisionId?: string;
  config: Configuration | Partial<Configuration>;
}

export function decodeConfiguration(payload: string): Partial<Configuration> {
  return decodeShare(payload).config;
}

/** 解析分享链接：v=2 带修订号；旧 v=1 链接没有修订号，交由服务端补录为首版 */
export function decodeShare(payload: string): DecodedShare {
  try {
    const parsed = JSON.parse(fromBase64Url(payload)) as Record<string, unknown>;
    if (parsed.v === 2 && parsed.c && typeof parsed.c === "object") {
      const config = sanitizeConfig(parsed.c as Partial<Configuration>);
      const valid = GROUP_IDS.every((field) => typeof (parsed.c as Record<string, unknown>)[field] === "string");
      if (!valid) return { legacy: true, config: {} };
      return { legacy: false, revisionId: typeof parsed.r === "string" ? parsed.r : undefined, config };
    }
    // 旧格式：{ v: 1, color, material, ... }，无修订号
    if (parsed.v === 1 || parsed.v === undefined) {
      const keys = GROUP_IDS;
      if (keys.some((key) => typeof parsed[key] !== "string")) return { legacy: true, config: {} };
      return { legacy: true, config: sanitizeConfig(parsed as Partial<Configuration>) };
    }
    return { legacy: false, config: {} };
  } catch {
    return { legacy: false, config: {} };
  }
}

export function createShareUrl(configuration: Configuration, revision?: ConfigRevision): string {
  return `${window.location.origin}${window.location.pathname}#/share/${encodeConfiguration(configuration, revision)}`;
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(price);
}
