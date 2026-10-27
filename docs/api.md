# API 契约

所有路径同源；实体字段使用camelCase，时间为UTC ISO字符串。成功读取返回数组，POST创建返回201实体，PATCH返回200实体，DELETE返回204空响应。

错误统一为 `{ "error": { "code": "INVALID_INPUT", "message": "可读说明", "details": {} } }`。details可省略。常见状态：400输入、401无身份、403无权限/跨源/CSRF、404不存在、405方法不允许、409有关联记录、413请求过大、415非JSON、429登录限流、503认证未配置。

## 公共菜单

`GET /api/areas`、`GET /api/restaurants`、`GET /api/dishes`。公共菜单排除自身及父级停用项。可使用areaId，店铺/菜品可使用restaurantId、category精确筛选；首页category专指菜品分类。

区域字段：id/name/type/sortOrder/enabled/createdAt/updatedAt。店铺字段：id/areaId/name/category/location/enabled/createdAt/updatedAt。菜品字段：id/restaurantId/name/category/priceCents/weight/notes/enabled/createdAt/updatedAt。

## 推荐

`POST /api/recommend`，Content-Type为application/json。

```json
{
  "mode": "combo",
  "filters": {
    "areaId": "区域ID",
    "maxPriceCents": 2000,
    "excludedRestaurantIds": [],
    "excludedDishIds": []
  },
  "avoidRecent": false,
  "recentDishIds": []
}
```

mode为restaurant/dish/combo。filters还支持restaurantId、category；未使用的筛选字段应省略，不能传空字符串。dish模式必须指定restaurantId。recentDishIds至多5项，按旧到新；排除列表各至多200项。所有价格、权重与启用状态以数据库为准，客户端不能传入候选菜单或权重。

成功返回 `{status:"ok",restaurant,dish,candidateDishCount}`。restaurant模式dish为null。空候选是HTTP200 `{status:"empty",message}`，不是服务异常。

## 管理员会话

应用内密码/访问密钥登录，不依赖Cloudflare Access。会话凭据由服务端写入`ed_admin_session` Cookie，生产属性为`Path=/; HttpOnly; Secure; SameSite=Lax`（仅本地回环HTTP开发省略Secure），前端无法读取。会话默认12小时后绝对过期。

`GET /api/admin/session`：查询当前会话，无需先登录。始终返回HTTP200：未登录为`{"authenticated":false}`；已登录为`{"authenticated":true,"csrfToken":"...","expiresAt":"UTC ISO"}`。若Cookie已失效会同时下发清除Cookie。

`POST /api/admin/session`：登录。请求体`{"password":"管理员密码或访问密钥"}`（字段名保持`password`以兼容前端），必须`application/json`且`Origin`与目标同源。服务端按生产配置选择唯一认证方式：设置`ADMIN_ACCESS_KEY_HASH`时校验高熵访问密钥的 SHA-256；否则使用`ADMIN_PASSWORD_HASH`的 PBKDF2 校验；同时设置时访问密钥优先。成功返回200、登录状态、CSRF令牌及`Set-Cookie`；凭据错误返回401 `INVALID_CREDENTIALS`；同一来源连续失败达到上限返回429 `TOO_MANY_ATTEMPTS`并带`Retry-After`；两种凭据都未配置时返回503 `AUTH_NOT_CONFIGURED`。

`DELETE /api/admin/session`：退出登录，需要有效会话及`X-CSRF-Token`；返回204并清除Cookie。重复退出或过期会话返回401。

## 管理菜单

`GET/POST /api/admin/{areas|restaurants|dishes}`，`PATCH/DELETE /api/admin/{资源}/:id`。GET包含停用项。

所有管理接口都需要有效的`ed_admin_session`会话Cookie，否则返回401。所有写请求（POST/PATCH/DELETE）还必须：

- 携带与会话一致的`X-CSRF-Token`请求头，否则403 `CSRF_FAILED`；
- `Origin`与请求目标同源，否则403 `ORIGIN_REJECTED`；
- 使用`application/json`（POST/PATCH必须）。

创建时必须有name；店铺必须有areaId，菜品必须有restaurantId和priceCents。可写字段：

| 资源 | 字段 |
| --- | --- |
| areas | name、type、sortOrder、enabled |
| restaurants | areaId、name、category、location、enabled |
| dishes | restaurantId、name、category、priceCents、weight、notes、enabled |

type默认为other（canteen/nearby/other），sortOrder默认为0，enabled默认为true，category/location/notes默认为空字符串，weight默认为1。PATCH仅改提交字段，空PATCH和未知字段拒绝；id和时间由服务端生成。

名称1–100字符，分类≤60，位置≤300，备注≤500；价格为0–100000000整数分，权重为0–1000000有限数，排序为0–1000000整数；请求体上限65536字节。

删除非空区域/店铺返回409 HAS_CHILDREN，details含restaurants/dishes关联数量。数据库RESTRICT提供最终约束。不存在云端历史读取或写入接口。
