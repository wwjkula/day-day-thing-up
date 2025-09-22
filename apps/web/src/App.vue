<script setup lang="ts">
import { onMounted, ref } from 'vue'
import QuickFill from './components/QuickFill.vue'
import MyRecords from './components/MyRecords.vue'
import WeeklyReport from './components/WeeklyReport.vue'
import AdminPanel from './components/admin/AdminPanel.vue'
import Login from './components/Login.vue'
import { getMe } from './api'

const activeTab = ref<'quick'|'mine'|'weekly'|'admin'>('quick')
const user = ref<any | null>(null)
const loading = ref(false)

async function refreshMe() {
  if (!window.__AUTH__) { user.value = null; return }
  loading.value = true
  try {
    const r = await getMe()
    user.value = r?.user || null
  } catch { user.value = null } finally { loading.value = false }
}

function onLoggedIn() { refreshMe() }
function logout() { try { localStorage.removeItem('AUTH') } catch {}; (window as any).__AUTH__ = ''; user.value = null }

onMounted(() => { refreshMe() })
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
          <span style="margin-right:8px">{{ user?.name || '未命名' }}</span>
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
  </div>
</template>

<style scoped>
.container { max-width: 900px; margin: 0 auto; padding: 16px; }
.topbar { display:flex; align-items:center; justify-content:space-between; margin-bottom: 12px; }
.title { font-size: 18px; font-weight: 600; }
.login-container { max-width: 900px; margin: 0 auto; padding: 16px; }
.loading { max-width: 900px; margin: 40px auto; text-align:center; color: #666; }
</style>
