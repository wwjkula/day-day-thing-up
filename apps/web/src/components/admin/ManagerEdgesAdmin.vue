<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { authHeader, withBase } from '../../api'

type Edge = { managerId: number; subordinateId: number; startDate: string; endDate: string|null; priority: number }

const items = ref<Edge[]>([])
const loading = ref(false)

const formVisible = ref(false)
const form = ref<Partial<Edge>>({ managerId: undefined, subordinateId: undefined, startDate: new Date().toISOString().slice(0,10), endDate: null, priority: 100 })

async function load() {
  loading.value = true
  try {
    const res = await fetch(withBase('/api/admin/manager-edges'), { headers: { ...authHeader() } })
    const j = await res.json(); items.value = j.items || []
  } finally { loading.value = false }
}

function openCreate() { form.value = { managerId: undefined, subordinateId: undefined, startDate: new Date().toISOString().slice(0,10), endDate: null, priority: 100 }; formVisible.value = true }

async function save() {
  try {
    const res = await fetch(withBase('/api/admin/manager-edges'), { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(form.value) })
    if (!res.ok) throw new Error(await res.text())
    ElMessage.success('已新增')
    formVisible.value = false
    await load()
  } catch (e:any) { ElMessage.error(e?.message || '失败') }
}

async function remove(row: Edge) {
  try {
    const res = await fetch(withBase('/api/admin/manager-edges'), { method: 'DELETE', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify({ managerId: row.managerId, subordinateId: row.subordinateId, startDate: row.startDate }) })
    if (!res.ok) throw new Error(await res.text())
    ElMessage.success('已删除')
    await load()
  } catch (e:any) { ElMessage.error(e?.message || '失败') }
}

onMounted(() => load())
</script>

<template>
  <div>
    <div class="toolbar">
      <el-button type="primary" @click="openCreate">新增管理边</el-button>
    </div>
    <el-table :data="items" v-loading="loading" style="width:100%">
      <el-table-column prop="managerId" label="管理者" width="120" />
      <el-table-column prop="subordinateId" label="下属" width="120" />
      <el-table-column prop="startDate" label="开始" width="140" />
      <el-table-column prop="endDate" label="结束" width="140" />
      <el-table-column prop="priority" label="优先级" width="100" />
      <el-table-column label="操作" width="120">
        <template #default="{ row }">
          <el-popconfirm title="确认删除?" @confirm="() => remove(row)"><template #reference><el-button type="danger" size="small">删除</el-button></template></el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="formVisible" title="新增管理边" width="500px">
      <el-form label-width="120px">
        <el-form-item label="管理者ID"><el-input v-model.number="form.managerId" /></el-form-item>
        <el-form-item label="下属ID"><el-input v-model.number="form.subordinateId" /></el-form-item>
        <el-form-item label="开始日"><el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="结束日"><el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="优先级"><el-input-number v-model="form.priority" :min="1" :max="999" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible=false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar { margin-bottom: 8px; text-align: right; }
</style>

