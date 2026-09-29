// 按 frontend-integration.md 第2节的响应/异常约定封装请求。
// 调用方按 error.kind / error.status 分支处理：
//   kind === 'http'   -> 按 error.status（400/409/500/其他）展示 error.message
//   kind === 'network' -> 超时/断网/非JSON响应，提示“连接异常，操作结果待确认”，重新查询状态
export type SimulatorApiError = {
  kind: 'http' | 'network'
  status?: number
  message: string
}

type Envelope<T> = { code?: number, message?: string, data?: T }

export const useSimulatorApi = () => {
  const request = async <T>(path: string, options: { method?: 'GET' | 'POST', body?: unknown } = {}): Promise<T> => {
    let response: Envelope<T> | T
    try {
      response = await $fetch<Envelope<T> | T>(path, {
        method: options.method || 'GET',
        body: options.body,
        headers: options.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined
      })
    } catch (error) {
      const fetchError = error as { response?: { status?: number, _data?: Envelope<unknown> }, status?: number, statusCode?: number, message?: string }
      const status = fetchError.response?.status ?? fetchError.status ?? fetchError.statusCode
      if (status !== undefined) {
        const message = fetchError.response?._data?.message || fetchError.message || `请求失败（HTTP ${status}）`
        const apiError: SimulatorApiError = { kind: 'http', status, message }
        throw apiError
      }
      // 超时、网络断开、非 JSON 响应等，统一按“连接异常，操作结果待确认”处理。
      const apiError: SimulatorApiError = { kind: 'network', message: '连接异常，操作结果待确认' }
      throw apiError
    }

    if (response && typeof response === 'object' && 'code' in response) {
      const envelope = response as Envelope<T>
      if (envelope.code !== undefined && envelope.code !== 200) {
        const apiError: SimulatorApiError = { kind: 'http', status: envelope.code, message: envelope.message || '请求失败' }
        throw apiError
      }
      return envelope.data as T
    }
    return response as T
  }

  return { request }
}
