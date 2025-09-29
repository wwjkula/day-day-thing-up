<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { withBase, authHeader } from '../api'
import { validateWorkItemTitle, validateWorkItemType, validateDateString } from '@drrq/shared/index'

type WorkItem = { id: number; workDate: string; title: string; type: 'done'|'progress'|'temp'|'assist'; durationMinutes?: number }

type ViewMode = 'list'|'card'

type Range = { from: string; to: string }

function thisWeek(): Range {
  const now = new Date()
  const day = (now.getUTCDay() + 6) % 7 // Monday=0
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day))
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (6 - day)))
  return { from: monday.toISOString().slice(0,10), to: sunday.toISOString().slice(0,10) }
}

// Quick-fill form
const qf = ref<{ title: string; workDate: string; type: 'done'|'progress'|'temp'|'assist' }>({
  title: '',
  workDate: new Date().toISOString().slice(0,10),
  type: 'done',
})
const submitting = ref(false)

// Weekly data and UI state
const range = ref<Range>(thisWeek())
const items = ref<WorkItem[]>([])
const loading = ref(false)
const viewMode = ref<ViewMode>('list')
const typeFilter = ref<Array<WorkItem['type']>>([])
const keyword = ref('')

const filtered = computed(() => {
  let arr = items.value.slice()
  if (typeFilter.value.length) arr = arr.filter(i => typeFilter.value.includes(i.type))
  if (keyword.value.trim()) {
    const k = keyword.value.trim()
    arr = arr.filter(i => i.title.includes(k))
  }
  return arr
})

const days = computed(() => {
  const res: { label: string; date: string; short: string; list: WorkItem[] }[] = []
  const start = new Date(range.value.from + 'T00:00:00Z')
  const names = ['周一','周二','周三','周四','周五','周六','周日']
  for (let i=0;i<7;i++) {
    const d = new Date(start.getTime() + i*24*3600*1000)
    const ds = d.toISOString().slice(0,10)
    const label = `${names[i]} ${ds}`
    const short = names[i] || ''
    res.push({ label, date: ds, short, list: filtered.value.filter(it => it.workDate === ds) })
  }
  return res
})

async function loadWeek() {
  loading.value = true
  try {
    const params = new URLSearchParams({ from: range.value.from, to: range.value.to, scope: 'self' })
    const res = await fetch(withBase(`/api/work-items?${params}`), { headers: { ...authHeader() } })
    const j = await res.json()
    items.value = (j.items || []).map((x:any) => ({ id: x.id, workDate: x.workDate, title: x.title, type: x.type, durationMinutes: x.durationMinutes }))
  } catch (e:any) {
    ElMessage.error(e?.message || '加载失败')
  } finally { loading.value = false }
}

async function submitQuick() {
  const t = validateWorkItemTitle(qf.value.title)
  if (!t.valid) return ElMessage.error(t.error || '标题不合法')
  const d = validateDateString(qf.value.workDate)
  if (!d.valid) return ElMessage.error(d.error || '日期不合法')
  const ty = validateWorkItemType(qf.value.type)
  if (!ty.valid) return ElMessage.error(ty.error || '类型不合法')

  submitting.value = true
  try {
    const res = await fetch(withBase('/api/work-items'), { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(qf.value) })
    if (!res.ok) throw new Error(await res.text())
    ElMessage.success('已提交')
    qf.value.title = ''
    await loadWeek()
  } catch (e:any) { ElMessage.error(e?.message || '提交失败') } finally { submitting.value = false }
}

function copyAsNew(it: WorkItem) {
  qf.value.title = it.title
  qf.value.type = it.type
  qf.value.workDate = new Date().toISOString().slice(0,10)
  ElMessage.success('已复制到快速填报')
}

async function copyYesterdayFirst() {
  const today = new Date(qf.value.workDate + 'T00:00:00Z')
  const y = new Date(today.getTime() - 24*3600*1000)
  const ds = y.toISOString().slice(0,10)
  try {
    const params = new URLSearchParams({ from: ds, to: ds, scope: 'self', limit: '1' })
    const res = await fetch(withBase(`/api/work-items?${params}`), { headers: { ...authHeader() } })
    const j = await res.json()
    const first = (j.items || [])[0]
    if (!first) return ElMessage.info('昨日无记录')
    copyAsNew({ id: first.id, workDate: first.workDate, title: first.title, type: first.type })
  } catch { ElMessage.error('复制失败') }
}

onMounted(() => { loadWeek() })
</script>

<template>
  <div class="home">
    <!-- Top quick-fill bar -->
    <div class="qf">
      <el-input v-model="qf.title" placeholder="≤20字（例：设备巡检完成）" maxlength="20" show-word-limit @keyup.enter="submitQuick" />
      <el-select v-model="qf.type" style="width:120px">
        <el-option label="完成" value="done" />
        <el-option label="推进" value="progress" />
        <el-option label="临时" value="temp" />
        <el-option label="协同" value="assist" />
      </el-select>
      <el-date-picker v-model="qf.workDate" type="date" value-format="YYYY-MM-DD" style="width:150px" />
      <el-button type="primary" :loading="submitting" @click="submitQuick">提交</el-button>
      <el-button @click="copyYesterdayFirst">复制昨日</el-button>
    </div>

    <!-- Toolbar: filters, view toggle, range -->
    <div class="bar">
      <el-select v-model="typeFilter" multiple collapse-tags placeholder="类型筛选" style="min-width:220px">
        <el-option label="完成" value="done" />
        <el-option label="推进" value="progress" />
        <el-option label="临时" value="temp" />
        <el-option label="协同" value="assist" />
      </el-select>
      <el-input v-model="keyword" placeholder="关键字" style="width:200px" />
      <span class="spacer" />
      <el-date-picker v-model="range.from" type="date" value-format="YYYY-MM-DD" />
      <span style="margin:0 6px">~</span>
      <el-date-picker v-model="range.to" type="date" value-format="YYYY-MM-DD" />
      <el-button :loading="loading" @click="loadWeek">刷新</el-button>
      <el-segmented v-model="viewMode" :options="[{label:'列表',value:'list'},{label:'卡片',value:'card'}]" />
    </div>

    <!-- Weekly grouped list -->
    <div v-if="viewMode==='list'">
      <div v-for="d in days" :key="d.date" class="day">
        <div class="day-hd">{{ d.label }} <el-tag v-if="!d.list.length" type="warning">缺报提醒</el-tag></div>
        <el-table v-if="d.list.length" :data="d.list" size="small" class="day-table">
          <el-table-column prop="title" label="标题" />
          <el-table-column prop="type" label="类型" width="100" />
          <el-table-column prop="durationMinutes" label="时长(分)" width="120" />
          <el-table-column label="操作" width="120">
            <template #default="{ row }"><el-button size="small" @click="copyAsNew(row)">复制</el-button></template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <div v-else class="cards">
      <div v-for="d in days" :key="d.date">
        <div class="day-hd">{{ d.label }} <el-tag v-if="!d.list.length" type="warning">缺报提醒</el-tag></div>
        <div class="card-row">
          <el-card v-for="it in d.list" :key="it.id" shadow="never" class="card">
            <div class="t">{{ it.title }}</div>
            <div class="m">
              <el-tag size="small">{{ it.type }}</el-tag>
              <span v-if="it.durationMinutes" class="dim">· {{ it.durationMinutes }}m</span>
            </div>
            <div class="ops"><el-button size="small" @click="copyAsNew(it)">复制</el-button></div>
          </el-card>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home { padding: 12px; border: 1px solid var(--el-border-color); border-radius: 8px; }
.qf { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.bar { display: flex; gap: 8px; align-items: center; margin: 8px 0 12px; }
.bar .spacer { flex: 1; }
.day { margin-bottom: 10px; }
.day-hd { font-weight: 600; margin: 6px 0; }
.day-table :deep(.el-table__cell) { padding: 6px 8px; }
.cards .card-row { display: flex; gap: 8px; flex-wrap: wrap; }
.card { width: 260px; }
.card .t { font-weight: 600; margin-bottom: 6px; }
.card .m { color: #666; display:flex; align-items:center; gap:6px; }
.card .ops { margin-top: 8px; text-align: right; }
</style>

