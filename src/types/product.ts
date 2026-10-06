export interface ProductOption {
  id: string;
  name: string;
  description: string;
  price: number;
  swatch?: string;
  value?: string | number | boolean;
}

export interface ProductGroup {
  id: "color" | "material" | "filter" | "battery" | "stand" | "trim";
  name: string;
  summary: string;
  options: ProductOption[];
}

export type CameraPreset = "hero" | "front" | "top" | "detail";

export interface Configuration {
  color: string;
  material: string;
  filter: string;
  battery: string;
  stand: string;
  trim: string;
}

export interface ProductSpec {
  label: string;
  value: string;
}
