import type { Configuration } from "../types/product";

function toBase64Url(value: string): string {
  return btoa(unescape(encodeURIComponent(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return decodeURIComponent(escape(atob(padded)));
}

export function encodeConfiguration(configuration: Configuration): string {
  return toBase64Url(JSON.stringify({ v: 1, ...configuration }));
}

export function decodeConfiguration(payload: string): Partial<Configuration> {
  try {
    const parsed = JSON.parse(fromBase64Url(payload)) as Partial<Configuration> & { v?: number };
    const keys: Array<keyof Configuration> = ["color", "material", "filter", "battery", "stand", "trim"];
    if (keys.some((key) => typeof parsed[key] !== "string")) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function createShareUrl(configuration: Configuration): string {
  return `${window.location.origin}${window.location.pathname}#/share/${encodeConfiguration(configuration)}`;
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(price);
}
