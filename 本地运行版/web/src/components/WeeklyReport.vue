<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import type {
  VisibilityScope,
  DailyOverviewResponse,
  DailyOverviewUser,
  WeeklyOverviewResponse,
  WeeklyOverviewUser,
} from '@drrq/shared/index'
import {
  getDailyOverview,
  getWeeklyOverview,
  postWeeklyExport,
  getExportStatus,
  downloadExport,
} from '../api'

type ViewMode = 'daily' | 'weekly'
type GroupTab = 'users' | 'orgs'

const scope = ref<VisibilityScope>('self')
const viewMode = ref<ViewMode>('daily')

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysISO(dateStr: string, amount: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + amount)
  return d.toISOString().slice(0, 10)
}

function weekRangeOf(dateStr: string): [string, string] {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const day = (d.getUTCDay() + 6) % 7
  const monday = new Date(d)
  monday.setUTCDate(monday.getUTCDate() - day)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  return [monday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)]
}

function eachDay(from: string, to: string): string[] {
  const dates: string[] = []
  let current = from
  while (current <= to) {
    dates.push(current)
    current = addDaysISO(current, 1)
  }
  return dates
}

function formatDateLabel(dateStr: string): string {
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const d = new Date(`${dateStr}T00:00:00`)
  const idx = d.getDay()
  return `${dateStr} ${dayNames[idx] ?? ''}`
}

function typeLabel(type: string): string {
  switch (type) {
    case 'done':
      return '完成'
    case 'progress':
      return '推进'
    case 'temp':
      return '临时'
    case 'assist':
      return '协同'
    case 'plan':
      return '计划'
    default:
      return type
  }
}

const dailyDate = ref<string>(todayISO())
const weeklyRange = ref<[string, string]>(weekRangeOf(todayISO()))

const dailyData = ref<DailyOverviewResponse | null>(null)
const weeklyData = ref<WeeklyOverviewResponse | null>(null)

const loadingDaily = ref(false)
const loadingWeekly = ref(false)
const exporting = ref(false)

const dailyOrgFilter = ref<number[]>([])
const dailySearch = ref('')
const dailyOnlyMissing = ref(false)
const dailyOnlyPlan = ref(false)
const dailyGroupTab = ref<GroupTab>('users')

const weeklyOrgFilter = ref<number[]>([])
const weeklySearch = ref('')
const weeklyOnlyMissing = ref(false)
const weeklyOnlyPlan = ref(false)
const weeklyGroupTab = ref<GroupTab>('users')

const weeklyDrawerVisible = ref(false)
const weeklyDrawerUser = ref<WeeklyOverviewUser | null>(null)
const weeklyDrawerActiveDate = ref('')

async function loadDailyOverview() {
  loadingDaily.value = true
  try {
    const data = await getDailyOverview({ date: dailyDate.value, scope: scope.value })
    dailyData.value = data
  } catch (err: any) {
    ElMessage.error(err?.message || '加载日视图失败')
  } finally {
    loadingDaily.value = false
  }
}

async function loadWeeklyOverview() {
  if (!weeklyRange.value[0] || !weeklyRange.value[1]) return
  loadingWeekly.value = true
  try {
    const data = await getWeeklyOverview({ from: weeklyRange.value[0], to: weeklyRange.value[1], scope: scope.value })
    weeklyData.value = data
  } catch (err: any) {
    ElMessage.error(err?.message || '加载周视图失败')
  } finally {
    loadingWeekly.value = false
  }
}

function shiftDaily(delta: number) {
  dailyDate.value = addDaysISO(dailyDate.value, delta)
}

function shiftWeek(delta: number) {
  weeklyRange.value = [addDaysISO(weeklyRange.value[0], delta * 7), addDaysISO(weeklyRange.value[1], delta * 7)]
}

function resetWeek() {
  weeklyRange.value = weekRangeOf(todayISO())
}

function resetToday() {
  dailyDate.value = todayISO()
}

function openWeeklyDrawer(user: WeeklyOverviewUser) {
  weeklyDrawerUser.value = user
  weeklyDrawerActiveDate.value = user.days[0]?.date ?? ''
  weeklyDrawerVisible.value = true
}

function closeWeeklyDrawer() {
  weeklyDrawerVisible.value = false
  weeklyDrawerUser.value = null
  weeklyDrawerActiveDate.value = ''
}

function weekDates(): string[] {
  return eachDay(weeklyRange.value[0], weeklyRange.value[1])
}

const scopeOptions = [
  { label: '仅本人', value: 'self' },
  { label: '直属下属', value: 'direct' },
  { label: '子树', value: 'subtree' },
]

const viewOptions = [
  { label: '日视图', value: 'daily' },
  { label: '周视图', value: 'weekly' },
]

const dailyTotals = computed(() => dailyData.value?.totals || null)

const dailyRootOrgIds = computed(() =>
  (dailyData.value?.orgs || []).filter((org) => org.parentId == null).map((org) => org.orgId)
)

const dailyOrgOptions = computed(() =>
  (dailyData.value?.orgs || []).map((org) => ({
    label: org.name,
    value: org.orgId,
    parentId: org.parentId,
  }))
)

function matchesOrg(orgId: number | null, selectedIds: number[], rootIds: number[]): boolean {
  if (!selectedIds.length) return true
  if (orgId != null && selectedIds.includes(orgId)) return true
  if (rootIds.some((id) => selectedIds.includes(id))) return true
  return false
}

const filteredDailyUsers = computed<DailyOverviewUser[]>(() => {
  if (!dailyData.value) return []
  const keyword = dailySearch.value.trim().toLowerCase()
  const selected = dailyOrgFilter.value
  const roots = dailyRootOrgIds.value
  return dailyData.value.users.filter((user) => {
    if (!matchesOrg(user.orgId ?? null, selected, roots)) return false
    if (keyword) {
      const name = (user.name || '').toLowerCase()
      if (!name.includes(keyword)) return false
    }
    if (dailyOnlyMissing.value && !user.metrics.missing) return false
    if (dailyOnlyPlan.value && user.metrics.planCount === 0) return false
    return true
  })
})

const dailyOrgsForDisplay = computed(() => dailyData.value?.orgs || [])

const weeklyRootOrgIds = computed(() =>
  (weeklyData.value?.orgs || []).filter((org) => org.parentId == null).map((org) => org.orgId)
)

const weeklyOrgOptions = computed(() =>
  (weeklyData.value?.orgs || []).map((org) => ({
    label: org.name,
    value: org.orgId,
    parentId: org.parentId,
  }))
)

const weeklyDatesComputed = computed(() => weekDates())

const filteredWeeklyUsers = computed<WeeklyOverviewUser[]>(() => {
  if (!weeklyData.value) return []
  const keyword = weeklySearch.value.trim().toLowerCase()
  const selected = weeklyOrgFilter.value
  const roots = weeklyRootOrgIds.value
  return weeklyData.value.users.filter((user) => {
    if (!matchesOrg(user.orgId ?? null, selected, roots)) return false
    if (keyword) {
      const name = (user.name || '').toLowerCase()
      if (!name.includes(keyword)) return false
    }
    if (weeklyOnlyMissing.value && user.summary.missingDays.length === 0) return false
    if (weeklyOnlyPlan.value && user.summary.planCount === 0) return false
    return true
  })
})

const weeklyOrgsForDisplay = computed(() => weeklyData.value?.orgs || [])

async function exportWeeklyExcel() {
  if (!weeklyRange.value[0] || !weeklyRange.value[1]) return
  exporting.value = true
  try {
    const { jobId } = await postWeeklyExport({
      from: weeklyRange.value[0],
      to: weeklyRange.value[1],
      scope: scope.value,
    })
    let attempts = 0
    while (attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const status = await getExportStatus(jobId)
      if (status.status === 'ready') {
        await downloadExport(jobId)
        ElMessage.success('导出已就绪，开始下载')
        return
      }
      attempts += 1
    }
    throw new Error('导出超时，请稍后重试')
  } catch (err: any) {
    ElMessage.error(err?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

watch(scope, () => {
  loadDailyOverview()
  loadWeeklyOverview()
})

watch(dailyDate, () => {
  loadDailyOverview()
})

watch(weeklyRange, () => {
  loadWeeklyOverview()
})

watch(viewMode, (mode) => {
  if (mode === 'daily' && !dailyData.value) {
    loadDailyOverview()
  } else if (mode === 'weekly' && !weeklyData.value) {
    loadWeeklyOverview()
  }
})

onMounted(() => {
  loadDailyOverview()
  loadWeeklyOverview()
})
</script>

<template>
  <div class="weekly-report-page">
    <div class="toolbar">
      <el-segmented v-model="viewMode" :options="viewOptions" />
      <el-select v-model="scope" style="width: 140px">
        <el-option v-for="option in scopeOptions" :key="option.value" :label="option.label" :value="option.value" />
      </el-select>

      <template v-if="viewMode === 'daily'">
        <el-date-picker v-model="dailyDate" type="date" value-format="YYYY-MM-DD" :clearable="false" />
        <el-button-group>
          <el-button @click="shiftDaily(-1)">前一天</el-button>
          <el-button @click="resetToday">今天</el-button>
          <el-button @click="shiftDaily(1)">后一天</el-button>
        </el-button-group>
        <el-select v-model="dailyOrgFilter" multiple collapse-tags style="min-width: 200px" placeholder="按组织筛选">
          <el-option v-for="org in dailyOrgOptions" :key="org.value" :label="org.label" :value="org.value" />
        </el-select>
        <el-input v-model="dailySearch" placeholder="搜索人员" style="width: 180px" />
        <el-checkbox v-model="dailyOnlyMissing">只看缺报</el-checkbox>
        <el-checkbox v-model="dailyOnlyPlan">只看有计划</el-checkbox>
        <el-button :loading="loadingDaily" @click="loadDailyOverview">刷新</el-button>
      </template>

      <template v-else>
        <el-date-picker
          v-model="weeklyRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          :clearable="false"
        />
        <el-button-group>
          <el-button @click="shiftWeek(-1)">上一周</el-button>
          <el-button @click="resetWeek">本周</el-button>
          <el-button @click="shiftWeek(1)">下一周</el-button>
        </el-button-group>
        <el-select v-model="weeklyOrgFilter" multiple collapse-tags style="min-width: 220px" placeholder="按组织筛选">
          <el-option v-for="org in weeklyOrgOptions" :key="org.value" :label="org.label" :value="org.value" />
        </el-select>
        <el-input v-model="weeklySearch" placeholder="搜索人员" style="width: 200px" />
        <el-checkbox v-model="weeklyOnlyMissing">只看缺报</el-checkbox>
        <el-checkbox v-model="weeklyOnlyPlan">只看有计划</el-checkbox>
        <el-button :loading="loadingWeekly" @click="loadWeeklyOverview">刷新</el-button>
        <el-button type="primary" :loading="exporting" @click="exportWeeklyExcel">导出 Excel</el-button>
      </template>
    </div>

    <template v-if="viewMode === 'daily'">
      <div class="summary" v-if="dailyTotals">
        <el-tag type="info">人员 {{ dailyTotals.userCount }}</el-tag>
        <el-tag type="success">已完成 {{ dailyTotals.completedUsers }}</el-tag>
        <el-tag type="success">完成条目 {{ dailyTotals.completedCount }}</el-tag>
        <el-tag type="warning">有计划 {{ dailyTotals.planUsers }}</el-tag>
        <el-tag type="warning">计划条目 {{ dailyTotals.planCount }}</el-tag>
        <el-tag type="danger">缺报 {{ dailyTotals.missingUsers }}</el-tag>
      </div>

      <el-tabs v-model="dailyGroupTab" class="daily-tabs">
        <el-tab-pane label="按人员" name="users">
          <el-empty v-if="!filteredDailyUsers.length && !loadingDaily" description="暂无可见人员" />
          <div v-else class="daily-card-grid" v-loading="loadingDaily">
            <el-card
              v-for="user in filteredDailyUsers"
              :key="user.userId"
              shadow="hover"
              class="daily-card"
            >
              <div class="daily-card__header">
                <div>
                  <div class="daily-card__name">{{ user.name || `用户 ${user.userId}` }}</div>
                  <div class="daily-card__org" v-if="user.orgName">{{ user.orgName }}</div>
                </div>
                <div class="daily-card__chips">
                  <el-tag type="success" v-if="user.metrics.completedCount">完成 {{ user.metrics.completedCount }}</el-tag>
                  <el-tag type="warning" v-if="user.metrics.planCount">计划 {{ user.metrics.planCount }}</el-tag>
                  <el-tag type="danger" v-if="user.metrics.missing">缺报</el-tag>
                </div>
              </div>
              <div class="daily-card__section">
                <div class="section-title">今日完成</div>
                <el-empty v-if="!user.completed.length" description="暂无完成记录" />
                <ul v-else class="item-list">
                  <li v-for="item in user.completed" :key="item.id">
                    <span class="item-title">{{ item.title }}</span>
                    <span class="item-type">{{ typeLabel(item.type) }}</span>
                    <span v-if="item.durationMinutes" class="item-duration">{{ item.durationMinutes }} 分钟</span>
                  </li>
                </ul>
              </div>
              <div class="daily-card__section">
                <div class="section-title">明日计划（{{ dailyData?.nextDate }}）</div>
                <el-empty v-if="!user.plans.length" description="暂无计划" />
                <ul v-else class="item-list">
                  <li v-for="item in user.plans" :key="`plan-${item.id}`">
                    <span class="item-title">{{ item.title }}</span>
                    <span class="item-type">计划</span>
                    <span v-if="item.durationMinutes" class="item-duration">{{ item.durationMinutes }} 分钟</span>
                  </li>
                </ul>
              </div>
            </el-card>
          </div>
        </el-tab-pane>
        <el-tab-pane label="按组织" name="orgs">
          <el-table :data="dailyOrgsForDisplay" size="small" class="org-table" v-loading="loadingDaily">
            <el-table-column prop="name" label="组织" min-width="180" />
            <el-table-column prop="metrics.userCount" label="人数" width="100" />
            <el-table-column prop="metrics.completedUsers" label="已完成" width="100" />
            <el-table-column prop="metrics.planUsers" label="有计划" width="100" />
            <el-table-column prop="metrics.planCount" label="计划条目" width="110" />
            <el-table-column prop="metrics.completedCount" label="完成条目" width="120" />
            <el-table-column prop="metrics.completedMinutes" label="总时长(分钟)" width="140" />
            <el-table-column prop="metrics.missingUsers" label="缺报" width="100" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </template>

    <template v-else>
      <el-tabs v-model="weeklyGroupTab" class="weekly-tabs">
        <el-tab-pane label="按人员" name="users">
          <el-table :data="filteredWeeklyUsers" v-loading="loadingWeekly" style="width: 100%">
            <el-table-column label="人员" min-width="220">
              <template #default="{ row }">
                <div class="weekly-user">
                  <div class="weekly-user__name">{{ row.name || `用户 ${row.userId}` }}</div>
                  <div class="weekly-user__org" v-if="row.orgName">{{ row.orgName }}</div>
                  <el-tag type="danger" size="small" v-if="row.summary.missingDays.length">缺报 {{ row.summary.missingDays.length }} 天</el-tag>
                </div>
              </template>
            </el-table-column>
            <el-table-column
              v-for="(date, index) in weeklyDatesComputed"
              :key="date"
              :label="formatDateLabel(date)"
              width="150"
            >
              <template #default="{ row }">
                <div class="weekly-day-cell">
                  <div class="count">完成 {{ row.days[index]?.completedCount || 0 }}</div>
                  <div v-if="row.days[index]?.planCount" class="plan">计划 {{ row.days[index]?.planCount }}</div>
                  <div v-if="row.days[index]?.completedMinutes" class="minutes">
                    {{ row.days[index]?.completedMinutes }} 分钟
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="汇总" width="220">
              <template #default="{ row }">
                <div class="weekly-summary">
                  <div>完成 {{ row.summary.completedCount }} 条 / {{ row.summary.completedMinutes }} 分钟</div>
                  <div>计划 {{ row.summary.planCount }} 条</div>
                  <div v-if="row.summary.missingDays.length">缺报 {{ row.summary.missingDays.length }} 天</div>
                  <el-button size="small" type="primary" text @click="openWeeklyDrawer(row)">查看详情</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="按组织" name="orgs">
          <el-table :data="weeklyOrgsForDisplay" size="small" v-loading="loadingWeekly">
            <el-table-column prop="name" label="组织" min-width="200" />
            <el-table-column prop="summary.userCount" label="人数" width="100" />
            <el-table-column prop="summary.completedUsers" label="已完成" width="100" />
            <el-table-column prop="summary.planUsers" label="有计划" width="100" />
            <el-table-column prop="summary.planCount" label="计划条目" width="110" />
            <el-table-column prop="summary.completedCount" label="完成条目" width="120" />
            <el-table-column prop="summary.completedMinutes" label="总时长(分钟)" width="140" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </template>

    <el-drawer
      v-model="weeklyDrawerVisible"
      :title="weeklyDrawerUser ? `${weeklyDrawerUser.name || `用户 ${weeklyDrawerUser.userId}`} · 周详情` : ''"
      size="50%"
      @close="closeWeeklyDrawer"
    >
      <div v-if="weeklyDrawerUser" class="drawer-summary">
        <div>完成 {{ weeklyDrawerUser.summary.completedCount }} 条 · {{ weeklyDrawerUser.summary.completedMinutes }} 分钟</div>
        <div>计划 {{ weeklyDrawerUser.summary.planCount }} 条</div>
        <div v-if="weeklyDrawerUser.summary.missingDays.length">缺报 {{ weeklyDrawerUser.summary.missingDays.length }} 天</div>
      </div>
      <el-tabs v-if="weeklyDrawerUser" v-model="weeklyDrawerActiveDate">
        <el-tab-pane
          v-for="day in weeklyDrawerUser.days"
          :key="day.date"
          :label="formatDateLabel(day.date)"
          :name="day.date"
        >
          <div class="drawer-section">
            <div class="section-title">完成</div>
            <el-empty v-if="!day.completed.length" description="暂无完成记录" />
            <ul v-else class="item-list">
              <li v-for="item in day.completed" :key="item.id">
                <span class="item-title">{{ item.title }}</span>
                <span class="item-type">{{ typeLabel(item.type) }}</span>
                <span v-if="item.durationMinutes" class="item-duration">{{ item.durationMinutes }} 分钟</span>
              </li>
            </ul>
          </div>
          <div class="drawer-section">
            <div class="section-title">计划</div>
            <el-empty v-if="!day.plans.length" description="暂无计划" />
            <ul v-else class="item-list">
              <li v-for="item in day.plans" :key="`plan-${item.id}`">
                <span class="item-title">{{ item.title }}</span>
                <span class="item-type">计划</span>
                <span v-if="item.durationMinutes" class="item-duration">{{ item.durationMinutes }} 分钟</span>
              </li>
            </ul>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-drawer>
  </div>
</template>

<style scoped>
.weekly-report-page {
  margin-top: 16px;
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  text-align: left;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.daily-tabs,
.weekly-tabs {
  --el-tabs-header-height: 42px;
}

.daily-card-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
}

.daily-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.daily-card__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.daily-card__name {
  font-weight: 600;
  font-size: 16px;
}

.daily-card__org {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin-top: 2px;
}

.daily-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.daily-card__section {
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 8px;
}

.section-title {
  font-weight: 600;
  margin-bottom: 6px;
}

.item-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item-list li {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.item-title {
  font-weight: 500;
}

.item-type {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.item-duration {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.org-table {
  margin-top: 12px;
}

.weekly-user {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.weekly-user__name {
  font-weight: 600;
}

.weekly-user__org {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.weekly-day-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.weekly-day-cell .count {
  font-weight: 600;
}

.weekly-day-cell .plan {
  color: var(--el-color-warning);
}

.weekly-day-cell .minutes {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.weekly-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.drawer-summary {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.drawer-section {
  margin-bottom: 16px;
}

.drawer-section:last-child {
  margin-bottom: 0;
}

.weekly-day-cell .plan,
.daily-card__chips .el-tag.type-warning {
  color: var(--el-color-warning);
}

.weekly-report-page :deep(.el-table__cell) {
  padding: 10px 12px;
}
</style>
