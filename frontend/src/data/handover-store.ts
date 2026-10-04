import type { HandoverState } from './types'

// 交接班台账单独存一份：与业务模块数据分开，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pv-plant-ops:handover'

function emptyState(): HandoverState {
  return { batches: [], todos: [], lastReconcileAt: '', lastReconcileCorrections: 0 }
}

function readStorage(): HandoverState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return emptyState()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return emptyState()
  }
  try {
    const parsed = JSON.parse(raw) as Partial<HandoverState>
    return { ...emptyState(), ...parsed }
  } catch {
    return emptyState()
  }
}

let cache: HandoverState | null = null

export function handoverState(): HandoverState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveHandoverState(state: HandoverState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}
