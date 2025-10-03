<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { authHeader, withBase, adminListUsers } from '../../api'

type Edge = { managerId: number; managerName?: string | null; subordinateId: number; subordinateName?: string | null; startDate: string; endDate: string|null; priority: number }
type UserOption = { id: number; name: string }

const items = ref<Edge[]>([])
const loading = ref(false)
const userLoading = ref(false)

const formVisible = ref(false)
const form = ref<Partial<Edge>>({ managerId: undefined, subordinateId: undefined, startDate: new Date().toISOString().slice(0,10), endDate: null, priority: 100 })
const users = ref<UserOption[]>([])

async function loadUsers() {
  userLoading.value = true
  try {
    const res = await adminListUsers({ limit: 500 })
    const list = res.items || []
    users.value = list.map((u: any) => ({ id: Number(u.id), name: u.name || `用户${u.id}` }))
  } catch (e: any) {
    users.value = []
    ElMessage.error(e?.message || '加载用户失败')
  } finally {
    userLoading.value = false
  }
}

async function loadEdges() {
  loading.value = true
  try {
    const res = await fetch(withBase('/api/admin/manager-edges'), { headers: { ...authHeader() } })
    const j = await res.json(); items.value = j.items || []
  } finally { loading.value = false }
}

async function load() {
  await Promise.all([loadUsers(), loadEdges()])
}

function openCreate() { form.value = { managerId: undefined, subordinateId: undefined, startDate: new Date().toISOString().slice(0,10), endDate: null, priority: 100 }; formVisible.value = true }

async function save() {
  try {
    if (form.value.managerId == null || form.value.subordinateId == null) {
      ElMessage.error('请选择管理者和下属')
      return
    }
    const payload = {
      ...form.value,
      managerId: Number(form.value.managerId),
      subordinateId: Number(form.value.subordinateId),
    }
    const res = await fetch(withBase('/api/admin/manager-edges'), { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(payload) })
    if (!res.ok) throw new Error(await res.text())
    ElMessage.success('已新增')
    formVisible.value = false
    await loadEdges()
  } catch (e:any) { ElMessage.error(e?.message || '失败') }
}

async function remove(row: Edge) {
  try {
    const res = await fetch(withBase('/api/admin/manager-edges'), { method: 'DELETE', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify({ managerId: row.managerId, subordinateId: row.subordinateId, startDate: row.startDate }) })
    if (!res.ok) throw new Error(await res.text())
    ElMessage.success('已删除')
    await loadEdges()
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
      <el-table-column label="管理者" width="220">
        <template #default="{ row }">
          <span>{{ row.managerName || '未命名' }}</span>
          <span class="id">（ID：{{ row.managerId }}）</span>
        </template>
      </el-table-column>
      <el-table-column label="下属" width="220">
        <template #default="{ row }">
          <span>{{ row.subordinateName || '未命名' }}</span>
          <span class="id">（ID：{{ row.subordinateId }}）</span>
        </template>
      </el-table-column>
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
        <el-form-item label="管理者">
          <el-select
            v-model="form.managerId"
            filterable
            :loading="userLoading"
            placeholder="请选择管理者"
          >
            <el-option v-for="u in users" :key="u.id" :label="`${u.name}（ID：${u.id}）`" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="下属">
          <el-select
            v-model="form.subordinateId"
            filterable
            :loading="userLoading"
            placeholder="请选择下属"
          >
            <el-option v-for="u in users" :key="`sub-${u.id}`" :label="`${u.name}（ID：${u.id}）`" :value="u.id" />
          </el-select>
        </el-form-item>
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
.id { color: var(--el-text-color-secondary); margin-left: 4px; }
</style>

