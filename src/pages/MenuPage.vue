<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { DISH_CATEGORIES, RESTAURANT_CATEGORIES, canonicalDishCategory, normalizeRestaurantCategory } from '../../shared/categories'
import { useMenuStore } from '../stores/menu'
import { useRatingsStore } from '../stores/ratings'
import { money } from '../lib/format'
import RatingControl from '../components/RatingControl.vue'

type View = 'restaurants' | 'dishes'
const menu = useMenuStore()
const ratings = useRatingsStore()
const view = ref<View>('restaurants')
const areaId = ref('')
const restaurantId = ref('')
const restaurantCategory = ref('')
const dishCategory = ref('')
const keyword = ref('')

onMounted(() => { void menu.load(); void ratings.load() })

const areas = computed(() => menu.areas.filter((area) => area.enabled))
const restaurants = computed(() => menu.restaurants.filter((restaurant) => restaurant.enabled
  && areas.value.some((area) => area.id === restaurant.areaId)))
const dishes = computed(() => menu.dishes.filter((dish) => dish.enabled
  && restaurants.value.some((restaurant) => restaurant.id === dish.restaurantId)))
const dishCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const dish of dishes.value) counts.set(dish.restaurantId, (counts.get(dish.restaurantId) ?? 0) + 1)
  return counts
})
const areaName = (id: string): string => areas.value.find((area) => area.id === id)?.name ?? ''
const restaurantName = (id: string): string => restaurants.value.find((restaurant) => restaurant.id === id)?.name ?? ''
const search = computed(() => keyword.value.trim())

const filteredRestaurants = computed(() => restaurants.value.filter((restaurant) => (!areaId.value || restaurant.areaId === areaId.value)
  && (!restaurantCategory.value || normalizeRestaurantCategory(restaurant.category) === restaurantCategory.value)
  && (!search.value || restaurant.name.includes(search.value))))
const filteredDishes = computed(() => dishes.value.filter((dish) => {
  const restaurant = restaurants.value.find((item) => item.id === dish.restaurantId)
  if (!restaurant) return false
  return (!areaId.value || restaurant.areaId === areaId.value)
    && (!restaurantId.value || dish.restaurantId === restaurantId.value)
    && (!dishCategory.value || canonicalDishCategory(dish.category) === dishCategory.value)
    && (!search.value || dish.name.includes(search.value))
}))
const selectedShop = computed(() => restaurants.value.find((restaurant) => restaurant.id === restaurantId.value) ?? null)
const selectedShopDishes = computed(() => dishes.value.filter((dish) => dish.restaurantId === restaurantId.value))
const hasFilter = computed(() => Boolean(areaId.value || restaurantId.value || restaurantCategory.value || dishCategory.value || search.value))

function switchView(next: View): void {
  if (view.value === next) return
  view.value = next
  restaurantId.value = ''
  restaurantCategory.value = ''
  dishCategory.value = ''
  keyword.value = ''
}
function openShop(id: string): void {
  view.value = 'dishes'
  restaurantId.value = id
  areaId.value = ''
  dishCategory.value = ''
  keyword.value = ''
}
function backToShops(): void {
  restaurantId.value = ''
  view.value = 'restaurants'
}
function resetFilters(): void {
  areaId.value = ''
  restaurantId.value = ''
  restaurantCategory.value = ''
  dishCategory.value = ''
  keyword.value = ''
}
</script>

<template>
  <section class="intro page-intro"><span class="eyebrow">今天的菜单，都在这儿</span><h1>浏览<span>菜单</span></h1><p>按店铺或菜品逛一逛，顺手给喜欢的打个分。评分匿名提交，全站共享。</p></section>

  <div v-if="menu.error" class="notice error" role="alert">{{ menu.error }} <button class="text-button" @click="menu.load">重新加载</button></div>
  <div v-if="ratings.error" class="notice error" role="alert">{{ ratings.error }} <button class="text-button" @click="ratings.load">重新加载评分</button></div>

  <section class="panel menu-panel" :aria-busy="menu.loading">
    <div class="menu-toolbar">
      <div class="view-tabs" role="group" aria-label="菜单视图">
        <button type="button" :class="{ selected: view === 'restaurants' }" :aria-pressed="view === 'restaurants'" @click="switchView('restaurants')">店铺</button>
        <button type="button" :class="{ selected: view === 'dishes' }" :aria-pressed="view === 'dishes'" @click="switchView('dishes')">菜品</button>
      </div>
      <p class="menu-count" role="status">
        <template v-if="menu.loading">正在加载菜单…</template>
        <template v-else-if="view === 'restaurants'">{{ filteredRestaurants.length }} 家店铺</template>
        <template v-else>{{ filteredDishes.length }} 道菜品</template>
      </p>
    </div>

    <div class="menu-filters">
      <label>区域<select v-model="areaId"><option value="">全部区域</option><option v-for="area in areas" :key="area.id" :value="area.id">{{ area.name }}</option></select></label>
      <label v-if="view === 'restaurants'">店铺类型<select v-model="restaurantCategory"><option value="">全部类型</option><option v-for="item in RESTAURANT_CATEGORIES" :key="item" :value="item">{{ item }}</option></select></label>
      <label v-else>店铺<select v-model="restaurantId"><option value="">全部店铺</option><option v-for="restaurant in restaurants" :key="restaurant.id" :value="restaurant.id">{{ restaurant.name }}</option></select></label>
      <label v-if="view === 'dishes'">菜品分类<select v-model="dishCategory"><option value="">全部类型</option><option v-for="item in DISH_CATEGORIES" :key="item" :value="item">{{ item }}</option></select></label>
      <label class="menu-search">{{ view === 'restaurants' ? '搜索店铺' : '搜索菜品' }}<input v-model="keyword" type="search" maxlength="40" :placeholder="view === 'restaurants' ? '输入店铺名称' : '输入菜品名称'"></label>
      <button v-if="hasFilter" type="button" class="text-button" @click="resetFilters">重置筛选</button>
    </div>

    <div v-if="view === 'dishes' && selectedShop" class="shop-detail-head">
      <button type="button" class="text-button shop-back" @click="backToShops">← 返回店铺列表</button>
      <div class="shop-detail-title"><h2>{{ selectedShop.name }}</h2><span class="card-tag">{{ normalizeRestaurantCategory(selectedShop.category) }}</span></div>
      <p class="card-meta">{{ areaName(selectedShop.areaId) }}<span v-if="selectedShop.location"> · {{ selectedShop.location }}</span> · {{ selectedShopDishes.length }} 道菜品</p>
      <RatingControl target-type="restaurant" :target-id="selectedShop.id" :name="selectedShop.name" compact />
    </div>

    <div v-if="menu.loading && !menu.areas.length" class="empty-state"><h2>正在准备菜单…</h2></div>

    <div v-else-if="view === 'restaurants'">
      <div v-if="!filteredRestaurants.length" class="empty-state"><span aria-hidden="true">⌂</span><h3>还没有符合条件的店铺</h3><p>{{ restaurants.length ? '试试放宽区域、类型或搜索条件。' : '菜单还是空的，请管理员先添加店铺。' }}</p><button v-if="hasFilter" type="button" class="secondary" @click="resetFilters">重置筛选</button></div>
      <div v-else class="menu-grid">
        <article v-for="restaurant in filteredRestaurants" :key="restaurant.id" class="menu-card shop-card">
          <div class="card-head"><h3>{{ restaurant.name }}</h3><span class="card-tag">{{ normalizeRestaurantCategory(restaurant.category) }}</span></div>
          <p class="card-meta">{{ areaName(restaurant.areaId) }}<span v-if="restaurant.location"> · {{ restaurant.location }}</span></p>
          <p class="card-dishes">{{ dishCounts.get(restaurant.id) ?? 0 }} 道菜品<span v-if="!(dishCounts.get(restaurant.id) ?? 0)" class="subtle"> · 暂无录入菜品</span></p>
          <RatingControl target-type="restaurant" :target-id="restaurant.id" :name="restaurant.name" />
          <button type="button" class="secondary card-action" @click="openShop(restaurant.id)">查看菜单</button>
        </article>
      </div>
    </div>

    <div v-else>
      <div v-if="!filteredDishes.length" class="empty-state"><span aria-hidden="true">≋</span><h3>还没有符合条件的菜品</h3><p>{{ selectedShop ? '这家店还没有录入菜品。' : dishes.length ? '试试放宽区域、店铺、分类或搜索条件。' : '菜单还是空的，请管理员先添加菜品。' }}</p><button v-if="hasFilter" type="button" class="secondary" @click="resetFilters">重置筛选</button></div>
      <div v-else class="menu-grid">
        <article v-for="dish in filteredDishes" :key="dish.id" class="menu-card dish-card">
          <div class="card-head"><h3>{{ dish.name }}</h3><strong class="card-price">{{ money(dish.priceCents) }}</strong></div>
          <p class="card-meta">{{ restaurantName(dish.restaurantId) }} · {{ areaName(restaurants.find((restaurant) => restaurant.id === dish.restaurantId)?.areaId ?? '') }}</p>
          <p class="card-tags"><span class="card-tag">{{ canonicalDishCategory(dish.category) || '不分类' }}</span></p>
          <p v-if="dish.notes" class="card-notes">{{ dish.notes }}</p>
          <RatingControl target-type="dish" :target-id="dish.id" :name="dish.name" />
        </article>
      </div>
    </div>

    <p class="privacy-note menu-note">评分匿名提交，计入全站平均分与评分人数，不影响随机推荐。清除 Cookie、使用无痕窗口或更换浏览器会得到新的匿名身份，无法再修改原身份提交的评分。</p>
  </section>
</template>
