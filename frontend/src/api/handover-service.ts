import { handoverState, saveHandoverState } from '@/data/handover-store'
import { listRows } from '@/data/local-store'
import { isTerminalStatus } from '@/api/local-service'
import { MODULE_BY_KEY } from '@/data/modules'
import type {
  ActionResult,
  EntryRow,
  HandoverBatch,
  HandoverItem,
  ReconcileRow,
  TodoEntry,
} from '@/data/types'

// 交接班只挑这三类未结事项：告警、巡视、消缺。
export const HANDOVER_MODULES = ['alarm', 'patrol', 'defect'] as const

export const SHIFTS = ['白班 08:00-20:00', '夜班 20:00-08:00']

// 演示用值班名册：交接班双方从这里挑人。
export const SHIFT_ROSTER = ['值班管理员', '张海', '李岚', '王铮']

export type HandoverCandidate = {
  moduleKey: string
  moduleName: string
  rowId: number
  code: string
  status: string
}

export type TodoView = TodoEntry & {
  moduleName: string
  /** 有效状态：直接读模块台账，模块说结了就是结了 */
  open: boolean
  /** 台账账面与模块口径对不上，等对账校正 */
  drift: boolean
}

function now(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function moduleName(key: string): string {
  return MODULE_BY_KEY.get(key)?.name ?? key
}

function rowCode(key: string, row: EntryRow): string {
  const meta = MODULE_BY_KEY.get(key)
  const codeField = meta?.fields[0] ?? 'id'
  return String(row[codeField] ?? row.id)
}

function findRow(moduleKey: string, rowId: number): EntryRow | undefined {
  return listRows(moduleKey).find((row) => Number(row.id) === rowId)
}

/** 未结口径：没到终态就算未结，候选挑选、待办、对账都按这一个口径。 */
function isRowOpen(moduleKey: string, row: EntryRow | undefined): boolean {
  return row !== undefined && !isTerminalStatus(moduleKey, String(row.status))
}

/** 可被挑进交接的事项：模块里还没结、且不在任何待签收批次里的记录。 */
export function listHandoverCandidates(): HandoverCandidate[] {
  const inFlight = new Set<string>()
  for (const batch of handoverState().batches) {
    if (batch.status !== '待签收') continue
    for (const item of batch.items) {
      inFlight.add(`${item.moduleKey}:${item.rowId}`)
    }
  }
  const candidates: HandoverCandidate[] = []
  for (const key of HANDOVER_MODULES) {
    for (const row of listRows(key)) {
      if (!isRowOpen(key, row)) continue
      if (inFlight.has(`${key}:${Number(row.id)}`)) continue
      candidates.push({
        moduleKey: key,
        moduleName: moduleName(key),
        rowId: Number(row.id),
        code: rowCode(key, row),
        status: String(row.status),
      })
    }
  }
  return candidates
}

export type SubmitInput = {
  operatorOut: string
  operatorIn: string
  shiftFrom: string
  shiftTo: string
  items: { moduleKey: string; rowId: number; note: string }[]
}

export type SubmitResult = ActionResult & { batch?: HandoverBatch }

/** 交班提交：一次多条；同一交班人同一班次重复提交只认第一次。 */
export function submitHandover(input: SubmitInput): SubmitResult {
  const operatorOut = input.operatorOut.trim()
  const operatorIn = input.operatorIn.trim()
  if (!operatorOut || !operatorIn) {
    return { ok: false, message: '交班人、接班人都要先指明' }
  }
  if (operatorOut === operatorIn) {
    return { ok: false, message: '交班人和接班人不能是同一个人' }
  }
  if (input.items.length === 0) {
    return { ok: false, message: '至少挑一条未结事项再提交' }
  }
  for (const item of input.items) {
    if (!item.note.trim()) {
      return { ok: false, message: '每条交接事项都要写明现在卡在哪一步' }
    }
  }

  const state = handoverState()
  const idemKey = `${operatorOut}@${input.shiftFrom}`
  const existing = state.batches.find((batch) => batch.idemKey === idemKey && batch.status !== '已退回')
  if (existing) {
    return {
      ok: false,
      message: `本班次已经提交过交接班（批次 ${existing.id}），重复提交只认第一次`,
      batch: existing,
    }
  }

  // 提交时再核一遍：挑出来的必须还是未结，中途被别人结了的不让进账。
  for (const item of input.items) {
    if (!isRowOpen(item.moduleKey, findRow(item.moduleKey, item.rowId))) {
      return { ok: false, message: `事项 ${item.moduleKey}#${item.rowId} 状态已变化，请重新挑选后再提交` }
    }
  }

  const seq = state.batches.length + 1
  const batch: HandoverBatch = {
    id: `HO-${String(seq).padStart(3, '0')}`,
    idemKey,
    shiftFrom: input.shiftFrom,
    shiftTo: input.shiftTo,
    operatorOut,
    operatorIn,
    createdAt: now(),
    status: '待签收',
    returnedAt: '',
    completedAt: '',
    items: input.items.map((item, index) => ({
      id: index + 1,
      moduleKey: item.moduleKey,
      rowId: item.rowId,
      code: rowCode(item.moduleKey, findRow(item.moduleKey, item.rowId) as EntryRow),
      note: item.note.trim(),
      status: '待签收',
      signedBy: '',
      signedAt: '',
    })),
  }
  saveHandoverState({ ...state, batches: [...state.batches, batch] })
  return { ok: true, message: `交接班已提交，共 ${batch.items.length} 条，等 ${operatorIn} 签收`, batch }
}

export function listBatches(): HandoverBatch[] {
  return [...handoverState().batches].sort((a, b) => b.id.localeCompare(a.id))
}

/** 接班人逐条签收：签一条落一条待办；打断后从未签收的接着来。 */
export function signItem(batchId: string, itemId: number, operator: string): ActionResult {
  const state = handoverState()
  const batch = state.batches.find((item) => item.id === batchId)
  if (!batch) {
    return { ok: false, message: `没有找到批次 ${batchId}` }
  }
  if (batch.status === '已退回') {
    return { ok: false, message: '本组交接已整组退回，不能再签收' }
  }
  if (batch.status === '已签收') {
    return { ok: false, message: '本组交接已全部签收完毕' }
  }
  if (batch.operatorIn !== operator) {
    return { ok: false, message: `这批交接指定由 ${batch.operatorIn} 签收，别人签不算数` }
  }
  const item = batch.items.find((entry) => entry.id === itemId)
  if (!item) {
    return { ok: false, message: `批次里没有第 ${itemId} 条事项` }
  }
  if (item.status === '已签收') {
    return { ok: false, message: '这条已经签收过了，接着签下一条' }
  }

  const signedAt = now()
  const nextItem: HandoverItem = { ...item, status: '已签收', signedBy: operator, signedAt }
  const items = batch.items.map((entry) => (entry.id === itemId ? nextItem : entry))
  const allSigned = items.every((entry) => entry.status === '已签收')
  const nextBatch: HandoverBatch = {
    ...batch,
    items,
    status: allSigned ? '已签收' : '待签收',
    completedAt: allSigned ? signedAt : '',
  }

  // 签收即落到接班人待办；待办编号按批次+事项生成，重复签收不会落两条。
  const todoId = `TD-${batch.id}-${item.id}`
  const todos = state.todos.some((todo) => todo.id === todoId)
    ? state.todos
    : [
        ...state.todos,
        {
          id: todoId,
          owner: operator,
          moduleKey: item.moduleKey,
          rowId: item.rowId,
          code: item.code,
          note: item.note,
          batchId: batch.id,
          signedAt,
          done: false,
        },
      ]

  const batches = state.batches.map((entry) => (entry.id === batchId ? nextBatch : entry))
  saveHandoverState({ ...state, batches, todos })

  const left = items.filter((entry) => entry.status === '待签收').length
  return {
    ok: true,
    message: allSigned
      ? `第 ${itemId} 条已签收，本组交接全部完成`
      : `第 ${itemId} 条已签收并进待办，还剩 ${left} 条，从第 ${items.find((entry) => entry.status === '待签收')?.id} 条接着交`,
  }
}

/** 签收前改动交接内容：不允许局部改，整组退回交班人重交。 */
export function requestBatchChange(batchId: string, operator: string): ActionResult {
  const state = handoverState()
  const batch = state.batches.find((item) => item.id === batchId)
  if (!batch) {
    return { ok: false, message: `没有找到批次 ${batchId}` }
  }
  if (batch.operatorOut !== operator) {
    return { ok: false, message: '只有交班人本人能改动这组交接' }
  }
  if (batch.status !== '待签收') {
    return { ok: false, message: '本组交接已完结，不能再改动' }
  }
  const returned: HandoverBatch = { ...batch, status: '已退回', returnedAt: now() }
  const batches = state.batches.map((entry) => (entry.id === batchId ? returned : entry))
  saveHandoverState({ ...state, batches })
  const signed = batch.items.filter((item) => item.status === '已签收').length
  return {
    ok: true,
    message: signed > 0
      ? `签收前改动，整组退回：${signed} 条已签收事项保持移交，其余退回交班人重交`
      : '签收前改动，整组退回交班人，未签收事项不进接班值班清单',
  }
}

/** 接班人待办（值班清单）：有效状态读模块台账，台账账面只做对账用。 */
export function listTodosFor(operator: string): TodoView[] {
  return handoverState()
    .todos.filter((todo) => todo.owner === operator)
    .map((todo) => {
      const open = isRowOpen(todo.moduleKey, findRow(todo.moduleKey, todo.rowId))
      return {
        ...todo,
        moduleName: moduleName(todo.moduleKey),
        open,
        drift: todo.done === open,
      }
    })
    .sort((a, b) => Number(b.open) - Number(a.open) || b.id.localeCompare(a.id))
}

/** 对账：同一批移交事项两边各读一次未结数；不一致时以业务模块台账为准校正。 */
export function reconcile(): ReconcileRow[] {
  const state = handoverState()
  const fixed = state.todos.map((todo) => {
    const done = !isRowOpen(todo.moduleKey, findRow(todo.moduleKey, todo.rowId))
    return todo.done === done ? todo : { ...todo, done }
  })
  const corrections = fixed.filter((todo, index) => todo !== state.todos[index]).length
  saveHandoverState({ ...state, todos: fixed, lastReconcileAt: now(), lastReconcileCorrections: corrections })

  return HANDOVER_MODULES.map((key) => {
    const moduleTodos = fixed.filter((todo) => todo.moduleKey === key)
    const moduleOpen = moduleTodos.filter((todo) =>
      isRowOpen(key, findRow(key, todo.rowId)),
    ).length
    const ledgerOpen = moduleTodos.filter((todo) => !todo.done).length
    const moduleCorrections = moduleTodos.filter(
      (todo) => state.todos.find((old) => old.id === todo.id)?.done !== todo.done,
    ).length
    return {
      moduleKey: key,
      name: moduleName(key),
      moduleOpen,
      ledgerOpen,
      corrections: moduleCorrections,
      consistent: moduleOpen === ledgerOpen,
    }
  })
}

export function lastReconcileInfo(): { at: string; corrections: number } {
  const state = handoverState()
  return { at: state.lastReconcileAt, corrections: state.lastReconcileCorrections }
}
