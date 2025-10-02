<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { authLogin } from '../api'

const props = defineProps<{ migrating?: boolean }>()

const emit = defineEmits<{
  (e: 'logged-in', user: any): void
  (e: 'run-migration'): void
}>()

const loading = ref(false)
const form = ref<{ employeeNo: string; password: string }>({ employeeNo: '', password: '' })

async function onSubmit() {
  if (!form.value.employeeNo.trim()) {
    ElMessage.error('请输入工号')
    return
  }
  loading.value = true
  try {
    const response = await authLogin({ employeeNo: form.value.employeeNo.trim(), password: form.value.password })
    if (!response?.ok) {
      throw new Error(response?.error || '登录失败')
    }
    const token = String(response.token || '')
    ;(window as any).__AUTH__ = token
    try {
      localStorage.setItem('AUTH', token)
    } catch {}
    emit('logged-in', response.user)
    ElMessage.success('登录成功')
  } catch (err: any) {
    ElMessage.error(err?.message || '登录失败')
  } finally {
    loading.value = false
  }
}

function onRunMigration() {
  if (loading.value || props.migrating) return
  emit('run-migration')
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-card">
      <h3 class="login-title">日事日清 · 周度汇总</h3>
      <el-form :model="form" label-width="80px">
        <el-form-item label="工号">
          <el-input v-model="form.employeeNo" placeholder="请输入工号，例如 D0101" @keyup.enter.native="onSubmit" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password placeholder="如未设置密码可留空" @keyup.enter.native="onSubmit" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSubmit">登录</el-button>
          <el-button type="warning" plain :loading="props.migrating" style="margin-left: 8px" @click="onRunMigration">运行数据迁移</el-button>
        </el-form-item>
      </el-form>
      <div class="hint">如该账号尚未设置密码，可直接留空密码登录；建议登录后尽快在右上角“修改密码”完成设置。</div>
    </div>
  </div>
</template>

<style scoped>
.login-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80vh;
}

.login-card {
  width: 360px;
  padding: 20px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
}

.login-title {
  margin-bottom: 12px;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  text-align: center;
}

.hint {
  margin-top: 12px;
  color: #888;
  font-size: 12px;
  line-height: 1.5;
}
</style>
