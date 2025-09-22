<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { CreateWorkItemRequest } from '@drrq/shared/index'
import { validateWorkItemTitle, validateWorkItemType, validateDateString } from '@drrq/shared/index'
import { withBase, authHeader } from '../api'

const form = ref<CreateWorkItemRequest>({
  title: '',
  workDate: new Date().toISOString().slice(0, 10),
  type: 'done',
})

const submitting = ref(false)

async function submit() {
  // client-side validation (mirror server)
  const t = validateWorkItemTitle(form.value.title)
  if (!t.valid) return ElMessage.error(t.error || '标题不合法')
  const d = validateDateString(form.value.workDate)
  if (!d.valid) return ElMessage.error(d.error || '日期不合法')
  const ty = validateWorkItemType(form.value.type || 'done')
  if (!ty.valid) return ElMessage.error(ty.error || '类型不合法')

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
    // reset title only
    form.value.title = ''
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
    try { localStorage.setItem('AUTH', j.token) } catch {}
    ElMessage.success('已获取开发Token')
  } catch {
    ElMessage.error('获取Token失败')
  }
}
</script>

<template>
  <div class="quick-fill">
    <div class="toolbar">
      <el-button size="small" @click="devGetToken">获取开发Token</el-button>
    </div>
    <el-form label-width="80px" @submit.prevent>
      <el-form-item label="标题">
        <el-input v-model="form.title" maxlength="20" show-word-limit placeholder="≤20字" />
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
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<style scoped>
.quick-fill { padding: 12px; border: 1px solid var(--el-border-color); border-radius: 8px; }
.toolbar { text-align: right; margin-bottom: 8px; }
</style>

