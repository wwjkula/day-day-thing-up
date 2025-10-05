<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminGenerateSampleWorkItems, adminClearWorkItems } from '../../api'

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function initialRange(): [string, string] {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 4)
  return [iso(start), iso(end)]
}

const range = ref<[string, string]>(initialRange())
const generating = ref(false)
const clearing = ref(false)

async function handleGenerate() {
  if (!range.value || range.value.length !== 2) {
    ElMessage.error('请选择开始和结束日期')
    return
  }
  const [startDate, endDate] = range.value
  if (!startDate || !endDate) {
    ElMessage.error('请选择开始和结束日期')
    return
  }
  if (startDate > endDate) {
    ElMessage.error('开始日期不能晚于结束日期')
    return
  }
  generating.value = true
  try {
    const result = await adminGenerateSampleWorkItems({ startDate, endDate })
    ElMessage.success(`已生成示例数据：${result.created} 条，覆盖 ${result.processedUsers} 人`)
  } catch (err: any) {
    ElMessage.error(err?.message || '生成示例数据失败')
  } finally {
    generating.value = false
  }
}

async function handleClear() {
  try {
    await ElMessageBox.confirm('此操作会清空所有人员的工作记录与计划，是否继续？', '请确认', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  clearing.value = true
  try {
    const result = await adminClearWorkItems()
    ElMessage.success(`已清空 ${result.cleared} 个用户文件`)
  } catch (err: any) {
    ElMessage.error(err?.message || '清空失败')
  } finally {
    clearing.value = false
  }
}

function resetRange() {
  range.value = initialRange()
}
</script>

<template>
  <div class="work-items-admin">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">批量示例数据</div>
      </template>
      <div class="form-line">
        <el-date-picker
          v-model="range"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="~"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
        />
        <el-button @click="resetRange">重置</el-button>
        <span class="flex-spacer"></span>
        <el-button type="primary" :loading="generating" @click="handleGenerate">生成示例数据</el-button>
      </div>
      <p class="hint">
        提示：示例数据会为每位在职员工在所选范围内生成“工作”记录以及次日的“计划”记录，已生成的示例数据不会重复创建。
      </p>
    </el-card>

    <el-card shadow="never" class="danger-card">
      <template #header>
        <div class="card-header danger">清空全部记录</div>
      </template>
      <div class="form-line">
        <el-alert type="warning" show-icon :closable="false" title="此操作不可撤销，将删除所有工作记录与计划。" />
        <el-button type="danger" :loading="clearing" @click="handleClear">清空所有记录</el-button>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.work-items-admin {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-line {
  display: flex;
  align-items: center;
  gap: 12px;
}

.flex-spacer {
  flex: 1;
}

.hint {
  margin-top: 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.danger-card .card-header.danger {
  color: var(--el-color-danger);
}

.card-header {
  font-weight: 600;
}
</style>
