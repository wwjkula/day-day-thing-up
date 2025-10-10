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
            <span class="point-icon"></span>
            <el-input
              v-model="form.employeeNo"
              placeholder="请输入账号/工号，例如 D0101"
              @keyup.enter.native="onSubmit"
            >
              <template #prefix>
                <el-icon><User /></el-icon>
              </template>
            </el-input>
          </li>
          <li class="auth-item">
            <span class="point-icon"></span>
            <el-input
              v-model="form.password"
              type="password"
              show-password
              placeholder="请输入密码（未设置可留空）"
              @keyup.enter.native="onSubmit"
            >
              <template #prefix>
                <el-icon><Lock /></el-icon>
              </template>
            </el-input>
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
  background:
    radial-gradient(70% 90% at 15% 20%, rgba(96,165,250,0.35), transparent 60%),
    radial-gradient(70% 90% at 85% 40%, rgba(94,224,255,0.32), transparent 60%),
    radial-gradient(90% 90% at 50% 80%, rgba(168,85,247,0.30), transparent 60%),
    linear-gradient(180deg, rgba(2,6,23,0.88), rgba(2,6,23,0.92));
  filter: saturate(1.35) blur(16px) contrast(1.06);
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  will-change: transform;
}

@media (prefers-reduced-motion: no-preference) {
  .aurora-layer { animation: aurora-move 16s ease-in-out infinite alternate; }
  .aurora-layer::before { animation: aurora-rotate 28s linear infinite; }
  .aurora-layer::after { animation: aurora-drift 20s ease-in-out infinite alternate; }
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
.aurora-layer::after { content: ""; position: absolute; inset: -20% -20%; pointer-events: none; }

/* Vivid conic ribbon with radial mask */
.aurora-layer::before {
  background:
    conic-gradient(from 0turn,
      rgba(99,102,241,0.36),
      rgba(56,189,248,0.38),
      rgba(59,130,246,0.40),
      rgba(167,139,250,0.36),
      rgba(99,102,241,0.36));
  filter: blur(22px) saturate(1.3);
  mix-blend-mode: screen;
  -webkit-mask: radial-gradient(60% 60% at 50% 50%, #000 40%, transparent 72%);
          mask: radial-gradient(60% 60% at 50% 50%, #000 40%, transparent 72%);
}

/* Highlight glow and soft star specks */
.aurora-layer::after {
  background:
    radial-gradient(1200px 800px at 70% 20%, rgba(255,255,255,0.14), transparent 60%),
    radial-gradient(900px 700px at 30% 80%, rgba(255,255,255,0.10), transparent 60%),
    radial-gradient(2px 2px at 20% 25%, rgba(255,255,255,0.18), transparent 60%),
    radial-gradient(2px 2px at 35% 60%, rgba(255,255,255,0.18), transparent 60%),
    radial-gradient(1.5px 1.5px at 62% 42%, rgba(255,255,255,0.16), transparent 60%),
    radial-gradient(1.5px 1.5px at 78% 66%, rgba(255,255,255,0.13), transparent 60%);
  filter: blur(12px) saturate(1.1);
  mix-blend-mode: screen;
  opacity: .9;
}

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
.point-icon { width: 22px; height: 22px; border-radius: 8px; background: linear-gradient(135deg, var(--brand-grad-start), var(--brand-grad-end)); box-shadow: 0 6px 16px rgba(94,160,255,.35); opacity: .92; }

.auth-item :deep(.el-input__wrapper) { border-radius: 12px; transition: box-shadow .15s ease; }
.auth-item :deep(.el-input__wrapper.is-focus),
.auth-item :deep(.el-input__wrapper:hover) { box-shadow: inset 0 0 0 1px rgba(94,160,255,.65), 0 0 0 2px rgba(94,160,255,.2), 0 10px 26px rgba(94,160,255,.18); }
.auth-item .el-button.btn-primary { padding: 12px 18px; border-radius: 12px; }
/* center and lengthen login button */
.auth-item.actions { justify-content: center; }
.auth-item.actions .point-icon { display: none; }
.auth-item.actions .el-button.btn-primary { width: 100%; height: 44px; border-radius: 12px; }

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
