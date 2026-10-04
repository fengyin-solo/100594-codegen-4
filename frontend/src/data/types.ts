/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// ---- 交接班：把当班未结的告警、巡视、消缺记成一笔账 ----

/** 交接事项：从业务模块挑出来的一条未结记录，签收前不算移交。 */
export type HandoverItem = {
  id: number
  moduleKey: string
  rowId: number
  code: string
  /** 交班人写明现在卡在哪一步 */
  note: string
  status: '待签收' | '已签收'
  signedBy: string
  signedAt: string
}

/** 一组交接事项：一次提交多条，整组同进退。 */
export type HandoverBatch = {
  id: string
  /** 幂等键：同一交班人同一班次重复提交只认第一次 */
  idemKey: string
  shiftFrom: string
  shiftTo: string
  operatorOut: string
  operatorIn: string
  createdAt: string
  status: '待签收' | '已签收' | '已退回'
  returnedAt: string
  completedAt: string
  items: HandoverItem[]
}

/** 接班人待办（值班清单）：只有签收过的事项才会落进来。 */
export type TodoEntry = {
  id: string
  owner: string
  moduleKey: string
  rowId: number
  code: string
  note: string
  batchId: string
  signedAt: string
  /** 台账自己记的账；与模块口径不一致时以模块为准校正 */
  done: boolean
}

export type HandoverState = {
  batches: HandoverBatch[]
  todos: TodoEntry[]
  lastReconcileAt: string
  lastReconcileCorrections: number
}

/** 对账结果：同一批移交事项，模块口径与台账口径各读一次未结条数。 */
export type ReconcileRow = {
  moduleKey: string
  name: string
  moduleOpen: number
  ledgerOpen: number
  corrections: number
  consistent: boolean
}
