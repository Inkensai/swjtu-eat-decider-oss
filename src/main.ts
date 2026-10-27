import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import './style.css'
import App from './App.vue'
import HomePage from './pages/HomePage.vue'
import HistoryPage from './pages/HistoryPage.vue'
import AdminPage from './pages/AdminPage.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomePage, meta: { title: '今天吃什么' } },
    { path: '/history', component: HistoryPage, meta: { title: '我的记录' } },
    { path: '/admin/:pathMatch(.*)*', component: AdminPage, meta: { title: '菜单管理' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
router.afterEach((to) => { document.title = `${String(to.meta.title)} · Eat Decider` })
createApp(App).use(createPinia()).use(router).mount('#app')
