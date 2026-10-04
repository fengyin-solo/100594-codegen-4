<template>
  <div class="handover-strip">
    <span class="strip-title">交接口径</span>
    <span>本模块实时未结 <strong>{{ info.moduleOpen }}</strong> 条（与交接账本同源）</span>
    <span>待签收 <strong>{{ info.pendingSign }}</strong></span>
    <span>已签收待办 <strong>{{ info.todo }}</strong></span>
    <span v-if="info.autoClosed" class="strip-muted">源单已结自动核销 {{ info.autoClosed }}</span>
    <span v-if="info.notLinked" class="strip-muted">尚未挂账 {{ info.notLinked }}</span>
    <span :class="['strip-badge', info.moduleOpen === info.pendingSign + info.todo ? 'ok' : 'warn']">
      {{ info.moduleOpen === info.pendingSign + info.todo ? '挂账部分已全部对齐' : `还有 ${info.notLinked} 条未挂账·以本模块为准` }}
    </span>
    <RouterLink class="link" to="/handover">去交接账签收 →</RouterLink>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { reconcile } from '@/api/handover-service'
import type { HandoverModuleKey } from '@/data/handover'

const props = defineProps<{ moduleKey: HandoverModuleKey }>()

// 本模块业务记录一变化（状态流转、重置）就重新对账，保证两处条数实时一致。
const tick = ref(0)
function bump(event: Event) {
  const detail = (event as CustomEvent<{ key: string }>).detail
  if (!detail || detail.key === props.moduleKey) {
    tick.value += 1
  }
}
onMounted(() => window.addEventListener('pv:entries-updated', bump))
onBeforeUnmount(() => window.removeEventListener('pv:entries-updated', bump))

const info = computed(() => {
  void tick.value
  return reconcile().find((row) => row.key === props.moduleKey) ?? {
    key: props.moduleKey,
    name: '',
    moduleOpen: 0,
    ledgerLinked: 0,
    ledgerOpen: 0,
    autoClosed: 0,
    pendingSign: 0,
    todo: 0,
    notLinked: 0,
  }
})
</script>
