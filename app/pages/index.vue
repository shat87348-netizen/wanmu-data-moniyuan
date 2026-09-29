<script setup lang="ts">
import type { SimulatorApiError } from '~/composables/useSimulatorApi'

// ============================== 类型（对应 frontend-integration.md 第3-10节） ==============================
type ProtocolOption = {
  value: number
  label: string
  transferType: number
  transferTypeName: string
  defaultPort: number
  defaultIntervalMillis: number
  defaultLoopEnabled: number
}
type EnumOption = { value: number, label: string }
type FindData = { protocols: ProtocolOption[], statuses: EnumOption[], yesNo: EnumOption[] }

type PdxpConfig = {
  inputFrameLength: number | null
  transportHeaderLength: number | null
  telemetryHeaderLength: number | null
  customDataLength: number | null
  transportHeader: string
  customData: string
  ver: string
  mid: string
  sid: string
  did: string
  bid: string
  initialNo: string
  flag: string
}

type SourceRecord = {
  id: number
  sourceName: string
  transferProtocol: number
  transferType: number
  filePath: string
  targetHost: string
  targetPort: number
  sendIntervalMillis: number
  loopEnabled: number
  remark: string | null
  createTime: string
  updateTime: string
  pdxp: PdxpConfig | null
  latestRunId: number | null
  sentUnitCount: number
  protocolName: string
  transferTypeName: string
  loopEnabledName: string
  runStatus: string
}

type RunRecord = {
  id: number
  sourceId: number
  runStatus: string
  startTime: string
  endTime: string | null
  sentUnitCount: number
  sentByteCount: number
  completedLoopCount: number
  lastSendTime: string | null
  errorMessage: string | null
  configSnapshot: Record<string, unknown> | null
  createTime: string
  updateTime: string
}

type Page<T> = { pageNum: number, pageSize: number, total: number, records: T[] }

// 运行状态：连接异常时用这个本地值，不是后端枚举。
const UNKNOWN_STATUS = '__unknown__'
const TERMINAL_LIKE = new Set(['未启动', '已停止', '已完成', '异常'])

// ============================== 基础设施 ==============================
const { request } = useSimulatorApi()
const toast = useToast()

const errorMessage = (error: unknown): string => {
  const apiError = error as SimulatorApiError
  if (apiError && typeof apiError === 'object' && 'kind' in apiError) return apiError.message
  return error instanceof Error ? error.message : '请稍后重试'
}
const isConflict = (error: unknown) => (error as SimulatorApiError)?.kind === 'http' && (error as SimulatorApiError).status === 409

// ============================== 枚举 ==============================
const findData = ref<FindData>({ protocols: [], statuses: [], yesNo: [] })
const findDataLoading = ref(false)
const protocolByValue = computed(() => new Map(findData.value.protocols.map(item => [item.value, item])))
const statusLabel = (value: number) => findData.value.statuses.find(item => item.value === value)?.label || String(value)

const loadFindData = async () => {
  findDataLoading.value = true
  try {
    findData.value = await request<FindData>('/simulator/findData')
  } catch (error) {
    toast.add({ title: '枚举加载失败', description: errorMessage(error), color: 'error' })
  } finally {
    findDataLoading.value = false
  }
}

// ============================== 查询栏 + 列表 ==============================
const queryForm = reactive({ name: '', status: '' as number | '' })
const pageNum = ref(1)
const pageSize = ref(20)
const total = ref(0)
const records = ref<SourceRecord[]>([])
const listLoading = ref(false)
const listStale = ref(false)
const lastUpdatedAt = ref<Date | null>(null)
let listRequestSeq = 0

const buildListQuery = () => {
  const params = new URLSearchParams({ pageNum: String(pageNum.value), pageSize: String(pageSize.value) })
  if (queryForm.name.trim()) params.set('name', queryForm.name.trim())
  if (queryForm.status !== '') params.set('status', String(queryForm.status))
  return params.toString()
}

const loadList = async () => {
  const seq = ++listRequestSeq
  listLoading.value = true
  try {
    const data = await request<Page<SourceRecord>>(`/simulator/sources?${buildListQuery()}`)
    if (seq !== listRequestSeq) return // 已有更新的查询在途，丢弃这次过期响应
    records.value = Array.isArray(data?.records) ? data.records : []
    total.value = Number(data?.total || 0)
    listStale.value = false
    lastUpdatedAt.value = new Date()
  } catch (error) {
    if (seq !== listRequestSeq) return
    listStale.value = true
    // 保留上次数据，只标记过期，不把所有实例改成“已停止”（frontend-integration.md 第9节第6条）。
    toast.add({ title: '列表刷新失败', description: errorMessage(error), color: 'error' })
  } finally {
    if (seq === listRequestSeq) listLoading.value = false
  }
}

const runQuery = () => { pageNum.value = 1; void loadList() }
const resetQuery = () => { Object.assign(queryForm, { name: '', status: '' }); pageNum.value = 1; void loadList() }
const changePage = (next: number) => { pageNum.value = next; void loadList() }

// ============================== 轮询（页面可见时每 2~3 秒刷新列表，隐藏时暂停） ==============================
const POLL_INTERVAL_MS = 2500
let pollTimer: ReturnType<typeof setInterval> | undefined
const startPolling = () => {
  if (pollTimer) return
  pollTimer = setInterval(() => { if (!isAnyDialogOpen.value) void loadList() }, POLL_INTERVAL_MS)
}
const stopPolling = () => {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = undefined
}
const handleVisibilityChange = () => {
  if (document.visibilityState === 'hidden') stopPolling()
  else { void loadList(); startPolling() }
}

// ============================== 行操作（启动/停止/删除），按行加锁 ==============================
const rowBusy = ref<Record<number, 'start' | 'stop' | 'delete' | undefined>>({})
const isRowBusy = (id: number) => Boolean(rowBusy.value[id])

const canStart = (record: SourceRecord) => TERMINAL_LIKE.has(record.runStatus) && !isRowBusy(record.id)
const canStop = (record: SourceRecord) => (record.runStatus === '启动中' || record.runStatus === '运行中') && Boolean(record.latestRunId) && !isRowBusy(record.id)
const canEdit = (record: SourceRecord) => TERMINAL_LIKE.has(record.runStatus) && !isRowBusy(record.id)
const canDelete = (record: SourceRecord) => TERMINAL_LIKE.has(record.runStatus) && !isRowBusy(record.id)

const startSource = async (record: SourceRecord) => {
  rowBusy.value = { ...rowBusy.value, [record.id]: 'start' }
  try {
    await request<number>('/simulator/sources/start', { method: 'POST', body: { id: record.id } })
    toast.add({ title: `已提交启动：${record.sourceName}`, color: 'success' })
  } catch (error) {
    if (isConflict(error)) toast.add({ title: '启动被拒绝', description: errorMessage(error), color: 'warning' })
    else toast.add({ title: '启动失败', description: errorMessage(error), color: 'error' })
  } finally {
    delete rowBusy.value[record.id]
    rowBusy.value = { ...rowBusy.value }
    await loadList()
  }
}

const stopSource = async (record: SourceRecord) => {
  if (!record.latestRunId) {
    toast.add({ title: '缺少运行ID，正在刷新详情', color: 'warning' })
    await loadList()
    return
  }
  rowBusy.value = { ...rowBusy.value, [record.id]: 'stop' }
  try {
    await request<void>('/simulator/sources/stop', { method: 'POST', body: { id: record.id, runId: record.latestRunId } })
    toast.add({ title: '停止请求已提交', description: '继续刷新直到状态变为已停止', color: 'success' })
  } catch (error) {
    toast.add({ title: '停止失败', description: errorMessage(error), color: 'error' })
  } finally {
    delete rowBusy.value[record.id]
    rowBusy.value = { ...rowBusy.value }
    await loadList()
  }
}

const deleteConfirmId = ref<number | null>(null)
const requestDelete = (record: SourceRecord) => { deleteConfirmId.value = record.id }
const cancelDelete = () => { deleteConfirmId.value = null }
const confirmDelete = async (record: SourceRecord) => {
  deleteConfirmId.value = null
  rowBusy.value = { ...rowBusy.value, [record.id]: 'delete' }
  try {
    await request<void>('/simulator/sources/delete', { method: 'POST', body: { id: record.id } })
    toast.add({ title: '已删除', color: 'success' })
    if (records.value.length === 1 && pageNum.value > 1) pageNum.value -= 1
    await loadList()
  } catch (error) {
    toast.add({ title: '删除失败', description: errorMessage(error), color: 'error' })
  } finally {
    delete rowBusy.value[record.id]
    rowBusy.value = { ...rowBusy.value }
  }
}

// ============================== 新建/编辑弹窗 ==============================
const isFormOpen = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const editingId = ref<number | null>(null)
const formSubmitting = ref(false)
const formLoading = ref(false)

const emptyPdxp = (): PdxpConfig => ({
  inputFrameLength: 512,
  transportHeaderLength: 2,
  telemetryHeaderLength: 4,
  customDataLength: 5,
  transportHeader: '1234',
  customData: '0102030405',
  ver: '80',
  mid: '0001',
  sid: '00000001',
  did: '00000001',
  bid: '00000001',
  initialNo: '00000000',
  flag: '00'
})

const baseForm = reactive({
  sourceName: '',
  transferProtocol: '' as number | '',
  filePath: '',
  targetHost: '127.0.0.1',
  targetPort: null as number | null,
  sendIntervalMillis: null as number | null,
  loopEnabled: 0,
  remark: ''
})
const pdxpForm = reactive<PdxpConfig>(emptyPdxp())

const isPdxpSelected = computed(() => Number(baseForm.transferProtocol) === 2)
const selectedProtocol = computed(() => protocolByValue.value.get(Number(baseForm.transferProtocol)))

const resetForm = () => {
  Object.assign(baseForm, { sourceName: '', transferProtocol: '', filePath: '', targetHost: '127.0.0.1', targetPort: null, sendIntervalMillis: null, loopEnabled: 0, remark: '' })
  Object.assign(pdxpForm, emptyPdxp())
}

// 只在“新建”时，切换协议才应用默认值；编辑回填后不再被默认值覆盖（第6.1节）。
const onProtocolChange = () => {
  if (formMode.value !== 'create') return
  const option = selectedProtocol.value
  if (!option) return
  baseForm.targetPort = option.defaultPort
  baseForm.sendIntervalMillis = option.defaultIntervalMillis
  baseForm.loopEnabled = option.defaultLoopEnabled
  if (option.value === 2) Object.assign(pdxpForm, emptyPdxp())
}

const openCreateDialog = () => {
  formMode.value = 'create'
  editingId.value = null
  resetForm()
  isFormOpen.value = true
}

const openEditDialog = async (record: SourceRecord) => {
  formMode.value = 'edit'
  editingId.value = record.id
  formLoading.value = true
  isFormOpen.value = true
  try {
    // 编辑必须重新查详情回填，不能直接用列表行的数据（列表里的 pdxp 不加载协议参数）。
    const detail = await request<SourceRecord>(`/simulator/sources/${record.id}`)
    Object.assign(baseForm, {
      sourceName: detail.sourceName,
      transferProtocol: detail.transferProtocol,
      filePath: detail.filePath,
      targetHost: detail.targetHost,
      targetPort: detail.targetPort,
      sendIntervalMillis: detail.sendIntervalMillis,
      loopEnabled: detail.loopEnabled,
      remark: detail.remark || ''
    })
    if (detail.transferProtocol === 2 && detail.pdxp) {
      Object.assign(pdxpForm, detail.pdxp)
    } else {
      Object.assign(pdxpForm, emptyPdxp())
    }
  } catch (error) {
    toast.add({ title: '加载详情失败', description: errorMessage(error), color: 'error' })
    isFormOpen.value = false
  } finally {
    formLoading.value = false
  }
}

const closeForm = () => { isFormOpen.value = false }

// ---------- PDXP 长度预览与十六进制校验（第6.2 / 6.3节） ----------
const num = (value: number | null) => Number.isFinite(Number(value)) ? Number(value) : 0
const remainLength = computed(() => num(pdxpForm.inputFrameLength) - num(pdxpForm.telemetryHeaderLength))
const dataFieldLength = computed(() => num(pdxpForm.inputFrameLength) + num(pdxpForm.customDataLength))
const totalLength = computed(() => num(pdxpForm.transportHeaderLength) + 32 + num(pdxpForm.customDataLength) + num(pdxpForm.inputFrameLength))
const totalLengthExceeded = computed(() => isPdxpSelected.value && totalLength.value > 65507)

const HEX_PATTERN = /^[0-9A-Fa-f]*$/
const hexFieldError = (value: string, expectedChars: number) => {
  if (!HEX_PATTERN.test(value)) return '只允许 0-9、A-F'
  if (value.length !== expectedChars) return `需要 ${expectedChars} 个十六进制字符（当前 ${value.length}）`
  return ''
}
const pdxpHexErrors = computed(() => {
  if (!isPdxpSelected.value) return {}
  return {
    transportHeader: hexFieldError(pdxpForm.transportHeader, num(pdxpForm.transportHeaderLength) * 2),
    customData: hexFieldError(pdxpForm.customData, num(pdxpForm.customDataLength) * 2),
    ver: hexFieldError(pdxpForm.ver, 2),
    mid: hexFieldError(pdxpForm.mid, 4),
    sid: hexFieldError(pdxpForm.sid, 8),
    did: hexFieldError(pdxpForm.did, 8),
    bid: hexFieldError(pdxpForm.bid, 8),
    initialNo: hexFieldError(pdxpForm.initialNo, 8),
    flag: hexFieldError(pdxpForm.flag, 2)
  }
})
const pdxpHasHexError = computed(() => Object.values(pdxpHexErrors.value).some(Boolean))
const pdxpLengthError = computed(() => {
  if (!isPdxpSelected.value) return ''
  if (num(pdxpForm.telemetryHeaderLength) > num(pdxpForm.inputFrameLength)) return '原帧头长度不能超过输入帧长度'
  if (totalLengthExceeded.value) return `UDP报文总长度 ${totalLength.value} 字节超过 65507 字节上限`
  return ''
})
const uppercaseHex = (field: 'transportHeader' | 'customData' | 'ver' | 'mid' | 'sid' | 'did' | 'bid' | 'initialNo' | 'flag') => {
  pdxpForm[field] = pdxpForm[field].toUpperCase()
}

const formValid = computed(() => {
  if (!baseForm.sourceName.trim() || baseForm.sourceName.trim().length > 100) return false
  if (baseForm.transferProtocol === '') return false
  if (!baseForm.filePath.trim() || baseForm.filePath.length > 1000) return false
  if (!baseForm.targetHost.trim() || baseForm.targetHost.length > 100) return false
  if (!Number.isInteger(baseForm.targetPort) || (baseForm.targetPort as number) < 1 || (baseForm.targetPort as number) > 65535) return false
  if (!Number.isInteger(baseForm.sendIntervalMillis) || (baseForm.sendIntervalMillis as number) < 0 || (baseForm.sendIntervalMillis as number) > 86400000) return false
  if (baseForm.remark && baseForm.remark.length > 500) return false
  if (isPdxpSelected.value && (pdxpHasHexError.value || pdxpLengthError.value)) return false
  return true
})

const saveSource = async () => {
  if (!formValid.value) {
    toast.add({ title: '请检查表单填写', color: 'warning' })
    return
  }
  const body: Record<string, unknown> = {
    sourceName: baseForm.sourceName.trim(),
    transferProtocol: Number(baseForm.transferProtocol),
    transferType: selectedProtocol.value?.transferType,
    filePath: baseForm.filePath,
    targetHost: baseForm.targetHost.trim(),
    targetPort: baseForm.targetPort,
    sendIntervalMillis: baseForm.sendIntervalMillis,
    loopEnabled: baseForm.loopEnabled,
    remark: baseForm.remark.trim() || null
  }
  if (isPdxpSelected.value) {
    body.pdxp = {
      inputFrameLength: pdxpForm.inputFrameLength,
      transportHeaderLength: pdxpForm.transportHeaderLength,
      telemetryHeaderLength: pdxpForm.telemetryHeaderLength,
      customDataLength: pdxpForm.customDataLength,
      transportHeader: pdxpForm.transportHeader,
      customData: pdxpForm.customData,
      ver: pdxpForm.ver,
      mid: pdxpForm.mid,
      sid: pdxpForm.sid,
      did: pdxpForm.did,
      bid: pdxpForm.bid,
      initialNo: pdxpForm.initialNo,
      flag: pdxpForm.flag
    }
  }
  // FEP 必须整体不带 pdxp 字段，不是提交空对象（第6.4节）。
  if (formMode.value === 'edit') body.id = editingId.value

  formSubmitting.value = true
  try {
    await request<number>(formMode.value === 'create' ? '/simulator/sources/create' : '/simulator/sources/update', { method: 'POST', body })
    toast.add({ title: '配置已保存', color: 'success' })
    isFormOpen.value = false
    await loadList()
  } catch (error) {
    if (isConflict(error)) toast.add({ title: '保存被拒绝', description: errorMessage(error), color: 'warning' })
    else toast.add({ title: '保存失败', description: errorMessage(error), color: 'error' })
    // 400/409 均保留用户已填写内容，不清空表单。
  } finally {
    formSubmitting.value = false
  }
}

// ============================== 详情抽屉 ==============================
const isDetailOpen = ref(false)
const detailLoading = ref(false)
const detailRecord = ref<SourceRecord | null>(null)
const openDetail = async (id: number) => {
  isDetailOpen.value = true
  detailLoading.value = true
  detailRecord.value = null
  try {
    detailRecord.value = await request<SourceRecord>(`/simulator/sources/${id}`)
  } catch (error) {
    toast.add({ title: '详情加载失败', description: errorMessage(error), color: 'error' })
  } finally {
    detailLoading.value = false
  }
}

// ============================== 运行历史抽屉 ==============================
const isHistoryOpen = ref(false)
const historySourceId = ref<number | null>(null)
const historySourceName = ref('')
const historyLoading = ref(false)
const historyPageNum = ref(1)
const historyPageSize = ref(20)
const historyTotal = ref(0)
const historyRecords = ref<RunRecord[]>([])
const expandedSnapshotId = ref<number | null>(null)

const loadHistory = async () => {
  if (!historySourceId.value) return
  historyLoading.value = true
  try {
    const params = new URLSearchParams({ pageNum: String(historyPageNum.value), pageSize: String(historyPageSize.value) })
    const data = await request<Page<RunRecord>>(`/simulator/sources/${historySourceId.value}/runs?${params.toString()}`)
    historyRecords.value = Array.isArray(data?.records) ? data.records : []
    historyTotal.value = Number(data?.total || 0)
  } catch (error) {
    toast.add({ title: '运行历史加载失败', description: errorMessage(error), color: 'error' })
  } finally {
    historyLoading.value = false
  }
}
const openHistory = (record: SourceRecord) => {
  historySourceId.value = record.id
  historySourceName.value = record.sourceName
  historyPageNum.value = 1
  expandedSnapshotId.value = null
  isHistoryOpen.value = true
  void loadHistory()
}
const changeHistoryPage = (next: number) => { historyPageNum.value = next; void loadHistory() }
const toggleSnapshot = (id: number) => { expandedSnapshotId.value = expandedSnapshotId.value === id ? null : id }

const isAnyDialogOpen = computed(() => isFormOpen.value) // 轮询只更新列表，不覆盖表单未保存输入（第9节第4条）

// ============================== 展示辅助 ==============================
const statusTagClass = (status: string) => ({
  未启动: 'tag neutral', 启动中: 'tag info', 运行中: 'tag success',
  停止中: 'tag warning', 已停止: 'tag neutral', 已完成: 'tag success', 异常: 'tag error'
}[status] || 'tag neutral')
const dash = (value: unknown) => value === null || value === undefined || value === '' ? '—' : String(value)
const countUnit = (record: { protocolName?: string }) => record.protocolName === 'PDXP' ? '帧' : '数据单元'

onMounted(() => {
  void loadFindData()
  void loadList()
  if (document.visibilityState !== 'hidden') startPolling()
  document.addEventListener('visibilitychange', handleVisibilityChange)
})
onUnmounted(() => {
  stopPolling()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <main class="simulator-page">
    <header class="page-header">
      <div>
        <h1>模拟源管理</h1>
        <p>独立模拟数据处理软件的采集数据来源，支持 PDXP/UDP 与 FEP/TCP 混合运行</p>
      </div>
      <div class="header-meta">
        <span v-if="lastUpdatedAt" class="update-time" :class="{ stale: listStale }">
          {{ listStale ? '数据可能已过期' : '已更新' }}：{{ lastUpdatedAt.toLocaleTimeString('zh-CN', { hour12: false }) }}
        </span>
        <AppThemeMenu />
        <UButton type="button" class="outline-button small" :disabled="listLoading" @click="loadList">{{ listLoading ? '刷新中…' : '刷新' }}</UButton>
        <UButton type="button" class="primary-button" @click="openCreateDialog">新建模拟源</UButton>
      </div>
    </header>

    <div class="content-row">
      <section class="data-card filter-panel">
        <div class="query-grid">
          <label>模拟源名称<UInput v-model.trim="queryForm.name" class="app-input" placeholder="按名称模糊查询" @keyup.enter="runQuery" /></label>
          <label>运行状态<AppSelect v-model.number="queryForm.status">
            <option value="">全部</option>
            <option v-for="item in findData.statuses" :key="item.value" :value="item.value">{{ item.label }}</option>
          </AppSelect></label>
          <div class="query-actions">
            <UButton type="button" class="primary-button" @click="runQuery">查询</UButton>
            <UButton type="button" class="outline-button" @click="resetQuery">重置</UButton>
          </div>
        </div>
      </section>

      <section class="data-card table-panel">
        <div class="table-wrap">
          <table class="process-table wide-table">
            <thead>
              <tr>
                <th>名称</th><th>协议</th><th>目标地址/端口</th><th>文件路径</th><th>发送间隔</th><th>是否循环</th><th>状态</th><th>本次发送单元数</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="listLoading && !records.length"><td colspan="9" class="empty-state">正在加载…</td></tr>
              <tr v-else-if="!records.length"><td colspan="9" class="empty-state">暂无模拟源</td></tr>
              <tr v-for="record in records" :key="record.id">
                <td :title="record.sourceName">{{ record.sourceName }}</td>
                <td>{{ record.protocolName }}</td>
                <td>{{ record.targetHost }}:{{ record.targetPort }}</td>
                <td class="ellipsis-cell" :title="record.filePath">{{ record.filePath }}</td>
                <td>{{ record.sendIntervalMillis }} ms</td>
                <td>{{ record.loopEnabledName }}</td>
                <td><span :class="statusTagClass(record.runStatus)">{{ record.runStatus }}</span></td>
                <td>{{ record.sentUnitCount }} {{ countUnit(record) }}</td>
                <td class="row-actions">
                  <UButton type="button" class="outline-button small" :disabled="!canStart(record)" :loading="rowBusy[record.id] === 'start'" @click="startSource(record)">启动</UButton>
                  <UButton type="button" class="outline-button small" :disabled="!canStop(record)" :loading="rowBusy[record.id] === 'stop'" @click="stopSource(record)">停止</UButton>
                  <UButton type="button" class="outline-button small" :disabled="!canEdit(record)" @click="openEditDialog(record)">编辑</UButton>
                  <UButton type="button" class="outline-button small" :disabled="!canDelete(record)" @click="requestDelete(record)">删除</UButton>
                  <UButton type="button" class="outline-button small" @click="openDetail(record.id)">详情</UButton>
                  <UButton type="button" class="outline-button small" @click="openHistory(record)">历史</UButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="pagination-bar">
          <span>共 {{ total }} 条</span>
          <div class="pagination-actions">
            <UButton type="button" class="outline-button small" :disabled="pageNum <= 1" @click="changePage(pageNum - 1)">上一页</UButton>
            <span>第 {{ pageNum }} 页</span>
            <UButton type="button" class="outline-button small" :disabled="pageNum * pageSize >= total" @click="changePage(pageNum + 1)">下一页</UButton>
          </div>
        </footer>
      </section>
    </div>

    <!-- 删除二次确认 -->
    <div v-if="deleteConfirmId !== null" class="modal-layer" @click.self="cancelDelete">
      <section class="confirm-dialog" role="dialog" aria-modal="true">
        <p>删除此模拟源配置？历史运行记录仍保留。</p>
        <div class="dialog-footer">
          <UButton type="button" class="outline-button" @click="cancelDelete">取消</UButton>
          <UButton type="button" class="primary-button danger" @click="confirmDelete(records.find(item => item.id === deleteConfirmId)!)">确认删除</UButton>
        </div>
      </section>
    </div>

    <!-- 新建/编辑弹窗 -->
    <div v-if="isFormOpen" class="modal-layer" @click.self="closeForm">
      <section class="form-dialog" role="dialog" aria-modal="true">
        <header class="modal-header">
          <div><h2>{{ formMode === 'create' ? '新建模拟源' : '编辑模拟源' }}</h2></div>
          <UButton type="button" class="icon-button" aria-label="关闭" @click="closeForm"><UIcon name="i-lucide-x" /></UButton>
        </header>
        <div v-if="formLoading" class="protocol-source-empty">正在加载配置…</div>
        <form v-else class="modal-body" @submit.prevent="saveSource">
          <section class="form-section">
            <h3>基础配置</h3>
            <div class="form-grid">
              <label class="form-field"><span>模拟源名称 <b>*</b></span><UInput v-model.trim="baseForm.sourceName" maxlength="100" class="app-input" /></label>
              <label class="form-field"><span>协议 <b>*</b></span>
                <AppSelect v-model.number="baseForm.transferProtocol" :disabled="formMode === 'edit'" @change="onProtocolChange">
                  <option value="" disabled>请选择协议</option>
                  <option v-for="item in findData.protocols" :key="item.value" :value="item.value">{{ item.label }}</option>
                </AppSelect>
              </label>
              <label class="form-field"><span>传输方式</span><UInput :model-value="selectedProtocol?.transferTypeName || '—'" disabled class="app-input" /></label>
              <label class="form-field"><span>文件路径 <b>*</b></span><UInput v-model.trim="baseForm.filePath" maxlength="1000" placeholder="模拟源服务所在机器上的文件路径" class="app-input" /></label>
              <label class="form-field"><span>目标地址 <b>*</b></span><UInput v-model.trim="baseForm.targetHost" maxlength="100" class="app-input" /></label>
              <label class="form-field"><span>目标端口 <b>*</b></span><UInput v-model.number="baseForm.targetPort" type="number" min="1" max="65535" class="app-input" /></label>
              <label class="form-field"><span>发送间隔（毫秒） <b>*</b></span><UInput v-model.number="baseForm.sendIntervalMillis" type="number" min="0" max="86400000" class="app-input" /></label>
              <label class="form-field"><span>是否循环</span>
                <AppSelect v-model.number="baseForm.loopEnabled">
                  <option v-for="item in findData.yesNo" :key="item.value" :value="item.value">{{ item.label }}</option>
                </AppSelect>
              </label>
              <label class="form-field span-2"><span>备注</span><UTextarea v-model.trim="baseForm.remark" maxlength="500" class="app-input" /></label>
            </div>
            <p class="field-hint">请填写模拟源服务所在机器上的文件路径，启动时检查文件是否可用。</p>
          </section>

          <section v-if="isPdxpSelected" class="form-section">
            <h3>PDXP 配置</h3>
            <div class="form-grid">
              <label class="form-field"><span>输入帧长度（字节）</span><UInput v-model.number="pdxpForm.inputFrameLength" type="number" min="1" max="65475" class="app-input" /></label>
              <label class="form-field"><span>传输头长度（字节）</span><UInput v-model.number="pdxpForm.transportHeaderLength" type="number" min="0" max="65475" class="app-input" /></label>
              <label class="form-field"><span>原帧头长度（字节）</span><UInput v-model.number="pdxpForm.telemetryHeaderLength" type="number" min="0" class="app-input" /></label>
              <label class="form-field"><span>自定义数据长度（字节）</span><UInput v-model.number="pdxpForm.customDataLength" type="number" min="0" max="65475" class="app-input" /></label>
            </div>
            <div class="pdxp-preview">
              <span>原帧剩余部分长度 = {{ remainLength }} 字节</span>
              <span>PDXP数据域长度 = {{ dataFieldLength }} 字节</span>
              <span :class="{ danger: totalLengthExceeded }">UDP报文总长度 = {{ totalLength }} 字节（上限 65507）</span>
            </div>
            <p v-if="pdxpLengthError" class="field-error">{{ pdxpLengthError }}</p>
            <p class="field-hint">报文预览顺序：传输头 → 32字节PDXP包头 → 自定义数据 → 原帧剩余部分 → 原帧头（自动移到末尾，无需填写）。</p>

            <div class="form-grid">
              <label class="form-field"><span>传输头内容</span><UInput :model-value="pdxpForm.transportHeader" class="app-input mono" @update:model-value="v => { pdxpForm.transportHeader = String(v); uppercaseHex('transportHeader') }" /><span v-if="pdxpHexErrors.transportHeader" class="field-error">{{ pdxpHexErrors.transportHeader }}</span></label>
              <label class="form-field"><span>自定义数据内容</span><UInput :model-value="pdxpForm.customData" class="app-input mono" @update:model-value="v => { pdxpForm.customData = String(v); uppercaseHex('customData') }" /><span v-if="pdxpHexErrors.customData" class="field-error">{{ pdxpHexErrors.customData }}</span></label>
              <label class="form-field"><span>版本 VER</span><UInput :model-value="pdxpForm.ver" class="app-input mono" @update:model-value="v => { pdxpForm.ver = String(v); uppercaseHex('ver') }" /><span v-if="pdxpHexErrors.ver" class="field-error">{{ pdxpHexErrors.ver }}</span></label>
              <label class="form-field"><span>任务标志 MID</span><UInput :model-value="pdxpForm.mid" class="app-input mono" @update:model-value="v => { pdxpForm.mid = String(v); uppercaseHex('mid') }" /><span v-if="pdxpHexErrors.mid" class="field-error">{{ pdxpHexErrors.mid }}</span></label>
              <label class="form-field"><span>信源地址 SID</span><UInput :model-value="pdxpForm.sid" class="app-input mono" @update:model-value="v => { pdxpForm.sid = String(v); uppercaseHex('sid') }" /><span v-if="pdxpHexErrors.sid" class="field-error">{{ pdxpHexErrors.sid }}</span></label>
              <label class="form-field"><span>信宿地址 DID</span><UInput :model-value="pdxpForm.did" class="app-input mono" @update:model-value="v => { pdxpForm.did = String(v); uppercaseHex('did') }" /><span v-if="pdxpHexErrors.did" class="field-error">{{ pdxpHexErrors.did }}</span></label>
              <label class="form-field"><span>数据标志 BID</span><UInput :model-value="pdxpForm.bid" class="app-input mono" @update:model-value="v => { pdxpForm.bid = String(v); uppercaseHex('bid') }" /><span v-if="pdxpHexErrors.bid" class="field-error">{{ pdxpHexErrors.bid }}</span></label>
              <label class="form-field"><span>包序号初值</span><UInput :model-value="pdxpForm.initialNo" class="app-input mono" @update:model-value="v => { pdxpForm.initialNo = String(v); uppercaseHex('initialNo') }" /><span v-if="pdxpHexErrors.initialNo" class="field-error">{{ pdxpHexErrors.initialNo }}</span></label>
              <label class="form-field"><span>数据处理标志 FLAG</span><UInput :model-value="pdxpForm.flag" class="app-input mono" @update:model-value="v => { pdxpForm.flag = String(v); uppercaseHex('flag') }" /><span v-if="pdxpHexErrors.flag" class="field-error">{{ pdxpHexErrors.flag }}</span></label>
            </div>
          </section>
          <p v-else-if="baseForm.transferProtocol !== ''" class="field-hint">FEP 无需协议专用配置；分块大小、连接与应答超时由服务端配置文件维护。</p>

          <footer class="dialog-footer">
            <UButton type="button" class="outline-button" :disabled="formSubmitting" @click="closeForm">取消</UButton>
            <UButton type="submit" class="primary-button" :disabled="formSubmitting || !formValid">{{ formSubmitting ? '保存中…' : '保存' }}</UButton>
          </footer>
        </form>
      </section>
    </div>

    <!-- 详情抽屉 -->
    <div v-if="isDetailOpen" class="modal-layer" @click.self="isDetailOpen = false">
      <section class="drawer-panel" role="dialog" aria-modal="true">
        <header class="modal-header"><h2>模拟源详情</h2><UButton type="button" class="icon-button" aria-label="关闭" @click="isDetailOpen = false"><UIcon name="i-lucide-x" /></UButton></header>
        <div v-if="detailLoading" class="protocol-source-empty">正在加载…</div>
        <div v-else-if="detailRecord" class="detail-body">
          <dl class="detail-grid">
            <div><dt>名称</dt><dd>{{ detailRecord.sourceName }}</dd></div>
            <div><dt>协议</dt><dd>{{ detailRecord.protocolName }}</dd></div>
            <div><dt>目标地址/端口</dt><dd>{{ detailRecord.targetHost }}:{{ detailRecord.targetPort }}</dd></div>
            <div><dt>文件路径</dt><dd>{{ detailRecord.filePath }}</dd></div>
            <div><dt>发送间隔</dt><dd>{{ detailRecord.sendIntervalMillis }} ms</dd></div>
            <div><dt>是否循环</dt><dd>{{ detailRecord.loopEnabledName }}</dd></div>
            <div><dt>状态</dt><dd><span :class="statusTagClass(detailRecord.runStatus)">{{ detailRecord.runStatus }}</span></dd></div>
            <div><dt>本次发送单元数</dt><dd>{{ detailRecord.sentUnitCount }} {{ countUnit(detailRecord) }}</dd></div>
            <div><dt>备注</dt><dd>{{ dash(detailRecord.remark) }}</dd></div>
            <div><dt>创建时间</dt><dd>{{ detailRecord.createTime }}</dd></div>
            <div><dt>更新时间</dt><dd>{{ detailRecord.updateTime }}</dd></div>
          </dl>
          <template v-if="detailRecord.transferProtocol === 2 && detailRecord.pdxp">
            <h3>PDXP 协议参数（只读）</h3>
            <dl class="detail-grid">
              <div><dt>输入帧长度</dt><dd>{{ detailRecord.pdxp.inputFrameLength }}</dd></div>
              <div><dt>传输头长度</dt><dd>{{ detailRecord.pdxp.transportHeaderLength }}</dd></div>
              <div><dt>原帧头长度</dt><dd>{{ detailRecord.pdxp.telemetryHeaderLength }}</dd></div>
              <div><dt>自定义数据长度</dt><dd>{{ detailRecord.pdxp.customDataLength }}</dd></div>
              <div><dt>传输头内容</dt><dd class="mono">{{ dash(detailRecord.pdxp.transportHeader) }}</dd></div>
              <div><dt>自定义数据内容</dt><dd class="mono">{{ dash(detailRecord.pdxp.customData) }}</dd></div>
              <div><dt>VER / MID</dt><dd class="mono">{{ detailRecord.pdxp.ver }} / {{ detailRecord.pdxp.mid }}</dd></div>
              <div><dt>SID / DID</dt><dd class="mono">{{ detailRecord.pdxp.sid }} / {{ detailRecord.pdxp.did }}</dd></div>
              <div><dt>BID / 包序号初值</dt><dd class="mono">{{ detailRecord.pdxp.bid }} / {{ detailRecord.pdxp.initialNo }}</dd></div>
              <div><dt>FLAG</dt><dd class="mono">{{ detailRecord.pdxp.flag }}</dd></div>
            </dl>
          </template>
        </div>
      </section>
    </div>

    <!-- 运行历史抽屉 -->
    <div v-if="isHistoryOpen" class="modal-layer" @click.self="isHistoryOpen = false">
      <section class="drawer-panel wide" role="dialog" aria-modal="true">
        <header class="modal-header"><h2>运行历史 · {{ historySourceName }}</h2><UButton type="button" class="icon-button" aria-label="关闭" @click="isHistoryOpen = false"><UIcon name="i-lucide-x" /></UButton></header>
        <div v-if="historyLoading && !historyRecords.length" class="protocol-source-empty">正在加载…</div>
        <div v-else-if="!historyRecords.length" class="protocol-source-empty">暂无运行记录</div>
        <div v-else class="table-wrap">
          <table class="process-table wide-table">
            <thead><tr><th>运行ID</th><th>状态</th><th>开始时间</th><th>结束时间</th><th>发送单元数</th><th>发送字节数</th><th>完成轮数</th><th>最近发送时间</th><th>异常原因</th><th>配置快照</th></tr></thead>
            <tbody>
              <template v-for="run in historyRecords" :key="run.id">
                <tr>
                  <td>{{ run.id }}</td>
                  <td><span :class="statusTagClass(run.runStatus)">{{ run.runStatus }}</span></td>
                  <td>{{ run.startTime }}</td>
                  <td>{{ dash(run.endTime) }}</td>
                  <td>{{ run.sentUnitCount }}</td>
                  <td>{{ run.sentByteCount }}</td>
                  <td>{{ run.completedLoopCount }}</td>
                  <td>{{ dash(run.lastSendTime) }}</td>
                  <td>{{ dash(run.errorMessage) }}</td>
                  <td><UButton type="button" class="outline-button small" @click="toggleSnapshot(run.id)">{{ expandedSnapshotId === run.id ? '收起' : '查看' }}</UButton></td>
                </tr>
                <tr v-if="expandedSnapshotId === run.id" class="snapshot-row">
                  <td colspan="10"><pre class="snapshot-pre">{{ JSON.stringify(run.configSnapshot, null, 2) }}</pre></td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <footer class="pagination-bar">
          <span>共 {{ historyTotal }} 条</span>
          <div class="pagination-actions">
            <UButton type="button" class="outline-button small" :disabled="historyPageNum <= 1" @click="changeHistoryPage(historyPageNum - 1)">上一页</UButton>
            <span>第 {{ historyPageNum }} 页</span>
            <UButton type="button" class="outline-button small" :disabled="historyPageNum * historyPageSize >= historyTotal" @click="changeHistoryPage(historyPageNum + 1)">下一页</UButton>
          </div>
        </footer>
      </section>
    </div>
  </main>
</template>

<style scoped>
.simulator-page { width: 100%; padding: 20px 24px; height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; gap: 16px; }
.page-header { flex: none; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.page-header h1 { margin: 0; font-size: 18px; color: var(--ui-text-highlighted); }
.page-header p { margin: 4px 0 0; font-size: 12px; color: var(--ui-text-muted); }
.header-meta { display: flex; align-items: center; gap: 10px; }
.update-time { font-size: 11px; color: var(--ui-text-muted); }
.update-time.stale { color: var(--ui-warning, #e6a23c); }

/* 查询栏（左）与列表（右）水平并排：查询栏固定 340px，列表占满剩余宽度，两者都撑满这一行的高度。 */
.content-row { flex: 1; min-height: 0; display: flex; flex-direction: row; gap: 16px; }

.data-card { border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg-elevated); overflow: visible; }
.filter-panel { width: 340px; height: 100%; flex: none; padding: 14px; overflow-y: auto; }
.query-grid { display: grid; grid-template-columns: 1fr; gap: 14px; align-content: start; }
.query-grid label { display: grid; gap: 6px; color: var(--ui-text-muted); font-size: 11px; }
.query-actions { display: flex; align-items: center; gap: 8px; }

.table-panel { width: calc(100% - 340px); height: 100%; flex: none; display: flex; flex-direction: column; overflow: hidden; }
.table-wrap { flex: 1; overflow: auto; }
.process-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.process-table th, .process-table td { padding: 8px 10px; border-top: 1px solid var(--ui-border-muted); text-align: left; white-space: nowrap; }
.process-table th { position: sticky; top: 0; background: var(--ui-bg-elevated); background-image: linear-gradient(color-mix(in oklab, var(--ui-bg-muted) 65%, transparent), color-mix(in oklab, var(--ui-bg-muted) 65%, transparent)); color: var(--ui-text-muted); font-weight: 600; }
.wide-table { min-width: 1100px; }
.ellipsis-cell { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
.empty-state { text-align: center; padding: 24px; color: var(--ui-text-muted); }
.row-actions { display: flex; gap: 6px; flex-wrap: wrap; }

.tag { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; }
.tag.neutral { background: var(--ui-bg-accented); color: var(--ui-text-muted); }
.tag.info { background: color-mix(in oklab, var(--ui-color-primary-500) 22%, transparent); color: var(--ui-color-primary-300); }
.tag.success { background: color-mix(in oklab, #22c55e 22%, transparent); color: #4ade80; }
.tag.warning { background: color-mix(in oklab, #f59e0b 22%, transparent); color: #fbbf24; }
.tag.error { background: color-mix(in oklab, #ef4444 22%, transparent); color: #f87171; }

.pagination-bar { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; font-size: 12px; color: var(--ui-text-muted); border-top: 1px solid var(--ui-border-muted); }
.pagination-actions { display: flex; align-items: center; gap: 10px; }

.modal-layer { position: fixed; inset: 0; background: #00000080; display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
.confirm-dialog, .form-dialog, .drawer-panel { background: var(--ui-bg-elevated); border: 1px solid var(--ui-border); border-radius: var(--ui-radius); padding: 16px 18px; }
.confirm-dialog { width: 320px; }
.form-dialog { width: 720px; max-height: 88vh; overflow-y: auto; }
.drawer-panel { width: 640px; max-height: 88vh; overflow-y: auto; }
.drawer-panel.wide { width: 960px; }
.modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.modal-header h2 { margin: 0; font-size: 15px; color: var(--ui-text-highlighted); }
.dialog-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }

.form-section { margin-bottom: 16px; }
.form-section h3 { margin: 0 0 10px; font-size: 13px; color: var(--ui-text-highlighted); }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.form-field { display: grid; gap: 6px; font-size: 11px; color: var(--ui-text-muted); }
.form-field b { color: var(--ui-error, #ef4444); font-weight: 500; }
.form-field.span-2 { grid-column: span 2; }
.field-hint { margin: 6px 0 0; font-size: 11px; color: var(--ui-text-dimmed); }
.field-error { margin: 2px 0 0; font-size: 11px; color: #f87171; }
.mono { font-family: "SFMono-Regular", Consolas, monospace; }
.pdxp-preview { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; padding: 8px 10px; background: var(--ui-bg-muted); border-radius: var(--ui-radius); font-size: 12px; color: var(--ui-text); }
.pdxp-preview .danger { color: #f87171; }

.detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 20px; margin: 0 0 16px; }
.detail-grid dt { font-size: 11px; color: var(--ui-text-muted); }
.detail-grid dd { margin: 2px 0 0; font-size: 13px; color: var(--ui-text); }

.snapshot-row td { background: var(--ui-bg-muted); }
.snapshot-pre { margin: 0; padding: 10px; font-size: 11px; max-height: 260px; overflow: auto; white-space: pre-wrap; word-break: break-all; }

.primary-button { background: var(--ui-primary); color: white; }
.primary-button.danger { background: #ef4444; }
.outline-button { border: 1px solid var(--ui-border); background: transparent; color: var(--ui-text); }
.outline-button.small, .primary-button.small { font-size: 11px; padding: 2px 8px; }
.icon-button { border: none; background: transparent; color: var(--ui-text-muted); cursor: pointer; }

@media (max-width: 900px) {
  .form-grid { grid-template-columns: 1fr; }
  .form-dialog, .drawer-panel, .drawer-panel.wide { width: 100%; }
  /* 窄屏放不下 340px 固定侧栏，改回上下堆叠。 */
  .simulator-page { height: auto; }
  .content-row { flex-direction: column; height: auto; }
  .filter-panel, .table-panel { width: 100%; height: auto; }
  .table-wrap { max-height: 60vh; }
}
</style>
