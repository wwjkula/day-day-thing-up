<script setup lang="ts">
import { onMounted, ref } from 'vue'
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
  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const date = new Date(`${dateStr}T00:00:00`)
  return labels[date.getDay()] ?? ''
}

async function loadMissing() {
  missingLoading.value = true
  try {
    const { from, to } = currentWeekRange()
    const todayStr = toDateString(new Date())
    const recordResponse = await listWorkItems({ from, to, scope: 'self' })
    const recordedDates = new Set(
      (recordResponse.items ?? []).filter((item) => item.type !== 'plan').map((item) => item.workDate),
    )

    const start = new Date(`${from}T00:00:00`)
    const end = new Date(`${to}T00:00:00`)
    const results: Array<{ date: string; weekday: string }> = []

    for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
      const dateStr = toDateString(day)
      if (dateStr > todayStr) continue
      if (!recordedDates.has(dateStr)) {
        results.push({ date: dateStr, weekday: weekdayLabel(dateStr) })
      }
    }

    missingDates.value = results
  } catch (err: any) {
    missingDates.value = []
    ElMessage.error(err?.message || '加载缺报信息失败')
  } finally {
    missingLoading.value = false
  }
}

async function submit() {
  const titleCheck = validateWorkItemTitle(form.value.title)
  if (!titleCheck.valid) {
    ElMessage.error(titleCheck.error || '标题不合法')
    return
  }

  const dateCheck = validateDateString(form.value.workDate)
  if (!dateCheck.valid) {
    ElMessage.error(dateCheck.error || '日期格式不正确')
    return
  }

  const typeCheck = validateWorkItemType(form.value.type || 'done')
  if (!typeCheck.valid) {
    ElMessage.error(typeCheck.error || '类型不合法')
    return
  }

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
  } catch (err: any) {
    ElMessage.error(err?.message || '提交失败')
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
    } catch {
      /* ignore */
    }
    ElMessage.success('已获取开发 Token')
    await loadMissing()
  } catch (err: any) {
    ElMessage.error(err?.message || '获取 Token 失败')
  }
}

onMounted(() => {
  loadMissing()
})
</script>

<template>
  <div class="quick-fill">
    <div class="quick-fill__header">
      <div>
        <div class="quick-fill__title">快速填报</div>
        <div class="quick-fill__subtitle">记录每日关键事项，保持节奏如一。</div>
      </div>
      <el-space alignment="center" wrap>
        <el-button size="small" type="primary" plain @click="devGetToken">获取开发 Token</el-button>
      </el-space>
    </div>
    <el-form label-width="80px" class="quick-fill__form" @submit.prevent>
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

    <div class="quick-fill__missing" v-loading="missingLoading">
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
  padding: 24px;
  border-radius: 20px;
  border: 1px solid var(--app-border-color);
  background: var(--app-surface-color);
  box-shadow: var(--el-box-shadow-light);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.quick-fill__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.quick-fill__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--app-text-color);
}

.quick-fill__subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: var(--app-text-secondary);
}

.quick-fill__form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.quick-fill__missing {
  padding: 16px;
  border: 1px dashed rgba(59, 130, 246, 0.24);
  border-radius: 16px;
  background: rgba(59, 130, 246, 0.06);
  color: var(--app-text-color);
  min-height: 92px;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

.dark .quick-fill__missing {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(96, 165, 250, 0.42);
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
  background: rgba(59, 130, 246, 0.14);
  line-height: 1.4;
  font-size: 14px;
}

.missing-item .weekday {
  color: var(--app-text-secondary);
}

.missing-empty {
  padding: 4px 0;
}
</style>
