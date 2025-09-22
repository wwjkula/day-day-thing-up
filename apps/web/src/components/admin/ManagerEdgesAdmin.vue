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
    ElMessage.success('\u5df2\u65b0\u589e')
    formVisible.value = false
    await load()
  } catch (e:any) { ElMessage.error(e?.message || '\u5931\u8d25') }
}

async function remove(row: Edge) {
  try {
    const res = await fetch(withBase('/api/admin/manager-edges'), { method: 'DELETE', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify({ managerId: row.managerId, subordinateId: row.subordinateId, startDate: row.startDate }) })
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
      <el-button type="primary" @click="openCreate">\u65b0\u589e\u7ba1\u7406\u8fb9</el-button>
    </div>
    <el-table :data="items" v-loading="loading" style="width:100%">
      <el-table-column prop="managerId" label="\u7ba1\u7406\u8005" width="120" />
      <el-table-column prop="subordinateId" label="\u4e0b\u5c5e" width="120" />
      <el-table-column prop="startDate" label="\u5f00\u59cb" width="140" />
      <el-table-column prop="endDate" label="\u7ed3\u675f" width="140" />
      <el-table-column prop="priority" label="\u4f18\u5148\u7ea7" width="100" />
      <el-table-column label="\u64cd\u4f5c" width="120">
        <template #default="{ row }">
          <el-popconfirm title="\u786e\u8ba4\u5220\u9664?" @confirm="() => remove(row)"><template #reference><el-button type="danger" size="small">\u5220\u9664</el-button></template></el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="formVisible" title="\u65b0\u589e\u7ba1\u7406\u8fb9" width="500px">
      <el-form label-width="120px">
        <el-form-item label="\u7ba1\u7406\u8005ID"><el-input v-model.number="form.managerId" /></el-form-item>
        <el-form-item label="\u4e0b\u5c5eID"><el-input v-model.number="form.subordinateId" /></el-form-item>
        <el-form-item label="\u5f00\u59cb\u65e5"><el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="\u7ed3\u675f\u65e5"><el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="\u4f18\u5148\u7ea7"><el-input-number v-model="form.priority" :min="1" :max="999" /></el-form-item>
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

