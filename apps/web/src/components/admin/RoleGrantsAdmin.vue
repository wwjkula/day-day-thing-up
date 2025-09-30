<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { authHeader, withBase } from '../../api'

type Grant = { id: number; granteeUserId: number; granteeName?: string | null; roleId: number; roleCode: string; roleName: string; domainOrgId: number; scope: 'self'|'direct'|'subtree'; startDate: string; endDate: string|null }

const items = ref<Grant[]>([])
const loading = ref(false)

const formVisible = ref(false)
const form = ref<Partial<Grant> & { roleCode?: string }>({ granteeUserId: undefined, roleCode: 'employee', domainOrgId: undefined, scope: 'self', startDate: new Date().toISOString().slice(0,10), endDate: null })

async function load() {
  loading.value = true
  try {
    const res = await fetch(withBase('/api/admin/role-grants'), { headers: { ...authHeader() } })
    const j = await res.json(); items.value = j.items || []
  } finally { loading.value = false }
}

function openCreate() { form.value = { granteeUserId: undefined, roleCode: 'employee', domainOrgId: undefined, scope: 'self', startDate: new Date().toISOString().slice(0,10), endDate: null }; formVisible.value = true }

async function save() {
  try {
    const res = await fetch(withBase('/api/admin/role-grants'), { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(form.value) })
    if (!res.ok) throw new Error(await res.text())
    ElMessage.success('已新增')
    formVisible.value = false
    await load()
  } catch (e:any) { ElMessage.error(e?.message || '失败') }
}

async function remove(row: Grant) {
  try {
    const res = await fetch(withBase(`/api/admin/role-grants/${row.id}`), { method: 'DELETE', headers: { ...authHeader() } })
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
      <el-table-column prop="roleCode" label="角色" width="140" />
      <el-table-column prop="domainOrgId" label="域(组织ID)" width="140" />
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
        <el-form-item label="用户ID"><el-input v-model.number="form.granteeUserId" /></el-form-item>
        <el-form-item label="角色code"><el-input v-model="form.roleCode" placeholder="sys_admin/employee/..." /></el-form-item>
        <el-form-item label="组织ID"><el-input v-model.number="form.domainOrgId" /></el-form-item>
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


