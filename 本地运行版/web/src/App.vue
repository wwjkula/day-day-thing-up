<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import QuickFill from './components/QuickFill.vue'
import MyRecords from './components/MyRecords.vue'
import WeeklyReport from './components/WeeklyReport.vue'
import AdminPanel from './components/admin/AdminPanel.vue'
import Login from './components/Login.vue'
import ChangePassword from './components/ChangePassword.vue'
import { getMe, adminMigrateToR2 } from './api'

const activeTab = ref<'quick' | 'mine' | 'weekly' | 'admin'>('quick')
const user = ref<any | null>(null)
const loading = ref(false)
const cpVisible = ref(false)
const migrating = ref(false)

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
  } catch {}
  ;(window as any).__AUTH__ = ''
  user.value = null
  activeTab.value = 'quick'
}

onMounted(() => {
  refreshMe()
})
</script>

<template>
  <div>
    <div v-if="!user && !loading" class="login-container">
      <Login @logged-in="onLoggedIn" />
    </div>
    <div v-else-if="loading" class="loading">加载中...</div>
    <div v-else class="container">
      <div class="topbar">
        <div class="title">日事日清 · MVP</div>
        <div class="user">
          <span class="user-name">{{ user?.name || '未命名' }}</span>
          <el-button v-if="user?.isAdmin" size="small" type="warning" :loading="migrating" @click="migrateData">数据迁移</el-button>
          <el-button size="small" @click="cpVisible = true">修改密码</el-button>
          <el-button size="small" @click="logout">退出</el-button>
        </div>
      </div>
      <el-tabs v-model="activeTab" type="border-card">
        <el-tab-pane label="快速填报" name="quick">
          <QuickFill />
        </el-tab-pane>
        <el-tab-pane label="我的记录" name="mine">
          <MyRecords />
        </el-tab-pane>
        <el-tab-pane label="周报" name="weekly">
          <WeeklyReport />
        </el-tab-pane>
        <el-tab-pane v-if="user?.isAdmin" label="管理" name="admin">
          <AdminPanel />
        </el-tab-pane>
      </el-tabs>
    </div>
    <ChangePassword v-model:visible="cpVisible" />
  </div>
</template>

<style scoped>
.container {
  max-width: 900px;
  margin: 0 auto;
  padding: 16px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.user {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-name {
  margin-right: 8px;
}

.title {
  font-size: 18px;
  font-weight: 600;
}

.login-container {
  max-width: 900px;
  margin: 0 auto;
  padding: 16px;
}

.loading {
  max-width: 900px;
  margin: 40px auto;
  text-align: center;
  color: #666;
}
</style>
