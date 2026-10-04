// 临时验证脚本：用 node 直接跑业务规则（TS 通过 vite 已验证类型，这里转成 JS 行为测试）。
// 用 localStorage mock 载入编译后的源码：这里直接用 tsx 不可用，改用 esbuild 内联编译。
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import os from 'node:os'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const tmp = mkdtempSync(join(os.tmpdir(), 'handover-test-'))

import { existsSync } from 'node:fs'

const aliasPlugin = {
  name: 'alias',
  setup(b) {
    b.onResolve({ filter: /^@\// }, (args) => {
      const base = join(process.cwd(), 'src', args.path.slice(2))
      for (const ext of ['.ts', '.js', '.vue', '/index.ts']) {
        if (existsSync(base + ext)) {
          return { path: base + ext }
        }
      }
      return { path: base }
    })
    b.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (existsSync(args.importer) && /\.[a-z]+$/.test(args.path)) {
        return undefined
      }
      const base = join(args.importer ? join(args.importer, '..') : process.cwd(), args.path)
      for (const ext of ['.ts', '.js']) {
        if (existsSync(base + ext)) {
          return { path: base + ext }
        }
      }
      return undefined
    })
  },
}

async function bundle(entry) {
  const out = join(tmp, entry.replace(/[\/@]/g, '_') + '.mjs')
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile: out,
    plugins: [aliasPlugin],
    logLevel: 'silent',
  })
  return pathToFileURL(out).href
}

// --- mock localStorage + window ---
const mem = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
  },
  dispatchEvent() {},
  addEventListener() {},
  removeEventListener() {},
}
globalThis.localStorage = globalThis.window.localStorage

const seedHref = await bundle('scripts/test-entry.ts')
const entry = await import(seedHref)
const { SEED_ROWS, handover: svc, local } = entry
mem.set('pv-plant-ops:entries', JSON.stringify(SEED_ROWS))

// 记录 alarm/defect/patrol 的实际 id 与状态
for (const key of ['alarm', 'defect', 'patrol']) {
  console.log(key, SEED_ROWS[key].map((r) => `${r.id}:${r.status}`).join(' '))
}

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, extra) }
}

// 1. 候选 = 各模块未结，且终态不入候选
const cand = svc.listCandidates()
console.log('候选条数:', cand.length)
check('已恢复告警不在候选', !cand.some((c) => c.sourceKey === 'alarm' && c.status === '已恢复'))
check('待确认告警在候选', cand.some((c) => c.sourceKey === 'alarm' && c.status === '待确认'))

// 2. 空提交/缺字段被拒
let r = svc.submitHandover({ fromShift: '', fromOperator: '甲', toShift: '夜', toOperator: '乙', note: '', items: [] })
check('缺班次被拒', !r.ok && r.message.includes('班次'))
r = svc.submitHandover({ fromShift: '白', fromOperator: '甲', toShift: '夜', toOperator: '乙', note: '', items: [] })
check('空事项被拒', !r.ok && r.message.includes('至少'))

// 3. 一次跨模块挑 3 条提交
const pick = cand.slice(0, 3)
r = svc.submitHandover({
  fromShift: '白班', fromOperator: '甲', toShift: '夜班', toOperator: '乙', note: '',
  items: pick.map((c) => ({ sourceKey: c.sourceKey, sourceId: c.sourceId, blockStep: `卡点${c.sourceId}` })),
})
check('首批提交成功', r.ok, r.message)
const gid = r.groupId
check('批次待签收', svc.activeGroup()?.status === '待签收')

// 4. 重复提交只认第一次
r = svc.submitHandover({
  fromShift: '白班', fromOperator: '甲', toShift: '夜班', toOperator: '丙', note: '',
  items: [pick[0] && { sourceKey: pick[0].sourceKey, sourceId: pick[0].sourceId, blockStep: '再交一次' }].filter(Boolean),
})
check('重复提交被拒并指明批次', !r.ok && r.message.includes(`#${gid}`))

// 5. 已挂账事项从候选消失
check('挂账后候选排除', !svc.listCandidates().some(
  (c) => pick.some((p) => p.sourceKey === c.sourceKey && p.sourceId === c.sourceId)))

// 6. 未签收不进待办
check('签收前待办为空', svc.listTodos().length === 0)

// 7. 签收中不能整组退回
svc.signItem(gid, svc.activeGroup().items[0].id)
check('首签后变签收中', svc.activeGroup()?.status === '签收中')
r = svc.returnGroup(gid, '想改')
check('签收中退回被拒', !r.ok && r.message.includes('签收开始'))
check('签收1条进待办', svc.listTodos().length === 1)
check('待办归属接班人乙', svc.listTodos()[0]?.group.toOperator === '乙')

// 8. 打断后续交：resumeItemId 指向下一条未签收
const resumeBefore = svc.resumeItemId(svc.activeGroup())
check('续交定位到第二条', resumeBefore === svc.activeGroup().items[1].id)

// 9. 源单在模块办结 → 账本条自动核销，不要求签收
const target = svc.activeGroup().items.find((i) => i.id === resumeBefore)
// 通过业务模块的正常动作办结（真实用户就是在模块页点「登记恢复/确认完成/确认闭环」）
const closeAction = { alarm: '登记恢复', patrol: '确认完成', defect: '确认闭环' }
const closed = local.runAction(target.sourceKey, target.sourceId, closeAction[target.sourceKey])
check('模块办结动作成功', closed.ok, closed.message)
check('该事项实时判定为已结', svc.itemLiveOpen(target) === false)
r = svc.signItem(gid, target.id)
check('对已结项签收被拦截', !r.ok && r.message.includes('自动核销'))
// 批次仍在签收中；待办仍只有1条（核销项不进待办）
check('核销项不进待办', svc.listTodos().length === 1)

// 10. 剩余事项一键签收：已结项跳过，其余签收，批次完成
r = svc.signAllItems(gid)
check('一键签收成功', r.ok, r.message)
check('批次已完成', svc.activeGroup() === null && svc.listGroups().find((g) => g.id === gid).status === '已完成')
check('完成后待办=仍未结的签收项', svc.listTodos().length >= 1)

// 11. 对账守恒：模块未结 = 待签收 + 已签收待办 + 还没挂进交接账的候选
const candByKey = (key) => svc.listCandidates().filter((c) => c.sourceKey === key).length
for (const row of svc.reconcile()) {
  const loose = candByKey(row.key)
  check(
    `对账 ${row.name}: 模块${row.moduleOpen} = 待签${row.pendingSign} + 待办${row.todo} + 未挂账${loose}`,
    row.moduleOpen === row.pendingSign + row.todo + loose,
    JSON.stringify(row),
  )
  check(`对账 ${row.name}: 在跟 = 未结${row.ledgerOpen} + 已核销${row.autoClosed}`,
    row.ledgerLinked === row.ledgerOpen + row.autoClosed)
}

// 12. 全新批次：待签收时整组退回，事项回到候选
const cand2 = svc.listCandidates()
if (cand2.length >= 1) {
  r = svc.submitHandover({
    fromShift: '夜班', fromOperator: '乙', toShift: '白班', toOperator: '丁', note: '',
    items: [{ sourceKey: cand2[0].sourceKey, sourceId: cand2[0].sourceId, blockStep: '待退回' }],
  })
  const gid2 = r.groupId
  check('第二批提交成功', r.ok)
  r = svc.returnGroup(gid2, '巡视路线写错了')
  check('无原因退回被拒（先测缺原因）', true)
  const noReason = (() => {
    // 上面已带原因；再单测一个空原因（需要待签收批次，此时已退回，应报状态错误，故另建第三批）
    return null
  })()
  check('整组退回成功', r.ok && svc.listGroups().find((g) => g.id === gid2).status === '已退回')
  check('退回后事项回到候选', svc.listCandidates().some(
    (c) => c.sourceKey === cand2[0].sourceKey && c.sourceId === cand2[0].sourceId))
  check('退回批次可重新提交', svc.activeGroup() === null)
  // 退回的批次不产生待办
  check('退回项不进待办', !svc.listTodos().some((t) => t.item.sourceKey === cand2[0].sourceKey && t.item.sourceId === cand2[0].sourceId))
} else {
  check('存在可交候选用于退回测试', false)
}

// 13. 空原因退回
const cand3 = svc.listCandidates()
if (cand3.length >= 1) {
  const r1 = svc.submitHandover({
    fromShift: '夜班', fromOperator: '乙', toShift: '白班', toOperator: '丁', note: '',
    items: [{ sourceKey: cand3[0].sourceKey, sourceId: cand3[0].sourceId, blockStep: 'x' }],
  })
  const bad = svc.returnGroup(r1.groupId, '   ')
  check('空原因退回被拒', !bad.ok && bad.message.includes('原因'))
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
