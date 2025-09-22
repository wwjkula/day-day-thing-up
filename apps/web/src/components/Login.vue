<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { authLogin } from '../api'

const loading = ref(false)
const form = ref<{ employeeNo: string; password: string }>({ employeeNo: '', password: '' })

const emit = defineEmits<{ (e: 'logged-in', user: any): void }>()

async function onSubmit() {
  if (!form.value.employeeNo.trim()) {
    ElMessage.error('请输入工号')
    return
  }
  loading.value = true
  try {
    const r = await authLogin({ employeeNo: form.value.employeeNo.trim(), password: form.value.password })
    if (!r?.ok) throw new Error(r?.error || '登录失败')
    const token = r.token as string
    // persist token
    window.__AUTH__ = token
    try { localStorage.setItem('AUTH', token) } catch {}
    emit('logged-in', r.user)
    ElMessage.success('登录成功')
  } catch (e: any) {
    ElMessage.error(e?.message || '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-card">
      <h3 style="margin-bottom:12px">登录 · 日事日清</h3>
      <el-form :model="form" label-width="80px">
        <el-form-item label="工号">
          <el-input v-model="form.employeeNo" placeholder="请输入工号，如 D0101" @keyup.enter.native="onSubmit" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password placeholder="如未设置密码可留空" @keyup.enter.native="onSubmit" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSubmit">登录</el-button>
        </el-form-item>
      </el-form>
      <div class="hint">如该账号尚未设置密码，可直接留空密码登录；建议登录后尽快在右上角“修改密码”。</div>
    </div>
  </div>
</template>

<style scoped>
.login-wrap { display:flex; align-items:center; justify-content:center; min-height: 80vh; }
.login-card { width: 360px; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background: #fff; }
.hint { color:#888; font-size:12px; }
</style>

