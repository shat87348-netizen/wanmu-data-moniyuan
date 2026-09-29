# 模拟源管理（独立前端模块）

按 [`frontend-integration.md`](./frontend-integration.md) 实现的“模拟源管理”页面，对接 `data-simulator-service`
（`/simulator/*`，默认 `http://127.0.0.1:8085`）。是一个独立于 `../web1`（数据处理主前端）的小型 Nuxt 应用，
视觉主题（深色配色、组件库）与 `web1` 保持一致，但不共用同一套源码/构建产物。

## 运行

```bash
cd frontend-integration
npm install
npm run dev      # http://localhost:3000，默认代理到 http://127.0.0.1:8085
```

后端地址运行时可配置，不用重新构建：

```bash
SIMULATOR_API_TARGET=http://192.168.1.20:8085 npm run dev
# 或生产环境：
SIMULATOR_API_TARGET=http://192.168.1.20:8085 node .output/server/index.mjs
```

原理与 `../web1` 的 `server/api/[...].ts` 一致：`server/routes/simulator/[...].ts` 在请求到达时读取
`runtimeConfig.apiTarget`（默认取环境变量 `SIMULATOR_API_TARGET`）动态转发，不是构建时写死，见
[frontend-integration.md 第2节](./frontend-integration.md#2-服务地址与请求封装)关于同源代理的建议。

## 构建

```bash
npm run build
node .output/server/index.mjs   # 默认 http://localhost:3000
```

## 结构

```text
frontend-integration/
├── frontend-integration.md   规格文档（原始交付物）
├── app/
│   ├── app.vue
│   ├── app.config.ts          主题变量，照搬 web1 的配色
│   ├── assets/css/main.css    深色主题 CSS 变量，照搬 web1
│   ├── components/AppSelect.vue   从 web1 复制，保持下拉框样式一致
│   ├── composables/useSimulatorApi.ts  请求封装，按文档第2节处理 200/400/409/500/网络异常
│   └── pages/index.vue        模拟源管理页面本体（查询栏/工具栏/列表/新建编辑弹窗/详情抽屉/历史抽屉）
├── server/routes/simulator/[...].ts   动态反向代理到 SIMULATOR_API_TARGET
├── nuxt.config.ts
└── package.json
```

## 已实现范围

对照 `frontend-integration.md` 第1、11节：

- 查询栏（名称、状态）、工具栏（新建、刷新）、分页列表，行操作按状态单独加载锁（第8节状态矩阵）。
- 新建/编辑弹窗：基础配置 + PDXP 专用配置（四种长度实时预览、十六进制字段校验）+ FEP 隐藏并移除 `pdxp` 字段。
- 详情抽屉：`GET /simulator/sources/{id}` 只读展示，含 PDXP 只读协议参数。
- 运行历史抽屉：分页记录 + 可展开的 `configSnapshot`。
- 轮询：页面可见时约 2.5 秒刷新列表，隐藏时暂停，恢复可见立即刷新；弹窗打开时轮询只更新列表不覆盖表单；
  请求序号丢弃过期响应；刷新失败保留旧数据并标记“可能已过期”。
- 未实现（文档第1节明确排除）：文件上传/服务器文件浏览、批量启停、暂停续跑、运行中修改、WebSocket 推送。

尚未接入真实的 `data-simulator-service` 后端联调验证（第12节验收清单未执行）；已完成构建与本地界面走查
（无控制台报错，PDXP/FEP 表单分支、状态矩阵按钮禁用逻辑均按文档实现）。
