<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { authHeader, withBase } from '../../api'

type Org = { id: number; name: string; parentId: number|null; type: string; active: boolean }

type OrgNode = { id: number; label: string; name: string; type: string; active: boolean; children?: OrgNode[] }

const tree = ref<OrgNode[]>([])
const flat = ref<Org[]>([])
const loading = ref(false)

const formVisible = ref(false)
const editing = ref<Org | null>(null)
const form = ref<Partial<Org>>({ name: '', parentId: null, type: 'department', active: true })

async function load() {
  loading.value = true
  try {
    const [t, f] = await Promise.all([
      fetch(withBase('/api/admin/orgs/tree'), { headers: { ...authHeader() } }).then(r=>r.json()),
      fetch(withBase('/api/admin/orgs'), { headers: { ...authHeader() } }).then(r=>r.json()),
    ])
    tree.value = t.items || []
    flat.value = (f.items || []) as Org[]
  } finally { loading.value = false }
}

function openCreate() {
  editing.value = null
  form.value = { name: '', parentId: null, type: 'department', active: true }
  formVisible.value = true
}
function openEdit(row: Org) {
  editing.value = row
  form.value = { ...row }
  formVisible.value = true
}

async function submit() {
  try {
    const payload = { name: form.value.name, parentId: form.value.parentId, type: form.value.type, active: form.value.active }
    if (!editing.value) {
      const res = await fetch(withBase('/api/admin/orgs'), { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error(await res.text())
      ElMessage.success('新建成功')
    } else {
      const res = await fetch(withBase(`/api/admin/orgs/${editing.value.id}`), { method: 'PUT', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error(await res.text())
      ElMessage.success('已保存')
    }
    formVisible.value = false
    await load()
  } catch (e:any) {
    ElMessage.error(e?.message || '保存失败')
  }
}

onMounted(() => load())
</script>

<template>
  <div>
    <div class="toolbar">
      <el-button type="primary" @click="openCreate">新增组织</el-button>
    </div>
    <el-row :gutter="12">
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>组织树</template>
          <el-tree :data="tree" node-key="id" :props="{ children: 'children', label: 'label' }" v-loading="loading" />
        </el-card>
      </el-col>
      <el-col :span="16">
        <el-table :data="flat" v-loading="loading" style="width:100%">
          <el-table-column prop="id" label="ID" width="80" />
          <el-table-column prop="name" label="名称" />
          <el-table-column prop="parentId" label="父级" width="100" />
          <el-table-column prop="type" label="类型" width="120" />
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button size="small" @click="openEdit(row)">编辑</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-col>
    </el-row>

    <el-dialog v-model="formVisible" :title="editing ? '编辑组织' : '新增组织'" width="500px">
      <el-form label-width="100px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="父级组织">
          <el-select v-model="form.parentId" clearable filterable>
            <el-option :value="null" label="(无)" />
            <el-option v-for="o in flat" :key="o.id" :label="`${o.id}-${o.name}`" :value="o.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type">
            <el-option value="root" label="项目部(根)" />
            <el-option value="leadership" label="领导层" />
            <el-option value="department" label="部门" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用"><el-switch v-model="form.active" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible=false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar { margin-bottom: 8px; text-align: right; }
</style>

