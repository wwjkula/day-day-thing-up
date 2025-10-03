<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { authHeader, withBase, adminListUsers, adminListOrgs, adminListRoles } from '../../api'

type Grant = { id: number; granteeUserId: number; granteeName?: string | null; roleId: number; roleCode: string; roleName: string; domainOrgId: number; scope: 'self'|'direct'|'subtree'; startDate: string; endDate: string|null }
type UserOption = { id: number; name: string }
type OrgOption = { id: number; name: string }
type RoleOption = { id: number; code: string; name: string }

const items = ref<Grant[]>([])
const loading = ref(false)
const usersLoading = ref(false)
const orgsLoading = ref(false)
const rolesLoading = ref(false)

const formVisible = ref(false)
const form = ref<{ granteeUserId?: number; roleId?: number; domainOrgId?: number; scope: 'self' | 'direct' | 'subtree'; startDate: string; endDate: string | null }>({ granteeUserId: undefined, roleId: undefined, domainOrgId: undefined, scope: 'self', startDate: new Date().toISOString().slice(0,10), endDate: null })
const users = ref<UserOption[]>([])
const orgs = ref<OrgOption[]>([])
const roles = ref<RoleOption[]>([])

async function loadUsers() {
  usersLoading.value = true
  try {
    const res = await adminListUsers({ limit: 500 })
    const list = res.items || []
    users.value = list.map((u: any) => ({ id: Number(u.id), name: u.name || `用户${u.id}` }))
  } catch (e: any) {
    users.value = []
    ElMessage.error(e?.message || '加载用户失败')
  } finally { usersLoading.value = false }
}

async function loadOrgs() {
  orgsLoading.value = true
  try {
    const res = await adminListOrgs()
    const list = res.items || []
    orgs.value = list.map((o: any) => ({ id: Number(o.id), name: o.name || `组织${o.id}` }))
  } catch (e: any) {
    orgs.value = []
    ElMessage.error(e?.message || '加载组织失败')
  } finally { orgsLoading.value = false }
}

async function loadRoles() {
  rolesLoading.value = true
  try {
    const res = await adminListRoles()
    const list = res.items || []
    roles.value = list.map((r: any) => ({ id: Number(r.id), code: r.code, name: r.name || r.code }))
  } catch (e: any) {
    roles.value = []
    ElMessage.error(e?.message || '加载角色失败')
  } finally { rolesLoading.value = false }
}

async function loadGrants() {
  loading.value = true
  try {
    const res = await fetch(withBase('/api/admin/role-grants'), { headers: { ...authHeader() } })
    const j = await res.json(); items.value = j.items || []
  } finally { loading.value = false }
}

async function load() {
  await Promise.all([loadUsers(), loadOrgs(), loadRoles(), loadGrants()])
}

function openCreate() {
  form.value = { granteeUserId: undefined, roleId: roles.value[0]?.id, domainOrgId: undefined, scope: 'self', startDate: new Date().toISOString().slice(0,10), endDate: null }
  formVisible.value = true
}

async function save() {
  try {
    if (!form.value.granteeUserId) {
      ElMessage.error('请选择用户')
      return
    }
    if (!form.value.roleId) {
      ElMessage.error('请选择角色')
      return
    }
    if (!form.value.domainOrgId) {
      ElMessage.error('请选择组织')
      return
    }
    const payload = {
      granteeUserId: Number(form.value.granteeUserId),
      roleId: Number(form.value.roleId),
      domainOrgId: Number(form.value.domainOrgId),
      scope: form.value.scope,
      startDate: form.value.startDate,
      endDate: form.value.endDate,
    }
    const res = await fetch(withBase('/api/admin/role-grants'), { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(payload) })
    if (!res.ok) throw new Error(await res.text())
    ElMessage.success('已新增')
    formVisible.value = false
    await loadGrants()
  } catch (e:any) { ElMessage.error(e?.message || '失败') }
}

async function remove(row: Grant) {
  try {
    const res = await fetch(withBase(`/api/admin/role-grants/${row.id}`), { method: 'DELETE', headers: { ...authHeader() } })
    if (!res.ok) throw new Error(await res.text())
    ElMessage.success('已删除')
    await loadGrants()
  } catch (e:any) { ElMessage.error(e?.message || '失败') }
}

onMounted(() => load())
</script>

<template>
  <div>
    <div class="toolbar">
      <el-button type="primary" @click="openCreate">新增授权</el-button>
    </div>
    <el-table :data="items" v-loading="loading" style="width:100%">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column label="用户" width="220">
        <template #default="{ row }">
          <span>{{ row.granteeName || '未命名' }}</span>
          <span class="id">（ID：{{ row.granteeUserId }}）</span>
        </template>
      </el-table-column>
      <el-table-column label="角色" width="160">
        <template #default="{ row }">
          <span>{{ row.roleName || row.roleCode }}</span>
          <span class="id">（Code：{{ row.roleCode }}）</span>
        </template>
      </el-table-column>
      <el-table-column label="授权组织" width="200">
        <template #default="{ row }">
          <span>{{ orgs.find(o => o.id === row.domainOrgId)?.name || `组织 ${row.domainOrgId}` }}</span>
          <span class="id">（ID：{{ row.domainOrgId }}）</span>
        </template>
      </el-table-column>
      <el-table-column prop="scope" label="范围" width="120" />
      <el-table-column prop="startDate" label="开始" width="140" />
      <el-table-column prop="endDate" label="结束" width="140" />
      <el-table-column label="操作" width="120">
        <template #default="{ row }">
          <el-popconfirm title="确认删除?" @confirm="() => remove(row)"><template #reference><el-button type="danger" size="small">删除</el-button></template></el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="formVisible" title="新增授权" width="520px">
      <el-form label-width="140px">
        <el-form-item label="用户">
          <el-select v-model="form.granteeUserId" filterable :loading="usersLoading" placeholder="请选择用户">
            <el-option v-for="u in users" :key="u.id" :label="`${u.name}（ID：${u.id}）`" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.roleId" filterable :loading="rolesLoading" placeholder="请选择角色">
            <el-option v-for="r in roles" :key="r.id" :label="`${r.name}（Code：${r.code}）`" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="组织">
          <el-select v-model="form.domainOrgId" filterable :loading="orgsLoading" placeholder="请选择组织">
            <el-option v-for="o in orgs" :key="o.id" :label="`${o.name}（ID：${o.id}）`" :value="o.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="范围">
          <el-select v-model="form.scope">
            <el-option label="self" value="self" />
            <el-option label="direct" value="direct" />
            <el-option label="subtree" value="subtree" />
          </el-select>
        </el-form-item>
        <el-form-item label="开始日"><el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="结束日"><el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
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


