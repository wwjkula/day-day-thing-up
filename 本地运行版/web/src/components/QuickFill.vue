<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import type { CreateWorkItemRequest } from '@drrq/shared/index'
import { validateWorkItemTitle, validateWorkItemType, validateDateString } from '@drrq/shared/index'
import { withBase, authHeader, listWorkItems } from '../api'

const form = ref<CreateWorkItemRequest>({
  title: '',
  workDate: new Date().toISOString().slice(0, 10),
  type: 'done',
})

const submitting = ref(false)
const missingLoading = ref(false)
const missingDates = ref<Array<{ date: string; weekday: string }>>([])

function toDateString(date: Date): string {
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

function currentWeekRange(): { from: string; to: string } {
  const today = new Date()
  const day = today.getDay() === 0 ? 7 : today.getDay()
  const monday = new Date(today)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(today.getDate() - (day - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { from: toDateString(monday), to: toDateString(sunday) }
}

function weekdayLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`)
  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return labels[date.getDay()] ?? ''
}

async function loadMissing() {
  missingLoading.value = true
  try {
    const { from, to } = currentWeekRange()
    const todayStr = toDateString(new Date())
    const recordResponse = await listWorkItems({ from, to, scope: 'self' })
    const recordedDates = new Set((recordResponse.items ?? [])
      .filter(item => item.type !== 'plan')
      .map(item => item.workDate))

    const start = new Date(`${from}T00:00:00`)
    const end = new Date(`${to}T00:00:00`)
    const results: Array<{ date: string; weekday: string }> = []

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = toDateString(d)
      if (dateStr > todayStr) continue
      if (!recordedDates.has(dateStr)) {
        results.push({ date: dateStr, weekday: weekdayLabel(dateStr) })
      }
    }

    missingDates.value = results
  } catch (e: any) {
    missingDates.value = []
    ElMessage.error(e?.message || '加载缺报信息失败')
  } finally {
    missingLoading.value = false
  }
}

async function submit() {
  const titleCheck = validateWorkItemTitle(form.value.title)
  if (!titleCheck.valid) return ElMessage.error(titleCheck.error || '标题不合法')
  const dateCheck = validateDateString(form.value.workDate)
  if (!dateCheck.valid) return ElMessage.error(dateCheck.error || '日期不合法')
  const typeCheck = validateWorkItemType(form.value.type || 'done')
  if (!typeCheck.valid) return ElMessage.error(typeCheck.error || '类型不合法')

  submitting.value = true
  try {
    const res = await fetch(withBase('/api/work-items'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify(form.value),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error || res.statusText)
    }
    ElMessage.success('已提交')
    form.value.title = ''
    await loadMissing()
  } catch (e: any) {
    ElMessage.error(e?.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

async function devGetToken() {
  try {
    const res = await fetch(withBase('/dev/token?sub=1'))
    const j = await res.json()
    ;(window as any).__AUTH__ = j.token
    try {
      localStorage.setItem('AUTH', j.token)
    } catch {}
    ElMessage.success('已获取开发 Token')
    await loadMissing()
  } catch {
    ElMessage.error('获取 Token 失败')
  }
}

onMounted(() => {
  loadMissing()
})
</script>

<template>
  <div class="quick-fill">
    <div class="toolbar">
      <el-button size="small" @click="devGetToken">获取开发 Token</el-button>
    </div>
    <el-form label-width="80px" @submit.prevent>
      <el-form-item label="标题">
        <el-input v-model="form.title" maxlength="20" show-word-limit placeholder="20 字以内" />
      </el-form-item>
      <el-form-item label="日期">
        <el-date-picker v-model="form.workDate" type="date" value-format="YYYY-MM-DD" />
      </el-form-item>
      <el-form-item label="类型">
      <el-select v-model="form.type">
        <el-option label="完成" value="done" />
        <el-option label="推进" value="progress" />
        <el-option label="临时" value="temp" />
        <el-option label="协同" value="assist" />
        <el-option label="计划" value="plan" />
      </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
      </el-form-item>
    </el-form>

    <div class="missing-section" v-loading="missingLoading">
      <div class="missing-title">缺报提醒</div>
      <template v-if="!missingLoading">
        <div v-if="missingDates.length === 0" class="missing-empty">
          <el-alert type="success" title="最近一周均已填报" :closable="false" />
        </div>
        <ul v-else class="missing-list">
          <li v-for="item in missingDates" :key="item.date" class="missing-item">
            <el-tag type="warning" effect="plain">{{ item.date }}</el-tag>
            <span class="weekday">{{ item.weekday }}</span>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<style scoped>
.quick-fill {
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
}

.toolbar {
  text-align: right;
  margin-bottom: 8px;
}

.missing-section {
  margin-top: 16px;
  padding: 12px;
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-primary);
  min-height: 80px;
  transition: background-color 0.2s ease;
}

.missing-title {
  font-weight: 600;
  margin-bottom: 8px;
}

.missing-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.missing-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--el-color-warning-light-9, rgba(253, 246, 236, 0.9));
  color: var(--el-color-warning);
  line-height: 1.4;
  font-size: 14px;
}

.missing-item .weekday {
  color: var(--el-text-color-secondary);
}

.missing-empty {
  padding: 8px 0;
}
</style>
