<script setup lang="ts">
import { useRoute } from 'vue-router'
const route = useRoute()
</script>

<template>
  <div class="app-shell" :class="{ 'home-shell': route.path === '/' }">
    <header class="site-header">
      <RouterLink class="brand" to="/" aria-label="Eat Decider 首页"><span class="brand-mark" aria-hidden="true">食</span><span>Eat Decider<small>好好吃饭，轻松决定</small></span></RouterLink>
      <nav aria-label="主导航">
        <RouterLink to="/" :aria-current="route.path === '/' ? 'page' : undefined">帮我决定</RouterLink>
        <RouterLink to="/history" :aria-current="route.path === '/history' ? 'page' : undefined">我的记录</RouterLink>
        <a href="/admin" :aria-current="route.path.startsWith('/admin') ? 'page' : undefined">菜单管理</a>
      </nav>
    </header>
    <main id="main-content"><RouterView /></main>
    <footer class="site-footer"><span>Eat Decider</span><span>把时间留给美食和朋友。</span></footer>
  </div>
</template>
