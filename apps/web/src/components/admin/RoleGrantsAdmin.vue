<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { authHeader, withBase } from '../../api'

type Grant = { id: number; granteeUserId: number; roleId: number; roleCode: string; roleName: string; domainOrgId: number; scope: 'self'|'direct'|'subtree'; startDate: string; endDate: string|null }

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
    ElMessage.success('\u5df2\u65b0\u589e')
    formVisible.value = false
    await load()
  } catch (e:any) { ElMessage.error(e?.message || '\u5931\u8d25') }
}

async function remove(row: Grant) {
  try {
    const res = await fetch(withBase(`/api/admin/role-grants/${row.id}`), { method: 'DELETE', headers: { ...authHeader() } })
    if (!res.ok) throw new Error(await res.text())
    ElMessage.success('\u5df2\u5220\u9664')
    await load()
  } catch (e:any) { ElMessage.error(e?.message || '\u5931\u8d25') }
}

onMounted(() => load())
</script>

<template>
  <div>
    <div class="toolbar">
      <el-button type="primary" @click="openCreate">\u65b0\u589e\u6388\u6743</el-button>
    </div>
    <el-table :data="items" v-loading="loading" style="width:100%">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="granteeUserId" label="\u7528\u6237ID" width="120" />
      <el-table-column prop="roleCode" label="\u89d2\u8272" width="140" />
      <el-table-column prop="domainOrgId" label="\u57df(\u7ec4\u7ec7ID)" width="140" />
      <el-table-column prop="scope" label="\u8303\u56f4" width="120" />
      <el-table-column prop="startDate" label="\u5f00\u59cb" width="140" />
      <el-table-column prop="endDate" label="\u7ed3\u675f" width="140" />
      <el-table-column label="\u64cd\u4f5c" width="120">
        <template #default="{ row }">
          <el-popconfirm title="\u786e\u8ba4\u5220\u9664?" @confirm="() => remove(row)"><template #reference><el-button type="danger" size="small">\u5220\u9664</el-button></template></el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="formVisible" title="\u65b0\u589e\u6388\u6743" width="520px">
      <el-form label-width="140px">
        <el-form-item label="\u7528\u6237ID"><el-input v-model.number="form.granteeUserId" /></el-form-item>
        <el-form-item label="\u89d2\u8272code"><el-input v-model="form.roleCode" placeholder="sys_admin/employee/..." /></el-form-item>
        <el-form-item label="\u7ec4\u7ec7ID"><el-input v-model.number="form.domainOrgId" /></el-form-item>
        <el-form-item label="\u8303\u56f4">
          <el-select v-model="form.scope">
            <el-option label="self" value="self" />
            <el-option label="direct" value="direct" />
            <el-option label="subtree" value="subtree" />
          </el-select>
        </el-form-item>
        <el-form-item label="\u5f00\u59cb\u65e5"><el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="\u7ed3\u675f\u65e5"><el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible=false">\u53d6\u6d88</el-button>
        <el-button type="primary" @click="save">\u4fdd\u5b58</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar { margin-bottom: 8px; text-align: right; }
</style>

