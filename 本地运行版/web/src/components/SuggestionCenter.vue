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
    // Reset filter to 'all' every time dialog opens
    filter.value = 'all'
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
        <div class="hdr-left">
          <div class="hdr-icon"><el-icon><ChatLineRound /></el-icon></div>
          <div class="hdr-meta">
            <div class="hdr-title">意见反馈</div>
            <div class="hdr-sub">你的想法很重要 · 帮助我们做得更好</div>
          </div>
        </div>
        <div class="hdr-right">
          <div class="segmented">
            <button :class="{active: filter==='all'}" @click="filter='all'">全部</button>
            <button :class="{active: filter==='unread'}" @click="filter='unread'">未读</button>
            <button :class="{active: filter==='read'}" @click="filter='read'">已读</button>
          </div>
        </div>
        <div class="hdr-topline"></div>
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
            <el-button class="btn-ghost" @click="content = ''">清空</el-button>
            <el-button class="btn-primary" :loading="submitting" @click="submit">提交</el-button>
          </div>
        </div>
      </section>

      <!-- Right: history -->
      <section class="history">
        <div class="history-head">
          <div class="history-title">我的建议</div>
        </div>
        <div class="list" v-loading="loading">
          <template v-if="loading">
            <el-skeleton :rows="5" animated />
          </template>
          <template v-else>
            <el-empty v-if="filteredItems.length === 0" description="暂无提交记录" />
            <el-scrollbar v-else class="cards">
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
            </el-scrollbar>
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
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  /* Horizontal gradient: left colored -> long gentle fade to transparent */
  background: linear-gradient(
      90deg,
      var(--el-color-primary) 0%,
      var(--el-color-primary-light-3) 34%,
      rgb(147 197 253 / 0.28) 52%,
      rgb(147 197 253 / 0.18) 62%,
      rgb(147 197 253 / 0.10) 74%,
      rgb(147 197 253 / 0.04) 88%,
      transparent 100%
    ),
    var(--el-bg-color);
  color: #fff;
}
.hdr-left { display:flex; align-items:center; gap: 12px; }
.hdr-right { display:flex; align-items:center; }
.hdr-topline { position:absolute; left:0; right:0; top:0; height:1px; background: rgba(255,255,255,0.6); opacity: .35; }
.hdr-icon { width: 36px; height: 36px; display:flex; align-items:center; justify-content:center; background: rgba(255,255,255,0.22); border-radius: 10px; box-shadow: inset 0 1px 0 rgba(255,255,255,.45); }
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
  position: relative;
  border-radius: 16px;
  padding: 16px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow: 0 12px 30px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06);
  backdrop-filter: blur(12px);
}
.compose-title { font-weight: 600; margin-bottom: 8px; color: var(--app-text-color); }
.compose-toolbar { display:flex; align-items:center; margin-top: 10px; }
.compose .hint { color: var(--app-text-secondary); font-size: 12px; }
.spacer { flex: 1; }

.history .history-head { display:flex; align-items:center; gap: 10px; margin-bottom: 8px; }
.history-title { font-weight: 600; color: var(--app-text-color); }
.list { border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 12px; background: rgba(255,255,255,0.06); box-shadow: 0 12px 30px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06); min-height: 100px; backdrop-filter: blur(12px); }

.cards { display: flex; flex-direction: column; gap: 12px; max-height: 420px; }
.sugg-card { position:relative; border: 1px solid rgba(255,255,255,0.10); border-radius: 14px; padding: 12px; background: rgba(255,255,255,0.06); box-shadow: 0 10px 24px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.06); transition: transform .12s ease, box-shadow .12s ease; backdrop-filter: blur(10px); }
.sugg-card:hover { transform: translateY(-1px) scale(1.005); box-shadow: 0 14px 32px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06); }
.sugg-card.unread { border-color: rgba(255, 196, 0, 0.25); background: rgba(255, 196, 0, 0.08); }
.sugg-card::before { content: ''; position: absolute; left: 8px; top: 10px; bottom: 10px; width: 2px; border-radius: 2px; background: linear-gradient(180deg, var(--el-color-primary), var(--el-color-primary-light-3)); opacity: .9; }
.sugg-card__head { display:flex; align-items:center; gap: 8px; margin-bottom: 6px; }
.muted { color: var(--app-text-secondary); font-size: 12px; }
.sugg-card__content { white-space: pre-wrap; line-height: 1.6; }
.sugg-card__content.collapsed { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.sugg-card__replies { margin-top: 8px; display:flex; flex-direction: column; gap: 8px; }
.reply { border-left: 2px solid var(--el-color-primary); background: rgba(59, 130, 246, 0.06); border-radius: 8px; padding: 8px 10px; }
.dark .reply { background: rgba(59, 130, 246, 0.12); }
.reply-meta { display:flex; align-items:center; gap: 8px; margin-bottom: 4px; }
.reply-content { white-space: pre-wrap; }

/* Segmented control (header) */
.segmented { display:inline-flex; align-items:center; padding: 4px; gap: 4px; background: rgba(15,23,42,0.06); backdrop-filter: blur(8px); border: 1px solid rgba(15,23,42,0.12); border-radius: 999px; box-shadow: inset 0 1px 0 rgba(255,255,255,.5); }
.segmented button { appearance:none; border:none; background: transparent; color: var(--app-text-color); padding: 6px 12px; border-radius: 999px; cursor: pointer; font-size: 12px; opacity: .92; transition: all .12s ease; }
.segmented button:hover { opacity: 1; }
.segmented button.active { background: linear-gradient(135deg, #5EA0FF, #5DE0FF); color: #0b1220; box-shadow: 0 6px 18px rgba(94,160,255,.35); }

/* Dark theme overrides for segmented */
.dark .segmented { background: rgba(255,255,255,0.14); border-color: rgba(255,255,255,0.25); box-shadow: inset 0 1px 0 rgba(255,255,255,.35); }
.dark .segmented button { color:#fff; }
.dark .segmented button:hover { background: rgba(255,255,255,0.08); }

/* Neon primary & ghost button */
.btn-primary { background: linear-gradient(135deg,#5EA0FF,#5DE0FF); color:#0b1220; border:none; box-shadow: 0 10px 24px rgba(94,160,255,.35), 0 0 0 2px rgba(94,160,255,.25) inset; }
.btn-primary:hover { filter: brightness(1.02); }
.btn-primary:active { transform: translateY(1px); }
.btn-ghost { background: transparent; border: 1px solid rgba(255,255,255,0.25); color: #fff; }
.btn-ghost:hover { background: rgba(255,255,255,0.06); }

@media (max-width: 960px) {
  .sugg-body { grid-template-columns: 1fr; }
}

/* Textarea neon focus */
.sugg-body :deep(.el-textarea__inner) { border-radius: 12px; }
.sugg-body :deep(.el-textarea.is-focus .el-textarea__inner),
.sugg-body :deep(.el-textarea__inner:focus) {
  box-shadow: inset 0 0 0 1px rgba(94,160,255,.65), 0 0 0 2px rgba(94,160,255,.2), 0 10px 26px rgba(94,160,255,.18);
}
</style>
