<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getSettings, adminUpdateSettings } from '../../api'

const loading = ref(false)
const saving = ref(false)
const titleMaxLength = ref<number | null>(40)

async function loadSettings() {
  loading.value = true
  try {
    const resp = await getSettings()
    const n = Number(resp?.settings?.titleMaxLength)
    titleMaxLength.value = Number.isFinite(n) && n >= 1 ? n : 40
  } catch (e: any) {
    titleMaxLength.value = 40
  } finally {
    loading.value = false
  }
}

async function save() {
  const n = Number(titleMaxLength.value)
  if (!Number.isInteger(n) || n < 1) {
    ElMessage.error('请输入有效的正整数')
    return
  }
  saving.value = true
  try {
    const r = await adminUpdateSettings({ titleMaxLength: n })
    if (!r?.ok) throw new Error(r?.error || '保存失败')
    ElMessage.success('已保存')
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => loadSettings())
</script>

<template>
  <div class="system-settings">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">系统设置</div>
      </template>
      <el-form label-width="180px" v-loading="loading">
        <el-form-item label="快速填报标题字数上限">
          <el-input v-model.number="titleMaxLength" type="number" placeholder="例如：40" style="width: 220px" />
          <div class="hint">仅影响标题长度校验与输入字数提示。无固定上限，请慎重设置。</div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
  
</template>

<style scoped>
.card-header { font-weight: 600; }
.hint { margin-left: 12px; color: var(--el-text-color-secondary); font-size: 12px; }
</style>

