<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import type {
  DailyOverviewResponse,
  DailyOverviewUser,
  WeeklyOverviewResponse,
  WeeklyOverviewUser,
  WeeklyOverviewOrg,
  WeeklyOverviewDay,
} from '@drrq/shared/index'
import { getDailyOverview, getWeeklyOverview } from '../api'

type ViewMode = 'daily' | 'weekly'
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

const dailyOrgFilter = ref<number[]>([])
const dailySearch = ref('')
const dailyOnlyMissing = ref(false)
const dailyOnlyPlan = ref(false)
const weeklySearch = ref('')
const weeklyOnlyMissing = ref(false)
const weeklyOnlyPlan = ref(false)
const exporting = ref(false)

function resolveWeeklyDay(user: WeeklyOverviewUser, date: string) {
  const found = user.days.find((day) => day.date === date)
  return (
    found ?? {
      date,
      completedCount: 0,
      completedMinutes: 0,
      planCount: 0,
      completed: [],
      plans: [],
    }
  )
}

function aggregateGroupStats(users: WeeklyOverviewUser[], summary?: WeeklyOverviewOrg['summary']) {
  if (summary) {
    return {
      completedCount: summary.completedCount ?? 0,
      completedMinutes: summary.completedMinutes ?? 0,
      planCount: summary.planCount ?? 0,
      userCount: summary.userCount ?? users.length,
    }
  }
  let completedCount = 0
  let completedMinutes = 0
  let planCount = 0
  for (const user of users) {
    completedCount += user.summary.completedCount
    completedMinutes += user.summary.completedMinutes
    planCount += user.summary.planCount
  }
  return { completedCount, completedMinutes, planCount, userCount: users.length }
}

function formatWorkItems(items: WeeklyOverviewDay['completed']) {
  if (!items.length) return ''
  return items
    .map((item) => {
      const label = typeLabel(item.type)
      const title = item.title || ''
      const duration = item.durationMinutes ? `(${item.durationMinutes}m)` : ''
      return `${label}: ${title}${duration}`
    })
    .join('\n')
}

function charDisplayWidth(cp: number): number {
  if (
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x2e80 && cp <= 0x9fff) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff00 && cp <= 0xffef)
  ) {
    return 2
  }
  return 1
}

function displayLength(str: string): number {
  let length = 0
  for (let i = 0; i < str.length; ) {
    const cp = str.codePointAt(i)!
    length += charDisplayWidth(cp)
    i += cp > 0xffff ? 2 : 1
  }
  return length
}

function sanitizeSheetName(raw: string, used: Set<string>) {
  const invalidChars = /[\[\]:*?\/\\]/g
  let base = raw.replace(invalidChars, '_').trim()
  if (!base) base = 'Sheet'
  if (base.length > 31) base = base.slice(0, 31)
  let name = base
  let counter = 1
  while (used.has(name)) {
    const suffix = `_${counter++}`
    const maxLen = Math.max(31 - suffix.length, 1)
    name = `${base.slice(0, maxLen)}${suffix}`
  }
  used.add(name)
  return name
}

async function exportWeeklyExcel() {
  if (!weeklyData.value) {
    await loadWeeklyOverview()
    if (!weeklyData.value) {
      ElMessage.warning('周视图数据尚未加载完成')
      return
    }
  }
  try {
    exporting.value = true
    const [{ utils, writeFile }] = await Promise.all([import('xlsx-js-style')])
    const workbook = utils.book_new()
    const usedNames = new Set<string>()
    const dates = weeklyDates.value
    const header = [
      '工号',
      '姓名',
      '用户ID',
      '组织',
      ...dates.map((date) => formatDateLabel(date)),
      '完成总数',
      '完成总分钟',
      '计划总数',
      '缺报天数',
      '缺报日期',
    ]

    const appendSheet = (title: string, users: WeeklyOverviewUser[]) => {
      const rows: (string | number)[][] = []
      const rowSpans: Array<{ start: number; end: number }> = []
      const rowHasValues: boolean[] = []
      const thinBlackBorder = { style: 'thin', color: { rgb: 'FF000000' } }
      const fullBorder = {
        top: thinBlackBorder,
        bottom: thinBlackBorder,
        left: thinBlackBorder,
        right: thinBlackBorder,
      }
      const summaryStartIndex = 4 + dates.length
      const mergeColumns: number[] = [0, 1, 2, 3]
      for (let col = summaryStartIndex; col < header.length; col += 1) {
        mergeColumns.push(col)
      }

      for (const user of users) {
        const summary = user.summary
        const daysData = dates.map((date) => resolveWeeklyDay(user, date))
        const completedCells = daysData.map((day) => formatWorkItems(day.completed))
        const planCells = daysData.map((day) => formatWorkItems(day.plans))
        const completedHasValues = completedCells.some((cell) => typeof cell === 'string' && cell.trim() !== '')
        const planHasValues = planCells.some((cell) => typeof cell === 'string' && cell.trim() !== '')
        const missingDates = summary.missingDays.join(', ')
        const completedRow: (string | number)[] = [
          user.employeeNo ?? '',
          user.name ?? '',
          user.userId,
          user.orgName ?? '',
          ...completedCells,
          summary.completedCount,
          summary.completedMinutes,
          summary.planCount,
          summary.missingDays.length,
          missingDates,
        ]
        const planRow: (string | number)[] = [
          '',
          '',
          '',
          '',
          ...planCells,
          ...Array(header.length - summaryStartIndex).fill(''),
        ]
        const startIdx = rows.length
        rows.push(completedRow)
        rows.push(planRow)
        rowHasValues.push(completedHasValues)
        rowHasValues.push(planHasValues)
        rowSpans.push({ start: startIdx, end: startIdx + 1 })
      }

      if (!rows.length) {
        rows.push(['（无符合人员）', ...Array(header.length - 1).fill('')])
        rowHasValues.push(false)
      }

      const sheet = utils.aoa_to_sheet([header, ...rows])
      const dayColumnIndices = dates.map((_, idx) => 4 + idx)

      const applyCellStyle = (cellRef: string, style: { alignment?: any; border?: any }) => {
        const cell = sheet[cellRef]
        if (!cell) return
        cell.s = cell.s || {}
        if (style.alignment) {
          const prevAlignment = cell.s.alignment ?? {}
          cell.s.alignment = { ...prevAlignment, ...style.alignment }
        }
        if (style.border) {
          const prevBorder = cell.s.border ?? {}
          cell.s.border = { ...prevBorder, ...style.border }
        }
      }

      for (let c = 0; c < header.length; c += 1) {
        const headerRef = utils.encode_cell({ r: 0, c })
        applyCellStyle(headerRef, { alignment: { horizontal: 'center', vertical: 'center' }, border: fullBorder })
      }

      if (rowSpans.length && mergeColumns.length) {
        const sheetMerges = sheet['!merges'] ?? []
        for (const span of rowSpans) {
          const startRow = span.start + 1
          const endRow = span.end + 1
          for (const col of mergeColumns) {
            sheetMerges.push({
              s: { r: startRow, c: col },
              e: { r: endRow, c: col },
            })
            for (let row = startRow; row <= endRow; row += 1) {
              const cellRef = utils.encode_cell({ r: row, c: col })
              const border: any = {
                left: thinBlackBorder,
                right: thinBlackBorder,
              }
              if (row === startRow) border.top = thinBlackBorder
              if (row === endRow) border.bottom = thinBlackBorder
              applyCellStyle(cellRef, { alignment: { horizontal: 'center', vertical: 'center' }, border })
            }
          }
        }
        sheet['!merges'] = sheetMerges
      }

      for (let r = 0; r < rows.length; r += 1) {
        const sheetRow = r + 1
        const hasValue = rowHasValues[r]
        for (const col of dayColumnIndices) {
          const cellRef = utils.encode_cell({ r: sheetRow, c: col })
          const style: { alignment: any; border?: any } = { alignment: { wrapText: true, vertical: 'top' } }
          if (hasValue) {
            style.border = fullBorder
          }
          applyCellStyle(cellRef, style)
        }
      }

      {
        const cols: Array<{ wch: number }> = Array.from({ length: header.length }, () => ({ wch: 10 }))
        const maxLineLength = (value: unknown) => {
          if (typeof value !== 'string' || !value) return 0
          return value
            .split(/\r?\n/)
            .reduce((max, line) => Math.max(max, displayLength(line)), 0)
        }
        for (const col of dayColumnIndices) {
          let maxLen = 0
          for (let r = 0; r < rows.length; r += 1) {
            const cellValue = rows[r]?.[col] ?? ''
            const lineLength = maxLineLength(cellValue)
            if (lineLength > maxLen) maxLen = lineLength
          }
          cols[col] = { wch: Math.max(10, maxLen) }
        }
        ;(sheet as any)['!cols'] = cols
      }

      const sheetName = sanitizeSheetName(title, usedNames)
      utils.book_append_sheet(workbook, sheet, sheetName)
    }

    weeklyGrouping.value.groups.forEach((group) => {
      appendSheet(group.title, group.users)
    })
    if (weeklyGrouping.value.unassigned.length) {
      appendSheet('未分配', weeklyGrouping.value.unassigned)
    }
    if (!workbook.SheetNames.length) {
      appendSheet('周视图', [])
    }

    const [from, to] = weeklyRange.value
    const scope = weeklyData.value?.scope ?? 'self'
    const fileName = `Weekly_${from}_${to}_${scope}.xlsx`
    writeFile(workbook, fileName)
    ElMessage.success('已导出周视图数据')
  } catch (err: any) {
    ElMessage.error(err?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

async function loadDailyOverview() {
  loadingDaily.value = true
  try {
    const data = await getDailyOverview({ date: dailyDate.value, scope: 'direct' })
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
    const data = await getWeeklyOverview({ from: weeklyRange.value[0], to: weeklyRange.value[1], scope: 'direct' })
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

const filteredWeeklyUsers = computed<WeeklyOverviewUser[]>(() => {
  if (!weeklyData.value) return []
  const keyword = weeklySearch.value.trim().toLowerCase()
  return weeklyData.value.users.filter((user) => {
    if (keyword) {
      const name = (user.name || '').toLowerCase()
      if (!name.includes(keyword)) return false
    }
    if (weeklyOnlyMissing.value && user.summary.missingDays.length === 0) return false
    if (weeklyOnlyPlan.value && user.summary.planCount === 0) return false
    return true
  })
})

const weeklyDates = computed(() => eachDay(weeklyRange.value[0], weeklyRange.value[1]))

const weeklyGrouping = computed(() => {
  const data = weeklyData.value
  if (!data) return { groups: [] as Array<{ key: string; title: string; summary: any; users: WeeklyOverviewUser[] }>, unassigned: [] as WeeklyOverviewUser[] }
  const orgs: WeeklyOverviewOrg[] = data.orgs || []
  const users = filteredWeeklyUsers.value
  const orgMap = new Map<number, WeeklyOverviewOrg>()
  const childrenMap = new Map<number | null, WeeklyOverviewOrg[]>()
  for (const org of orgs) {
    orgMap.set(org.orgId, org)
    const parent = org.parentId != null ? Number(org.parentId) : null
    let bucket = childrenMap.get(parent)
    if (!bucket) {
      bucket = []
      childrenMap.set(parent, bucket)
    }
    bucket.push(org)
  }
  const rootChildren = childrenMap.get(null) || []
  let topLevel = rootChildren
  if (rootChildren.length === 1) {
    const rootOrg = rootChildren[0]
    if (rootOrg) {
      const childList = childrenMap.get(rootOrg.orgId)
      topLevel = childList || []
    }
  }
  const descendantCache = new Map<number, number[]>()
  function collect(orgId: number): number[] {
    const cached = descendantCache.get(orgId)
    if (cached) return cached
    const ids = [orgId]
    const children = childrenMap.get(orgId) || []
    for (const child of children) {
      ids.push(...collect(child.orgId))
    }
    descendantCache.set(orgId, ids)
    return ids
  }
  const assigned = new Set<number>()
  const groups = topLevel
    .map((org) => {
      const descendantIds = collect(org.orgId)
      const groupUsers = users.filter((user) => user.orgId != null && descendantIds.includes(Number(user.orgId)))
      groupUsers.forEach((user) => assigned.add(user.userId))
      return {
        key: String(org.orgId),
        title: org.name,
        summary: org.summary,
        users: groupUsers,
      }
    })
    .filter((group) => group.users.length || (group.summary && group.summary.userCount))
  const unassigned = users.filter((user) => !assigned.has(user.userId))
  return { groups, unassigned }
})

const weeklyOpenGroups = ref<string[]>([])

watch(
  [
    () => weeklyGrouping.value,
    () => weeklySearch.value.trim().toLowerCase(),
  ],
  ([grouping, keyword]) => {
    const keys: string[] = []
    if (keyword) {
      grouping.groups.forEach((group) => {
        if (group.users.length) keys.push(group.key)
      })
      if (grouping.unassigned.length) keys.push('__unassigned')
    } else {
      grouping.groups.forEach((group) => {
        keys.push(group.key)
      })
      if (grouping.unassigned.length) keys.push('__unassigned')
    }
    weeklyOpenGroups.value = keys
  },
  { immediate: true }
)

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
        <el-input v-model="weeklySearch" placeholder="搜索人员" style="width: 200px" />
        <el-checkbox v-model="weeklyOnlyMissing">只看缺报</el-checkbox>
        <el-checkbox v-model="weeklyOnlyPlan">只看有计划</el-checkbox>
        <el-button :loading="loadingWeekly" @click="loadWeeklyOverview">刷新</el-button>

        <el-button

          type="primary"

          :loading="exporting"

          :disabled="loadingWeekly || !weeklyData"

          @click="exportWeeklyExcel"

        >

          导出Excel

        </el-button>
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
    </template>

    <template v-else>
      <div v-if="!filteredWeeklyUsers.length">
        <el-empty v-if="!loadingWeekly" description="暂无可见人员" />
      </div>
      <el-collapse
        v-else
        v-model="weeklyOpenGroups"
        class="weekly-collapse"
        accordion="false"
      >
        <el-collapse-item
          v-for="group in weeklyGrouping.groups"
          :key="group.key"
          :name="group.key"
        >
          <template #title>
            <div class="weekly-collapse__title">
              <span>{{ group.title }}</span>
              <span class="weekly-collapse__stats">
                <template v-for="stats in [aggregateGroupStats(group.users, group.summary)]" :key="group.key + '-stats'">
                  完成 {{ stats.completedCount }} 条 · {{ stats.completedMinutes }} 分钟 · 计划 {{ stats.planCount }} 条 · 人员 {{ stats.userCount }}
                </template>
              </span>
            </div>
          </template>
          <el-empty v-if="!group.users.length" description="该部门暂无符合条件的人员" />
          <el-table
            v-else
            :data="group.users"
            class="weekly-table"
            border
            style="width: 100%"
          >
            <el-table-column label="人员" min-width="200">
              <template #default="{ row }">
                <div class="weekly-table__user">
                  <div class="weekly-table__name">{{ row.name || `用户 ${row.userId}` }}</div>
                  <div class="weekly-table__org" v-if="row.orgName">{{ row.orgName }}</div>
                  <div class="weekly-table__chips">
                    <el-tag type="warning" size="small" v-if="row.summary.planCount">计划 {{ row.summary.planCount }}</el-tag>
                    <el-tag type="danger" size="small" v-if="row.summary.missingDays.length">缺报 {{ row.summary.missingDays.length }} 天</el-tag>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column
              v-for="date in weeklyDates"
              :key="date"
              :label="formatDateLabel(date)"
              min-width="260"
            >
              <template #default="{ row }">
                <template v-for="day in [resolveWeeklyDay(row, date)]" :key="day.date">
                  <div class="weekly-cell">
                    <div class="weekly-cell__section">
                      <div class="section-title">完成</div>
                      <div v-if="!day.completed.length" class="weekly-cell__empty">暂无完成记录</div>
                      <ul v-else class="item-list">
                        <li v-for="item in day.completed" :key="item.id">
                          <span class="item-title">{{ item.title }}</span>
                          <span class="item-type">{{ typeLabel(item.type) }}</span>
                          <span v-if="item.durationMinutes" class="item-duration">{{ item.durationMinutes }} 分钟</span>
                        </li>
                      </ul>
                    </div>
                    <div class="weekly-cell__section">
                      <div class="section-title">计划</div>
                      <div v-if="!day.plans.length" class="weekly-cell__empty">暂无计划</div>
                      <ul v-else class="item-list">
                        <li v-for="item in day.plans" :key="`plan-${item.id}`">
                          <span class="item-title">{{ item.title }}</span>
                          <span class="item-type">计划</span>
                          <span v-if="item.durationMinutes" class="item-duration">{{ item.durationMinutes }} 分钟</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </template>
              </template>
            </el-table-column>
            <el-table-column label="本周概览" min-width="220">
              <template #default="{ row }">
                <div class="weekly-summary">
                  <div>完成 {{ row.summary.completedCount }} 条 · {{ row.summary.completedMinutes }} 分钟</div>
                  <div>计划 {{ row.summary.planCount }} 条</div>
                  <div v-if="row.summary.missingDays.length">缺报 {{ row.summary.missingDays.length }} 天</div>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
        <el-collapse-item v-if="weeklyGrouping.unassigned.length" name="__unassigned">
          <template #title>
            <div class="weekly-collapse__title">
              <span>未分配组织</span>
              <span class="weekly-collapse__stats" v-for="stats in [aggregateGroupStats(weeklyGrouping.unassigned)]" :key="'unassigned-stats'">
                完成 {{ stats.completedCount }} 条 · {{ stats.completedMinutes }} 分钟 · 计划 {{ stats.planCount }} 条 · 人员 {{ stats.userCount }}
              </span>
            </div>
          </template>
          <el-table
            :data="weeklyGrouping.unassigned"
            class="weekly-table"
            border
            style="width: 100%"
          >
            <el-table-column label="人员" min-width="200">
              <template #default="{ row }">
                <div class="weekly-table__user">
                  <div class="weekly-table__name">{{ row.name || `用户 ${row.userId}` }}</div>
                  <div class="weekly-table__chips">
                    <el-tag type="warning" size="small" v-if="row.summary.planCount">计划 {{ row.summary.planCount }}</el-tag>
                    <el-tag type="danger" size="small" v-if="row.summary.missingDays.length">缺报 {{ row.summary.missingDays.length }} 天</el-tag>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column
              v-for="date in weeklyDates"
              :key="date"
              :label="formatDateLabel(date)"
              min-width="260"
            >
              <template #default="{ row }">
                <template v-for="day in [resolveWeeklyDay(row, date)]" :key="day.date">
                  <div class="weekly-cell">
                    <div class="weekly-cell__section">
                      <div class="section-title">完成</div>
                      <div v-if="!day.completed.length" class="weekly-cell__empty">暂无完成记录</div>
                      <ul v-else class="item-list">
                        <li v-for="item in day.completed" :key="item.id">
                          <span class="item-title">{{ item.title }}</span>
                          <span class="item-type">{{ typeLabel(item.type) }}</span>
                          <span v-if="item.durationMinutes" class="item-duration">{{ item.durationMinutes }} 分钟</span>
                        </li>
                      </ul>
                    </div>
                    <div class="weekly-cell__section">
                      <div class="section-title">计划</div>
                      <div v-if="!day.plans.length" class="weekly-cell__empty">暂无计划</div>
                      <ul v-else class="item-list">
                        <li v-for="item in day.plans" :key="`plan-${item.id}`">
                          <span class="item-title">{{ item.title }}</span>
                          <span class="item-type">计划</span>
                          <span v-if="item.durationMinutes" class="item-duration">{{ item.durationMinutes }} 分钟</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </template>
              </template>
            </el-table-column>
            <el-table-column label="本周概览" min-width="220">
              <template #default="{ row }">
                <div class="weekly-summary">
                  <div>完成 {{ row.summary.completedCount }} 条 · {{ row.summary.completedMinutes }} 分钟</div>
                  <div>计划 {{ row.summary.planCount }} 条</div>
                  <div v-if="row.summary.missingDays.length">缺报 {{ row.summary.missingDays.length }} 天</div>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </template>
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

.daily-card__chips .el-tag.type-warning {
  color: var(--el-color-warning);
}

.weekly-table {
  margin-top: 12px;
}

.weekly-table :deep(.el-table__cell) {
  vertical-align: top;
  padding: 12px;
}

.weekly-table__user {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.weekly-table__name {
  font-weight: 600;
}

.weekly-table__org {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.weekly-table__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.weekly-table__chips .el-tag.type-warning {
  color: var(--el-color-warning);
}

.weekly-collapse {
  margin-top: 12px;
}

.weekly-collapse__title {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-weight: 600;
}

.weekly-collapse__stats {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  font-weight: 400;
}

.weekly-cell {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.weekly-cell__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.weekly-cell__section .section-title {
  margin-bottom: 0;
}

.weekly-cell__empty {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.weekly-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
