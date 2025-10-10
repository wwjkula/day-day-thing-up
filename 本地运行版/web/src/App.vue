<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Calendar, Document, EditPen, Moon, Setting, Sunny } from '@element-plus/icons-vue'
import QuickFill from './components/QuickFill.vue'
import MyRecords from './components/MyRecords.vue'
import WeeklyReport from './components/WeeklyReport.vue'
import AdminPanel from './components/admin/AdminPanel.vue'
import Login from './components/Login.vue'
import ChangePassword from './components/ChangePassword.vue'
import SuggestionCenter from './components/SuggestionCenter.vue'
import { getMe, adminMigrateToR2 } from './api'

const activeTab = ref<'quick' | 'mine' | 'weekly' | 'admin'>('quick')
const user = ref<any | null>(null)
const loading = ref(false)
const cpVisible = ref(false)
const suggVisible = ref(false)
const migrating = ref(false)

const THEME_STORAGE_KEY = 'APP_THEME'
const prefersDark =
  typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

let storedTheme: 'light' | 'dark' | null = null
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') {
      storedTheme = saved
    }
  } catch {
    storedTheme = null
  }
}

const hasManualTheme = ref(Boolean(storedTheme))
const theme = ref<'light' | 'dark'>(storedTheme ?? 'dark')

function applyTheme(mode: 'light' | 'dark') {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', mode === 'dark')
}

function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
  hasManualTheme.value = true
}

if (prefersDark) {
  prefersDark.addEventListener('change', (event) => {
    if (hasManualTheme.value) return
    theme.value = event.matches ? 'dark' : 'light'
  })
}

watch(theme, (mode) => {
  applyTheme(mode)
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode)
    } catch {
      /* ignore */
    }
  }
})

const userInitial = computed(() => {
  const label = (user.value?.name || user.value?.employeeNo || '用').trim()
  return label ? label[0] : '用'
})

async function refreshMe() {
  if (!window.__AUTH__) {
    user.value = null
    return
  }
  loading.value = true
  try {
    const response = await getMe()
    user.value = response?.user ?? null
  } catch {
    user.value = null
  } finally {
    loading.value = false
  }
}

async function ensureUserLoaded() {
  if (user.value || !window.__AUTH__) return
  await refreshMe()
}

async function migrateData() {
  if (!window.__AUTH__) {
    ElMessage.error('请先使用管理员账号登录')
    return
  }
  await ensureUserLoaded()
  if (!user.value?.isAdmin) {
    ElMessage.error('仅管理员可以执行数据迁移')
    return
  }
  if (!window.confirm('确认将 Neon 数据库中的数据迁移到 R2 存储？该操作可能耗时较长。')) {
    return
  }
  migrating.value = true
  try {
    const result = await adminMigrateToR2()
    if (!result?.ok) {
      throw new Error(result?.error || '迁移失败')
    }
    ElMessage.success('迁移完成')
  } catch (err: any) {
    ElMessage.error(err?.message || '迁移失败')
  } finally {
    migrating.value = false
  }
}

function onLoggedIn(newUser: any) {
  user.value = newUser ?? null
  activeTab.value = 'quick'
  refreshMe()
}

function logout() {
  try {
    localStorage.removeItem('AUTH')
  } catch {
    /* ignore */
  }
  ;(window as any).__AUTH__ = ''
  user.value = null
  activeTab.value = 'quick'
}

onMounted(() => {
  applyTheme(theme.value)
  refreshMe()
})
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="header-left">
        <div class="brand-mark">日</div>
        <div class="brand-copy">
          <div class="brand-title">日事日清 · 周度汇总</div>
        </div>
      </div>
      <div class="header-right">
        <el-tooltip :content="theme === 'dark' ? '切换为浅色模式' : '切换为暗色模式'">
          <el-button class="theme-toggle" text circle @click="toggleTheme">
            <el-icon>
              <component :is="theme === 'dark' ? Sunny : Moon" />
            </el-icon>
          </el-button>
        </el-tooltip>
        <div v-if="user" class="header-user">
          <div class="header-user__avatar">{{ userInitial }}</div>
          <div class="header-user__meta">
            <div class="header-user__name">
              {{ user?.name || '未命名用户' }}
              <el-tag v-if="user?.isAdmin" size="small" type="warning" effect="plain">管理员</el-tag>
            </div>
            <div v-if="user?.orgName" class="header-user__org">{{ user.orgName }}</div>
          </div>
        </div>
      </div>
    </header>
    <main class="app-main">
      <div v-if="!user && !loading" class="auth-container">
        <Login @logged-in="onLoggedIn" />
      </div>
      <div v-else-if="loading" class="loading-state">
        <el-skeleton :rows="5" animated />
      </div>
      <div v-else class="workspace">
        <div class="workspace-top">
          <div class="workspace-title-group">
            <div class="workspace-title">欢迎回来，{{ user?.name || '未命名用户' }}</div>
            <div class="workspace-subtitle">
              继续保持日清日进的节奏，周报一目了然。
            </div>
          </div>
        <div class="workspace-actions">
          <el-button plain @click="suggVisible = true">意见反馈</el-button>
          <el-button
            v-if="user?.isAdmin"
            type="warning"
            plain
            :loading="migrating"
              @click="migrateData"
            >
              数据迁移
            </el-button>
            <el-button plain @click="cpVisible = true">修改密码</el-button>
            <el-button type="primary" @click="logout">退出</el-button>
          </div>
        </div>
        <el-tabs v-model="activeTab" type="card" class="workspace-tabs">
          <el-tab-pane name="quick">
            <template #label>
              <el-icon><EditPen /></el-icon>
              <span>快速填报</span>
            </template>
            <QuickFill />
          </el-tab-pane>
          <el-tab-pane name="mine">
            <template #label>
              <el-icon><Document /></el-icon>
              <span>我的记录</span>
            </template>
            <MyRecords />
          </el-tab-pane>
          <el-tab-pane name="weekly">
            <template #label>
              <el-icon><Calendar /></el-icon>
              <span>周报洞察</span>
            </template>
            <WeeklyReport />
          </el-tab-pane>
          <el-tab-pane v-if="user?.isAdmin" name="admin">
            <template #label>
              <el-icon><Setting /></el-icon>
              <span>管理中心</span>
            </template>
            <AdminPanel />
          </el-tab-pane>
        </el-tabs>
      </div>
      <ChangePassword v-model:visible="cpVisible" />
      <SuggestionCenter v-model:visible="suggVisible" />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  background: var(--app-bg-color);
  display: flex;
  flex-direction: column;
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 36px;
  background: var(--app-surface-muted);
  backdrop-filter: blur(22px);
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.brand-mark {
  width: 40px;
  height: 40px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--el-color-primary), var(--el-color-primary-light-3));
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 2px;
}

.brand-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.brand-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--app-text-color);
}

.brand-subtitle {
  font-size: 12px;
  color: var(--app-text-secondary);
  letter-spacing: 0.4px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.theme-toggle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid transparent;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

.theme-toggle:hover {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.25);
}

.header-user {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 14px 6px 6px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.18);
}

.dark .header-user {
  background: rgba(59, 130, 246, 0.18);
  border-color: rgba(59, 130, 246, 0.28);
}

.header-user__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--el-color-primary-dark-2), var(--el-color-primary));
  color: #fff;
  font-weight: 600;
}

.header-user__meta {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.header-user__name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text-color);
}

.header-user__org {
  font-size: 12px;
  color: var(--app-text-secondary);
}

.app-main {
  flex: 1;
  display: flex;
  justify-content: center;
  padding: 32px 24px 48px;
}

.auth-container,
.loading-state,
.workspace {
  width: min(1120px, 100%);
}

.auth-container {
  display: flex;
  justify-content: center;
  padding-top: 40px;
}

.loading-state {
  margin-top: 64px;
  background: var(--app-surface-color);
  border-radius: 18px;
  padding: 32px;
  border: 1px solid var(--app-border-color);
  box-shadow: var(--el-box-shadow-light);
}

.workspace {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.workspace-top {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  padding: 24px;
  border-radius: 20px;
  background: var(--app-surface-color);
  border: 1px solid var(--app-border-color);
  box-shadow: var(--el-box-shadow-light);
}

.workspace-title-group {
  max-width: 60%;
}

.workspace-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--app-text-color);
}

.workspace-subtitle {
  margin-top: 6px;
  color: var(--app-text-secondary);
  font-size: 13px;
}

.workspace-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.workspace-tabs :deep(.el-tabs__header) {
  margin: 0;
  border-bottom: none;
  padding: 0;
}

.workspace-tabs :deep(.el-tabs__nav) {
  border: none;
}

.workspace-tabs :deep(.el-tabs__item) {
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 10px 18px;
  margin-right: 12px;
  color: var(--app-text-secondary);
  background: rgba(59, 130, 246, 0.08);
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  line-height: 1;
}

.workspace-tabs :deep(.el-tabs__item .el-icon) {
  font-size: 16px;
}

.workspace-tabs :deep(.el-tabs__item.is-active) {
  color: #fff;
  background: linear-gradient(135deg, var(--el-color-primary), var(--el-color-primary-dark-2));
  box-shadow: var(--el-box-shadow-light);
}

.workspace-tabs :deep(.el-tabs__content) {
  margin-top: 18px;
}

@media (max-width: 960px) {
  .app-header {
    padding: 16px 24px;
  }

  .workspace-top {
    flex-direction: column;
    align-items: flex-start;
  }

  .workspace-title-group {
    max-width: 100%;
  }

  .workspace-actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .workspace-tabs :deep(.el-tabs__item) {
    margin-bottom: 8px;
  }
}
</style>
