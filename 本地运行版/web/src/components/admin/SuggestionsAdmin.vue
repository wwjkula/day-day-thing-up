<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { adminListSuggestions, adminReplySuggestion, adminMarkSuggestionRead } from '../../api'

type AdminSuggestion = {
  id: number
  content: string
  readAt: string | null
  createdAt: string
  updatedAt: string
  creator: { id: number; name: string | null; employeeNo: string | null }
  replies: Array<{ id: number; authorUserId: number; authorName?: string | null; content: string; createdAt: string }>
}

const loading = ref(false)
const items = ref<AdminSuggestion[]>([])
const total = ref(0)
const pager = ref({ limit: 50, offset: 0 })
const status = ref<'all' | 'unread' | 'read'>('unread')
const q = ref('')

const replyVisible = ref(false)
const replyTarget = ref<AdminSuggestion | null>(null)
const replyContent = ref('')
const replying = ref(false)

async function load() {
  loading.value = true
  try {
    const params: any = { limit: pager.value.limit, offset: pager.value.offset }
    if (status.value === 'unread' || status.value === 'read') params.status = status.value
    if (q.value.trim()) params.q = q.value.trim()
    const res = await adminListSuggestions(params)
    items.value = res?.items || []
    total.value = res?.total || 0
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败')
  } finally { loading.value = false }
}

function openReply(row: AdminSuggestion) {
  replyTarget.value = row
  replyContent.value = ''
  replyVisible.value = true
}

async function submitReply() {
  if (!replyTarget.value) return
  const text = replyContent.value.trim()
  if (!text) { ElMessage.error('请输入回复内容'); return }
  replying.value = true
  try {
    const r = await adminReplySuggestion(replyTarget.value.id, { content: text })
    if (!r?.ok) throw new Error(r?.error || '回复失败')
    ElMessage.success('已回复')
    replyVisible.value = false
    await load()
  } catch (e: any) {
    ElMessage.error(e?.message || '回复失败')
  } finally { replying.value = false }
}

async function toggleRead(row: AdminSuggestion, nextRead: boolean) {
  try {
    const r = await adminMarkSuggestionRead(row.id, nextRead)
    if (!r?.ok) throw new Error(r?.error || '操作失败')
    await load()
  } catch (e: any) {
    ElMessage.error(e?.message || '操作失败')
  }
}

onMounted(() => load())
</script>

<template>
  <div>
    <div class="toolbar">
      <el-select v-model="status" style="width:120px">
        <el-option label="全部" value="all" />
        <el-option label="未读" value="unread" />
        <el-option label="已读" value="read" />
      </el-select>
      <el-input v-model="q" placeholder="搜索内容" style="width:240px" @keyup.enter="() => { pager.offset = 0; load() }" />
      <el-button :loading="loading" @click="() => { pager.offset = 0; load() }">查询</el-button>
    </div>
    <el-table :data="items" v-loading="loading" style="width:100%">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column label="提交人" min-width="180">
        <template #default="{ row }">
          <div>{{ row.creator?.name || ('用户'+ row.creator?.id) }}</div>
          <div class="dim" v-if="row.creator?.employeeNo">{{ row.creator.employeeNo }}</div>
        </template>
      </el-table-column>
      <el-table-column label="内容">
        <template #default="{ row }">
          <div class="prewrap">{{ row.content }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.readAt ? 'success' : 'warning'">{{ row.readAt ? '已读' : '未读' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="提交时间" width="180">
        <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220">
        <template #default="{ row }">
          <el-button size="small" type="primary" @click="openReply(row)">回复</el-button>
          <el-button size="small" @click="toggleRead(row, !row.readAt)">{{ row.readAt ? '标记未读' : '标记已读' }}</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination background layout="prev, pager, next" :page-size="pager.limit" :total="total" @current-change="(p:number)=>{ pager.offset=(p-1)*pager.limit; load() }" />
    </div>

    <el-dialog v-model="replyVisible" title="回复建议" width="600px">
      <el-input v-model="replyContent" type="textarea" :autosize="{ minRows: 4, maxRows: 12 }" placeholder="输入回复内容" />
      <template #footer>
        <el-button @click="replyVisible=false">取消</el-button>
        <el-button type="primary" :loading="replying" @click="submitReply">发送</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar { margin-bottom: 8px; display: flex; gap: 8px; align-items: center; }
.pager { margin-top: 8px; text-align: right; }
.prewrap { white-space: pre-wrap; }
.dim { color: var(--el-text-color-secondary); font-size: 12px; }
</style>

