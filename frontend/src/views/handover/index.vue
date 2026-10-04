<template>
  <section ref="rootEl" class="page handover-page">
    <header class="page-head">
      <div>
        <h2>交接班账本</h2>
        <p class="page-desc">
          当班没结的告警、巡视、消缺逐条挑进交接账，写明卡在哪一步；接班人逐条签收后事项才进待办，没签收的不进下一班值班清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">刷新对账</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">业务模块实时未结（对账口径）</span>
        <strong class="stat-value">{{ summary.moduleOpen }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待签收事项</span>
        <strong class="stat-value">{{ summary.pendingSign }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">接班人待办（已签收未结）</span>
        <strong class="stat-value">{{ todos.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">在途交接批次</span>
        <strong class="stat-value">{{ active ? 1 : 0 }}</strong>
      </article>
    </div>

    <div class="handover-block">
      <h3 class="block-title">口径核对：两处未结条数必须对得上</h3>
      <p class="block-tip">
        交接页与告警、巡视、消缺模块页读的是同一份实时数据；条数对不上时
        <strong>以业务模块实时状态为准</strong>，源单一办结，账本条自动核销。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>业务模块</th>
            <th>模块实时未结</th>
            <th>账本在跟</th>
            <th>待签收</th>
            <th>已签收待办</th>
            <th>尚未挂账</th>
            <th>源单已结自动核销</th>
            <th>核对结果</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in reconciles" :key="row.key">
            <td>{{ row.name }}</td>
            <td>{{ row.moduleOpen }}</td>
            <td>{{ row.ledgerOpen }}</td>
            <td>{{ row.pendingSign }}</td>
            <td>{{ row.todo }}</td>
            <td>{{ row.notLinked }}</td>
            <td>{{ row.autoClosed }}</td>
            <td>
              <span :class="['badge', row.moduleOpen === row.pendingSign + row.todo + row.notLinked ? 'ok' : 'warn']">
                {{ row.moduleOpen }} = {{ row.pendingSign }} + {{ row.todo }} + {{ row.notLinked }}
                {{ row.moduleOpen === row.pendingSign + row.todo + row.notLinked ? '· 已对齐' : '· 以模块为准' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 在途批次：交班被打断时，回来从最后一条已签收事项的下一条接着交 -->
    <div v-if="active" class="handover-block">
      <h3 class="block-title">
        在途交接批次 #{{ active.id }}
        <span :class="['badge', groupBadgeClass(active.status)]">{{ active.status }}</span>
      </h3>
      <p class="block-tip">
        {{ active.fromShift }}（{{ active.fromOperator }}）→
        {{ active.toShift }}（{{ active.toOperator }}）· 提交于 {{ active.createdAt }}
        <template v-if="resumeId !== null">· 交班被打断，已定位到下一条待签收事项</template>
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>模块</th>
            <th>单号</th>
            <th>模块实时状态</th>
            <th>交班说明：卡在哪一步</th>
            <th>签收</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in active.items"
            :key="item.id"
            :data-item-id="item.id"
            :class="{ 'resume-row': item.id === resumeId, 'closed-row': !isLive(item) }"
          >
            <td>{{ moduleName(item.sourceKey) }}</td>
            <td>{{ item.sourceLabel }}</td>
            <td>{{ liveStatus(item) }}</td>
            <td>{{ item.blockStep }}</td>
            <td>
              <span v-if="item.signed" class="badge ok">已签收 · {{ item.signedAt }}</span>
              <span v-else-if="!isLive(item)" class="badge muted">源单已结 · 自动核销</span>
              <span v-else class="badge warn">待签收</span>
            </td>
            <td class="row-actions">
              <button
                v-if="!item.signed && isLive(item)"
                class="link"
                type="button"
                @click="signOne(item)"
              >
                {{ active.toOperator }} 签收
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="active.status === '待签收' || active.status === '签收中'" class="handover-actions">
        <button class="btn primary" type="button" @click="signAll">一键签收全部未结项</button>
        <button v-if="active.status === '待签收'" class="btn" type="button" @click="returning = !returning">
          整组退回（签收前唯一改动方式）
        </button>
        <div v-if="returning" class="return-box">
          <textarea v-model="returnReason" rows="2" placeholder="退回原因：例如巡视单号写错、有告警漏交……整组退回后事项回到可挑选列表"></textarea>
          <div class="row-actions">
            <button class="btn" type="button" @click="confirmReturn">确认整组退回</button>
            <button class="btn ghost" type="button" @click="returning = false">取消</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 没有在途批次时，交班人才可以挑事项、一次提交多条 -->
    <div v-else class="handover-block">
      <h3 class="block-title">交班登记：挑出当班未结事项（可跨模块一次提交多条）</h3>
      <div class="shift-bar">
        <label class="filter-item">
          <span>交班班次</span>
          <input v-model="form.fromShift" placeholder="如 白班 08:00-20:00" />
        </label>
        <label class="filter-item">
          <span>交班人</span>
          <input v-model="form.fromOperator" placeholder="交班人姓名" />
        </label>
        <label class="filter-item">
          <span>接班班次</span>
          <input v-model="form.toShift" placeholder="如 夜班 20:00-08:00" />
        </label>
        <label class="filter-item">
          <span>接班人</span>
          <input v-model="form.toOperator" placeholder="接班人姓名" />
        </label>
        <label class="filter-item filter-item-grow">
          <span>本班总体交代</span>
          <input v-model="form.note" placeholder="选填，如夜间注意组串区巡视" />
        </label>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th class="col-check">交接</th>
            <th>模块</th>
            <th>单号</th>
            <th>说明</th>
            <th>实时状态</th>
            <th class="col-step">现在卡在哪一步（必填）</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="candidate in candidates" :key="candidate.sourceKey + ':' + candidate.sourceId">
            <td>
              <input v-model="selected" type="checkbox" :value="refKey(candidate)" />
            </td>
            <td>{{ moduleName(candidate.sourceKey) }}</td>
            <td>{{ candidate.label }}</td>
            <td>{{ candidate.desc || '—' }}</td>
            <td>{{ candidate.status }}</td>
            <td>
              <input
                v-model="blockSteps[refKey(candidate)]"
                class="step-input"
                placeholder="如：告警已确认，等厂家远程指导复位"
              />
            </td>
          </tr>
          <tr v-if="!candidates.length">
            <td colspan="6" class="empty-state">三个模块当前没有可交接的未结事项（或都已挂在历史批次里）</td>
          </tr>
        </tbody>
      </table>
      <div class="handover-actions">
        <button class="btn primary" type="button" @click="submit">提交交接批次（{{ selected.length }} 条）</button>
        <span class="block-tip">重复提交只认第一次；签收前发现错误只能整组退回，不能在原批次上改。</span>
      </div>
    </div>

    <!-- 接班人待办清单：签收结果落在这里 -->
    <div class="handover-block">
      <h3 class="block-title">接班人待办清单 <span class="badge muted">仅已签收事项进入，共 {{ todos.length }} 条</span></h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>模块</th>
            <th>单号</th>
            <th>实时状态</th>
            <th>卡在哪一步</th>
            <th>来源批次</th>
            <th>接班人</th>
            <th>签收时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="todo in todos" :key="todo.item.id">
            <td>{{ moduleName(todo.item.sourceKey) }}</td>
            <td>{{ todo.sourceLabel }}</td>
            <td>{{ todo.liveStatus }}</td>
            <td>{{ todo.item.blockStep }}</td>
            <td>#{{ todo.group.id }}（{{ todo.group.fromOperator }} 交）</td>
            <td>{{ todo.group.toOperator }}</td>
            <td>{{ todo.item.signedAt }}</td>
          </tr>
          <tr v-if="!todos.length">
            <td colspan="7" class="empty-state">还没有已签收事项；没签收的事项不许进下一班值班清单</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="history.length" class="handover-block">
      <h3 class="block-title">历史批次（{{ history.length }}）</h3>
      <details v-for="group in history" :key="group.id" class="history-item">
        <summary>
          批次 #{{ group.id }}
          <span :class="['badge', groupBadgeClass(group.status)]">{{ group.status }}</span>
          <span class="history-meta">
            {{ group.fromShift }}（{{ group.fromOperator }}）→ {{ group.toShift }}（{{ group.toOperator }}）
            · {{ group.items.length }} 条 · {{ group.createdAt }}
          </span>
        </summary>
        <p v-if="group.returnReason" class="return-reason">退回原因（{{ group.returnedAt }}）：{{ group.returnReason }}</p>
        <ul class="history-items">
          <li v-for="item in group.items" :key="item.id">
            {{ moduleName(item.sourceKey) }} · {{ item.sourceLabel }}
            <span :class="['badge', item.signed ? 'ok' : 'muted']">{{ item.signed ? '已签收' : '未签收' }}</span>
            — {{ item.blockStep }}
          </li>
        </ul>
      </details>
    </div>

    <footer class="page-foot">
      <span>交接账与业务记录都保存在本机浏览器；模块办结后账本条自动核销，未结数以业务模块实时状态为准</span>
      <button class="link" type="button" @click="resetAll">清空交接账（演示用）</button>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="successMessage" class="ok-text">{{ successMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'

import {
  activeGroup,
  itemLiveOpen,
  listCandidates,
  listGroups,
  listTodos,
  liveItemStatus,
  reconcile,
  resetHandoverLedger,
  resumeItemId,
  returnGroup,
  signAllItems,
  signItem,
  submitHandover,
} from '@/api/handover-service'
import { HANDOVER_MODULE_MAP } from '@/data/handover'
import type { CandidateRow, HandoverGroup, HandoverItem, ModuleReconcile } from '@/data/handover'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()

function nextShiftLabel(label: string): string {
  if (label.includes('白班')) {
    return '夜班 20:00-08:00'
  }
  if (label.includes('夜班')) {
    return '白班 08:00-20:00'
  }
  return label
}

const form = reactive({
  fromShift: session.shiftLabel,
  fromOperator: session.operator,
  toShift: nextShiftLabel(session.shiftLabel),
  toOperator: '',
  note: '',
})

const candidates = ref<CandidateRow[]>([])
const selected = ref<string[]>([])
const blockSteps = reactive<Record<string, string>>({})
const current = ref<HandoverGroup | null>(null)
const todos = ref<ReturnType<typeof listTodos>>([])
const reconciles = ref<ModuleReconcile[]>([])
const resumeId = ref<number | null>(null)
const returning = ref(false)
const returnReason = ref('')
const errorMessage = ref('')
const successMessage = ref('')
const rootEl = ref<HTMLElement | null>(null)

const active = computed(() => current.value)
const history = computed(() =>
  listGroups()
    .filter((group) => group.status === '已完成' || group.status === '已退回')
    .slice()
    .reverse(),
)

const summary = computed(() => ({
  moduleOpen: reconciles.value.reduce((sum, row) => sum + row.moduleOpen, 0),
  pendingSign: reconciles.value.reduce((sum, row) => sum + row.pendingSign, 0),
}))

function moduleName(key: string): string {
  return HANDOVER_MODULE_MAP.get(key)?.name ?? key
}

function refKey(candidate: CandidateRow): string {
  return `${candidate.sourceKey}:${candidate.sourceId}`
}

function isLive(item: HandoverItem): boolean {
  return itemLiveOpen(item)
}

function liveStatus(item: HandoverItem): string {
  return liveItemStatus(item)
}

function groupBadgeClass(status: HandoverGroup['status']): string {
  if (status === '已完成') return 'ok'
  if (status === '已退回') return 'muted'
  return 'warn'
}

function flash(ok: boolean, message: string) {
  errorMessage.value = ok ? '' : message
  successMessage.value = ok ? message : ''
}

function reload() {
  candidates.value = listCandidates()
  current.value = activeGroup()
  todos.value = listTodos()
  reconciles.value = reconcile()
  resumeId.value = current.value ? resumeItemId(current.value) : null
  if (resumeId.value !== null) {
    nextTick(() => {
      rootEl.value
        ?.querySelector(`[data-item-id="${resumeId.value}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }
}

function submit() {
  const items = selected.value.map((ref) => {
    const [sourceKey, sourceIdText] = ref.split(':')
    return {
      sourceKey: sourceKey as CandidateRow['sourceKey'],
      sourceId: Number(sourceIdText),
      blockStep: blockSteps[ref] ?? '',
    }
  })
  const result = submitHandover({
    fromShift: form.fromShift,
    fromOperator: form.fromOperator,
    toShift: form.toShift,
    toOperator: form.toOperator,
    note: form.note,
    items,
  })
  flash(result.ok, result.message)
  if (result.ok) {
    selected.value = []
    form.note = ''
    reload()
  }
}

function signOne(item: HandoverItem) {
  if (!current.value) return
  const result = signItem(current.value.id, item.id)
  flash(result.ok, result.message)
  reload()
}

function signAll() {
  if (!current.value) return
  const result = signAllItems(current.value.id)
  flash(result.ok, result.message)
  reload()
}

function confirmReturn() {
  if (!current.value) return
  const result = returnGroup(current.value.id, returnReason.value)
  flash(result.ok, result.message)
  if (result.ok) {
    returning.value = false
    returnReason.value = ''
    reload()
  }
}

function resetAll() {
  resetHandoverLedger()
  returning.value = false
  returnReason.value = ''
  flash(true, '交接账已清空，回到演示初始状态')
  reload()
}

onMounted(reload)
</script>
