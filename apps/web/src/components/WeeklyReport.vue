<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import type { VisibilityScope } from '@drrq/shared/index'
import { getWeekly, postWeeklyExport, getExportStatus, downloadExport } from '../api'

type WeeklyRow = {
  creatorId: number
  workDate: string
  itemCount: number
  totalMinutes: number
  typeCounts: { done: number; progress: number; temp: number; assist: number }
}

const loading = ref(false)
const exporting = ref(false)

// default to current week (Mon-Sun, UTC-based with Asia/Shanghai Monday intent)
function thisWeek(): { from: string; to: string } {
  const now = new Date()
  const day = (now.getUTCDay() + 6) % 7 // Monday=0
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day))
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (6 - day)))
  return { from: monday.toISOString().slice(0,10), to: sunday.toISOString().slice(0,10) }
}

const range = ref<{ from: string; to: string }>(thisWeek())
const scope = ref<VisibilityScope>('self')

const raw = ref<WeeklyRow[]>([])

const byUser = computed(() => {
  const m = new Map<number, { name?: string; itemCount: number; totalMinutes: number; done: number; progress: number; temp: number; assist: number }>()
  for (const r of raw.value) {
    const cur = m.get(r.creatorId) || { itemCount: 0, totalMinutes: 0, done: 0, progress: 0, temp: 0, assist: 0 }
    cur.itemCount += r.itemCount
    cur.totalMinutes += r.totalMinutes
    cur.done += r.typeCounts.done
    cur.progress += r.typeCounts.progress
    cur.temp += r.typeCounts.temp
    cur.assist += r.typeCounts.assist
    m.set(r.creatorId, cur)
  }
  const arr = Array.from(m.entries()).map(([creatorId, t]) => ({ creatorId, ...t }))
  arr.sort((a,b) => a.creatorId - b.creatorId)
  return arr
})

async function load() {
  loading.value = true
  try {
    const j = await getWeekly({ from: range.value.from, to: range.value.to, scope: scope.value })
    raw.value = j.data as WeeklyRow[]
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function exportZip() {
  exporting.value = true
  try {
    const { jobId } = await postWeeklyExport({ from: range.value.from, to: range.value.to, scope: scope.value })
    // poll status
    let attempts = 0
    while (attempts < 30) {
      await new Promise(r => setTimeout(r, 1000))
      const st = await getExportStatus(jobId)
      if (st.status === 'ready') {
        await downloadExport(jobId)
        ElMessage.success('导出已就绪，开始下载')
        return
      }
      attempts++
    }
    throw new Error('导出超时，请稍后重试')
  } catch (e: any) {
    ElMessage.error(e?.message || '导出失败')
  } finally {
    exporting.value = false
  }
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
  </div>
</template>

<style scoped>
.weekly-report { margin-top: 16px; padding: 12px; border: 1px solid var(--el-border-color); border-radius: 8px; }
.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
</style>

