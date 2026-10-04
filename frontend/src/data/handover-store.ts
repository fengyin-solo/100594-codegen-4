import type { HandoverGroup } from './handover'

// 交接班账本单独存一份 localStorage，与业务记录互不干扰。
const STORAGE_KEY = 'pv-plant-ops:handover'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type HandoverState = {
  groups: HandoverGroup[]
  groupSeq: number
  itemSeq: number
}

const EMPTY: HandoverState = { groups: [], groupSeq: 0, itemSeq: 0 }

function readState(): HandoverState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(EMPTY)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return clone(EMPTY)
  }
  try {
    const parsed = JSON.parse(raw) as HandoverState
    return {
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      groupSeq: Number(parsed.groupSeq) || 0,
      itemSeq: Number(parsed.itemSeq) || 0,
    }
  } catch {
    return clone(EMPTY)
  }
}

let cache: HandoverState | null = null

export function handoverState(): HandoverState {
  if (cache === null) {
    cache = readState()
  }
  return cache
}

export function saveHandover(next: HandoverState): void {
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetHandover(): void {
  saveHandover(clone(EMPTY))
}
