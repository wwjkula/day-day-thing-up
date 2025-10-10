<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { listMySuggestions, postSuggestion, type SuggestionItem } from '../api'

const visible = defineModel<boolean>('visible', { required: true })

const content = ref('')
const submitting = ref(false)
const loading = ref(false)
const items = ref<SuggestionItem[]>([])

async function loadList() {
  loading.value = true
  try {
    const res = await listMySuggestions({ limit: 50, offset: 0 })
    items.value = res?.items || []
  } catch (err: any) {
    items.value = []
  } finally {
    loading.value = false
  }
}

async function submit() {
  const text = (content.value || '').trim()
  if (!text) {
    ElMessage.error('请输入建议内容')
    return
  }
  submitting.value = true
  try {
    const r = await postSuggestion({ content: text })
    if (!r?.ok) throw new Error(r?.error || '提交失败')
    ElMessage.success('已提交')
    content.value = ''
    await loadList()
  } catch (e: any) {
    ElMessage.error(e?.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

watch(visible, (v) => {
  if (v) loadList()
})

onMounted(() => {
  if (visible.value) loadList()
})
</script>

<template>
  <el-dialog v-model="visible" title="意见反馈" width="680px">
    <div class="suggestion-form">
      <el-form label-width="80px" @submit.prevent>
        <el-form-item label="内容">
          <el-input
            v-model="content"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 12 }"
            placeholder="请描述你的建议或问题"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
        </el-form-item>
      </el-form>
    </div>

    <el-divider />

    <div class="my-suggestions" v-loading="loading">
      <div class="section-title">我的建议</div>
      <el-empty v-if="!loading && items.length === 0" description="暂无提交记录" />
      <el-timeline v-else>
        <el-timeline-item
          v-for="it in items"
          :key="it.id"
          :timestamp="new Date(it.createdAt).toLocaleString()"
          placement="top"
          type="primary"
        >
          <div class="item">
            <div class="item-header">
              <span class="status" :class="{ unread: !it.readAt }">{{ it.readAt ? '已读' : '未读' }}</span>
              <span class="sep">·</span>
              <span class="id">#{{ it.id }}</span>
            </div>
            <div class="content">{{ it.content }}</div>
            <div v-if="it.replies?.length" class="replies">
              <div class="reply" v-for="r in it.replies" :key="r.id">
                <el-tag size="small" type="info">管理员回复</el-tag>
                <span class="reply-meta">{{ new Date(r.createdAt).toLocaleString() }} · {{ r.authorName || r.authorUserId }}</span>
                <div class="reply-content">{{ r.content }}</div>
              </div>
            </div>
          </div>
        </el-timeline-item>
      </el-timeline>
    </div>
  </el-dialog>
  
</template>

<style scoped>
.suggestion-form { margin-bottom: 4px; }
.section-title { font-weight: 600; margin-bottom: 8px; }
.item-header { color: var(--el-text-color-secondary); margin-bottom: 6px; display:flex; align-items:center; gap:6px; }
.status { font-size: 12px; color: #16a34a; }
.status.unread { color: #f59e0b; }
.content { white-space: pre-wrap; line-height: 1.6; }
.replies { margin-top: 10px; padding-left: 6px; display: flex; flex-direction: column; gap: 8px; }
.reply-meta { margin-left: 8px; color: var(--el-text-color-secondary); font-size: 12px; }
.reply-content { margin-top: 4px; white-space: pre-wrap; }
</style>

