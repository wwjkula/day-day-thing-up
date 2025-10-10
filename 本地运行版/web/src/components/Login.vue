<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import { authLogin } from '../api'

const emit = defineEmits<{
  (e: 'logged-in', user: any): void
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
</script>

<template>
  <div class="login-aurora">
    <!-- Aurora background layer -->
    <div class="aurora-layer" aria-hidden="true"></div>

    <section class="login-surface">
      <!-- Brand + Inline Auth (single column) -->
      <div class="brand-pane">
        <div class="brand-header">
          <div class="brand-text">
            <h1 class="brand-title">日事日清 · 周度汇总系统</h1>
            <p class="brand-sub">专注当下，痕迹有据。轻松记录，提效每一天。</p>
          </div>
          <img class="brand-logo" src="/logo-company.png" alt="中国电建" />
        </div>

        <ul class="auth-list">
          <li class="auth-item">
            <span class="point-icon"><el-icon><User /></el-icon></span>
            <el-input
              v-model="form.employeeNo"
              @keyup.enter.native="onSubmit"
            />
          </li>
          <li class="auth-item">
            <span class="point-icon"><el-icon><Lock /></el-icon></span>
            <el-input
              v-model="form.password"
              type="password"
              show-password
              @keyup.enter.native="onSubmit"
            />
          </li>
          <li class="auth-item actions">
            <span class="point-icon"></span>
            <el-button class="btn-primary btn-long" :loading="loading" @click="onSubmit">登录</el-button>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.login-aurora {
  position: relative;
  min-height: 72vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Ambient aurora */
.aurora-layer {
  position: fixed;
  inset: 0;
  background: url('/login-bg.png') center / cover no-repeat;
  filter: none;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

@media (prefers-reduced-motion: no-preference) {
  .aurora-layer { animation: none; }
}

@keyframes aurora-move {
  0% { transform: translate3d(-2%, -1.5%, 0) scale(1.02); }
  100% { transform: translate3d(2%, 1.5%, 0) scale(1.05); }
}

@keyframes aurora-rotate {
  0% { transform: rotate(0turn) scale(1); }
  100% { transform: rotate(1turn) scale(1); }
}

@keyframes aurora-drift {
  0% { transform: translate3d(-2%, 0, 0); }
  100% { transform: translate3d(2%, 0, 0); }
}

.aurora-layer::before,
.aurora-layer::after { display: none; }

/* Vivid conic ribbon with radial mask */
/* aurora overlays disabled when using static background image */

/* Highlight glow and soft star specks */
/* aurora overlays disabled when using static background image */

.login-surface {
  position: relative;
  z-index: 1;
  width: min(960px, 100%);
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
  padding: 20px;
  border-radius: 24px;
  background: transparent;
  border: none;
  box-shadow: none;
  backdrop-filter: blur(calc(var(--glass-blur) + 6px));
}

.brand-pane {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: #e8eefc;
}

.brand-header { display:flex; align-items:center; justify-content: space-between; gap: 16px; }
.brand-text { display:flex; flex-direction: column; gap: 6px; }
.brand-logo { width: 48px; height: 48px; border-radius: 14px; object-fit: contain; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.28); box-shadow: inset 0 1px 0 rgba(255,255,255,.45); padding: 6px; }

.brand-title {
  margin: 0;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.2px;
  color: #f2f6ff;
}

.brand-sub { opacity: .92; color: #d6def5; margin: 2px 0 6px; }

.auth-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; max-width: 520px; }
.auth-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10); }
.point-icon { width: 22px; height: 22px; border-radius: 8px; background: linear-gradient(135deg, var(--brand-grad-start), var(--brand-grad-end)); box-shadow: 0 6px 16px rgba(94,160,255,.35); opacity: .92; display:flex; align-items:center; justify-content:center; }
.point-icon :deep(.el-icon) { color: #fff; font-size: 14px; }

.auth-item :deep(.el-input__wrapper) {
  border-radius: 12px;
  transition: box-shadow .15s ease;
  /* Always-on neon rim */
  box-shadow: inset 0 0 0 1px rgba(94,160,255,.65), 0 0 0 2px rgba(94,160,255,.2), 0 10px 26px rgba(94,160,255,.18);
}
.auth-item :deep(.el-input__wrapper.is-focus),
.auth-item :deep(.el-input__wrapper:hover) { box-shadow: inset 0 0 0 1px rgba(94,160,255,.65), 0 0 0 2px rgba(94,160,255,.2), 0 10px 26px rgba(94,160,255,.18); }
.auth-item .el-button.btn-primary { padding: 12px 18px; border-radius: 12px; }
/* center and lengthen login button */
.auth-item.actions { justify-content: center; }
.auth-item.actions .point-icon { display: none; }
.auth-item.actions .el-button.btn-primary { width: 100%; height: 44px; border-radius: 12px; }

/* Form-edge glow ring around the auth list */
.auth-list { position: relative; border-radius: 18px; isolation: isolate; }
.auth-list::before {
  content: "";
  position: absolute;
  inset: -14px;
  border-radius: inherit;
  pointer-events: none;
  background:
    radial-gradient(140px 16px at 50% 0%, rgba(94,160,255,0.85) 0%, rgba(94,160,255,0.45) 32%, rgba(94,160,255,0.20) 62%, rgba(94,160,255,0.07) 78%, transparent 100%),
    radial-gradient(140px 16px at 50% 100%, rgba(94,160,255,0.85) 0%, rgba(94,160,255,0.45) 32%, rgba(94,160,255,0.20) 62%, rgba(94,160,255,0.07) 78%, transparent 100%),
    radial-gradient(16px 140px at 0% 50%, rgba(94,160,255,0.85) 0%, rgba(94,160,255,0.45) 32%, rgba(94,160,255,0.20) 62%, rgba(94,160,255,0.07) 78%, transparent 100%),
    radial-gradient(16px 140px at 100% 50%, rgba(94,160,255,0.85) 0%, rgba(94,160,255,0.45) 32%, rgba(94,160,255,0.20) 62%, rgba(94,160,255,0.07) 78%, transparent 100%);
  filter: blur(10px) saturate(1.15);
  opacity: .95;
  z-index: -1;
}

/* removed right login card styles */

.btn-primary { background: linear-gradient(135deg,var(--brand-grad-start),var(--brand-grad-end)); color:#0b1220; border:none; box-shadow: 0 10px 24px rgba(94,160,255,.35), 0 0 0 2px rgba(94,160,255,.25) inset; }
.btn-primary:hover { filter: brightness(1.02); }
.btn-primary:active { transform: translateY(1px); }

.hint { margin-top: 8px; color: #cfd7ea; font-size: 12px; line-height: 1.5; }

@media (max-width: 960px) {
  .login-surface { grid-template-columns: 1fr; gap: 16px; padding: 16px; border-radius: 20px; }
  .brand-pane { padding: 12px; }
  .brand-title { font-size: 22px; }
  .login-card { width: 100%; }
}
</style>
