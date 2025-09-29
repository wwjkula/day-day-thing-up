<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import type { VisibilityScope, MissingWeeklyUser, MissingWeeklyStats } from '@drrq/shared/index'
import { getWeekly, getMissingWeekly, postWeeklyExport, postMissingWeeklyRemind, getExportStatus, downloadExport } from '../api'

type WeeklyRow = {
  creatorId: number
  workDate: string
  itemCount: number
  totalMinutes: number
  typeCounts: { done: number; progress: number; temp: number; assist: number }
}

const loading = ref(false)
const exporting = ref(false)
const missingLoading = ref(false)
const remindAllLoading = ref(false)

function thisWeek(): { from: string; to: string } {
  const now = new Date()
  const day = (now.getUTCDay() + 6) % 7
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day))
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (6 - day)))
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) }
}

const range = ref<{ from: string; to: string }>(thisWeek())
const scope = ref<VisibilityScope>('self')

const raw = ref<WeeklyRow[]>([])
const missing = ref<MissingWeeklyUser[]>([])
const missingStats = ref<MissingWeeklyStats | null>(null)
const remindingIds = ref<Set<number>>(new Set())

const byUser = computed(() => {
  const aggregate = new Map<number, { itemCount: number; totalMinutes: number; done: number; progress: number; temp: number; assist: number }>()
  for (const row of raw.value) {
    const current = aggregate.get(row.creatorId) ?? { itemCount: 0, totalMinutes: 0, done: 0, progress: 0, temp: 0, assist: 0 }
    current.itemCount += row.itemCount
    current.totalMinutes += row.totalMinutes
    current.done += row.typeCounts.done
    current.progress += row.typeCounts.progress
    current.temp += row.typeCounts.temp
    current.assist += row.typeCounts.assist
    aggregate.set(row.creatorId, current)
  }
  return Array.from(aggregate.entries())
    .map(([creatorId, totals]) => ({ creatorId, ...totals }))
    .sort((a, b) => a.creatorId - b.creatorId)
})

function updateReminding(ids: number[], add: boolean) {
  const next = new Set(remindingIds.value)
  for (const id of ids) {
    if (add) next.add(id)
    else next.delete(id)
  }
  remindingIds.value = next
}

function isReminding(userId: number) {
  return remindingIds.value.has(userId)
}

async function load() {
  loading.value = true
  try {
    const weekly = await getWeekly({ from: range.value.from, to: range.value.to, scope: scope.value })
    raw.value = weekly.data as WeeklyRow[]
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
  await loadMissing(false)
}

async function loadMissing(showError = true) {
  missingLoading.value = true
  try {
    const res = await getMissingWeekly({ from: range.value.from, to: range.value.to, scope: scope.value })
    missing.value = res.data
    missingStats.value = res.stats
  } catch (e: any) {
    missing.value = []
    missingStats.value = null
    if (showError) ElMessage.error(e?.message || '加载缺报信息失败')
  } finally {
    missingLoading.value = false
  }
}

async function exportZip() {
  exporting.value = true
  try {
    const { jobId } = await postWeeklyExport({ from: range.value.from, to: range.value.to, scope: scope.value })
    let attempts = 0
    while (attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const status = await getExportStatus(jobId)
      if (status.status === 'ready') {
        await downloadExport(jobId)
        ElMessage.success('导出已就绪，开始下载')
        return
      }
      attempts += 1
    }
    throw new Error('导出超时，请稍后重试')
  } catch (e: any) {
    ElMessage.error(e?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

async function remindTargets(userIds: number[], mode: 'single' | 'batch') {
  const ids = Array.from(new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))).map((id) => Math.trunc(id))
  if (!ids.length) return
  if (mode === 'batch') remindAllLoading.value = true
  updateReminding(ids, true)
  try {
    const res = await postMissingWeeklyRemind({ from: range.value.from, to: range.value.to, scope: scope.value, userIds: ids })
    if (res.notified > 0) ElMessage.success(`已提醒 ${res.notified} 人`)
    else ElMessage.info('暂无需要提醒的对象')
    await loadMissing(false)
  } catch (e: any) {
    ElMessage.error(e?.message || '发送提醒失败')
  } finally {
    updateReminding(ids, false)
    if (mode === 'batch') remindAllLoading.value = false
  }
}

async function remindOne(userId: number) {
  await remindTargets([userId], 'single')
}

async function remindAll() {
  await remindTargets(missing.value.map((m) => m.userId), 'batch')
}

onMounted(() => { load() })
</script>

<template>
  <div class="weekly-report">
    <div class="toolbar">
      <el-select v-model="scope" style="width: 140px">
        <el-option label="仅本人" value="self" />
        <el-option label="直属下属" value="direct" />
        <el-option label="子树" value="subtree" />
      </el-select>
      <el-date-picker v-model="range.from" type="date" value-format="YYYY-MM-DD" />
      <span style="margin:0 8px">~</span>
      <el-date-picker v-model="range.to" type="date" value-format="YYYY-MM-DD" />
      <el-button :loading="loading" @click="load">刷新</el-button>
      <el-button type="primary" :loading="exporting" @click="exportZip">导出 Excel</el-button>
    </div>
    <el-table :data="byUser" v-loading="loading" style="width:100%">
      <el-table-column prop="creatorId" label="用户ID" width="120" />
      <el-table-column prop="itemCount" label="条目数" width="100" />
      <el-table-column prop="totalMinutes" label="总时长(分钟)" width="140" />
      <el-table-column prop="done" label="完成" width="80" />
      <el-table-column prop="progress" label="推进" width="80" />
      <el-table-column prop="temp" label="临时" width="80" />
      <el-table-column prop="assist" label="协同" width="80" />
    </el-table>

    <div class="missing-panel">
      <div class="missing-toolbar">
        <div class="missing-info">
          缺报 {{ missingStats?.missingUsers ?? 0 }} / {{ missingStats?.totalActiveVisible ?? 0 }}
          <span v-if="(missingStats?.missingDates ?? 0) > 0">，共 {{ missingStats?.missingDates ?? 0 }} 个日期</span>
        </div>
        <div class="missing-actions">
          <el-button size="small" :loading="missingLoading" @click="loadMissing(true)">刷新缺报</el-button>
          <el-button size="small" type="primary" :disabled="!missing.length" :loading="remindAllLoading" @click="remindAll">一键提醒</el-button>
        </div>
      </div>
      <div v-if="!missingLoading && !missing.length" class="missing-empty">
        <el-alert type="success" title="本周期所有可见人员均已填报" :closable="false" />
      </div>
      <el-table v-else :data="missing" v-loading="missingLoading" size="small" style="width:100%">
        <el-table-column prop="userId" label="用户ID" width="100" />
        <el-table-column prop="name" label="姓名" width="160" />
        <el-table-column prop="employeeNo" label="工号" width="140" />
        <el-table-column prop="email" label="邮箱" />
        <el-table-column label="缺报日期" min-width="220">
          <template #default="{ row }">{{ row.missingDates.join('、') }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button type="danger" size="small" :loading="isReminding(row.userId)" @click="remindOne(row.userId)">提醒</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.weekly-report { margin-top: 16px; padding: 12px; border: 1px solid var(--el-border-color); border-radius: 8px; }
.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.missing-panel { margin-top: 16px; padding: 12px; border: 1px dashed var(--el-border-color); border-radius: 8px; background: #fafafa; }
.missing-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.missing-info { font-weight: 600; color: #333; }
.missing-actions { display: flex; gap: 8px; }
.missing-empty { padding: 8px 0; }
</style>