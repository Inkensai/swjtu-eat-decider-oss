# API 契约

所有路径同源；实体字段使用camelCase，时间为UTC ISO字符串。成功读取返回数组，POST创建返回201实体，PATCH返回200实体，DELETE返回204空响应。

错误统一为 `{ "error": { "code": "INVALID_INPUT", "message": "可读说明", "details": {} } }`。details可省略。常见状态：400输入、401无身份、403无权限/跨源/CSRF、404不存在、405方法不允许、409有关联记录、413请求过大、415非JSON、429登录或评分限流、503认证未配置。

## 公共菜单

`GET /api/areas`、`GET /api/restaurants`、`GET /api/dishes`。公共菜单排除自身及父级停用项。可使用areaId，店铺/菜品可使用restaurantId、category筛选；`category`按当前标准分类并结合已知旧名称映射匹配，首页category专指菜品分类。

区域字段：id/name/type/sortOrder/enabled/createdAt/updatedAt。店铺字段：id/areaId/name/category/location/enabled/createdAt/updatedAt。菜品字段：id/restaurantId/name/category/priceCents/weight/notes/enabled/createdAt/updatedAt。

## 推荐

`POST /api/recommend`，Content-Type为application/json。

```json
{
  "mode": "combo",
  "filters": {
    "areaId": "区域ID",
    "restaurantCategory": "粉面 / 面食",
    "maxPriceCents": 2000,
    "excludedRestaurantIds": [],
    "excludedDishIds": []
  },
  "avoidRecent": false,
  "recentDishIds": []
}
```

mode为restaurant/dish/combo。filters还支持restaurantId、restaurantCategory、category；未使用的筛选字段应省略，不能传空字符串。dish模式必须指定restaurantId。recentDishIds至多5项，按旧到新；排除列表各至多200项。所有价格、权重与启用状态以数据库为准，客户端不能传入候选菜单或权重。

`restaurantCategory`只筛选店铺分类。新标准值为`炒菜 / 家常菜`、`粉面 / 面食`、`快餐 / 盖饭`、`汉堡 / 炸鸡`、`火锅 / 麻辣烫`、`烧烤 / 烤肉`、`小吃 / 面点`、`轻食 / 简餐`、`饮品 / 甜品`、`其他 / 综合`。为兼容旧客户端，`火锅 / 串串`按`火锅 / 麻辣烫`匹配，`小吃 / 轻食`按原值精确匹配且不自动拆分；其他值返回400。历史空店铺分类按`其他 / 综合`参与；其他历史自定义分类只在省略该参数时参与。`category`只筛选菜品分类，两者互不替代；新标准为12类，已知旧名按兼容映射匹配，未知历史值仍可按原值精确筛选。dish模式已明确指定店铺，服务端忽略`restaurantCategory`。

成功返回 `{status:"ok",restaurant,dish,candidateDishCount}`。restaurant模式dish为null。空候选是HTTP200 `{status:"empty",message}`，不是服务异常。

随机选店（restaurant）只依赖店铺：未设置菜品分类、预算或排除菜品时，启用但没有录入菜品的店铺同样是有效候选，此时dish为null且candidateDishCount为0。设置上述任一依赖菜品的条件后，无菜品店铺不再参与；dish与combo模式始终要求存在有效菜品。评分不参与任何推荐权重。

## 匿名评分

评分对象类型为`restaurant`或`dish`，两者互不混淆；菜品ID不能当作店铺ID使用。所有正式评分直接写入D1并计入全站统计，没有本地私有评分或公开开关。

匿名身份由服务端生成256位随机凭据，通过`ed_rater_id` Cookie持有：生产为`Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`（仅本地回环HTTP开发省略Secure）。D1只保存`sha256("rater:" + 凭据)`摘要，响应JSON不回显Cookie原文。客户端不能提交身份ID，所有写入以Cookie解析出的摘要为准。清除Cookie、无痕窗口或更换浏览器会得到新的匿名身份，无法再修改原身份提交的评分。

`GET /api/ratings`：公开统计与当前身份状态，无需登录。

```json
{
  "restaurants": [{ "targetId": "店铺ID", "average": 4.5, "count": 2 }],
  "dishes": [{ "targetId": "菜品ID", "average": 5, "count": 1 }],
  "mine": [{ "targetType": "dish", "targetId": "菜品ID", "stars": 5 }]
}
```

只统计当前公开可见（自身与父级均启用）的对象；`average`为两位小数，`count`为有效评分人数，无评分时该对象不出现在数组里。`mine`只包含当前Cookie身份的评分，无Cookie时为空数组，且该请求不会创建身份。响应始终`Cache-Control: no-store`。

`PUT /api/ratings/{restaurant|dish}/:id`：提交或更新当前身份对该对象的评分，请求体`{"stars": 1-5}`（整数）。

- 成功返回200 `{targetType,targetId,stars,average,count}`；首次调用且没有Cookie时同时下发`ed_rater_id`。
- 同一身份重复提交只更新原记录（`created_at`保留、`updated_at`刷新），评分人数不变。
- 星级不是1–5整数、包含未知字段或不是JSON返回400；对象不存在或已停用返回404；请求体超过65536字节返回413；`Origin`与目标不同源返回403。
- 每个身份默认每600秒允许30次写操作、每个来源IP默认120次，超出返回429 `TOO_MANY_REQUESTS`并带`Retry-After`。

`DELETE /api/ratings/{restaurant|dish}/:id`：删除当前身份对该对象的评分，返回204。没有身份Cookie返回401 `IDENTITY_REQUIRED`；该身份没有这条评分返回404。其他身份的评分无法通过该路由寻址，删除只会影响Cookie对应的身份。

`GET /api/admin/ratings`：管理员评分列表，需要有效会话。可选查询参数`targetType`（restaurant/dish）、`targetId`、`restaurantId`（筛选该店铺下菜品的评分）。返回`{items,total}`，`items`最多500条，按更新时间倒序；每项包含`id`、`targetType`、`targetId`、`targetName`、`targetEnabled`、`restaurantId`、`restaurantName`、`stars`、`createdAt`、`updatedAt`，不包含身份摘要或Cookie凭据。`targetType`非法返回400。

`DELETE /api/admin/ratings/:id`：管理员删除任意评分，需要会话、同源`Origin`和`X-CSRF-Token`；成功204，评分不存在404。删除后公共统计立即按剩余评分重算。

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

type默认为other（canteen/nearby/other），sortOrder默认为0，enabled默认为true，location/notes默认为空字符串，weight默认为1；店铺创建时省略category则默认为`其他 / 综合`，菜品创建时省略category则默认为空。店铺新建或主动改分类时只接受10个新标准值；菜品新建或主动改分类时只接受12个新标准值或空字符串（不分类）。PATCH仅改提交字段，空PATCH和未知字段拒绝；id和时间由服务端生成。店铺与菜品的历史自定义分类继续按≤60字符文本保存：编辑其他字段且分类原值不变时允许保留，主动修改则必须切换到新标准值。

名称1–100字符，分类≤60，位置≤300，备注≤500；价格为0–100000000整数分，权重为0–1000000有限数，排序为0–1000000整数；请求体上限65536字节。

删除非空区域/店铺返回409 HAS_CHILDREN，details含restaurants/dishes关联数量。数据库RESTRICT提供最终约束；删除店铺或菜品时，其评分随外键`ON DELETE CASCADE`一并清理，不产生孤儿评分。不存在云端历史读取或写入接口。
