# AeroStation 三维产品配置器

基于 Vue 3、TypeScript、Vite、Three.js、TresJS、Pinia、Tailwind CSS、Headless UI 和 Vue Router。

## 运行

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm build
```

## 已实现功能

- 由 Three.js 几何体程序化组成空气净化器模型，不依赖外部模型文件。
- 鼠标/触控拖拽旋转和缩放，移动端采用响应式布局。
- 颜色、材质、滤芯、续航、支架和控制环六组配置。
- 材质、滤芯、支架和电池选项包含真实依赖校验与自动修正。
- 价格及六个关键规格随配置实时更新。
- 主视角、正视、俯视和细节四种相机预设，切换使用逐帧平滑插值。
- 配置编码进分享链接，打开后还原为同一套选择。
