<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import type { Area, AreaType, Dish, Resource, Restaurant } from '../../shared/types'
import { DEFAULT_RESTAURANT_CATEGORY, DISH_CATEGORIES, RESTAURANT_CATEGORIES, canonicalDishCategory, isDishCategory, isRestaurantCategory, normalizeRestaurantCategory } from '../../shared/categories'
import { ApiError, api } from '../services/api'
import { useAdminStore } from '../stores/admin'
import AdminRatingsPanel from '../components/AdminRatingsPanel.vue'
import AdminImportPanel from '../components/AdminImportPanel.vue'
import { campusDate } from '../../shared/availability'
import { centsFromInput, money, priceInput } from '../lib/format'

type RecordItem = Area | Restaurant | Dish
const session = useAdminStore()
const areas = ref<Area[]>([])
const restaurants = ref<Restaurant[]>([])
const dishes = ref<Dish[]>([])
const selectedAreaId = ref('')
const selectedRestaurantId = ref('')
const loading = ref(false)
const saving = ref(false)
const loaded = ref(false)
const loggingIn = ref(false)
const password = ref('')
const error = ref('')
const message = ref('')
const editor = ref<{ resource: Resource; id?: string } | null>(null)
const originalCategory = ref('')
const restaurantCategoryTouched = ref(false)
const firstInput = ref<HTMLInputElement | null>(null)
const pendingDelete = ref<{ resource: Resource; record: RecordItem } | null>(null)
const showRatings = ref(false)
const showImport = ref(false)
const labels: Record<Resource, string> = { areas: '区域', restaurants: '店铺', dishes: '菜品' }
const typeLabels: Record<AreaType, string> = { canteen: '校内食堂', nearby: '校园周边', other: '其他区域' }
const selectedArea = computed(() => areas.value.find((area) => area.id === selectedAreaId.value))
const selectedRestaurant = computed(() => restaurants.value.find((restaurant) => restaurant.id === selectedRestaurantId.value))
const areaRestaurants = computed(() => restaurants.value.filter((restaurant) => restaurant.areaId === selectedAreaId.value))
const restaurantDishes = computed(() => dishes.value.filter((dish) => dish.restaurantId === selectedRestaurantId.value))
const legacyRestaurantCategory = computed(() => editor.value?.resource === 'restaurants' && originalCategory.value && !isRestaurantCategory(originalCategory.value) ? originalCategory.value : '')
const legacyDishCategory = computed(() => editor.value?.resource === 'dishes' && originalCategory.value && !isDishCategory(originalCategory.value) ? originalCategory.value : '')
const form = reactive({ name: '', type: 'canteen' as AreaType, sortOrder: '0', areaId: '', restaurantId: '', category: '', location: '', openingHours: '', closedToday: '', price: '', weight: '1', notes: '', soldOutOn: '', enabled: true })

function restaurantCategoryText(category: string): string {
  const value = category.trim()
  if (!value) return DEFAULT_RESTAURANT_CATEGORY
  if (isRestaurantCategory(value)) return value
  if (value === '小吃 / 轻食') return `历史分类：${value}（请重新选择标准分类）`
  const effective = normalizeRestaurantCategory(value)
  return effective !== value ? `历史分类：${value}（匹配 ${effective}）` : `历史分类：${value}`
}

function dishCategoryText(category: string): string {
  const value = category.trim()
  if (!value) return '不分类'
  if (isDishCategory(value)) return value
  const effective = canonicalDishCategory(value)
  return effective !== value ? `历史分类：${value}（匹配 ${effective}）` : `历史分类：${value}`
}

function handleError(cause: unknown, fallback: string, sessionAware = true) {
  if (sessionAware && cause instanceof ApiError && cause.status === 401) {
    session.clear()
    loaded.value = false
    error.value = '登录已过期，请重新输入管理员密码或访问密钥。'
    return
  }
  error.value = cause instanceof Error ? cause.message : fallback
}

async function load() {
  if (loading.value || saving.value || !session.authenticated) return
  loading.value = true
  error.value = ''
  try {
    const [a, r, d] = await Promise.all([api<Area[]>('/admin/areas'), api<Restaurant[]>('/admin/restaurants'), api<Dish[]>('/admin/dishes')])
    areas.value = a
    restaurants.value = r
    dishes.value = d
    if (!a.some((area) => area.id === selectedAreaId.value)) selectedAreaId.value = a[0]?.id || ''
    if (!r.some((restaurant) => restaurant.id === selectedRestaurantId.value && restaurant.areaId === selectedAreaId.value)) selectedRestaurantId.value = r.find((restaurant) => restaurant.areaId === selectedAreaId.value)?.id || ''
    loaded.value = true
  } catch (e) { handleError(e, '管理菜单加载失败。') }
  finally { loading.value = false }
}

onMounted(async () => {
  if (await session.refresh()) await load()
})

async function login() {
  if (loggingIn.value) return
  loggingIn.value = true
  error.value = ''
  message.value = ''
  try {
    await session.login(password.value)
    password.value = ''
    await load()
  } catch (e) { handleError(e, '登录失败，请重试。', false) }
  finally { loggingIn.value = false }
}

async function logout() {
  if (loggingIn.value || saving.value) return
  try {
    await session.logout()
  } catch (e) {
    handleError(e, '退出登录失败，请重试。')
    return
  }
  areas.value = []
  restaurants.value = []
  dishes.value = []
  loaded.value = false
  editor.value = null
  pendingDelete.value = null
  showRatings.value = false
  showImport.value = false
  error.value = ''
  message.value = '已退出登录。'
}

function selectArea(id: string) {
  selectedAreaId.value = id
  selectedRestaurantId.value = restaurants.value.find((restaurant) => restaurant.areaId === id)?.id || ''
}

async function openEditor(resource: Resource, record?: RecordItem) {
  pendingDelete.value = null
  error.value = ''
  message.value = ''
  editor.value = { resource, id: record?.id }
  originalCategory.value = record && 'category' in record ? record.category : ''
  restaurantCategoryTouched.value = false
  Object.assign(form, { name: record?.name || '', type: 'canteen', sortOrder: '0', areaId: selectedAreaId.value, restaurantId: selectedRestaurantId.value, category: resource === 'restaurants' ? DEFAULT_RESTAURANT_CATEGORY : '', location: '', openingHours: '', closedToday: '', price: '', weight: '1', notes: '', soldOutOn: '', enabled: record?.enabled ?? true })
  if (resource === 'areas' && record) { const area = record as Area; form.type = area.type; form.sortOrder = String(area.sortOrder) }
  if (resource === 'restaurants' && record) { const restaurant = record as Restaurant; form.areaId = restaurant.areaId; form.category = restaurant.category || DEFAULT_RESTAURANT_CATEGORY; form.location = restaurant.location; form.openingHours = restaurant.openingHours ?? ''; form.closedToday = restaurant.closedToday ?? '' }
  if (resource === 'dishes' && record) { const dish = record as Dish; form.restaurantId = dish.restaurantId; form.category = dish.category; form.price = priceInput(dish.priceCents); form.weight = String(dish.weight); form.notes = dish.notes; form.soldOutOn = dish.soldOutOn ?? '' }
  await nextTick()
  firstInput.value?.focus()
}

function hasChildren(resource: Resource, id: string): boolean {
  return resource === 'areas' ? restaurants.value.some((restaurant) => restaurant.areaId === id) : resource === 'restaurants' ? dishes.value.some((dish) => dish.restaurantId === id) : false
}

async function save() {
  if (!editor.value || saving.value) return
  error.value = ''
  const { resource, id } = editor.value
  const payload: Record<string, unknown> = { name: form.name.trim(), enabled: form.enabled }
  if (!payload.name) { error.value = '请填写名称。'; return }
  if (resource === 'areas') {
    if (!Number.isSafeInteger(Number(form.sortOrder)) || !String(form.sortOrder).trim() || Number(form.sortOrder) < 0 || Number(form.sortOrder) > 1000000) { error.value = '排序请输入 0 至 1000000 的整数。'; return }
    Object.assign(payload, { type: form.type, sortOrder: Number(form.sortOrder) })
  } else if (resource === 'restaurants') {
    if (!form.areaId) { error.value = '请先创建并选择所属区域。'; return }
    const category = id && !restaurantCategoryTouched.value ? originalCategory.value : form.category.trim()
    Object.assign(payload, { areaId: form.areaId, category, location: form.location.trim(), openingHours: form.openingHours.trim(), closedToday: form.closedToday })
  } else {
    const priceCents = centsFromInput(form.price)
    const weight = Number(form.weight)
    if (!form.restaurantId) { error.value = '请先创建并选择所属店铺。'; return }
    if (priceCents === null) { error.value = '价格请输入 0 至 1000000 元，最多保留两位小数。'; return }
    if (!String(form.weight).trim() || !Number.isFinite(weight) || weight < 0 || weight > 1000000) { error.value = '权重请输入 0 至 1000000 的数值。'; return }
    Object.assign(payload, { restaurantId: form.restaurantId, category: form.category.trim(), priceCents, weight, notes: form.notes.trim(), soldOutOn: form.soldOutOn })
  }
  saving.value = true
  try {
    const record = await api<RecordItem>(`/admin/${resource}${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) }, { csrf: session.csrfToken })
    if (resource === 'areas') selectedAreaId.value = record.id
    if (resource === 'restaurants') { selectedAreaId.value = (record as Restaurant).areaId; selectedRestaurantId.value = record.id }
    if (resource === 'dishes') { selectedRestaurantId.value = (record as Dish).restaurantId; selectedAreaId.value = restaurants.value.find((restaurant) => restaurant.id === selectedRestaurantId.value)?.areaId || '' }
    editor.value = null
    message.value = `${labels[resource]}已${id ? '更新' : '添加'}。`
  } catch (e) { handleError(e, '保存失败，请重试。') }
  finally { saving.value = false }
  if (!editor.value) await load()
}

async function toggle(resource: Resource, record: RecordItem) {
  if (saving.value) return
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    await api(`/admin/${resource}/${encodeURIComponent(record.id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !record.enabled }) }, { csrf: session.csrfToken })
    message.value = `${record.name}已${record.enabled ? '停用' : '启用'}。`
  } catch (e) { handleError(e, '状态修改失败。'); return }
  finally { saving.value = false }
  await load()
}

async function remove() {
  if (!pendingDelete.value || saving.value) return
  const { resource, record } = pendingDelete.value
  saving.value = true
  error.value = ''
  try {
    await api(`/admin/${resource}/${encodeURIComponent(record.id)}`, { method: 'DELETE' }, { csrf: session.csrfToken })
    pendingDelete.value = null
    message.value = `${labels[resource]}已删除。`
    if (editor.value?.id === record.id) editor.value = null
  } catch (e) { handleError(e, '删除失败。'); return }
  finally { saving.value = false }
  await load()
}
</script>

<template>
  <section class="intro page-intro"><span class="eyebrow">MENU EDITOR / 一份菜单，更多好选择</span><h1>校园<span>菜单管理</span></h1><p>按区域整理店铺，为每家店添上值得吃的菜。</p></section>
  <form v-if="session.ready && !session.authenticated" class="panel admin-login" @submit.prevent="login">
    <div class="section-top"><h2>管理员登录</h2></div>
    <p class="inline-hint">只有管理员可以修改共享菜单。请使用管理员密码或访问密钥，凭据只提交到服务端校验，不保存在浏览器或前端代码中；普通访客无需登录即可浏览和使用推荐。</p>
    <label for="admin-password">管理员密码或访问密钥</label>
    <div class="login-row">
      <input id="admin-password" v-model="password" type="password" autocomplete="current-password" maxlength="1024" placeholder="输入管理员密码或访问密钥" required :disabled="loggingIn">
      <button class="primary" :disabled="loggingIn">{{ loggingIn ? '正在登录…' : '登录' }}</button>
    </div>
  </form>
  <div v-if="!session.ready" class="panel empty-state"><h2>正在检查登录状态…</h2></div>
  <div v-if="error" class="notice error" role="alert">{{ error }}</div>
  <div v-if="message" class="notice success" role="status">{{ message }}</div>
  <p v-if="session.authenticated && loading" class="loading-text" role="status">正在加载共享菜单…</p>
  <template v-if="session.authenticated && loaded">
    <div class="admin-toolbar"><p><strong>{{ areas.length }}</strong> 个区域 <span>／</span> <strong>{{ restaurants.length }}</strong> 家店铺 <span>／</span> <strong>{{ dishes.length }}</strong> 道菜品</p><div class="toolbar-actions"><button class="text-button" :disabled="loading || saving" @click="showImport = !showImport">{{ showImport ? '收起批量导入' : '导入 / 导出' }}</button><button class="text-button" :disabled="loading || saving" @click="showRatings = !showRatings">{{ showRatings ? '收起评分管理' : '评分管理' }}</button><button class="text-button" :disabled="loading || saving" @click="load">刷新菜单 ↻</button><button class="text-button" :disabled="loading || saving || loggingIn" @click="logout">退出登录</button></div></div>
    <p class="inline-hint">按区域 → 店铺 → 菜品逐级管理。含有下级数据时不可删除；临时隐藏可使用停用。</p>
    <div class="admin-columns" :aria-busy="loading || saving">
      <section class="panel manage-column"><div class="section-top"><h2><span class="step-number">1</span> 区域</h2><button class="text-button" :disabled="saving || loading" @click="openEditor('areas')">＋ 添加</button></div><p v-if="!areas.length" class="column-empty">先添加一个区域，比如「校内食堂」。</p><ul class="manage-list"><li v-for="area in areas" :key="area.id" :class="{ current: area.id === selectedAreaId }"><button class="item-select" :aria-pressed="area.id === selectedAreaId" @click="selectArea(area.id)"><span>{{ area.name }}<small>{{ typeLabels[area.type] }} · {{ restaurants.filter((restaurant) => restaurant.areaId === area.id).length }} 家店铺</small></span><span v-if="!area.enabled" class="status-badge">停用</span></button><div class="item-actions"><button @click="openEditor('areas', area)" :disabled="saving || loading" :aria-label="`编辑区域${area.name}`">编辑</button><button @click="toggle('areas', area)" :disabled="saving || loading">{{ area.enabled ? '停用' : '启用' }}</button><button class="danger-text" :disabled="saving || loading || hasChildren('areas', area.id)" :title="hasChildren('areas', area.id) ? '请先移除区域内的店铺' : '删除区域'" @click="pendingDelete = { resource: 'areas', record: area }">删除</button></div></li></ul></section>
      <section class="panel manage-column"><div class="section-top"><h2><span class="step-number">2</span> 店铺</h2><button class="text-button" :disabled="!selectedAreaId || saving || loading" @click="openEditor('restaurants')">＋ 添加</button></div><p class="column-context">{{ selectedArea?.name || '请先选择区域' }}</p><p v-if="selectedArea && !selectedArea.enabled" class="inline-hint">所属区域已停用，店铺暂不参与推荐。</p><p v-if="!areaRestaurants.length" class="column-empty">{{ selectedAreaId ? '这个区域还没有店铺，添加一家吧。' : '选择左侧区域，查看店铺。' }}</p><ul class="manage-list"><li v-for="restaurant in areaRestaurants" :key="restaurant.id" :class="{ current: restaurant.id === selectedRestaurantId }"><button class="item-select" :aria-pressed="restaurant.id === selectedRestaurantId" @click="selectedRestaurantId = restaurant.id"><span>{{ restaurant.name }}<small>{{ restaurantCategoryText(restaurant.category) }} · {{ dishes.filter((dish) => dish.restaurantId === restaurant.id).length }} 道菜</small></span><span v-if="restaurant.closedToday === campusDate()" class="status-badge">今日停业</span><span v-if="!restaurant.enabled" class="status-badge">停用</span></button><div class="item-actions"><button @click="openEditor('restaurants', restaurant)" :disabled="saving || loading" :aria-label="`编辑店铺${restaurant.name}`">编辑</button><button @click="toggle('restaurants', restaurant)" :disabled="saving || loading">{{ restaurant.enabled ? '停用' : '启用' }}</button><button class="danger-text" :disabled="saving || loading || hasChildren('restaurants', restaurant.id)" :title="hasChildren('restaurants', restaurant.id) ? '请先删除店铺内的菜品' : '删除店铺'" @click="pendingDelete = { resource: 'restaurants', record: restaurant }">删除</button></div></li></ul></section>
      <section class="panel manage-column"><div class="section-top"><h2><span class="step-number">3</span> 菜品</h2><button class="text-button" :disabled="!selectedRestaurantId || saving || loading" @click="openEditor('dishes')">＋ 添加</button></div><p class="column-context">{{ selectedRestaurant?.name || '请先选择店铺' }}</p><p v-if="selectedRestaurant && (!selectedRestaurant.enabled || !selectedArea?.enabled)" class="inline-hint">上级店铺或区域已停用，菜品暂不参与推荐。</p><p v-if="!restaurantDishes.length" class="column-empty">{{ selectedRestaurantId ? '还没有菜品，记下第一道美味吧。' : '选择一家店铺，查看菜单。' }}</p><ul class="manage-list"><li v-for="dish in restaurantDishes" :key="dish.id"><div class="dish-summary"><span>{{ dish.name }}<small>{{ dishCategoryText(dish.category) }} · 权重 {{ dish.weight }}</small></span><strong>{{ money(dish.priceCents) }}</strong><span v-if="dish.soldOutOn === campusDate()" class="status-badge">今日售罄</span><span v-if="!dish.enabled" class="status-badge">停用</span></div><div class="item-actions"><button @click="openEditor('dishes', dish)" :disabled="saving || loading" :aria-label="`编辑菜品${dish.name}`">编辑</button><button @click="toggle('dishes', dish)" :disabled="saving || loading">{{ dish.enabled ? '停用' : '启用' }}</button><button class="danger-text" :disabled="saving || loading" @click="pendingDelete = { resource: 'dishes', record: dish }">删除</button></div></li></ul></section>
    </div>
    <AdminImportPanel v-if="showImport" :menu="{ areas, restaurants, dishes }" :selected-restaurant-id="selectedRestaurantId" :disabled="loading || saving" @imported="load" />
    <AdminRatingsPanel v-if="showRatings" :restaurants="restaurants" :dishes="dishes" />
    <div v-if="pendingDelete" class="confirm-box delete-confirm" role="alert"><h3>删除「{{ pendingDelete.record.name }}」？</h3><p>此操作不可撤销。已有的本机历史快照仍会保留。</p><div class="button-row"><button class="danger-button" :disabled="saving || loading" @click="remove">{{ saving ? '正在删除…' : '确认删除' }}</button><button class="secondary" :disabled="saving" @click="pendingDelete = null">取消</button></div></div>
    <form v-if="editor" :key="`${editor.resource}-${editor.id || 'new'}`" class="panel editor-panel" @submit.prevent="save"><div class="section-top"><h2>{{ editor.id ? '编辑' : '添加' }}{{ labels[editor.resource] }}</h2><button type="button" class="text-button" :disabled="saving" @click="editor = null">取消</button></div><fieldset :disabled="saving" class="plain-fieldset"><legend class="sr-only">{{ labels[editor.resource] }}信息</legend><div class="field-grid"><label>名称<input ref="firstInput" v-model="form.name" required maxlength="100" placeholder="填写一个好记的名称"></label><template v-if="editor.resource === 'areas'"><label>区域类型<select v-model="form.type"><option v-for="(label, value) in typeLabels" :key="value" :value="value">{{ label }}</option></select></label><label>排序<input v-model="form.sortOrder" type="number" min="0" max="1000000" step="1" required><small>数字越小，排列越靠前。</small></label></template><template v-else-if="editor.resource === 'restaurants'"><label>所属区域<select v-model="form.areaId" required><option value="" disabled>请选择区域</option><option v-for="area in areas" :key="area.id" :value="area.id">{{ area.name }}{{ area.enabled ? '' : '（已停用）' }}</option></select></label><label>店铺分类<select v-model="form.category" @change="restaurantCategoryTouched = true"><option v-for="item in RESTAURANT_CATEGORIES" :key="item" :value="item">{{ item }}</option><option v-if="legacyRestaurantCategory" :value="legacyRestaurantCategory">{{ restaurantCategoryText(legacyRestaurantCategory) }}</option></select><small>历史分类会保留，可主动改为标准分类。</small></label></template><template v-else><label>所属店铺<select v-model="form.restaurantId" required><option value="" disabled>请选择店铺</option><option v-for="restaurant in restaurants" :key="restaurant.id" :value="restaurant.id">{{ areas.find((area) => area.id === restaurant.areaId)?.name }} · {{ restaurant.name }}{{ restaurant.enabled ? '' : '（已停用）' }}</option></select></label><label>菜品分类<select v-model="form.category"><option value="">不分类</option><option v-for="item in DISH_CATEGORIES" :key="item" :value="item">{{ item }}</option><option v-if="legacyDishCategory" :value="legacyDishCategory">{{ dishCategoryText(legacyDishCategory) }}</option></select><small>历史分类会保留；新增或主动修改请使用新标准分类。</small></label><label>价格（元）<input v-model="form.price" inputmode="decimal" required maxlength="10" placeholder="例如 12.50"></label></template></div><details v-if="editor.resource === 'restaurants'" class="advanced-filters form-advanced"><summary>更多设置 <span>位置、营业时间、临时停业</span></summary><div class="advanced-body"><label>具体位置（可选）<input v-model="form.location" maxlength="300" placeholder="例如：食堂二楼东侧"></label><label>营业时间（可选）<input v-model="form.openingHours" maxlength="150" placeholder="11:00-14:00,17:00-21:00"><small>北京时间，每日时段用英文逗号分隔；留空表示未设置。</small></label><label class="check-label form-enabled"><input v-model="form.closedToday" type="checkbox" :true-value="campusDate()" false-value="">今天临时停业（次日自动恢复）</label><label class="check-label form-enabled"><input v-model="form.enabled" type="checkbox">启用并参与推荐</label></div></details><details v-else-if="editor.resource === 'dishes'" class="advanced-filters form-advanced"><summary>更多设置 <span>权重、备注、今日售罄</span></summary><div class="advanced-body"><div class="field-grid"><label>推荐权重<input v-model="form.weight" type="number" min="0" max="1000000" step="any"><small>默认 1；越大越容易被选中。</small></label><label>备注（可选）<textarea v-model="form.notes" rows="2" maxlength="500" placeholder="口味、份量或点单小提示"></textarea></label></div><label class="check-label form-enabled"><input v-model="form.soldOutOn" type="checkbox" :true-value="campusDate()" false-value="">今天已售罄（次日自动恢复）</label><label class="check-label form-enabled"><input v-model="form.enabled" type="checkbox">启用并参与推荐</label></div></details><label v-else class="check-label form-enabled"><input v-model="form.enabled" type="checkbox">启用并参与推荐</label><p class="inline-hint">删除带有下级数据的区域或店铺前，请先处理下级数据；需要临时隐藏时，使用停用。</p><p v-if="error" class="inline-error" role="alert">{{ error }}</p><div class="button-row"><button class="primary">{{ saving ? '正在保存…' : '保存' }}</button><button type="button" class="secondary" @click="editor = null">取消</button></div></fieldset></form>
  </template>
  <div v-else-if="session.authenticated && !loading" class="panel empty-state"><h2>管理菜单暂未加载</h2><p>可重新加载，或退出后重新登录。</p><button class="primary" @click="load">重新加载</button></div>
</template>
