<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { authHeader, withBase } from '../../api'

interface User { id: number; name: string; email?: string|null; employeeNo?: string|null; jobTitle?: string|null; grade?: string|null; active: boolean }
interface Org { id: number; name: string }

const loading = ref(false)
const users = ref<User[]>([])
const total = ref(0)
const q = ref('')
const pager = ref({ limit: 50, offset: 0 })

const orgs = ref<Org[]>([])

const formVisible = ref(false)
const editing = ref<User | null>(null)
const form = ref<Partial<User>>({ name: '', email: '', employeeNo: '', jobTitle: '', grade: '', active: true })
const primaryOrg = ref<number | null>(null)

async function loadUsers() {
  loading.value = true
  try {
    const params = new URLSearchParams({ q: q.value, limit: String(pager.value.limit), offset: String(pager.value.offset) })
    const res = await fetch(withBase(`/api/admin/users?${params}`), { headers: { ...authHeader() } })
    const j = await res.json()
    users.value = j.items || []
    total.value = j.total || 0
  } finally { loading.value = false }
}

async function loadOrgs() {
  const res = await fetch(withBase('/api/admin/orgs'), { headers: { ...authHeader() } })
  const j = await res.json(); orgs.value = (j.items || []).map((o:any)=>({ id: o.id, name: o.name }))
}

function openCreate() {
  editing.value = null
  form.value = { name: '', email: '', employeeNo: '', jobTitle: '', grade: '', active: true }
  primaryOrg.value = null
  formVisible.value = true
}

function openEdit(row: User) {
  editing.value = row
  form.value = { ...row }
  primaryOrg.value = null
  formVisible.value = true
}

async function save() {
  try {
    if (!editing.value) {
      const res = await fetch(withBase('/api/admin/users'), { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(form.value) })
      if (!res.ok) throw new Error(await res.text())
      const j = await res.json()
      if (primaryOrg.value != null) {
        await fetch(withBase(`/api/admin/users/${j.id}/primary-org`), { method: 'PATCH', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify({ orgId: primaryOrg.value }) })
      }
      ElMessage.success('已新建')
    } else {
      await fetch(withBase(`/api/admin/users/${editing.value.id}`), { method: 'PUT', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(form.value) })
      if (primaryOrg.value != null) {
        await fetch(withBase(`/api/admin/users/${editing.value.id}/primary-org`), { method: 'PATCH', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify({ orgId: primaryOrg.value }) })
      }
      ElMessage.success('已保存')
    }
    formVisible.value = false
    await loadUsers()
  } catch (e:any) {
    ElMessage.error(e?.message || '保存失败')
  }
}

onMounted(() => { loadUsers(); loadOrgs() })
</script>

<template>
  <div>
    <div class="toolbar">
      <el-input v-model="q" placeholder="姓名/邮箱/工号" style="width:240px" @keyup.enter="() => { pager.offset=0; loadUsers() }" />
      <el-button :loading="loading" @click="() => { pager.offset=0; loadUsers() }">查询</el-button>
      <el-button type="primary" @click="openCreate">新增人员</el-button>
    </div>
    <el-table :data="users" v-loading="loading" style="width:100%">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="name" label="姓名" />
      <el-table-column prop="employeeNo" label="工号" width="140" />
      <el-table-column prop="email" label="邮箱" />
      <el-table-column prop="jobTitle" label="职务" width="140" />
      <el-table-column prop="grade" label="职级" width="120" />
      <el-table-column prop="active" label="启用" width="100">
        <template #default="{ row }"><el-tag :type="row.active ? 'success':'info'">{{ row.active ? 'Y':'N' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="操作" width="140">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination background layout="prev, pager, next" :page-size="pager.limit" :total="total" @current-change="(p:number)=>{ pager.offset=(p-1)*pager.limit; loadUsers() }" />
    </div>

    <el-dialog v-model="formVisible" :title="editing ? '编辑人员' : '新增人员'" width="600px">
      <el-form label-width="120px">
        <el-form-item label="姓名"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="工号"><el-input v-model="form.employeeNo" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="form.email" /></el-form-item>
        <el-form-item label="职务"><el-input v-model="form.jobTitle" /></el-form-item>
        <el-form-item label="职级"><el-input v-model="form.grade" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="form.active" /></el-form-item>
        <el-form-item label="主属组织">
          <el-select v-model="primaryOrg" clearable filterable placeholder="不调整">
            <el-option v-for="o in orgs" :key="o.id" :label="`${o.id}-${o.name}`" :value="o.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible=false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar { margin-bottom: 8px; display: flex; gap: 8px; align-items: center; }
.pager { margin-top: 8px; text-align: right; }
</style>

