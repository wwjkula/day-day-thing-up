<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ListWorkItemsResponse, WorkItemResponse, WorkItemType } from '@drrq/shared/index'
import { validateWorkItemTitle, validateWorkItemType, validateDateString } from '@drrq/shared/index'
import { withBase, authHeader, updateWorkItem, deleteWorkItem } from '../api'

const items = ref<WorkItemResponse[]>([])
const loading = ref(false)

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

// 单日选择：用户选哪天就显示哪天
const selectedDate = ref<string>(todayISO())

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
    const params = new URLSearchParams({ from: selectedDate.value, to: selectedDate.value, scope: 'self' })
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
    ElMessage.error(titleCheck.error || '标题不合规')
    return
  }

  const dateCheck = validateDateString(editForm.value.workDate)
  if (!dateCheck.valid) {
    ElMessage.error(dateCheck.error || '日期格式不正确')
    return
  }

  const typeCheck = validateWorkItemType(editForm.value.type)
  if (!typeCheck.valid) {
    ElMessage.error(typeCheck.error || '类型不合规')
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
    await ElMessageBox.confirm('确认删除该记录？删除后不可恢复', '提示', {
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

watch(selectedDate, () => {
  load()
})

// 数据分组：当日计划 / 今日完成
const todayPlans = computed(() => items.value.filter((it) => it.type === 'plan'))
const todayDone = computed(() => items.value.filter((it) => it.type !== 'plan'))
const todayDoneMinutes = computed(() =>
  todayDone.value.reduce((sum, it) => sum + (typeof it.durationMinutes === 'number' ? it.durationMinutes : 0), 0)
)

// 为每张便笺生成稳定的轻微倾斜角度（-1.2° ~ 1.2°）
function tiltForId(id: number): number {
  const n = ((id * 9301 + 49297) % 233280) / 233280
  return (n - 0.5) * 2.4
}
function tiltStyle(id: number) {
  return { ['--tilt' as any]: `${tiltForId(id).toFixed(2)}deg` }
}
</script>

<template>
  <div class="my-records">
    <div class="my-records__header">
      <div>
        <div class="my-records__title">我的记录</div>
        <div class="my-records__subtitle">选择一个日期，查看当天的计划与完成。</div>
      </div>
      <el-space class="my-records__filters" alignment="center" wrap>
        <el-date-picker v-model="selectedDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        <el-button type="primary" plain :loading="loading" @click="load">刷新</el-button>
      </el-space>
    </div>

    <!-- 当日计划 -->
    <section class="note-board" aria-label="当日计划">
      <div class="board-header">
        <div class="board-title">当日计划</div>
        <div class="board-stats">
          <el-tag type="warning" effect="plain">{{ todayPlans.length }}</el-tag>
        </div>
      </div>
      <div class="board-body">
        <div class="note-grid" v-loading="loading">
          <el-empty v-if="!loading && todayPlans.length === 0" description="今日暂无计划" />
          <template v-else>
            <div class="note-item" v-for="it in todayPlans" :key="it.id">
              <div class="note-card" :style="tiltStyle(it.id)">
                <div class="note-content">
                  <div class="note-title" :title="it.title">{{ it.title }}</div>
                  <div class="note-meta">
                    <el-tag size="small" type="warning" effect="light">计划</el-tag>
                    <span class="note-date">{{ it.workDate }}</span>
                  </div>
                </div>
                <div class="note-actions">
                  <el-button size="small" type="primary" link @click="openEdit(it)">编辑</el-button>
                  <el-button size="small" type="danger" link @click="confirmDelete(it)">删除</el-button>
                </div>
              </div>
              <div class="note-string" aria-hidden="true"></div>
            </div>
          </template>
        </div>
      </div>
    </section>

    <!-- 今日完成 -->
    <section class="note-board" aria-label="今日完成">
      <div class="board-header">
        <div class="board-title">今日完成</div>
        <div class="board-stats">
          <el-tag type="success" effect="plain">{{ todayDone.length }}</el-tag>
          <el-tag type="info" effect="plain" v-if="todayDoneMinutes">{{ todayDoneMinutes }} 分钟</el-tag>
        </div>
      </div>
      <div class="board-body">
        <div class="note-grid" v-loading="loading">
          <el-empty v-if="!loading && todayDone.length === 0" description="今日暂无完成" />
          <template v-else>
            <div class="note-item" v-for="it in todayDone" :key="it.id">
              <div class="note-card" :style="tiltStyle(it.id)">
                <div class="note-content">
                  <div class="note-title" :title="it.title">{{ it.title }}</div>
                  <div class="note-meta">
                    <el-tag size="small" type="success" effect="light">{{ typeLabels[it.type] || '完成' }}</el-tag>
                    <span v-if="it.durationMinutes" class="note-duration">{{ it.durationMinutes }} 分钟</span>
                    <span class="note-date">{{ it.workDate }}</span>
                  </div>
                </div>
                <div class="note-actions">
                  <el-button size="small" type="primary" link @click="openEdit(it)">编辑</el-button>
                  <el-button size="small" type="danger" link @click="confirmDelete(it)">删除</el-button>
                </div>
              </div>
              <div class="note-string" aria-hidden="true"></div>
            </div>
          </template>
        </div>
      </div>
    </section>

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

/* Note Board */
.note-board {
  position: relative;
}

.board-body {
  position: relative;
  padding-top: 24px; /* space for the rope */
}

.board-body::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 6px;
  height: 8px;
  border-radius: 4px;
  background: repeating-linear-gradient(
      90deg,
      var(--rope-color-1),
      var(--rope-color-1) 12px,
      var(--rope-color-2) 12px,
      var(--rope-color-2) 24px
    );
  box-shadow: 0 2px 2px var(--rope-shadow);
  z-index: 0;
}

.board-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.board-title {
  font-weight: 700;
}

.board-stats {
  display: flex;
  gap: 8px;
}

.note-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  align-items: start;
}

/* wrapper for each note to host the free-hanging string outside masked card */
.note-item {
  position: relative;
}

.note-card {
  position: relative;
  background: var(--note-surface);
  color: var(--note-ink);
  border: 1px solid var(--note-border);
  border-radius: 10px;
  padding: 14px 12px 36px 12px;
  box-shadow: var(--note-shadow);
  transform: rotate(var(--tilt, 0deg));
  transition: transform 0.12s ease, box-shadow 0.12s ease;
  /* Real punch hole: bottom-center transparent circle */
  --note-hole-size: 4px; /* radius */
  --note-hole-offset: 10px; /* distance from bottom */
  -webkit-mask-image: radial-gradient(
    circle var(--note-hole-size) at 50% calc(100% - var(--note-hole-offset)),
    transparent 99%,
    #fff 100%
  );
  mask-image: radial-gradient(
    circle var(--note-hole-size) at 50% calc(100% - var(--note-hole-offset)),
    transparent 99%,
    #fff 100%
  );
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

.note-card:hover {
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16), 0 3px 8px rgba(15, 23, 42, 0.1);
  transform: rotate(calc(var(--tilt, 0deg) * 0.3));
}

/* small string connecting note to the rope */
.note-card::before { content: none; }

.note-string {
  position: absolute;
  left: 50%;
  top: -20px;
  transform: translateX(-50%);
  width: 2px;
  height: 20px;
  background: linear-gradient(to bottom, var(--rope-color-2), var(--rope-color-1));
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.1);
  z-index: 3; /* above rope and card */
  pointer-events: none;
}

/* folded corner */
.note-card::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  border-top: 16px solid var(--note-corner);
  border-left: 16px solid transparent;
  filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.06));
}

 

.note-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.note-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}

.note-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #6b7280;
  font-size: 12px;
}

.note-duration {
  color: #64748b;
}

.note-actions {
  position: absolute;
  right: 10px;
  bottom: 8px;
  display: flex;
  gap: 8px;
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
}
</style>
