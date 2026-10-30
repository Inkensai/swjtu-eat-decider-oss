<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useMotionPreference } from './lib/useMotionPreference'
import { useClock } from './lib/useClock'
import { computed } from 'vue'
const route = useRoute()
const motion = useMotionPreference()
const now = useClock()
const dateLabel = computed(() => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now.value).replaceAll('/', '.'))
</script>

<template>
  <div class="app-shell" :class="{ 'home-shell': route.path === '/' }" :data-motion="motion.reduced.value ? 'reduced' : 'full'">
    <a class="skip-link" href="#main-content">跳转到主要内容</a>
    <header class="site-header">
      <RouterLink class="brand" to="/" aria-label="Eat Decider 首页">
        <svg class="brand-symbol" aria-hidden="true" viewBox="0 0 44 44"><circle cx="22" cy="22" r="17" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M15 10v11m5-11v11m-10-11v11c0 4 10 4 10 0M15 25v10m15-25v25m0-25c-6 5-6 13 0 13" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M35 4h5v5" fill="none" stroke="currentColor"/></svg>
        <span class="brand-name">EAT DECIDER<small class="brand-subtitle">校园用餐指南 <span aria-hidden="true">/</span> SWJTU</small></span>
      </RouterLink>
      <nav aria-label="主导航">
        <RouterLink to="/" :aria-current="route.path === '/' ? 'page' : undefined"><span class="nav-index" aria-hidden="true">01</span>帮我决定</RouterLink>
        <RouterLink to="/menu" :aria-current="route.path === '/menu' ? 'page' : undefined"><span class="nav-index" aria-hidden="true">02</span>浏览菜单</RouterLink>
        <RouterLink to="/history" :aria-current="route.path === '/history' ? 'page' : undefined"><span class="nav-index" aria-hidden="true">03</span>我的记录</RouterLink>
        <RouterLink to="/admin" :aria-current="route.path.startsWith('/admin') ? 'page' : undefined"><span class="nav-index" aria-hidden="true">04</span>菜单管理</RouterLink>
      </nav>
      <div class="header-tools"><button class="motion-toggle" type="button" :aria-pressed="!motion.reduced.value" :disabled="motion.systemReduced.value" aria-label="动态效果" :title="motion.systemReduced.value ? '已跟随系统减少动态效果' : motion.reduced.value ? '开启动效' : '关闭动效'" @click="motion.toggle"><span aria-hidden="true">{{ motion.reduced.value ? 'Ⅱ' : '◌' }}</span>{{ motion.systemReduced.value ? '系统减弱动效' : motion.reduced.value ? '动效关闭' : '动效开启' }}</button></div>
    </header>
    <main id="main-content" tabindex="-1"><RouterView v-slot="{ Component }"><div :key="route.path" class="page-frame page-reveal"><component :is="Component" /></div></RouterView></main>
    <footer class="site-footer"><span><i class="footer-marker" aria-hidden="true"></i> 好好吃饭，认真生活。</span><span class="footer-code">SWJTU <span aria-hidden="true">/</span> {{ dateLabel }} <span aria-hidden="true">/</span> EAT WELL.</span></footer>
  </div>
</template>
