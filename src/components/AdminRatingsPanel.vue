<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { AdminRating, AdminRatingList, Dish, RatingTargetType, Restaurant } from '../../shared/types'
import { api } from '../services/api'
import { useAdminStore } from '../stores/admin'
import { displayTime } from '../lib/format'

const props = defineProps<{ restaurants: Restaurant[]; dishes: Dish[] }>()
const session = useAdminStore()
const items = ref<AdminRating[]>([])
const total = ref(0)
const targetType = ref<'' | RatingTargetType>('')
const targetId = ref('')
const restaurantId = ref('')
const loading = ref(false)
const error = ref('')
const message = ref('')
const pending = ref<AdminRating | null>(null)

const targets = computed(() => {
  if (targetType.value === 'restaurant') return props.restaurants.map((restaurant) => ({ id: restaurant.id, name: restaurant.name }))
  if (targetType.value === 'dish') {
    return props.dishes
      .filter((dish) => !restaurantId.value || dish.restaurantId === restaurantId.value)
      .map((dish) => ({ id: dish.id, name: `${dish.name}（${props.restaurants.find((restaurant) => restaurant.id === dish.restaurantId)?.name ?? '未知店铺'}）` }))
  }
  return []
})

async function load(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  const query = new URLSearchParams()
  if (targetType.value) query.set('targetType', targetType.value)
  if (targetId.value) query.set('targetId', targetId.value)
  if (restaurantId.value) query.set('restaurantId', restaurantId.value)
  try {
    const result = await api<AdminRatingList>(`/admin/ratings${query.size ? `?${query.toString()}` : ''}`)
    items.value = result.items
    total.value = result.total
  } catch (e) {
    error.value = e instanceof Error ? e.message : '评分列表加载失败。'
  } finally {
    loading.value = false
  }
}

watch(targetType, () => { targetId.value = ''; restaurantId.value = ''; void load() })
watch([targetId, restaurantId], () => { void load() })
onMounted(() => { void load() })

async function remove(): Promise<void> {
  if (!pending.value || loading.value) return
  const target = pending.value
  loading.value = true
  error.value = ''
  try {
    await api(`/admin/ratings/${encodeURIComponent(target.id)}`, { method: 'DELETE' }, { csrf: session.csrfToken })
    pending.value = null
    message.value = `已删除「${target.targetName}」的一条评分。`
  } catch (e) {
    error.value = e instanceof Error ? e.message : '删除评分失败。'
  } finally {
    loading.value = false
  }
  await load()
}

function resetFilters(): void {
  targetType.value = ''
  targetId.value = ''
  restaurantId.value = ''
  void load()
}
</script>

<template>
  <section class="panel rating-admin">
    <div class="section-top"><h2>评分管理 <span class="count-badge">{{ total }}</span></h2><button type="button" class="text-button" :disabled="loading" @click="load">刷新评分 ↻</button></div>
    <p class="inline-hint">只显示评分对象、星级和时间，不显示任何匿名身份凭据或摘要。删除评分需要管理员会话与 CSRF 校验，删除后公共统计立即重算。</p>
    <div class="menu-filters rating-filters">
      <label>对象类型<select v-model="targetType"><option value="">全部</option><option value="restaurant">店铺</option><option value="dish">菜品</option></select></label>
      <label v-if="targetType === 'dish'">所属店铺<select v-model="restaurantId"><option value="">全部店铺</option><option v-for="restaurant in restaurants" :key="restaurant.id" :value="restaurant.id">{{ restaurant.name }}</option></select></label>
      <label v-if="targetType">评分对象<select v-model="targetId"><option value="">全部对象</option><option v-for="target in targets" :key="target.id" :value="target.id">{{ target.name }}</option></select></label>
      <button v-if="targetType || targetId || restaurantId" type="button" class="text-button" @click="resetFilters">重置筛选</button>
    </div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <div v-if="message" class="notice success" role="status">{{ message }}</div>
    <p v-if="loading" class="loading-text" role="status">正在加载评分…</p>
    <div v-if="!loading && !items.length" class="column-empty">还没有符合条件的评分。</div>
    <ul v-else class="rating-list">
      <li v-for="rating in items" :key="rating.id">
        <div class="rating-target"><strong>{{ rating.targetName || '（对象已删除）' }}</strong><small>{{ rating.targetType === 'restaurant' ? '店铺' : '菜品' }}<template v-if="rating.restaurantName"> · {{ rating.restaurantName }}</template><template v-if="!rating.targetEnabled"> · 已停用</template></small></div>
        <span class="rating-stars-static" :aria-label="`${rating.stars} 星`"><span aria-hidden="true">{{ '★'.repeat(rating.stars) }}</span></span>
        <div class="rating-times"><small>提交 {{ displayTime(rating.createdAt) }}</small><small>更新 {{ displayTime(rating.updatedAt) }}</small></div>
        <button type="button" class="text-button danger-text" :disabled="loading" @click="pending = rating">删除</button>
      </li>
    </ul>
    <p v-if="total > items.length" class="inline-hint">共 {{ total }} 条，当前显示最近 {{ items.length }} 条；可用筛选缩小范围。</p>
    <div v-if="pending" class="confirm-box" role="alert"><h3>删除「{{ pending.targetName }}」的这条 {{ pending.stars }} 星评分？</h3><p>删除后该评分不再计入平均分与评分人数，且无法撤销。</p><div class="button-row"><button class="danger-button" :disabled="loading" @click="remove">{{ loading ? '正在删除…' : '确认删除' }}</button><button class="secondary" :disabled="loading" @click="pending = null">取消</button></div></div>
  </section>
</template>
