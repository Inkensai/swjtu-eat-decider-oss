<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Mode, RecommendRequest, RecommendResult } from '../../shared/types'
import { DISH_CATEGORIES, RESTAURANT_CATEGORIES, canonicalDishCategory, normalizeRestaurantCategory, type DishCategory, type RestaurantCategory } from '../../shared/categories'
import { api } from '../services/api'
import { useMenuStore } from '../stores/menu'
import { useHistoryStore } from '../stores/history'
import { usePreferencesStore, defaultPreferences } from '../stores/preferences'
import { availabilityLabel, campusDate, isDishAvailable, isRestaurantOpen } from '../../shared/availability'
import { useClock } from '../lib/useClock'
import { centsFromInput, modeLabels, money } from '../lib/format'

const menu = useMenuStore()
const history = useHistoryStore()
const preferences = usePreferencesStore()
const now = useClock()
let clearingPreferences = false
const mode = ref<Mode>('combo')
const areaId = ref(preferences.value.areaId)
const restaurantId = ref('')
const restaurantCategory = ref<RestaurantCategory | ''>('')
const category = ref<DishCategory | ''>('')
const maxPrice = ref(preferences.value.maxPrice)
const excludedRestaurantIds = ref<string[]>([...preferences.value.excludedRestaurantIds])
const excludedDishIds = ref<string[]>([...preferences.value.excludedDishIds])
const avoidRecent = ref(preferences.value.avoidRecent)
const openNow = ref(preferences.value.openNow)
const busy = ref(false)
const error = ref('')
const result = ref<RecommendResult | null>(null)
const resultHistoryId = ref('')
const activeAreas = computed(() => menu.areas.filter((area) => area.enabled))
const activeAreaIds = computed(() => new Set(activeAreas.value.map((area) => area.id)))
const activeRestaurants = computed(() => menu.restaurants.filter((restaurant) => restaurant.enabled && restaurant.closedToday !== campusDate(now.value) && (!openNow.value || isRestaurantOpen(restaurant, now.value)) && activeAreaIds.value.has(restaurant.areaId)))
const dishRestaurantIds = computed(() => new Set(menu.dishes.filter((dish) => dish.enabled && isDishAvailable(dish, now.value)).map((dish) => dish.restaurantId)))
const areaRestaurants = computed(() => activeRestaurants.value.filter((restaurant) => !areaId.value || restaurant.areaId === areaId.value))
// 随机选店不依赖具体菜品：未设置菜品分类、预算或排除菜品时，没有录入菜品的店铺也是有效候选。
const requiresDishes = computed(() => mode.value !== 'restaurant'
  || Boolean(category.value) || Boolean(maxPrice.value.trim()) || excludedDishIds.value.length > 0)
const eligibleRestaurants = computed(() => areaRestaurants.value.filter((restaurant) => !requiresDishes.value
  || dishRestaurantIds.value.has(restaurant.id)))
const restaurantCategoryCounts = computed(() => {
  const counts = Object.fromEntries(RESTAURANT_CATEGORIES.map((item) => [item, 0])) as Record<RestaurantCategory, number>
  for (const restaurant of eligibleRestaurants.value) {
    // 与服务端推荐候选保持一致：只有依赖菜品的模式才排除没有菜品的店铺。
    const effective = normalizeRestaurantCategory(restaurant.category)
    if (Object.hasOwn(counts, effective)) counts[effective as RestaurantCategory]++
  }
  return counts
})
const restaurants = computed(() => eligibleRestaurants.value.filter((restaurant) => mode.value === 'dish'
  || !restaurantCategory.value
  || normalizeRestaurantCategory(restaurant.category) === restaurantCategory.value))
const restaurantMap = computed(() => new Map(restaurants.value.map((restaurant) => [restaurant.id, restaurant])))
const candidateRestaurants = computed(() => restaurants.value.filter((restaurant) => (!restaurantId.value || restaurant.id === restaurantId.value)
  && !excludedRestaurantIds.value.includes(restaurant.id)))
const baseDishes = computed(() => menu.dishes.filter((dish) => dish.enabled && isDishAvailable(dish, now.value)
  && restaurantMap.value.has(dish.restaurantId)
  && (!restaurantId.value || dish.restaurantId === restaurantId.value)))
const dishCategoryCounts = computed(() => {
  const counts = Object.fromEntries(DISH_CATEGORIES.map((item) => [item, 0])) as Record<DishCategory, number>
  for (const dish of baseDishes.value) {
    const effective = canonicalDishCategory(dish.category)
    if (Object.hasOwn(counts, effective)) counts[effective as DishCategory]++
  }
  return counts
})
const dishes = computed(() => category.value
  ? baseDishes.value.filter((dish) => canonicalDishCategory(dish.category) === category.value)
  : baseDishes.value)
const selectedEntry = computed(() => history.entries.find((entry) => entry.id === resultHistoryId.value))
const areaName = computed(() => { const current = result.value; return current?.status === 'ok' ? menu.areas.find((area) => area.id === current.restaurant.areaId)?.name : '' })
const selectedFilterCount = computed(() => Number(Boolean(category.value)) + Number(Boolean(maxPrice.value)) + excludedRestaurantIds.value.length + excludedDishIds.value.length)
watch(restaurants, () => {
  const visible = new Set(restaurants.value.map((restaurant) => restaurant.id))
  if (!visible.has(restaurantId.value)) restaurantId.value = ''
})
watch(restaurantCategoryCounts, (counts) => {
  if (restaurantCategory.value && counts[restaurantCategory.value] === 0) restaurantCategory.value = ''
})
watch(dishCategoryCounts, (counts) => {
  if (category.value && counts[category.value] === 0) category.value = ''
})
watch(mode, (value) => { if (value === 'dish') restaurantCategory.value = '' })
onMounted(() => { void menu.load() })
watch([areaId, maxPrice, excludedRestaurantIds, excludedDishIds, avoidRecent, openNow], () => {
  if (!clearingPreferences) preferences.save({ areaId: areaId.value, maxPrice: maxPrice.value, excludedRestaurantIds: excludedRestaurantIds.value, excludedDishIds: excludedDishIds.value, avoidRecent: avoidRecent.value, openNow: openNow.value })
}, { deep: true })
async function clearPreferences() {
  clearingPreferences = true
  const defaults = defaultPreferences()
  areaId.value = defaults.areaId
  maxPrice.value = defaults.maxPrice
  excludedRestaurantIds.value = []
  excludedDishIds.value = []
  avoidRecent.value = defaults.avoidRecent
  openNow.value = defaults.openNow
  preferences.clear()
  await nextTick()
  clearingPreferences = false
}

async function decide() {
  if (busy.value) return
  error.value = ''
  if (mode.value === 'dish' && !restaurantId.value) { error.value = '先选择一家店铺，再帮你挑菜。'; return }
  const maxPriceCents = maxPrice.value.trim() ? centsFromInput(maxPrice.value) : undefined
  if (maxPriceCents === null) { error.value = '预算请输入 0 至 1000000 元，最多保留两位小数。'; return }
  const request: RecommendRequest = {
    mode: mode.value,
    filters: {
      openNow: openNow.value,
      ...(areaId.value ? { areaId: areaId.value } : {}),
      ...(restaurantId.value ? { restaurantId: restaurantId.value } : {}),
      ...(mode.value !== 'dish' && restaurantCategory.value ? { restaurantCategory: restaurantCategory.value } : {}),
      ...(category.value ? { category: category.value } : {}),
      ...(maxPriceCents !== undefined ? { maxPriceCents } : {}),
      excludedRestaurantIds: excludedRestaurantIds.value,
      excludedDishIds: excludedDishIds.value,
    },
    avoidRecent: avoidRecent.value,
    recentDishIds: history.recentDishIds(),
  }
  busy.value = true
  try {
    const next = await api<RecommendResult>('/recommend', { method: 'POST', body: JSON.stringify(request) })
    result.value = next
    resultHistoryId.value = next.status === 'ok' ? history.add(request.mode, next) : ''
  } catch (e) { error.value = e instanceof Error ? e.message : '推荐暂时失败，请再试一次。' }
  finally { busy.value = false }
}
function resetFilters() { category.value = ''; maxPrice.value = ''; excludedRestaurantIds.value = []; excludedDishIds.value = [] }
</script>

<template>
  <section class="intro home-intro">
    <span class="eyebrow"><span class="tiny-dot"></span> 每一顿，都值得期待</span>
    <h1>今天<span>吃什么？</span></h1>
    <p>纠结就交给我们。选个区域，下一顿安排好了。</p>
  </section>

  <div v-if="menu.error" class="notice error" role="alert">{{ menu.error }} <button class="text-button" @click="menu.load">重新加载</button></div>
  <div v-if="history.warning" class="notice" role="status">{{ history.warning }}</div>
  <div v-if="preferences.warning" class="notice" role="status">{{ preferences.warning }}</div>
  <section class="decision-layout">
    <form class="panel decision-panel" @submit.prevent="decide">
      <div class="section-top"><h2>这次，怎么选</h2><span class="subtle">简单三步，马上开饭</span></div>
      <fieldset :disabled="busy || menu.loading" class="plain-fieldset">
        <legend class="sr-only">推荐条件</legend>
        <div class="mode-tabs" role="group" aria-label="推荐模式">
          <button v-for="item in (['combo', 'restaurant', 'dish'] as Mode[])" :key="item" type="button" :class="{ selected: mode === item }" :aria-pressed="mode === item" @click="mode = item"><span class="mode-icon" aria-hidden="true">{{ item === 'combo' ? '✦' : item === 'restaurant' ? '⌂' : '≋' }}</span>{{ modeLabels[item] }}</button>
        </div>
        <div class="field-grid main-fields">
          <label v-if="mode !== 'dish'" class="type-filter-field">今天想吃什么类型？<select v-model="restaurantCategory" aria-describedby="restaurant-type-hint"><option value="">不限类型</option><option v-for="item in RESTAURANT_CATEGORIES" :key="item" :value="item" :disabled="restaurantCategoryCounts[item] === 0">{{ item }}（{{ restaurantCategoryCounts[item] }}）</option></select><small id="restaurant-type-hint" class="sr-only">按当前区域与启用店铺统计；无候选类别不可选。</small></label>
          <label>想去哪里<select v-model="areaId"><option value="">全部区域</option><option v-if="areaId && !activeAreas.some(area => area.id === areaId)" :value="areaId">已保存的区域（暂不可用）</option><option v-for="area in activeAreas" :key="area.id" :value="area.id">{{ area.name }}</option></select></label>
          <label>{{ mode === 'dish' ? '选择店铺（必选）' : '想吃哪家（可选）' }}<select v-model="restaurantId"><option value="">{{ mode === 'dish' ? '请选择一家店铺' : '都可以，让我来选' }}</option><option v-for="restaurant in restaurants" :key="restaurant.id" :value="restaurant.id">{{ restaurant.name }} · {{ availabilityLabel(restaurant, now) }}</option></select></label>
        </div>
        <details class="advanced-filters">
          <summary>再挑剔一点 <span>{{ selectedFilterCount ? `${selectedFilterCount} 项筛选` : '分类、预算和排除项' }}</span></summary>
          <div class="advanced-body">
            <div class="field-grid"><label>菜品分类<select v-model="category"><option value="">不限分类</option><option v-for="item in DISH_CATEGORIES" :key="item" :value="item" :disabled="dishCategoryCounts[item] === 0">{{ item }}（{{ dishCategoryCounts[item] }}）</option></select><small>旧分类仅在不限分类下参与；已映射旧名称自动计入。</small></label><label>单份预算上限（元）<input v-model="maxPrice" inputmode="decimal" placeholder="例如 20.00" maxlength="10"></label></div>
            <fieldset v-if="restaurants.length" class="choice-fieldset"><legend>这次不想去</legend><div class="check-list"><label v-for="restaurant in restaurants" :key="restaurant.id" class="check-label"><input v-model="excludedRestaurantIds" type="checkbox" :value="restaurant.id" :disabled="excludedRestaurantIds.length >= 200 && !excludedRestaurantIds.includes(restaurant.id)">{{ restaurant.name }}</label></div></fieldset>
            <fieldset v-if="dishes.length" class="choice-fieldset"><legend>这次不想吃</legend><div class="check-list"><label v-for="dish in dishes" :key="dish.id" class="check-label"><input v-model="excludedDishIds" type="checkbox" :value="dish.id" :disabled="excludedDishIds.length >= 200 && !excludedDishIds.includes(dish.id)">{{ dish.name }}<span class="subtle"> · {{ restaurantMap.get(dish.restaurantId)?.name }}</span></label></div></fieldset>
            <p v-if="excludedRestaurantIds.length >= 200 || excludedDishIds.length >= 200" class="inline-hint">每类最多排除 200 项；取消部分排除或重置后可继续选择。</p><button type="button" class="text-button" @click="resetFilters">重置额外筛选</button>
          </div>
        </details>
        <label class="check-label availability-switch"><input v-model="openNow" type="checkbox"><span>只推荐正在营业的店铺<small>以北京时间和已录入时段为准；未设置时段的店铺不参与</small></span></label>
        <label v-if="mode !== 'restaurant'" class="check-label recent-switch"><input v-model="avoidRecent" type="checkbox"><span>换换口味<small>降低最近 5 次菜品在店内的相对权重</small></span><span class="switch-label">{{ avoidRecent ? '已开启' : '可选' }}</span></label>
        <button class="primary decide-button" type="submit" :disabled="!candidateRestaurants.length">{{ busy ? '正在为你挑选…' : menu.loading ? '正在准备菜单…' : '帮我决定' }} <span aria-hidden="true">↗</span></button>
      </fieldset>
      <p v-if="!menu.loading && !menu.error && !activeRestaurants.length" class="inline-hint">{{ openNow ? '当前没有已知营业中的店铺，试试取消营业筛选。' : '当前没有可推荐的店铺，请调整条件或稍后再试。' }}</p>
      <p v-if="!menu.loading && !menu.error && activeRestaurants.length && !candidateRestaurants.length" class="inline-hint">当前条件下没有可选店铺，可切换区域或重置额外筛选。</p><p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <p class="privacy-note">区域、预算与排除偏好自动保存在此浏览器。<button type="button" class="text-button" @click="clearPreferences">清除偏好</button></p>
    </form>

    <section class="result-panel" aria-live="polite" aria-atomic="true" :aria-busy="busy">
      <template v-if="result?.status === 'ok'">
        <div class="result-eyebrow">你的下一顿 <span aria-hidden="true">✦</span></div>
        <div class="food-art" aria-hidden="true"><span class="plate"><i></i><b></b><em></em></span><span class="chopstick one"></span><span class="chopstick two"></span></div>
        <span class="result-area">{{ areaName || '发现一点好味道' }}</span>
        <h2>{{ result.dish?.name || result.restaurant.name }}</h2>
        <p class="result-restaurant">{{ result.dish ? result.restaurant.name : '先决定去哪家，到了再慢慢选' }}</p>
        <strong v-if="result.dish" class="result-price">{{ money(result.dish.priceCents) }}</strong>
        <p v-if="result.dish?.notes" class="result-notes">{{ result.dish.notes }}</p>
        <p v-if="result.restaurant.location" class="result-location">{{ result.restaurant.location }}</p>
        <p class="result-location">{{ availabilityLabel(result.restaurant, now) }}</p>
        <div class="result-actions"><button v-if="selectedEntry" type="button" class="primary" :disabled="busy" @click="history.adopt(resultHistoryId)">{{ selectedEntry.adopted ? '✓ 就吃这个，已采纳' : '就吃这个' }}</button><span v-else class="subtle result-cap">记录已满，本条推荐未加入历史</span><button type="button" class="secondary" :disabled="busy" @click="decide">再来一次</button></div>
      </template>
      <template v-else-if="result?.status === 'empty'"><span class="empty-symbol" aria-hidden="true">⌕</span><h2>还没找到合适的</h2><p>{{ result.message }}</p><p class="subtle">试着放宽预算，或减少一些排除项。</p></template>
      <template v-else><div class="food-art empty-art" aria-hidden="true"><span class="plate"><i></i><b></b><em></em></span><span class="chopstick one"></span><span class="chopstick two"></span></div><span class="result-placeholder-label">把选择交给一点惊喜</span><h2>好吃的，正在等你</h2><p>按下按钮，发现今天的心动一餐。</p><span class="small-spark" aria-hidden="true">✦</span></template>
    </section>
  </section>
  <div class="home-bottom"><span><b>01</b> 选个地方</span><span><b>02</b> 留点惊喜</span><span><b>03</b> 好好吃饭</span></div>
</template>


<style scoped>
.availability-switch { margin-bottom: 12px; }
</style>
