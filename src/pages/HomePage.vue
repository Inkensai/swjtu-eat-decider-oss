<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Mode, RecommendRequest, RecommendResult } from '../../shared/types'
import { RESTAURANT_CATEGORIES, normalizeRestaurantCategory, type RestaurantCategory } from '../../shared/categories'
import { api } from '../services/api'
import { useMenuStore } from '../stores/menu'
import { useHistoryStore } from '../stores/history'
import { centsFromInput, modeLabels, money } from '../lib/format'

const menu = useMenuStore()
const history = useHistoryStore()
const mode = ref<Mode>('combo')
const areaId = ref('')
const restaurantId = ref('')
const restaurantCategory = ref<RestaurantCategory | ''>('')
const category = ref('')
const maxPrice = ref('')
const excludedRestaurantIds = ref<string[]>([])
const excludedDishIds = ref<string[]>([])
const avoidRecent = ref(false)
const busy = ref(false)
const error = ref('')
const result = ref<RecommendResult | null>(null)
const resultHistoryId = ref('')
const activeAreas = computed(() => menu.areas.filter((area) => area.enabled))
const activeRestaurants = computed(() => menu.restaurants.filter((restaurant) => restaurant.enabled && activeAreas.value.some((area) => area.id === restaurant.areaId)))
const restaurants = computed(() => activeRestaurants.value.filter((restaurant) => (!areaId.value || restaurant.areaId === areaId.value)
  && (mode.value === 'dish' || !restaurantCategory.value || normalizeRestaurantCategory(restaurant.category) === restaurantCategory.value)))
const dishes = computed(() => menu.dishes.filter((dish) => dish.enabled && restaurants.value.some((restaurant) => restaurant.id === dish.restaurantId) && (!restaurantId.value || dish.restaurantId === restaurantId.value)))
const categories = computed(() => [...new Set(dishes.value.map((dish) => dish.category).filter(Boolean))].sort())
const selectedEntry = computed(() => history.entries.find((entry) => entry.id === resultHistoryId.value))
const areaName = computed(() => { const current = result.value; return current?.status === 'ok' ? menu.areas.find((area) => area.id === current.restaurant.areaId)?.name : '' })
const selectedFilterCount = computed(() => Number(Boolean(category.value)) + Number(Boolean(maxPrice.value)) + excludedRestaurantIds.value.length + excludedDishIds.value.length)
watch(restaurants, () => {
  const visible = new Set(restaurants.value.map((restaurant) => restaurant.id))
  if (!visible.has(restaurantId.value)) restaurantId.value = ''
  excludedRestaurantIds.value = excludedRestaurantIds.value.filter((id) => visible.has(id))
})
watch(dishes, () => {
  const visible = new Set(dishes.value.map((dish) => dish.id))
  excludedDishIds.value = excludedDishIds.value.filter((id) => visible.has(id))
  if (!categories.value.includes(category.value)) category.value = ''
})
watch(mode, (value) => { if (value === 'dish') restaurantCategory.value = '' })
onMounted(() => { void menu.load() })

async function decide() {
  if (busy.value) return
  error.value = ''
  if (mode.value === 'dish' && !restaurantId.value) { error.value = '先选择一家店铺，再帮你挑菜。'; return }
  const maxPriceCents = maxPrice.value.trim() ? centsFromInput(maxPrice.value) : undefined
  if (maxPriceCents === null) { error.value = '预算请输入 0 至 1000000 元，最多保留两位小数。'; return }
  const request: RecommendRequest = {
    mode: mode.value,
    filters: {
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
  <section class="decision-layout">
    <form class="panel decision-panel" @submit.prevent="decide">
      <div class="section-top"><h2>这次，怎么选</h2><span class="subtle">简单三步，马上开饭</span></div>
      <fieldset :disabled="busy || menu.loading" class="plain-fieldset">
        <legend class="sr-only">推荐条件</legend>
        <div class="mode-tabs" role="group" aria-label="推荐模式">
          <button v-for="item in (['combo', 'restaurant', 'dish'] as Mode[])" :key="item" type="button" :class="{ selected: mode === item }" :aria-pressed="mode === item" @click="mode = item"><span class="mode-icon" aria-hidden="true">{{ item === 'combo' ? '✦' : item === 'restaurant' ? '⌂' : '≋' }}</span>{{ modeLabels[item] }}</button>
        </div>
        <div class="field-grid main-fields">
          <label v-if="mode !== 'dish'" class="type-filter-field">今天想吃什么类型？<select v-model="restaurantCategory"><option value="">不限类型</option><option v-for="item in RESTAURANT_CATEGORIES" :key="item" :value="item">{{ item }}</option></select></label>
          <label>想去哪里<select v-model="areaId"><option value="">全部区域</option><option v-for="area in activeAreas" :key="area.id" :value="area.id">{{ area.name }}</option></select></label>
          <label>{{ mode === 'dish' ? '选择店铺（必选）' : '想吃哪家（可选）' }}<select v-model="restaurantId"><option value="">{{ mode === 'dish' ? '请选择一家店铺' : '都可以，让我来选' }}</option><option v-for="restaurant in restaurants" :key="restaurant.id" :value="restaurant.id">{{ restaurant.name }}</option></select></label>
        </div>
        <details class="advanced-filters">
          <summary>再挑剔一点 <span>{{ selectedFilterCount ? `${selectedFilterCount} 项筛选` : '分类、预算和排除项' }}</span></summary>
          <div class="advanced-body">
            <div class="field-grid"><label>菜品分类<select v-model="category"><option value="">不限分类</option><option v-for="item in categories" :key="item">{{ item }}</option></select></label><label>单份预算上限（元）<input v-model="maxPrice" inputmode="decimal" placeholder="例如 20.00" maxlength="10"></label></div>
            <fieldset v-if="restaurants.length" class="choice-fieldset"><legend>这次不想去</legend><div class="check-list"><label v-for="restaurant in restaurants" :key="restaurant.id" class="check-label"><input v-model="excludedRestaurantIds" type="checkbox" :value="restaurant.id">{{ restaurant.name }}</label></div></fieldset>
            <fieldset v-if="dishes.length" class="choice-fieldset"><legend>这次不想吃</legend><div class="check-list"><label v-for="dish in dishes" :key="dish.id" class="check-label"><input v-model="excludedDishIds" type="checkbox" :value="dish.id">{{ dish.name }}<span class="subtle"> · {{ restaurants.find((restaurant) => restaurant.id === dish.restaurantId)?.name }}</span></label></div></fieldset>
            <button type="button" class="text-button" @click="resetFilters">重置额外筛选</button>
          </div>
        </details>
        <label class="check-label recent-switch"><input v-model="avoidRecent" type="checkbox"><span>换换口味<small>降低最近 5 次推荐菜品的出现概率</small></span><span class="switch-label">{{ avoidRecent ? '已开启' : '可选' }}</span></label>
        <button class="primary decide-button" type="submit" :disabled="!activeRestaurants.length">{{ busy ? '正在为你挑选…' : menu.loading ? '正在准备菜单…' : '帮我决定' }} <span aria-hidden="true">↗</span></button>
      </fieldset>
      <p v-if="!menu.loading && !menu.error && !activeRestaurants.length" class="inline-hint">菜单还是空的，请管理员先添加区域、店铺和菜品。</p>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <p class="privacy-note">共享菜单 · 私人历史只保存在此浏览器</p>
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
        <div class="result-actions"><button type="button" class="primary" :disabled="busy" @click="history.adopt(resultHistoryId)">{{ selectedEntry?.adopted ? '✓ 就吃这个，已采纳' : '就吃这个' }}</button><button type="button" class="secondary" :disabled="busy" @click="decide">再来一次</button></div>
      </template>
      <template v-else-if="result?.status === 'empty'"><span class="empty-symbol" aria-hidden="true">⌕</span><h2>还没找到合适的</h2><p>{{ result.message }}</p><p class="subtle">试着放宽预算，或减少一些排除项。</p></template>
      <template v-else><div class="food-art empty-art" aria-hidden="true"><span class="plate"><i></i><b></b><em></em></span><span class="chopstick one"></span><span class="chopstick two"></span></div><span class="result-placeholder-label">把选择交给一点惊喜</span><h2>好吃的，正在等你</h2><p>按下按钮，发现今天的心动一餐。</p><span class="small-spark" aria-hidden="true">✦</span></template>
    </section>
  </section>
  <div class="home-bottom"><span><b>01</b> 选个地方</span><span><b>02</b> 留点惊喜</span><span><b>03</b> 好好吃饭</span></div>
</template>
