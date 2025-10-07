<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ListWorkItemsResponse, WorkItemResponse, WorkItemType } from '@drrq/shared/index'
import { validateWorkItemTitle, validateWorkItemType, validateDateString } from '@drrq/shared/index'
import { withBase, authHeader, updateWorkItem, deleteWorkItem } from '../api'

const items = ref<WorkItemResponse[]>([])
const loading = ref(false)
function initialRange(): { from: string; to: string } {
  const now = new Date()
  const day = (now.getUTCDay() + 6) % 7 // Monday=0
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day))
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (6 - day)))
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) }
}

const range = ref<{ from: string; to: string }>(initialRange())

const editVisible = ref(false)
const editLoading = ref(false)
const editForm = ref<{ id: number | null; title: string; workDate: string; type: WorkItemType; durationMinutes: number | null }>({
  id: null,
  title: '',
  workDate: '',
  type: 'done',
  durationMinutes: null,
})

const typeLabels: Record<string, string> = {
  done: '完成',
  progress: '推进',
  temp: '临时',
  assist: '协同',
  plan: '计划',
}
const typeOptions = Object.entries(typeLabels).map(([value, label]) => ({ value: value as WorkItemType, label }))

function resetEditForm() {
  editForm.value = { id: null, title: '', workDate: '', type: 'done', durationMinutes: null }
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({ from: range.value.from, to: range.value.to, scope: 'self' })
    const res = await fetch(withBase(`/api/work-items?${params}`), { headers: { ...authHeader() } })
    const j: ListWorkItemsResponse = await res.json()
    items.value = j.items
  } finally {
    loading.value = false
  }
}

function openEdit(row: WorkItemResponse) {
  editForm.value = {
    id: row.id,
    title: row.title ?? '',
    workDate: row.workDate,
    type: (row.type as WorkItemType) ?? 'done',
    durationMinutes: row.durationMinutes ?? null,
  }
  editVisible.value = true
}

async function submitEdit() {
  if (!editForm.value.id) return
  const titleCheck = validateWorkItemTitle(editForm.value.title)
  if (!titleCheck.valid) return ElMessage.error(titleCheck.error || '标题不合法')

  const dateCheck = validateDateString(editForm.value.workDate)
  if (!dateCheck.valid) return ElMessage.error(dateCheck.error || '日期不合法')

  const typeCheck = validateWorkItemType(editForm.value.type)
  if (!typeCheck.valid) return ElMessage.error(typeCheck.error || '类型不合法')

  const duration = editForm.value.durationMinutes
  if (duration != null && (!Number.isInteger(duration) || duration < 0)) {
    return ElMessage.error('时长必须为不小于 0 的整数')
  }

  editLoading.value = true
  try {
    const payload = {
      title: editForm.value.title.trim(),
      workDate: editForm.value.workDate,
      type: editForm.value.type,
      durationMinutes: duration ?? null,
    }
    const result = await updateWorkItem(editForm.value.id, payload)
    if (!result?.ok) throw new Error(result?.error || '更新失败')
    ElMessage.success('已更新')
    editVisible.value = false
    resetEditForm()
    await load()
  } catch (err: any) {
    ElMessage.error(err?.message || '更新失败')
  } finally {
    editLoading.value = false
  }
}

async function confirmDelete(row: WorkItemResponse) {
  try {
    await ElMessageBox.confirm('确认删除该记录？删除后不可恢复。', '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  try {
    const result = await deleteWorkItem(row.id)
    if (!result?.ok) throw new Error(result?.error || '删除失败')
    ElMessage.success('已删除')
    await load()
  } catch (err: any) {
    ElMessage.error(err?.message || '删除失败')
  }
}

onMounted(() => { load() })
</script>

<template>
  <div class="my-records">
    <div class="toolbar">
      <el-date-picker v-model="range.from" type="date" value-format="YYYY-MM-DD" />
      <span class="range-separator">~</span>
      <el-date-picker v-model="range.to" type="date" value-format="YYYY-MM-DD" />
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>
    <div class="table-wrapper">
      <el-table :data="items" v-loading="loading" style="width: 100%" :fit="false">
        <el-table-column prop="workDate" label="日期" width="140" />
        <el-table-column prop="title" label="标题" min-width="420" show-overflow-tooltip />
        <el-table-column label="类型" width="120">
        <template #default="{ row }">
          {{ typeLabels[row.type] ?? row.type }}
        </template>
      </el-table-column>
        <el-table-column label="时长(分钟)" width="140">
        <template #default="{ row }">
          {{ row.durationMinutes != null ? row.durationMinutes : '—' }}
        </template>
      </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="primary" link @click="openEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" link @click="confirmDelete(row)">删除</el-button>
        </template>
      </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="editVisible" title="编辑记录" width="420px" @close="resetEditForm">
      <el-form label-width="100px">
        <el-form-item label="标题">
          <el-input v-model="editForm.title" maxlength="20" show-word-limit />
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker v-model="editForm.workDate" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="editForm.type">
            <el-option v-for="option in typeOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="用时(分钟)">
          <el-input-number v-model="editForm.durationMinutes" :min="0" :max="1440" :step="5" controls-position="right" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editLoading" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.my-records {
  margin-top: 16px;
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.range-separator {
  color: var(--el-text-color-secondary);
}
.table-wrapper {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.table-wrapper :deep(.el-table) {
  min-width: 980px;
}
</style>
