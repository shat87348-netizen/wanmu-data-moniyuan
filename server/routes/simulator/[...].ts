// 把 /simulator/** 转发到 runtimeConfig.apiTarget（默认取环境变量 SIMULATOR_API_TARGET）。
// 按 frontend-integration.md 第2节要求：完整保留 /simulator 前缀转发给新服务，不做路径改写；
// 运行时读取目标地址，改地址只需要改环境变量重启进程，不用重新构建。
export default defineEventHandler((event) => {
  const target = String(useRuntimeConfig(event).apiTarget || '').replace(/\/$/, '')
  return proxyRequest(event, `${target}${event.path}`)
})
