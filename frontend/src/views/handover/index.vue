<template>
  <section class="page" data-module="handover">
    <header class="page-head">
      <div>
        <h2>交接班管理</h2>
        <p class="page-desc">当班未结的告警、巡视、消缺逐条记成账：交班人提交，接班人签收后才算移交到手。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">刷新</button>
      </div>
    </header>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>当前值班人</span>
        <select v-model="currentOperator">
          <option v-for="name in roster" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>当前班次</span>
        <select v-model="currentShift">
          <option v-for="shift in shifts" :key="shift" :value="shift">{{ shift }}</option>
        </select>
      </label>
    </form>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待签收批次</span>
        <strong class="stat-value">{{ pendingBatches.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待我签收事项</span>
        <strong class="stat-value">{{ itemsWaitingForMe }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">我的值班清单未结</span>
        <strong class="stat-value">{{ openTodos.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">上次对账校正</span>
        <strong class="stat-value">{{ reconcileInfo.corrections }}</strong>
      </article>
    </div>

    <h3 class="section-title">交班：挑未结事项提交</h3>
    <p class="section-desc">从告警、巡视、消缺里挑当班没结的，逐条写明卡在哪一步，一次可提交多条；同一班次重复提交只认第一次。</p>
    <table class="data-table">
      <thead>
        <tr>
          <th>挑选</th>
          <th>模块</th>
          <th>编号</th>
          <th>当前状态</th>
          <th>卡在哪一步（必填）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in candidates" :key="`${item.moduleKey}:${item.rowId}`">
          <td>
            <input v-model="picked" type="checkbox" :value="`${item.moduleKey}:${item.rowId}`" />
          </td>
          <td>{{ item.moduleName }}</td>
          <td>{{ item.code }}</td>
          <td>{{ item.status }}</td>
          <td>
            <input
              v-model="notes[`${item.moduleKey}:${item.rowId}`]"
              class="note-input"
              placeholder="例：已联系厂家，等备件到场"
            />
          </td>
        </tr>
        <tr v-if="!candidates.length">
          <td colspan="5" class="empty-state">当前没有可交接的未结事项</td>
        </tr>
      </tbody>
    </table>
    <div class="submit-bar">
      <label class="filter-item">
        <span>接班人</span>
        <select v-model="operatorIn">
          <option value="">请选择接班人</option>
          <option v-for="name in handoverTargets" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
      <span class="shift-hint">{{ store.shiftLabel }} → {{ nextShift }}</span>
      <button class="btn primary" type="button" @click="submit">提交交接班（{{ picked.length }} 条）</button>
    </div>

    <h3 class="section-title">交接批次</h3>
    <p class="section-desc">签收前交班人任何改动都会整组退回；签收可以逐条来，打断后从最后一条已签收的接着交。</p>
    <table class="data-table">
      <thead>
        <tr>
          <th>批次</th>
          <th>交班人 → 接班人</th>
          <th>班次</th>
          <th>提交时间</th>
          <th>状态</th>
          <th>签收进度</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="batch in batches" :key="batch.id">
          <tr>
            <td>{{ batch.id }}</td>
            <td>{{ batch.operatorOut }} → {{ batch.operatorIn }}</td>
            <td>{{ batch.shiftFrom }} → {{ batch.shiftTo }}</td>
            <td>{{ batch.createdAt }}</td>
            <td>
              <span class="tag" :class="batchStatusClass(batch.status)">{{ batch.status }}</span>
            </td>
            <td>{{ signedCount(batch) }}/{{ batch.items.length }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="toggleExpand(batch.id)">
                {{ expanded.has(batch.id) ? '收起' : '展开' }}
              </button>
              <button
                v-if="batch.status === '待签收' && batch.operatorOut === store.operator"
                class="link danger"
                type="button"
                @click="amend(batch.id)"
              >
                改动（整组退回）
              </button>
            </td>
          </tr>
          <tr v-if="expanded.has(batch.id)">
            <td colspan="7" class="batch-detail">
              <table class="data-table inner-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>模块</th>
                    <th>编号</th>
                    <th>卡在哪一步</th>
                    <th>事项状态</th>
                    <th>签收</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in batch.items"
                    :key="item.id"
                    :class="{ 'next-sign': isNextToSign(batch, item.id) }"
                  >
                    <td>{{ item.id }}</td>
                    <td>{{ moduleLabel(item.moduleKey) }}</td>
                    <td>{{ item.code }}</td>
                    <td>{{ item.note }}</td>
                    <td>
                      <span v-if="item.status === '已签收'">已签收 · {{ item.signedBy }} · {{ item.signedAt }}</span>
                      <span v-else-if="batch.status === '已退回'" class="muted">已退回 · 不进值班清单</span>
                      <span v-else class="muted">未签收 · 签收后才进值班清单</span>
                    </td>
                    <td>
                      <button
                        v-if="batch.status === '待签收' && item.status === '待签收'"
                        class="link"
                        type="button"
                        @click="sign(batch.id, item.id)"
                      >
                        签收
                      </button>
                      <span v-else>—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-if="batch.status === '待签收' && nextItemId(batch)" class="resume-hint">
                已签收 {{ signedCount(batch) }} 条，从第 {{ nextItemId(batch) }} 条接着交。
              </p>
            </td>
          </tr>
        </template>
        <tr v-if="!batches.length">
          <td colspan="7" class="empty-state">还没有交接班记录</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">接班值班清单（{{ store.operator }} 的待办）</h3>
    <p class="section-desc">只有签收过的事项才会落到这里；事项仍在各自模块里办结，这里跟着模块口径走。</p>
    <table class="data-table">
      <thead>
        <tr>
          <th>模块</th>
          <th>编号</th>
          <th>交班人留言</th>
          <th>来自批次</th>
          <th>签收时间</th>
          <th>是否未结</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="todo in todos" :key="todo.id" :class="{ 'todo-done': !todo.open }">
          <td>{{ todo.moduleName }}</td>
          <td>{{ todo.code }}</td>
          <td>{{ todo.note }}</td>
          <td>{{ todo.batchId }}</td>
          <td>{{ todo.signedAt }}</td>
          <td>
            <span v-if="todo.open">未结</span>
            <span v-else class="muted">已了结（模块口径）</span>
            <span v-if="todo.drift" class="tag warn">账面待对账</span>
          </td>
        </tr>
        <tr v-if="!todos.length">
          <td colspan="6" class="empty-state">暂无待办，签收交接事项后会出现在这里</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">对账</h3>
    <p class="section-desc">移交中的事项，模块台账与交接台账各读一次未结条数，两边要能对上；口径不一致时以业务模块台账为准。</p>
    <div class="page-actions reconcile-bar">
      <button class="btn" type="button" @click="runReconcile">重新对账</button>
      <span v-if="reconcileInfo.at" class="muted">上次对账：{{ reconcileInfo.at }}，校正 {{ reconcileInfo.corrections }} 条</span>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>模块</th>
          <th>模块台账未结</th>
          <th>交接台账未结</th>
          <th>本次校正</th>
          <th>结论</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in reconcileRows" :key="row.moduleKey">
          <td>{{ row.name }}</td>
          <td>{{ row.moduleOpen }}</td>
          <td>{{ row.ledgerOpen }}</td>
          <td>{{ row.corrections }}</td>
          <td>
            <span v-if="row.consistent" class="tag ok">一致</span>
            <span v-else class="tag warn">不一致，已按模块口径校正</span>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ batches.length }} 个交接批次</span>
      <span v-if="message" class="ok-text">{{ message }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  SHIFTS,
  SHIFT_ROSTER,
  lastReconcileInfo,
  listBatches,
  listHandoverCandidates,
  listTodosFor,
  reconcile,
  requestBatchChange,
  signItem,
  submitHandover,
} from '@/api/handover-service'
import type { HandoverCandidate, TodoView } from '@/api/handover-service'
import { MODULE_BY_KEY } from '@/data/modules'
import type { HandoverBatch, ReconcileRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const roster = SHIFT_ROSTER
const shifts = SHIFTS

const candidates = ref<HandoverCandidate[]>([])
const batches = ref<HandoverBatch[]>([])
const todos = ref<TodoView[]>([])
const reconcileRows = ref<ReconcileRow[]>([])
const reconcileInfo = ref<{ at: string; corrections: number }>({ at: '', corrections: 0 })

const picked = ref<string[]>([])
const notes = ref<Record<string, string>>({})
const operatorIn = ref('')
const expanded = ref<Set<string>>(new Set())
const message = ref('')
const errorMessage = ref('')

const currentOperator = computed({
  get: () => store.operator,
  set: (name: string) => store.setOperator(name),
})
const currentShift = computed({
  get: () => store.shiftLabel,
  set: (label: string) => store.setShift(label),
})
const nextShift = computed(() => shifts.find((shift) => shift !== store.shiftLabel) ?? shifts[0])
const handoverTargets = computed(() => roster.filter((name) => name !== store.operator))
const pendingBatches = computed(() => batches.value.filter((batch) => batch.status === '待签收'))
const itemsWaitingForMe = computed(
  () =>
    pendingBatches.value
      .filter((batch) => batch.operatorIn === store.operator)
      .reduce((sum, batch) => sum + batch.items.filter((item) => item.status === '待签收').length, 0),
)
const openTodos = computed(() => todos.value.filter((todo) => todo.open))

function moduleLabel(key: string): string {
  return MODULE_BY_KEY.get(key)?.name ?? key
}

function signedCount(batch: HandoverBatch): number {
  return batch.items.filter((item) => item.status === '已签收').length
}

function nextItemId(batch: HandoverBatch): number | null {
  const next = batch.items.find((item) => item.status === '待签收')
  return next ? next.id : null
}

function isNextToSign(batch: HandoverBatch, itemId: number): boolean {
  return batch.status === '待签收' && nextItemId(batch) === itemId
}

function batchStatusClass(status: HandoverBatch['status']): string {
  if (status === '已签收') return 'ok'
  if (status === '已退回') return 'warn'
  return ''
}

function toggleExpand(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  expanded.value = next
}

function show(result: { ok: boolean; message: string }) {
  if (result.ok) {
    message.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    message.value = ''
  }
}

function submit() {
  const items = picked.value.map((key) => {
    const [moduleKey, rowId] = key.split(':')
    return { moduleKey, rowId: Number(rowId), note: notes.value[key] ?? '' }
  })
  const result = submitHandover({
    operatorOut: store.operator,
    operatorIn: operatorIn.value,
    shiftFrom: store.shiftLabel,
    shiftTo: nextShift.value,
    items,
  })
  show(result)
  if (result.ok) {
    picked.value = []
    notes.value = {}
    operatorIn.value = ''
  }
  reload()
}

function sign(batchId: string, itemId: number) {
  show(signItem(batchId, itemId, store.operator))
  reload()
}

function amend(batchId: string) {
  show(requestBatchChange(batchId, store.operator))
  reload()
}

function runReconcile() {
  reconcileRows.value = reconcile()
  reconcileInfo.value = lastReconcileInfo()
  todos.value = listTodosFor(store.operator)
  message.value = '对账完成，未结条数以业务模块台账为准'
  errorMessage.value = ''
}

function reload() {
  candidates.value = listHandoverCandidates()
  batches.value = listBatches()
  todos.value = listTodosFor(store.operator)
  reconcileInfo.value = lastReconcileInfo()
}

onMounted(() => {
  // 进页面先对一次账：台账账面与模块口径有出入的，按模块口径校正后再展示。
  reconcileRows.value = reconcile()
  reconcileInfo.value = lastReconcileInfo()
  reload()
})
</script>

<style scoped>
.section-title {
  margin: 18px 0 6px;
  font-size: 15px;
}
.section-desc {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--muted);
}
.note-input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
}
.submit-bar {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  margin: 10px 0 4px;
}
.shift-hint {
  font-size: 12px;
  color: var(--muted);
}
.tag {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 12px;
  background: #eef2f7;
}
.tag.ok {
  background: #e7f6ec;
  color: #18794e;
}
.tag.warn {
  background: #fdf0e5;
  color: #b42318;
}
.muted {
  color: var(--muted);
}
.batch-detail {
  background: #f8fafc;
}
.inner-table th,
.inner-table td {
  font-size: 12px;
}
.next-sign td {
  background: #fff8e6;
}
.resume-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.todo-done td {
  color: var(--muted);
}
.link.danger {
  color: #b42318;
}
.reconcile-bar {
  margin: 0 0 8px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.ok-text {
  color: #18794e;
}
select {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  background: #fff;
}
</style>
