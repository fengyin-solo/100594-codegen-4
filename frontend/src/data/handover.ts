/** 交接班账本的类型与口径配置。 */
import type { EntryRow } from './types'

/** 纳入交接班的三个业务模块：告警、巡视、消缺。 */
export type HandoverModuleKey = 'alarm' | 'patrol' | 'defect'

export const HANDOVER_MODULE_KEYS: HandoverModuleKey[] = ['alarm', 'patrol', 'defect']

/**
 * 每个模块的「未结」口径在这里定死，模块页与交接账本共用，
 * 两处读到的未结条数天然一致；出现分歧时以业务模块的实时状态为准。
 */
export type HandoverModuleConfig = {
  key: HandoverModuleKey
  name: string
  /** 单号字段，交接事项里展示用 */
  labelField: string
  /** 辅助描述字段 */
  descField: string
  /** 终态：落到这些状态就算这条活已经结掉，不再算未结 */
  closedStatuses: string[]
}

export const HANDOVER_MODULES: HandoverModuleConfig[] = [
  {
    key: 'alarm',
    name: '告警事件',
    labelField: '告警编号',
    descField: '关联设备',
    // 已恢复、已转缺陷都是闭环：告警本身不用再盯了
    closedStatuses: ['已恢复', '已转缺陷'],
  },
  {
    key: 'patrol',
    name: '巡视检查',
    labelField: '巡视单号',
    descField: '巡视路线',
    closedStatuses: ['已完成'],
  },
  {
    key: 'defect',
    name: '缺陷消缺',
    labelField: '缺陷编号',
    descField: '责任班组',
    closedStatuses: ['已闭环'],
  },
]

export const HANDOVER_MODULE_MAP: Map<string, HandoverModuleConfig> = new Map(
  HANDOVER_MODULES.map((item) => [item.key, item]),
)

/** 批次状态：待签收 →（签收第一条）签收中 →（有效项全部签收）已完成；签收前可整组退回。 */
export type HandoverGroupStatus = '待签收' | '签收中' | '已完成' | '已退回'

export type HandoverItem = {
  id: number
  groupId: number
  sourceKey: HandoverModuleKey
  sourceId: number
  /** 提交时的单号，留个快照，模块里单号被改了也认得出来 */
  sourceLabel: string
  /** 提交时的状态快照，仅作对照；有效状态一律实时回读业务模块 */
  sourceStatus: string
  /** 交班人写的「现在卡在哪一步」 */
  blockStep: string
  signed: boolean
  signedAt: string | null
}

export type HandoverGroup = {
  id: number
  createdAt: string
  fromShift: string
  toShift: string
  fromOperator: string
  toOperator: string
  note: string
  status: HandoverGroupStatus
  items: HandoverItem[]
  returnedAt: string | null
  returnReason: string
}

export type HandoverDraftItem = {
  sourceKey: HandoverModuleKey
  sourceId: number
  blockStep: string
}

export type SubmitHandoverInput = {
  fromShift: string
  fromOperator: string
  toShift: string
  toOperator: string
  note: string
  items: HandoverDraftItem[]
}

export type HandoverMutationResult = {
  ok: boolean
  message: string
  groupId?: number
}

export type CandidateRow = {
  sourceKey: HandoverModuleKey
  sourceId: number
  label: string
  desc: string
  status: string
  row: EntryRow
}

/** 接班人待办清单里的一行：签收结果落在这里。 */
export type HandoverTodoRow = {
  item: HandoverItem
  group: HandoverGroup
  sourceLabel: string
  liveStatus: string
}

/** 对账结果：模块实时未结 vs 账本在跟条数。 */
export type ModuleReconcile = {
  key: HandoverModuleKey
  name: string
  /** 业务模块实时未结（模块页读到的就是这个数，以此为准） */
  moduleOpen: number
  /** 账本里在跟的事项数（不含已退回批次） */
  ledgerLinked: number
  /** 在跟事项中源单仍未结的条数 */
  ledgerOpen: number
  /** 在跟事项中源单已在模块办结、被自动核销的条数 */
  autoClosed: number
  /** 还没签收、且仍未结的条数 */
  pendingSign: number
  /** 已签收、仍未结 → 接班人待办条数 */
  todo: number
  /** 模块实时未结、但还没挑进任何交接批次的条数 */
  notLinked: number
}
