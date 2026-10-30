<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { HistoryEntry, RatingTargetType } from '../../shared/types'
import { useHistoryStore } from '../stores/history'
import { useMenuStore } from '../stores/menu'
import { useRatingsStore } from '../stores/ratings'
import { displayTime, modeLabels, money } from '../lib/format'
import RatingControl from '../components/RatingControl.vue'

type Filter = 'all' | 'recommended' | 'adopted'
interface RatingTarget { targetType: RatingTargetType; targetId: string; name: string }

const history = useHistoryStore()
const menu = useMenuStore()
const ratings = useRatingsStore()
const confirming = ref(false)
const filter = ref<Filter>('all')

onMounted(() => { void menu.load(); void ratings.load() })

const counts = computed(() => ({
  all: history.entries.length,
  recommended: history.entries.filter((entry) => !entry.adopted).length,
  adopted: history.entries.filter((entry) => entry.adopted).length,
}))
const visible = computed(() => history.entries.filter((entry) => filter.value === 'all'
  || (filter.value === 'adopted' ? entry.adopted : !entry.adopted)))

/** 只有仍然公开存在的对象才显示评分入口，避免对已删除或停用的快照提交评分。 */
function resolveTarget(entry: HistoryEntry): RatingTarget | null {
  if (entry.dish) {
    const dish = menu.dishes.find((item) => item.id === entry.dish!.id && item.enabled)
    const restaurant = dish && menu.restaurants.find((item) => item.id === dish.restaurantId && item.enabled)
    return dish && restaurant ? { targetType: 'dish', targetId: dish.id, name: dish.name } : null
  }
  const restaurant = menu.restaurants.find((item) => item.id === entry.restaurant.id && item.enabled)
  return restaurant ? { targetType: 'restaurant', targetId: restaurant.id, name: restaurant.name } : null
}
const targets = computed(() => {
  const map = new Map<string, RatingTarget>()
  for (const entry of history.entries) {
    const target = resolveTarget(entry)
    if (target) map.set(entry.id, target)
  }
  return map
})
</script>

<template>
  <section class="intro page-intro"><span class="eyebrow">DINING JOURNAL / 每一顿的小记忆</span><h1>我的<span>用餐记录</span></h1><p>记住那些让你少一点纠结的选择。仅此浏览器可见，最多保留 100 条。</p></section>
  <div v-if="history.warning" class="notice" role="status">{{ history.warning }}</div>
  <div v-if="ratings.error" class="notice error" role="alert">{{ ratings.error }}</div>
  <section class="panel history-panel">
    <div class="section-top"><h2>最近的决定 <span class="count-badge">{{ counts.all }}</span></h2><button v-if="counts.all" class="text-button danger-text" @click="confirming = true">清空记录</button></div>
    <div v-if="confirming" class="confirm-box" role="alert"><p>确定清空此浏览器的所有记录？此操作无法撤销，但不会删除已经提交到全站的评分。</p><div class="button-row"><button class="danger-button" @click="history.clear(); confirming = false">确认清空</button><button class="secondary" @click="confirming = false">保留记录</button></div></div>
    <div class="filter-tabs" role="group" aria-label="记录筛选">
      <button type="button" :class="{ selected: filter === 'all' }" :aria-pressed="filter === 'all'" @click="filter = 'all'">全部 <span>{{ counts.all }}</span></button>
      <button type="button" :class="{ selected: filter === 'recommended' }" :aria-pressed="filter === 'recommended'" @click="filter = 'recommended'">已推荐 <span>{{ counts.recommended }}</span></button>
      <button type="button" :class="{ selected: filter === 'adopted' }" :aria-pressed="filter === 'adopted'" @click="filter = 'adopted'">已采纳 <span>{{ counts.adopted }}</span></button>
    </div>
    <div v-if="!counts.all" class="empty-state"><span aria-hidden="true">↺</span><h3>美味的记录，从下一顿开始</h3><p>完成一次推荐，就会自动出现在这里。</p><RouterLink to="/" class="primary button-link">去决定今天吃什么</RouterLink></div>
    <div v-else-if="!visible.length" class="empty-state"><span aria-hidden="true">⌕</span><h3>这个筛选下还没有记录</h3><p>切换到「全部」看看其他记录。</p></div>
    <ol v-else class="history-list"><li v-for="entry in visible" :key="entry.id"><div class="history-food-icon" aria-hidden="true">{{ entry.dish ? '≋' : '⌂' }}</div><div class="history-content"><div class="history-meta"><time :datetime="entry.at">{{ displayTime(entry.at) }}</time><span>{{ modeLabels[entry.mode] }}</span><span v-if="entry.adopted" class="history-adopted">已采纳</span></div><h3>{{ entry.dish?.name || entry.restaurant.name }}<strong v-if="entry.dish">{{ money(entry.dish.priceCents) }}</strong></h3><p>{{ entry.dish ? entry.restaurant.name : '店铺推荐' }}<span v-if="entry.restaurant.location"> · {{ entry.restaurant.location }}</span></p><RatingControl v-if="targets.get(entry.id)" v-bind="targets.get(entry.id)!" compact /></div><button class="adopt-button" :class="{ adopted: entry.adopted }" :aria-pressed="entry.adopted" :aria-label="`${entry.adopted ? '取消采纳' : '采纳'}${entry.dish?.name || entry.restaurant.name}`" @click="history.adopt(entry.id)">{{ entry.adopted ? '✓ 已采纳' : '标记采纳' }}</button></li></ol>
    <p class="privacy-note history-note">未采纳的推荐只保留在当前页面；刷新后只恢复已采纳记录。评分独立保存在全站，清空历史不会删除评分。</p>
  </section>
</template>
