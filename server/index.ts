import type { Env } from './env'
import { handleApi } from './api'
import { HttpError, json } from './http'
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const path = new URL(request.url).pathname
      if (path === '/api' || path.startsWith('/api/')) return await handleApi(request, env)
      // /admin 页面本身公开，由前端调用受保护的管理 API 并显示登录表单。
      return await env.ASSETS.fetch(request)
    } catch (error) {
      if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message, details: error.details } }, error.status, error.headers)
      console.error('Request failed', error instanceof Error ? error.name : 'UnknownError')
      return json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' } }, 500)
    }
  },
}
