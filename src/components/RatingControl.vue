<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RatingTargetType } from '../../shared/types'
import { useRatingsStore } from '../stores/ratings'

const props = defineProps<{
  targetType: RatingTargetType
  targetId: string
  /** 对象名称，只用于可访问标签。 */
  name: string
  compact?: boolean
}>()

const ratings = useRatingsStore()
const busy = ref(false)
const error = ref('')
const disabled = computed(() => busy.value || ratings.isPending(props.targetType, props.targetId))
const summary = computed(() => ratings.summary(props.targetType, props.targetId))
const myStars = computed(() => ratings.myStars(props.targetType, props.targetId))
const averageText = computed(() => summary.value.average === null || summary.value.count === 0
  ? '暂无评分'
  : `${summary.value.average.toFixed(1)} 分`)

async function rate(stars: number): Promise<void> {
  if (disabled.value) return
  busy.value = true
  error.value = ''
  try { await ratings.submit(props.targetType, props.targetId, stars) }
  catch (e) { error.value = e instanceof Error ? e.message : '评分失败，请稍后重试。' }
  finally { busy.value = false }
}

async function clear(): Promise<void> {
  if (disabled.value) return
  busy.value = true
  error.value = ''
  try { await ratings.remove(props.targetType, props.targetId) }
  catch (e) { error.value = e instanceof Error ? e.message : '删除评分失败，请稍后重试。' }
  finally { busy.value = false }
}
</script>

<template>
  <div class="rating-control" :class="{ compact, rated: myStars !== null }" :aria-busy="disabled">
    <div class="rating-stars" role="group" :aria-label="`为${name}评分，1 至 5 星`">
      <button
        v-for="star in 5"
        :key="star"
        type="button"
        class="rating-star"
        :class="{ filled: myStars !== null && star <= myStars }"
        :aria-pressed="myStars === star"
        :aria-label="`${name}：${star} 星`"
        :disabled="disabled"
        @click="rate(star)"
      >★</button>
    </div>
    <p class="rating-meta" aria-live="polite">
      <span class="rating-average" :class="{ empty: summary.count === 0 }">{{ averageText }}</span>
      <span v-if="summary.count">{{ summary.count }} 人评分</span>
      <span v-if="myStars !== null" class="rating-mine">我的评分：{{ myStars }} 星</span>
    </p>
    <button v-if="myStars !== null" type="button" class="text-button rating-clear" :disabled="disabled" @click="clear">删除我的评分</button>
    <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
  </div>
</template>
