<script setup lang="ts">
import { ref } from 'vue'
import QuickFill from './components/QuickFill.vue'
import MyRecords from './components/MyRecords.vue'
import WeeklyReport from './components/WeeklyReport.vue'

const activeTab = ref<'quick'|'mine'|'weekly'>('quick')
</script>

<template>
  <div class="container">
    <h2>日事日清 · MVP</h2>
    <el-tabs v-model="activeTab" type="border-card">
      <el-tab-pane label="快速填报" name="quick">
        <QuickFill />
      </el-tab-pane>
      <el-tab-pane label="我的记录" name="mine">
        <MyRecords />
      </el-tab-pane>
      <el-tab-pane label="周报" name="weekly">
        <WeeklyReport />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.container { max-width: 900px; margin: 0 auto; padding: 16px; }
</style>
