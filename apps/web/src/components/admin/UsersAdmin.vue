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
      ElMessage.success('\u5df2\u65b0\u5efa')
    } else {
      await fetch(withBase(`/api/admin/users/${editing.value.id}`), { method: 'PUT', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(form.value) })
      if (primaryOrg.value != null) {
        await fetch(withBase(`/api/admin/users/${editing.value.id}/primary-org`), { method: 'PATCH', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify({ orgId: primaryOrg.value }) })
      }
      ElMessage.success('\u5df2\u4fdd\u5b58')
    }
    formVisible.value = false
    await loadUsers()
  } catch (e:any) {
    ElMessage.error(e?.message || '\u4fdd\u5b58\u5931\u8d25')
  }
}

onMounted(() => { loadUsers(); loadOrgs() })
</script>

<template>
  <div>
    <div class="toolbar">
      <el-input v-model="q" placeholder="\u59d3\u540d/\u90ae\u7bb1/\u5de5\u53f7" style="width:240px" @keyup.enter="() => { pager.offset=0; loadUsers() }" />
      <el-button :loading="loading" @click="() => { pager.offset=0; loadUsers() }">\u67e5\u8be2</el-button>
      <el-button type="primary" @click="openCreate">\u65b0\u589e\u4eba\u5458</el-button>
    </div>
    <el-table :data="users" v-loading="loading" style="width:100%">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="name" label="\u59d3\u540d" />
      <el-table-column prop="employeeNo" label="\u5de5\u53f7" width="140" />
      <el-table-column prop="email" label="\u90ae\u7bb1" />
      <el-table-column prop="jobTitle" label="\u804c\u52a1" width="140" />
      <el-table-column prop="grade" label="\u804c\u7ea7" width="120" />
      <el-table-column prop="active" label="\u542f\u7528" width="100">
        <template #default="{ row }"><el-tag :type="row.active ? 'success':'info'">{{ row.active ? 'Y':'N' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="\u64cd\u4f5c" width="140">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)">\u7f16\u8f91</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination background layout="prev, pager, next" :page-size="pager.limit" :total="total" @current-change="(p:number)=>{ pager.offset=(p-1)*pager.limit; loadUsers() }" />
    </div>

    <el-dialog v-model="formVisible" :title="editing ? '\u7f16\u8f91\u4eba\u5458' : '\u65b0\u589e\u4eba\u5458'" width="600px">
      <el-form label-width="120px">
        <el-form-item label="\u59d3\u540d"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="\u5de5\u53f7"><el-input v-model="form.employeeNo" /></el-form-item>
        <el-form-item label="\u90ae\u7bb1"><el-input v-model="form.email" /></el-form-item>
        <el-form-item label="\u804c\u52a1"><el-input v-model="form.jobTitle" /></el-form-item>
        <el-form-item label="\u804c\u7ea7"><el-input v-model="form.grade" /></el-form-item>
        <el-form-item label="\u542f\u7528"><el-switch v-model="form.active" /></el-form-item>
        <el-form-item label="\u4e3b\u5c5e\u7ec4\u7ec7">
          <el-select v-model="primaryOrg" clearable filterable placeholder="\u4e0d\u8c03\u6574">
            <el-option v-for="o in orgs" :key="o.id" :label="`${o.id}-${o.name}`" :value="o.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible=false">\u53d6\u6d88</el-button>
        <el-button type="primary" @click="save">\u4fdd\u5b58</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar { margin-bottom: 8px; display: flex; gap: 8px; align-items: center; }
.pager { margin-top: 8px; text-align: right; }
</style>

