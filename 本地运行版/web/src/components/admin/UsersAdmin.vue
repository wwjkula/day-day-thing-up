<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { authHeader, withBase, adminListUsers, adminGetPrimaryOrg } from '../../api'

interface User { id: number; name: string; email?: string|null; employeeNo?: string|null; jobTitle?: string|null; active: boolean; visibleUserIds?: number[] }
interface Org { id: number; name: string }

const loading = ref(false)
const users = ref<User[]>([])
const total = ref(0)
const q = ref('')
const pager = ref({ limit: 50, offset: 0 })

const orgs = ref<Org[]>([])

const formVisible = ref(false)
const editing = ref<User | null>(null)
const form = ref<Partial<User>>({ name: '', email: '', employeeNo: '', jobTitle: '', active: true, visibleUserIds: [] })
const primaryOrg = ref<number | null>(null)
const visibleSelection = ref<number[]>([])
const userOptions = ref<User[]>([])

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

async function loadUserOptions() {
  const res = await adminListUsers({ limit: 500, offset: 0 })
  const list = res.items || []
  userOptions.value = list.map((u: any) => ({ id: Number(u.id), name: u.name || `用户${u.id}` }))
}

function openCreate() {
  editing.value = null
  form.value = { name: '', email: '', employeeNo: '', jobTitle: '', active: true, visibleUserIds: [] }
  primaryOrg.value = null
  visibleSelection.value = []
  formVisible.value = true
}

async function openEdit(row: User) {
  editing.value = row
  form.value = { ...row }
  primaryOrg.value = null
  const current = Array.isArray(row.visibleUserIds) ? row.visibleUserIds.slice() : [row.id]
  if (!current.includes(row.id)) current.push(row.id)
  visibleSelection.value = current
  try {
    const result = await adminGetPrimaryOrg(row.id)
    if (result && typeof result.orgId === 'number') {
      primaryOrg.value = result.orgId
    } else {
      primaryOrg.value = null
    }
  } catch (e) {
    primaryOrg.value = null
    console.error('Failed to load primary org', e)
  }
  formVisible.value = true
}

async function save() {
  try {
    const payload = {
      name: form.value.name,
      email: form.value.email,
      employeeNo: form.value.employeeNo,
      jobTitle: form.value.jobTitle,
      active: form.value.active,
      visibleUserIds: visibleSelection.value.slice(),
    }
    if (!editing.value) {
      const res = await fetch(withBase('/api/admin/users'), { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error(await res.text())
      const j = await res.json()
      if (primaryOrg.value != null) {
        await fetch(withBase(`/api/admin/users/${j.id}/primary-org`), { method: 'PATCH', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify({ orgId: primaryOrg.value }) })
      }
      ElMessage.success('已新建')
    } else {
      await fetch(withBase(`/api/admin/users/${editing.value.id}`), { method: 'PUT', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(payload) })
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

onMounted(() => { loadUsers(); loadOrgs(); loadUserOptions() })
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
      <el-table-column label="可见人数" width="120">
        <template #default="{ row }">
          {{ Array.isArray(row.visibleUserIds) ? row.visibleUserIds.length : 1 }}
        </template>
      </el-table-column>
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
      <el-form-item label="启用"><el-switch v-model="form.active" /></el-form-item>
      <el-form-item label="可见人员">
        <el-select v-model="visibleSelection" multiple filterable collapse-tags style="width: 100%" placeholder="请选择可见人员">
          <el-option v-for="u in userOptions" :key="u.id" :value="u.id" :label="`${u.name}（ID：${u.id}）`" />
        </el-select>
      </el-form-item>
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

