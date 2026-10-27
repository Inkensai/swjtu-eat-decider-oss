<script setup lang="ts">
import { ref } from 'vue'
import { useHistoryStore } from '../stores/history'
import { displayTime, modeLabels, money } from '../lib/format'
const history = useHistoryStore()
const confirming = ref(false)
</script>

<template>
  <section class="intro page-intro"><span class="eyebrow">每一顿的小记忆</span><h1>我的<span>用餐记录</span></h1><p>记住那些让你少一点纠结的选择。仅此浏览器可见，最多保留 100 条。</p></section>
  <div v-if="history.warning" class="notice" role="status">{{ history.warning }}</div>
  <section class="panel history-panel">
    <div class="section-top"><h2>最近的决定 <span class="count-badge">{{ history.entries.length }}</span></h2><button v-if="history.entries.length" class="text-button danger-text" @click="confirming = true">清空记录</button></div>
    <div v-if="confirming" class="confirm-box" role="alert"><p>确定清空此浏览器的所有记录？此操作无法撤销。</p><div class="button-row"><button class="danger-button" @click="history.clear(); confirming = false">确认清空</button><button class="secondary" @click="confirming = false">保留记录</button></div></div>
    <div v-if="!history.entries.length" class="empty-state"><span aria-hidden="true">↺</span><h3>美味的记录，从下一顿开始</h3><p>完成一次推荐，就会自动出现在这里。</p><RouterLink to="/" class="primary button-link">去决定今天吃什么</RouterLink></div>
    <ol v-else class="history-list"><li v-for="entry in history.entries" :key="entry.id"><div class="history-food-icon" aria-hidden="true">{{ entry.dish ? '≋' : '⌂' }}</div><div class="history-content"><div class="history-meta"><time :datetime="entry.at">{{ displayTime(entry.at) }}</time><span>{{ modeLabels[entry.mode] }}</span></div><h3>{{ entry.dish?.name || entry.restaurant.name }}<strong v-if="entry.dish">{{ money(entry.dish.priceCents) }}</strong></h3><p>{{ entry.dish ? entry.restaurant.name : '店铺推荐' }}<span v-if="entry.restaurant.location"> · {{ entry.restaurant.location }}</span></p></div><button class="adopt-button" :class="{ adopted: entry.adopted }" :aria-pressed="entry.adopted" :aria-label="`${entry.adopted ? '取消采纳' : '采纳'}${entry.dish?.name || entry.restaurant.name}`" @click="history.adopt(entry.id)">{{ entry.adopted ? '✓ 已采纳' : '标记采纳' }}</button></li></ol>
  </section>
</template>
