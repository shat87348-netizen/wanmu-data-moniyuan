export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: '模拟源管理'
    }
  },
  runtimeConfig: {
    // 服务端专用，容器/进程启动时用 SIMULATOR_API_TARGET 环境变量覆盖即可，不用重新构建。
    // 对应 frontend-integration.md 第2节：默认服务地址 http://127.0.0.1:8085，接口前缀 /simulator。
    apiTarget: process.env.SIMULATOR_API_TARGET || 'http://127.0.0.1:8085'
  },
  ui: {
    fonts: false
  },
  devtools: { enabled: true },
  compatibilityDate: '2026-08-03'
})
