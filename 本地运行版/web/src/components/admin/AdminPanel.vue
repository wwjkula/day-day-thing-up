<script setup lang="ts">
import { ref } from 'vue'
import OrgAdmin from './OrgAdmin.vue'
import UsersAdmin from './UsersAdmin.vue'
import WorkItemsAdmin from './WorkItemsAdmin.vue'

const tab = ref<'org'|'user'|'work'>('org')
</script>

<template>
  <div class="admin-panel">
    <el-tabs v-model="tab" type="border-card">
      <el-tab-pane label="组织管理" name="org">
        <OrgAdmin />
      </el-tab-pane>
      <el-tab-pane label="人员管理" name="user">
        <UsersAdmin />
      </el-tab-pane>
      <el-tab-pane label="工作数据" name="work">
        <WorkItemsAdmin />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.admin-panel { padding: 8px; }
</style>

