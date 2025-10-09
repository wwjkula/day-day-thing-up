<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ListWorkItemsResponse, WorkItemResponse, WorkItemType } from '@drrq/shared/index'
import { validateWorkItemTitle, validateWorkItemType, validateDateString } from '@drrq/shared/index'
import { withBase, authHeader, updateWorkItem, deleteWorkItem } from '../api'

const items = ref<WorkItemResponse[]>([])
const loading = ref(false)

function initialRange(): { from: string; to: string } {
  const now = new Date()
  const day = (now.getUTCDay() + 6) % 7
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day))
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (6 - day)))
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) }
}

const range = ref(initialRange())

const editVisible = ref(false)
const editLoading = ref(false)
const editForm = ref<{
  id: number | null
  title: string
  workDate: string
  type: WorkItemType
  durationMinutes: number | null
}>({
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

const typeOptions = Object.entries(typeLabels).map(([value, label]) => ({
  value: value as WorkItemType,
  label,
}))

function resetEditForm() {
  editForm.value = { id: null, title: '', workDate: '', type: 'done', durationMinutes: null }
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({ from: range.value.from, to: range.value.to, scope: 'self' })
    const res = await fetch(withBase(`/api/work-items?${params}`), { headers: { ...authHeader() } })
    const data: ListWorkItemsResponse = await res.json()
    items.value = data.items
  } catch (err: any) {
    ElMessage.error(err?.message || '加载数据失败')
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
  if (!titleCheck.valid) {
    ElMessage.error(titleCheck.error || '标题不合法')
    return
  }

  const dateCheck = validateDateString(editForm.value.workDate)
  if (!dateCheck.valid) {
    ElMessage.error(dateCheck.error || '日期格式不正确')
    return
  }

  const typeCheck = validateWorkItemType(editForm.value.type)
  if (!typeCheck.valid) {
    ElMessage.error(typeCheck.error || '类型不合法')
    return
  }

  const duration = editForm.value.durationMinutes
  if (duration != null && (!Number.isInteger(duration) || duration < 0)) {
    ElMessage.error('时长必须为不小于 0 的整数')
    return
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
    if (!result?.ok) {
      throw new Error(result?.error || '更新失败')
    }
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
    if (!result?.ok) {
      throw new Error(result?.error || '删除失败')
    }
    ElMessage.success('已删除')
    await load()
  } catch (err: any) {
    ElMessage.error(err?.message || '删除失败')
  }
}

onMounted(() => {
  load()
})
</script>

<template>
  <div class="my-records">
    <div class="my-records__header">
      <div>
        <div class="my-records__title">我的记录</div>
        <div class="my-records__subtitle">筛选一段时间内的填报，随时编辑或删除。</div>
      </div>
      <el-space class="my-records__filters" alignment="center" wrap>
        <el-date-picker v-model="range.from" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" />
        <span class="range-separator">~</span>
        <el-date-picker v-model="range.to" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" />
        <el-button type="primary" plain :loading="loading" @click="load">刷新</el-button>
      </el-space>
    </div>

    <div class="table-wrapper">
      <template v-if="loading">
        <el-skeleton :rows="6" animated />
      </template>
      <el-table v-else :data="items" :fit="false" :header-cell-style="{ background: 'transparent' }" empty-text="暂无记录">
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
            <el-option
              v-for="option in typeOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="用时(分钟)">
          <el-input-number
            v-model="editForm.durationMinutes"
            :min="0"
            :max="1440"
            :step="5"
            controls-position="right"
          />
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
  margin-top: 12px;
  padding: 24px;
  border-radius: 20px;
  border: 1px solid var(--app-border-color);
  background: var(--app-surface-color);
  box-shadow: var(--el-box-shadow-light);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.my-records__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.my-records__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--app-text-color);
}

.my-records__subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: var(--app-text-secondary);
  max-width: 520px;
}

.my-records__filters {
  gap: 10px;
}

.range-separator {
  color: var(--app-text-secondary);
  font-size: 13px;
}

.table-wrapper {
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(255, 255, 255, 0.4);
  padding: 0;
  overflow: hidden;
}

.dark .table-wrapper {
  background: rgba(30, 41, 59, 0.4);
  border-color: rgba(148, 163, 184, 0.24);
}

.table-wrapper :deep(.el-table) {
  --el-table-border-color: transparent;
  --el-table-border: none;
  background: transparent;
}

.table-wrapper :deep(.el-table__inner-wrapper::before) {
  display: none;
}

.table-wrapper :deep(.el-table tr) {
  transition: background 0.2s ease;
}

.table-wrapper :deep(.el-table tr:hover > td) {
  background: rgba(59, 130, 246, 0.08);
}

.table-wrapper :deep(.el-table__header th) {
  font-weight: 600;
  color: var(--app-text-secondary);
}

.table-wrapper :deep(.el-table__empty-block) {
  padding: 24px 0;
}

@media (max-width: 960px) {
  .my-records__header {
    flex-direction: column;
    align-items: flex-start;
  }

  .my-records__filters {
    width: 100%;
    justify-content: flex-start;
  }

  .table-wrapper {
    overflow-x: auto;
  }

  .table-wrapper :deep(.el-table) {
    min-width: 720px;
  }
}
</style>
