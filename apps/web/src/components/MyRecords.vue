<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { ListWorkItemsResponse, WorkItemResponse } from '@drrq/shared/index'

const items = ref<WorkItemResponse[]>([])
const loading = ref(false)
const range = ref<{ from: string; to: string }>((() => {
  const now = new Date()
  const day = (now.getUTCDay() + 6) % 7 // Monday=0
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day))
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (6 - day)))
  return { from: monday.toISOString().slice(0,10), to: sunday.toISOString().slice(0,10) }
})())

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({ from: range.value.from, to: range.value.to, scope: 'self' })
    const res = await fetch(`/api/work-items?${params}`, {
      headers: { ...(window.__AUTH__ ? { Authorization: `Bearer ${window.__AUTH__}` } : {}) }
    })
    const j: ListWorkItemsResponse = await res.json()
    items.value = j.items
  } finally {
    loading.value = false
  }
}

onMounted(() => { load() })
</script>

<template>
  <div class="my-records">
    <div class="toolbar">
      <el-date-picker v-model="range.from" type="date" value-format="YYYY-MM-DD" />
      <span style="margin:0 8px">~</span>
      <el-date-picker v-model="range.to" type="date" value-format="YYYY-MM-DD" />
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>
    <el-table :data="items" v-loading="loading" style="width: 100%">
      <el-table-column prop="workDate" label="日期" width="120" />
      <el-table-column prop="title" label="标题" />
      <el-table-column prop="type" label="类型" width="100" />
      <el-table-column prop="durationMinutes" label="时长(分钟)" width="120" />
    </el-table>
  </div>
</template>

<style scoped>
.my-records { margin-top: 16px; padding: 12px; border: 1px solid var(--el-border-color); border-radius: 8px; }
.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
</style>

