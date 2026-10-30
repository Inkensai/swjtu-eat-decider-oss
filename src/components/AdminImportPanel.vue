<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Menu, Resource } from '../../shared/types'
import { DISH_CSV_TEMPLATE, exportMenu, IMPORT_BODY_LIMIT, type ImportReport } from '../../shared/menu-import'
import { api } from '../services/api'
import { useAdminStore } from '../stores/admin'

const props = defineProps<{ menu: Menu; selectedRestaurantId: string; disabled?: boolean }>()
const emit = defineEmits<{ imported: [] }>()
const session = useAdminStore()
const format = ref<'json' | 'csv'>('json')
const restaurantId = ref(props.selectedRestaurantId)
const content = ref('')
const busy = ref(false)
const error = ref('')
const message = ref('')
const report = ref<ImportReport | null>(null)
const prepared = ref<Record<string, unknown> | null>(null)
const labels: Record<Resource, string> = { areas: '区域', restaurants: '店铺', dishes: '菜品' }
const total = computed(() => report.value ? Object.values(report.value.counts).reduce((sum, value) => sum + value, 0) : 0)

watch([format, restaurantId, content], () => { report.value = null; prepared.value = null; error.value = ''; message.value = '' })
watch(() => props.selectedRestaurantId, (value) => { if (!busy.value) restaurantId.value = value })

function download(value: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([value], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function exportSnapshot(): void {
  download(JSON.stringify(exportMenu(props.menu), null, 2), 'eat-decider-menu-v1.json', 'application/json;charset=utf-8')
}
async function readFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  report.value = null
  prepared.value = null
  error.value = ''
  if (file.size > IMPORT_BODY_LIMIT) { error.value = '文件超过 64 KiB，请拆成小批次后导入。'; return }
  busy.value = true
  try { content.value = await file.text() }
  catch { error.value = '文件读取失败，请重新选择。' }
  finally { busy.value = false }
}
async function preview(): Promise<void> {
  if (busy.value) return
  error.value = ''
  message.value = ''
  report.value = null
  prepared.value = null
  try {
    if (!content.value.trim()) throw new Error('请选择文件或粘贴导入内容。')
    if (format.value === 'csv' && !restaurantId.value) throw new Error('请先选择 CSV 菜品所属的店铺。')
    const input = format.value === 'csv'
      ? { csv: content.value, restaurantId: restaurantId.value }
      : { data: JSON.parse(content.value.replace(/^\uFEFF/, '')) as unknown }
    const body = JSON.stringify({ ...input, dryRun: true })
    if (new TextEncoder().encode(body).length > IMPORT_BODY_LIMIT) throw new Error('导入请求超过 64 KiB，请拆成小批次后重试。')
    busy.value = true
    report.value = await api<ImportReport>('/admin/import', { method: 'POST', body }, { csrf: session.csrfToken })
    if (report.value.valid) prepared.value = input
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '预览失败，请重试。' }
  finally { busy.value = false }
}
async function apply(): Promise<void> {
  if (busy.value || !prepared.value || !report.value?.valid || report.value.applied) return
  busy.value = true
  error.value = ''
  try {
    report.value = await api<ImportReport>('/admin/import', {
      method: 'POST', body: JSON.stringify({ ...prepared.value, dryRun: false }),
    }, { csrf: session.csrfToken })
    if (report.value.applied) { message.value = `已导入 ${total.value} 条记录。`; prepared.value = null; emit('imported') }
  } catch (cause) {
    error.value = `${cause instanceof Error ? cause.message : '导入失败。'} 请重新预览后再提交。`
    prepared.value = null
  } finally { busy.value = false }
}
</script>

<template>
  <section class="panel import-panel" :aria-busy="busy">
    <div class="section-top"><h2>批量导入与备份</h2><button class="text-button" :disabled="busy || disabled" @click="exportSnapshot">导出完整菜单 JSON</button></div>
    <p class="inline-hint">导出包含全部区域、店铺和菜品，不包含评分、登录信息或个人历史。JSON 保留 ID，可迁移到空库；导入只新增记录，不覆盖同名或同 ID 数据。每次最多 200 条、请求不超过 64 KiB，大备份请分批先导入区域和店铺，再导入菜品。</p>
    <fieldset class="plain-fieldset" :disabled="busy || disabled">
      <legend class="sr-only">选择导入文件</legend>
      <div class="field-grid">
        <label>导入格式<select v-model="format"><option value="json">完整菜单 JSON（version 1）</option><option value="csv">菜品 CSV</option></select></label>
        <label v-if="format === 'csv'">所属店铺<select v-model="restaurantId"><option value="">请选择店铺</option><option v-for="restaurant in menu.restaurants" :key="restaurant.id" :value="restaurant.id">{{ restaurant.name }}</option></select></label>
        <label>选择文件<input :key="format" type="file" :accept="format === 'csv' ? '.csv,text/csv' : '.json,application/json'" @change="readFile"></label>
      </div>
      <p v-if="format === 'csv'" class="inline-hint">CSV 金额单位为元，分类使用标准菜品分类，权重默认填 1。逗号、换行和双引号可用 CSV 引号转义。<button type="button" class="text-button" @click="download('\uFEFF' + DISH_CSV_TEMPLATE, 'dish-import-template.csv', 'text/csv;charset=utf-8')">下载 CSV 模板</button></p>
      <label class="import-content">或粘贴内容<textarea v-model="content" rows="7" spellcheck="false" :placeholder="format === 'csv' ? 'name,category,price,weight,notes' : '{&quot;version&quot;:1,&quot;areas&quot;:[],&quot;restaurants&quot;:[],&quot;dishes&quot;:[]}'"></textarea></label>
      <button class="secondary" type="button" @click="preview">{{ busy ? '正在处理…' : '校验并预览' }}</button>
    </fieldset>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <div v-if="message" class="notice success" role="status">{{ message }}</div>
    <div v-if="report" class="import-preview">
      <p role="status">{{ report.valid ? '校验通过' : '校验未通过，整批不会写入' }}：{{ report.counts.areas }} 个区域，{{ report.counts.restaurants }} 家店铺，{{ report.counts.dishes }} 道菜品。</p>
      <ul v-if="report.issues.length" class="import-issues"><li v-for="(issue, index) in report.issues" :key="index">{{ labels[issue.resource] }}第 {{ issue.row }} 条：{{ issue.message }}</li></ul>
      <details v-if="report.preview.length"><summary>查看 {{ total }} 条记录</summary><ul class="import-rows"><li v-for="row in report.preview" :key="`${row.resource}-${row.row}`">{{ labels[row.resource] }} · {{ row.name }}<small v-if="row.parentId">（所属 ID：{{ row.parentId }}）</small></li></ul></details>
      <button v-if="report.valid && !report.applied" class="primary" type="button" :disabled="busy || disabled || !prepared" @click="apply">{{ busy ? '正在导入…' : `确认新增这 ${total} 条记录` }}</button>
    </div>
  </section>
</template>

<style scoped>
.import-panel { margin-top: 1.25rem; }
.import-content { display: grid; gap: .5rem; margin: 1rem 0; }
.import-content textarea { width: 100%; box-sizing: border-box; font: 13px/1.5 monospace; }
.import-preview { margin-top: 1rem; }
.import-preview > button { margin-top: 1rem; }
.import-issues, .import-rows { max-height: 18rem; overflow: auto; padding: .5rem 1.5rem; overflow-wrap: anywhere; }
.import-issues { color: #a33232; }
.import-rows small { color: #687567; }
</style>
