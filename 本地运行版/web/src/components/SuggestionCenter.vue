<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { ChatLineRound } from '@element-plus/icons-vue'
import { listMySuggestions, postSuggestion, type SuggestionItem } from '../api'

const visible = defineModel<boolean>('visible', { required: true })

const content = ref('')
const submitting = ref(false)
const loading = ref(false)
const items = ref<SuggestionItem[]>([])
const filter = ref<'all' | 'unread' | 'read'>('all')
const expanded = ref<Set<number>>(new Set())

const STORAGE_KEY = 'SUGGESTION_DRAFT'

const filteredItems = computed(() => {
  const list = items.value || []
  if (filter.value === 'unread') return list.filter((i) => !i.readAt)
  if (filter.value === 'read') return list.filter((i) => !!i.readAt)
  return list
})

function toggleExpand(id: number) {
  const set = new Set(expanded.value)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  expanded.value = set
}

function isExpanded(id: number) {
  return expanded.value.has(id)
}

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
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
    await loadList()
  } catch (e: any) {
    ElMessage.error(e?.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    submit()
  }
}

watch(content, (v) => {
  try { localStorage.setItem(STORAGE_KEY, v ?? '') } catch {}
})

watch(visible, (v) => {
  if (v) {
    try { const d = localStorage.getItem(STORAGE_KEY); if (d) content.value = d } catch {}
    loadList()
  }
})

onMounted(() => {
  if (visible.value) loadList()
})
</script>

<template>
  <el-dialog v-model="visible" width="820px" class="sugg-dialog">
    <template #header>
      <div class="dlg-header">
        <div class="hdr-icon"><el-icon><ChatLineRound /></el-icon></div>
        <div class="hdr-meta">
          <div class="hdr-title">意见反馈</div>
          <div class="hdr-sub">你的想法很重要 · 帮助我们做得更好</div>
        </div>
      </div>
    </template>

    <div class="sugg-body">
      <!-- Left: compose -->
      <section class="compose">
        <div class="card">
          <div class="compose-title">写下你的建议</div>
          <el-input
            v-model="content"
            type="textarea"
            :autosize="{ minRows: 8, maxRows: 12 }"
            placeholder="请描述你的建议或问题，Ctrl/⌘ + Enter 可快速提交"
            @keydown="onKeydown"
          />
          <div class="compose-toolbar">
            <div class="hint">每小时最多 5 条</div>
            <span class="spacer"></span>
            <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
          </div>
        </div>
      </section>

      <!-- Right: history -->
      <section class="history">
        <div class="history-head">
          <div class="history-title">我的建议</div>
          <el-radio-group v-model="filter" size="small">
            <el-radio-button label="all">全部</el-radio-button>
            <el-radio-button label="unread">未读</el-radio-button>
            <el-radio-button label="read">已读</el-radio-button>
          </el-radio-group>
        </div>
        <div class="list" v-loading="loading">
          <template v-if="loading">
            <el-skeleton :rows="5" animated />
          </template>
          <template v-else>
            <el-empty v-if="filteredItems.length === 0" description="暂无提交记录" />
            <div v-else class="cards">
              <div v-for="it in filteredItems" :key="it.id" class="sugg-card" :class="{ unread: !it.readAt }">
                <div class="sugg-card__head">
                  <el-tag :type="it.readAt ? 'success' : 'warning'" effect="plain" size="small">{{ it.readAt ? '已读' : '未读' }}</el-tag>
                  <span class="muted">#{{ it.id }}</span>
                  <span class="muted">· {{ new Date(it.createdAt).toLocaleString() }}</span>
                  <span class="spacer"></span>
                  <el-button text size="small" @click="toggleExpand(it.id)">{{ isExpanded(it.id) ? '收起' : '展开' }}</el-button>
                </div>
                <div class="sugg-card__content" :class="{ collapsed: !isExpanded(it.id) }">{{ it.content }}</div>
                <div v-if="it.replies?.length" class="sugg-card__replies">
                  <div class="reply" v-for="r in it.replies" :key="r.id">
                    <div class="reply-meta">
                      <el-tag size="small" type="info">管理员回复</el-tag>
                      <span class="muted">{{ new Date(r.createdAt).toLocaleString() }} · {{ r.authorName || r.authorUserId }}</span>
                    </div>
                    <div class="reply-content">{{ r.content }}</div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </section>
    </div>
  </el-dialog>
</template>

<style scoped>
.sugg-dialog :deep(.el-dialog__header) { margin: 0; padding: 0; }
.sugg-dialog :deep(.el-dialog__body) { padding: 0; }

.dlg-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px;
  background: linear-gradient(135deg, var(--el-color-primary), var(--el-color-primary-light-3));
  color: #fff;
}
.hdr-icon { width: 36px; height: 36px; display:flex; align-items:center; justify-content:center; background: rgba(255,255,255,0.2); border-radius: 10px; }
.hdr-meta { display:flex; flex-direction: column; }
.hdr-title { font-weight: 700; }
.hdr-sub { opacity: 0.9; font-size: 12px; }

.sugg-body {
  display: grid;
  grid-template-columns: 2.4fr 3.6fr; /* ~40% / 60% */
  gap: 16px;
  padding: 16px;
  background: var(--app-surface-color);
}

.compose .card {
  border: 1px solid var(--app-border-color);
  border-radius: 16px;
  padding: 16px;
  background: var(--app-surface-color);
  box-shadow: var(--el-box-shadow-light);
}
.compose-title { font-weight: 600; margin-bottom: 8px; color: var(--app-text-color); }
.compose-toolbar { display:flex; align-items:center; margin-top: 10px; }
.compose .hint { color: var(--app-text-secondary); font-size: 12px; }
.spacer { flex: 1; }

.history .history-head { display:flex; align-items:center; gap: 10px; margin-bottom: 8px; }
.history-title { font-weight: 600; color: var(--app-text-color); }
.list { border: 1px solid var(--app-border-color); border-radius: 16px; padding: 12px; background: var(--app-surface-color); box-shadow: var(--el-box-shadow-light); min-height: 160px; }

.cards { display: flex; flex-direction: column; gap: 12px; }
.sugg-card { border: 1px solid var(--app-border-color); border-radius: 12px; padding: 12px; background: var(--app-surface-color); box-shadow: var(--el-box-shadow-lighter); }
.sugg-card.unread { border-color: rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.08); }
.sugg-card__head { display:flex; align-items:center; gap: 8px; margin-bottom: 6px; }
.muted { color: var(--app-text-secondary); font-size: 12px; }
.sugg-card__content { white-space: pre-wrap; line-height: 1.6; }
.sugg-card__content.collapsed { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.sugg-card__replies { margin-top: 8px; display:flex; flex-direction: column; gap: 8px; }
.reply { border-left: 2px solid var(--el-color-primary); background: rgba(59, 130, 246, 0.06); border-radius: 8px; padding: 8px 10px; }
.dark .reply { background: rgba(59, 130, 246, 0.12); }
.reply-meta { display:flex; align-items:center; gap: 8px; margin-bottom: 4px; }
.reply-content { white-space: pre-wrap; }

@media (max-width: 960px) {
  .sugg-body { grid-template-columns: 1fr; }
}
</style>
