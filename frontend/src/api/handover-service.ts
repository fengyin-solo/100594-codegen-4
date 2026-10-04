import {
  HANDOVER_MODULES,
  HANDOVER_MODULE_MAP,
  type CandidateRow,
  type HandoverDraftItem,
  type HandoverGroup,
  type HandoverItem,
  type HandoverModuleConfig,
  type HandoverModuleKey,
  type HandoverMutationResult,
  type HandoverTodoRow,
  type ModuleReconcile,
  type SubmitHandoverInput,
} from '@/data/handover'
import { handoverState, resetHandover, saveHandover } from '@/data/handover-store'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const ACTIVE_STATUSES = ['待签收', '签收中'] as const
const LIVE_STATUSES = ['待签收', '签收中', '已完成'] as const

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

export function handoverConfig(key: string): HandoverModuleConfig {
  const config = HANDOVER_MODULE_MAP.get(key)
  if (!config) {
    throw new Error(`模块「${key}」不参与交接班`)
  }
  return config
}

/** 这条业务记录现在还算不算未结：只看业务模块的实时状态。 */
export function isRowOpen(key: HandoverModuleKey, row: EntryRow): boolean {
  return !handoverConfig(key).closedStatuses.includes(String(row.status))
}

/** 模块的实时未结清单。模块页未结徽章与交接账本都从这里取数，口径只有一份。 */
export function openEntries(key: HandoverModuleKey): EntryRow[] {
  return listRows(key).filter((row) => isRowOpen(key, row))
}

function findSourceRow(item: HandoverItem): EntryRow | null {
  return listRows(item.sourceKey).find((row) => Number(row.id) === item.sourceId) ?? null
}

/** 事项在源模块里是否还活着；找不到源单也算已结（删了/重置了都不再跟）。 */
export function itemLiveOpen(item: HandoverItem): boolean {
  const row = findSourceRow(item)
  return row !== null && isRowOpen(item.sourceKey, row)
}

function itemLiveStatus(item: HandoverItem): string {
  const row = findSourceRow(item)
  return row ? String(row.status) : '源单不存在'
}

export function listGroups(): HandoverGroup[] {
  return handoverState().groups
}

/** 当前在途批次：只有这一批；有它在，交班人重复提交一律不认。 */
export function activeGroup(): HandoverGroup | null {
  return listGroups().find((group) => ACTIVE_STATUSES.includes(group.status as (typeof ACTIVE_STATUSES)[number])) ?? null
}

function linkedGroups(): HandoverGroup[] {
  return listGroups().filter((group) =>
    LIVE_STATUSES.includes(group.status as (typeof LIVE_STATUSES)[number]),
  )
}

/** 待挑进交接的未结事项：模块实时未结，扣掉已经在有效批次里挂过账的。 */
export function listCandidates(): CandidateRow[] {
  const linkedKeys = new Set(
    linkedGroups().flatMap((group) => group.items.map((item) => `${item.sourceKey}:${item.sourceId}`)),
  )
  const candidates: CandidateRow[] = []
  for (const config of HANDOVER_MODULES) {
    for (const row of openEntries(config.key)) {
      const refKey = `${config.key}:${row.id}`
      if (linkedKeys.has(refKey)) {
        continue
      }
      candidates.push({
        sourceKey: config.key,
        sourceId: Number(row.id),
        label: String(row[config.labelField] ?? row.id),
        desc: String(row[config.descField] ?? ''),
        status: String(row.status),
        row,
      })
    }
  }
  return candidates
}

export function submitHandover(input: SubmitHandoverInput): HandoverMutationResult {
  const current = activeGroup()
  if (current) {
    return {
      ok: false,
      groupId: current.id,
      message: `本班组已有交接批次 #${current.id}（${current.status}）未完成，重复提交只认第一次；签收前要改只能整组退回后重新提交。`,
    }
  }
  if (!input.fromShift.trim() || !input.toShift.trim()) {
    return { ok: false, message: '请填齐交班班次和接班班次' }
  }
  if (!input.fromOperator.trim() || !input.toOperator.trim()) {
    return { ok: false, message: '请填齐交班人和接班人，没人签收的交接不算交接' }
  }
  if (input.items.length === 0) {
    return { ok: false, message: '至少勾选一条未结事项再提交，空账不能交接' }
  }
  const seen = new Set<string>()
  for (const draft of input.items) {
    const refKey = `${draft.sourceKey}:${draft.sourceId}`
    if (seen.has(refKey)) {
      return { ok: false, message: '同一条事项被挑了两次，请合并成一条' }
    }
    seen.add(refKey)
    if (!draft.blockStep.trim()) {
      const config = handoverConfig(draft.sourceKey)
      return { ok: false, message: `${config.name}#${draft.sourceId} 没写「卡在哪一步」，接班人没法接手` }
    }
    const row = listRows(draft.sourceKey).find((entry) => Number(entry.id) === draft.sourceId)
    if (!row) {
      return { ok: false, message: `${refKey} 在业务模块里找不到，可能已被删除` }
    }
    if (!isRowOpen(draft.sourceKey, row)) {
      return { ok: false, message: `${refKey} 已经办结，不该再进交接账` }
    }
  }

  const state = handoverState()
  const groupId = state.groupSeq + 1
  const createdAt = nowText()
  const items: HandoverItem[] = input.items.map((draft: HandoverDraftItem) => {
    const config = handoverConfig(draft.sourceKey)
    const row = listRows(draft.sourceKey).find((entry) => Number(entry.id) === draft.sourceId) as EntryRow
    state.itemSeq += 1
    return {
      id: state.itemSeq,
      groupId,
      sourceKey: draft.sourceKey,
      sourceId: draft.sourceId,
      sourceLabel: String(row[config.labelField] ?? draft.sourceId),
      sourceStatus: String(row.status),
      blockStep: draft.blockStep.trim(),
      signed: false,
      signedAt: null,
    }
  })
  const group: HandoverGroup = {
    id: groupId,
    createdAt,
    fromShift: input.fromShift.trim(),
    toShift: input.toShift.trim(),
    fromOperator: input.fromOperator.trim(),
    toOperator: input.toOperator.trim(),
    note: input.note.trim(),
    status: '待签收',
    items,
    returnedAt: null,
    returnReason: '',
  }
  saveHandover({
    ...state,
    groupSeq: groupId,
    groups: [...state.groups, group],
  })
  return { ok: true, groupId, message: `批次 #${groupId} 已提交，共 ${items.length} 条，等待接班人签收` }
}

/** 签收完成判定：每条要么已签收，要么源单在模块里已办结（自动核销）。 */
function groupComplete(group: HandoverGroup): boolean {
  return group.items.every((item) => item.signed || !itemLiveOpen(item))
}

function persistGroup(group: HandoverGroup): void {
  const state = handoverState()
  const next = state.groups.map((entry) => (entry.id === group.id ? group : entry))
  saveHandover({ ...state, groups: next })
}

export function signItem(groupId: number, itemId: number): HandoverMutationResult {
  const group = listGroups().find((entry) => entry.id === groupId)
  if (!group) {
    return { ok: false, message: `找不到批次 #${groupId}` }
  }
  if (!ACTIVE_STATUSES.includes(group.status as (typeof ACTIVE_STATUSES)[number])) {
    return { ok: false, message: `批次 #${groupId} 已是「${group.status}」，不能再签收` }
  }
  const item = group.items.find((entry) => entry.id === itemId)
  if (!item) {
    return { ok: false, message: '批次里找不到这条交接事项' }
  }
  if (item.signed) {
    return { ok: false, message: '该事项已签收，不用重复签收' }
  }
  if (!itemLiveOpen(item)) {
    return { ok: false, message: '该事项已在业务模块办结，系统自动核销，无需签收' }
  }
  const next: HandoverGroup = {
    ...group,
    status: group.status === '待签收' ? '签收中' : group.status,
    items: group.items.map((entry) =>
      entry.id === itemId ? { ...entry, signed: true, signedAt: nowText() } : entry,
    ),
  }
  if (groupComplete(next)) {
    next.status = '已完成'
  }
  persistGroup(next)
  return { ok: true, groupId, message: next.status === '已完成'
    ? `批次 #${groupId} 全部签收完成，事项已落到接班人「${next.toOperator}」待办`
    : '签收成功，已进入接班人待办清单' }
}

export function signAllItems(groupId: number): HandoverMutationResult {
  const group = listGroups().find((entry) => entry.id === groupId)
  if (!group) {
    return { ok: false, message: `找不到批次 #${groupId}` }
  }
  if (!ACTIVE_STATUSES.includes(group.status as (typeof ACTIVE_STATUSES)[number])) {
    return { ok: false, message: `批次 #${groupId} 已是「${group.status}」，不能再签收` }
  }
  let signedCount = 0
  let closedCount = 0
  const next: HandoverGroup = {
    ...group,
    status: '签收中',
    items: group.items.map((item) => {
      if (item.signed) {
        return item
      }
      if (!itemLiveOpen(item)) {
        closedCount += 1
        return item
      }
      signedCount += 1
      return { ...item, signed: true, signedAt: nowText() }
    }),
  }
  if (groupComplete(next)) {
    next.status = '已完成'
  }
  persistGroup(next)
  return {
    ok: true,
    groupId,
    message: `本批签收 ${signedCount} 条${closedCount ? `，源单已办结自动核销 ${closedCount} 条` : ''}${
      next.status === '已完成' ? '，批次签收完成' : ''
    }`,
  }
}

/** 签收前批量改动：只允许整组退回；签收一旦开始（签收中）就不能退。 */
export function returnGroup(groupId: number, reason: string): HandoverMutationResult {
  const group = listGroups().find((entry) => entry.id === groupId)
  if (!group) {
    return { ok: false, message: `找不到批次 #${groupId}` }
  }
  if (group.status !== '待签收') {
    return { ok: false, message: `批次 #${groupId} 已是「${group.status}」，签收开始后不能整组退回` }
  }
  if (!reason.trim()) {
    return { ok: false, message: '退回要写明原因，交班人才知道改什么' }
  }
  const next: HandoverGroup = {
    ...group,
    status: '已退回',
    returnedAt: nowText(),
    returnReason: reason.trim(),
  }
  persistGroup(next)
  return { ok: true, groupId, message: `批次 #${groupId} 已整组退回，事项重新回到可挑选列表` }
}

/** 接班人待办：只认已签收、且源单仍未结的；没签收的一律不许进来。 */
export function listTodos(): HandoverTodoRow[] {
  const todos: HandoverTodoRow[] = []
  for (const group of linkedGroups()) {
    for (const item of group.items) {
      if (!item.signed || !itemLiveOpen(item)) {
        continue
      }
      todos.push({
        item,
        group,
        sourceLabel: item.sourceLabel,
        liveStatus: itemLiveStatus(item),
      })
    }
  }
  return todos.reverse()
}

/**
 * 交班被打断后从哪里接着交：批次里第一条「未签收且仍未结」的事项。
 * 已签收的不动，源单已办结的自动跳过。
 */
export function resumeItemId(group: HandoverGroup): number | null {
  const next = group.items.find((item) => !item.signed && itemLiveOpen(item))
  return next ? next.id : null
}

export function liveItemStatus(item: HandoverItem): string {
  return itemLiveStatus(item)
}

/** 模块实时未结数：模块页与交接页共用的那份口径。 */
export function moduleOpenCount(key: HandoverModuleKey): number {
  return openEntries(key).length
}

export function reconcile(): ModuleReconcile[] {
  return HANDOVER_MODULES.map((config) => {
    const linked = linkedGroups().flatMap((group) =>
      group.items.filter((item) => item.sourceKey === config.key),
    )
    const ledgerOpen = linked.filter((item) => itemLiveOpen(item)).length
    const pendingSign = linked.filter((item) => !item.signed && itemLiveOpen(item)).length
    const todo = linked.filter((item) => item.signed && itemLiveOpen(item)).length
    return {
      key: config.key,
      name: config.name,
      moduleOpen: openEntries(config.key).length,
      ledgerLinked: linked.length,
      ledgerOpen,
      autoClosed: linked.length - ledgerOpen,
      pendingSign,
      todo,
      notLinked: openEntries(config.key).length - pendingSign - todo,
    }
  })
}

export function resetHandoverLedger(): void {
  resetHandover()
}
