<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { authChangePassword } from '../api'

const visible = defineModel<boolean>('visible', { required: true })
const loading = ref(false)
const form = ref<{ currentPassword: string; newPassword: string }>({ currentPassword: '', newPassword: '' })

async function submit() {
  if ((form.value.newPassword || '').length < 6) {
    ElMessage.error('新密码至少 6 位')
    return
  }
  loading.value = true
  try {
    const r = await authChangePassword({ currentPassword: form.value.currentPassword || '', newPassword: form.value.newPassword })
    if (!r?.ok) throw new Error(r?.error || '修改失败')
    ElMessage.success('已修改密码')
    visible.value = false
    form.value = { currentPassword: '', newPassword: '' }
  } catch (e: any) {
    ElMessage.error(e?.message || '修改失败')
  } finally { loading.value = false }
}
</script>

<template>
  <el-dialog v-model="visible" title="修改密码" width="480px">
    <el-form label-width="120px" @submit.prevent>
      <el-form-item label="当前密码">
        <el-input v-model="form.currentPassword" type="password" show-password />
      </el-form-item>
      <el-form-item label="新密码">
        <el-input v-model="form.newPassword" type="password" show-password placeholder="至少 6 位" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible=false">取消</el-button>
      <el-button type="primary" :loading="loading" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
</style>

