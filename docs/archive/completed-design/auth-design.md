# LiveSetList 登录与收藏系统设计

本文档描述 LiveSetList 后续计划落地的登录、会话、收藏同步与后台权限方案。

注意：

- 本文档是历史设计与实施约定，不代表当前仓库最新实现的完整说明
- 当前已经实现的接口行为仍以 [api.md](/D:/Code/PythonCode/5%20LiveSetList/docs/api.md) 为准
- 当前数据库迁移与角色约定仍以 [docs/design/flyway.md](/D:/Code/PythonCode/5%20LiveSetList/docs/design/flyway.md) 和 [docs/db-roles.md](/D:/Code/PythonCode/5%20LiveSetList/docs/db-roles.md) 为准

## 1. 设计目标

鉴权设计解决 4 个问题：

1. 为项目提供统一登录能力
2. 将首页“收藏”改为仅登录用户可见，并与账号绑定
3. 为控制台写接口提供权限控制
4. 为后续审计、会话失效、跨设备收藏同步预留结构

基于当前代码状态，推荐采用：

- 公开读接口保持匿名可访问
- 写接口和控制台入口要求登录
- 收藏功能与登录用户绑定
- 认证采用“服务端 Session + HttpOnly Cookie + CSRF Token”

## 2. 当前项目现状

当前仓库中的相关情况：

- 前端首页列表和详情接口均可匿名访问
- 前端已接入 `AuthProvider`、`FavoriteProvider`、登录弹窗、`/api/auth/me` 启动恢复和服务端收藏切换
- 前端未登录时已隐藏“收藏”页签与星标入口
- 前端控制台入口已按角色可见性控制：仅 `editor+` 显示；未登录和 `viewer` 不显示
- 前端已增加控制台页签的状态层兜底拦截，避免通过开发者工具强行切 tab 绕过页面权限
- 控制台录入界面已接入真实写接口；当前接口清单与行为以 [api.md](/D:/Code/PythonCode/5%20LiveSetList/docs/api.md) 为准
- 后端认证骨架已落地：已新增用户表、会话表、认证路由和默认 admin 加载机制
- 后端当前数据库连接已拆分为只读连接、普通用户写连接和高权限业务写连接

相关代码位置：

- 前端登录态实现：[AuthProvider.tsx](/D:/Code/PythonCode/5%20LiveSetList/frontend/src/auth/AuthProvider.tsx)
- 前端收藏同步状态实现：[FavoriteProvider.tsx](/D:/Code/PythonCode/5%20LiveSetList/frontend/src/favorites/FavoriteProvider.tsx)
- 前端登录弹窗：[LoginDialog.tsx](/D:/Code/PythonCode/5%20LiveSetList/frontend/src/components/LoginDialog.tsx)
- 前端收藏状态实现：[App.tsx](/D:/Code/PythonCode/5%20LiveSetList/frontend/src/App.tsx)
- 前端接口封装：[api.ts](/D:/Code/PythonCode/5%20LiveSetList/frontend/src/api.ts)
- 后端接口入口：[main.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/main.py)
- 后端 live 查询路由：[lives.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/routers/lives.py)
- 后端数据库连接：[db.py](/D:/Code/PythonCode/5%20LiveSetList/backend/app/db.py)

## 3. 总体方案

### 3.1 认证模式

采用服务端 Session 模式：

- 登录成功后，由后端签发 `HttpOnly` session cookie
- 前端 JavaScript 不直接持有 session token
- 后端数据库保存 session 记录，支持主动失效和审计
- 所有写接口额外要求携带 CSRF Token

推荐 cookie：

- 名称：`live_set_list_session`
- 属性：`HttpOnly`
- 属性：`Secure`
- 属性：`SameSite=Lax`
- 路径：`/`

当前实现补充：

- 启动时自动确保一个默认 `admin` 账号存在
- 默认值优先读取环境变量：
  - `AUTH_DEFAULT_ADMIN_USERNAME`
  - `AUTH_DEFAULT_ADMIN_PASSWORD`
  - `AUTH_DEFAULT_ADMIN_DISPLAY_NAME`
- 若未设置，则回退到代码内默认值

### 3.2 收藏模式

收藏仅对已登录用户开放：

- 未登录用户：不显示“收藏”页签，不显示星标入口
- 已登录用户：使用服务端收藏表 `user_live_favorites`
- 收藏状态不再落本地 `localStorage`
- 收藏前端交互优化与弱一致同步策略，见 [favorite-optimistic-sync.md](/D:/Code/PythonCode/5%20LiveSetList/docs/archive/completed-design/favorite-optimistic-sync.md)

这样可以直接简化：

- 不需要匿名收藏状态
- 不需要登录时 merge 本地收藏
- 不需要维护“本地收藏”和“服务端收藏”两套来源

### 3.3 权限模式

推荐角色：

- `viewer`：可登录，可同步收藏
- `editor`：可访问控制台，可执行新增/编辑
- `admin`：可管理用户、会话、审计和高风险操作

权限边界：

- 匿名：可访问首页列表、详情、详情批量预读
- `viewer+`：可使用账号收藏
- `editor+`：可访问 `/api/admin/*`
- `admin+`：可访问用户管理类接口

## 3.4 权限控制策略

推荐采用“路由级访问控制 + 接口级鉴权 + 数据库连接分层”三层策略。

### 路由级访问控制

前端页面按是否登录和角色控制可见性：

- 匿名用户：
  - 显示“全量”页签
  - 不显示“收藏”页签
  - 不显示“控制台”页签，或显示后点击弹出登录框
- `viewer`：
  - 显示“全量”页签
  - 显示“收藏”页签
  - 不显示“控制台”页签
- `editor`：
  - 显示“全量”页签
  - 显示“收藏”页签
  - 显示“控制台”页签
- `admin`：
  - 与 `editor` 相同，并可进入后续用户管理页面

### 接口级鉴权

后端统一通过依赖注入控制权限：

- `get_current_user_optional()`：允许匿名访问
- `get_current_user()`：要求已登录
- `require_role("viewer")`：要求已登录
- `require_role("editor")`：要求具备编辑权限
- `require_role("admin")`：要求管理员权限

接口分级建议：

- 匿名可读：
  - `GET /api/lives`
  - `GET /api/lives/{live_id}`
  - `POST /api/lives/details:batch`
- 登录可用：
  - `GET /api/auth/me`
  - `POST /api/auth/logout`
  - `GET /api/me/favorites/lives`
  - `PUT /api/me/favorites/lives/{live_id}`
  - `DELETE /api/me/favorites/lives/{live_id}`
- `editor+`：
  - `GET /api/console/songs`
  - `GET /api/console/bands`
  - `GET /api/console/venues`
  - `POST /api/console/songs`
  - `POST /api/console/songs:batch`
  - `POST /api/console/venues`
  - `POST /api/console/lives`
  - `POST /api/console/lives/{live_id}/setlist`
- `admin+`：
  - 后续用户管理、会话管理、审计查询接口

### 数据库连接分层

数据库权限不只依赖应用层判断，还应做账号分层：

- 读接口使用只读连接
- 收藏接口使用普通用户写连接
- 认证和控制台接口使用高权限业务写连接

这样可以降低误写风险，并和当前仓库已有的数据库角色划分保持一致。

当前落地约定：

- `live_project_ro`：公开读接口
- `live_project_user_rw`：前端登录用户的低权限写接口，当前主要用于收藏写入
- `live_project_super_ro`：认证、session、审计，以及控制台写接口

## 4. 数据库设计

建议通过新的 Flyway migration 新增以下表。

### 4.1 `app_users`

```sql
create table app_users (
  id bigserial primary key,
    username varchar(64) not null,
  password_hash text not null,
  display_name varchar(64) not null,
  role varchar(16) not null check (role in ('viewer', 'editor', 'admin')),
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (username)
);
```

说明：

- `password_hash` 使用 `argon2id`
- 不开放公开注册
- 当前阶段默认 admin 用户通过应用启动时的内建加载逻辑自动写入

### 4.2 `auth_sessions`

```sql
create table auth_sessions (
  id bigserial primary key,
  user_id bigint not null references app_users(id) on delete cascade,
  session_token_hash text not null,
  csrf_token_hash text not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_ip inet,
  user_agent text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_token_hash)
);
```

说明：

- 只存 token 的哈希，不存明文
- 支持会话过期、主动注销和强制下线

### 4.3 `user_live_favorites`

```sql
create table user_live_favorites (
  id bigserial primary key,
  user_id bigint not null references app_users(id) on delete cascade,
  live_id integer not null references live_attrs(id) on delete cascade,
  source varchar(16) not null default 'manual' check (source in ('manual', 'imported')),
  created_at timestamptz not null default now(),
  unique (user_id, live_id)
);
```

说明：

- 唯一键保证收藏操作幂等
- `source` 用于区分手动收藏和后续可能的导入来源

### 4.4 `audit_logs`

```sql
create table audit_logs (
  id bigserial primary key,
  user_id bigint references app_users(id) on delete set null,
  action varchar(64) not null,
  resource_type varchar(32) not null,
  resource_id varchar(64),
  payload_json jsonb,
  created_at timestamptz not null default now()
);
```

说明：

- 记录登录、登出、写操作、权限失败和收藏操作等行为

## 5. 后端接口设计

## 5.1 认证接口

### `POST /api/auth/login`

请求体：

```json
{
  "username": "alice",
  "password": "plain-password"
}
```

成功响应：

```json
{
  "user": {
    "id": 1,
    "username": "alice",
    "display_name": "Alice",
    "role": "editor"
  },
  "csrf_token": "csrf-plain-token",
  "favorite_live_ids": [9, 15]
}
```

行为约定：

- 校验用户名和密码
- 设置 session cookie
- 返回当前用户信息和 CSRF Token

### `GET /api/auth/me`

已登录响应：

```json
{
  "authenticated": true,
  "user": {
    "id": 1,
    "username": "alice",
    "display_name": "Alice",
    "role": "editor"
  },
  "csrf_token": "csrf-plain-token",
  "favorite_live_ids": [9, 15]
}
```

未登录响应：

```json
{
  "authenticated": false
}
```

行为约定：

- 用于前端启动时恢复登录态
- 也可用于 session 续期

### `POST /api/auth/logout`

请求头：

- `X-CSRF-Token`

成功响应：

- `204 No Content`

行为约定：

- 使当前 session 失效
- 清空 cookie

## 5.2 收藏接口

### `GET /api/me/favorites/lives`

查询参数：

- `page`
- `page_size`

成功响应：

```json
{
  "items": [
    {
      "live_id": 1,
      "live_date": "2026-03-28",
      "live_title": "BanG Dream! Unit Live",
      "bands": [1, 2],
      "url": "https://example.com/lives/1",
      "is_favorite": true
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 1,
    "total_pages": 1
  }
}
```

行为约定：

- 分页返回当前登录用户的收藏列表
- 返回结构尽量与 `GET /api/lives` 保持一致，方便前端复用

### `PUT /api/me/favorites/lives/{live_id}`

请求头：

- `X-CSRF-Token`

成功响应：

- `204 No Content`

行为约定：

- 幂等操作
- 若目标已收藏，再次调用仍返回 `204`

### `DELETE /api/me/favorites/lives/{live_id}`

请求头：

- `X-CSRF-Token`

成功响应：

- `204 No Content`

行为约定：

- 幂等操作
- 若目标本就未收藏，再次调用仍返回 `204`

## 5.3 现有读接口的扩展

### `GET /api/lives`

在现有返回项上新增：

```json
{
  "is_favorite": true
}
```

约定：

- 匿名请求：统一返回 `false`
- 登录请求：按 `user_live_favorites` 判断

### `GET /api/lives/{live_id}`

在现有详情结果上新增：

```json
{
  "is_favorite": true
}
```

## 5.4 控制台接口

当前控制台真实接口统一挂在：

- `GET /api/console/songs`
- `GET /api/console/bands`
- `GET /api/console/venues`
- `POST /api/console/songs`
- `POST /api/console/songs:batch`
- `POST /api/console/venues`
- `POST /api/console/lives`
- `POST /api/console/lives/{live_id}/setlist`

权限要求：

- `editor` 及以上

建议返回结构：

```json
{
  "ok": true,
  "item": {}
}
```

## 6. 状态码与错误码约定

统一状态码：

- `200`：查询成功
- `201`：创建成功
- `204`：无响应体的成功写操作
- `400`：业务参数错误
- `401`：未登录
- `403`：已登录但无权限
- `404`：资源不存在
- `409`：冲突，例如唯一键冲突
- `422`：请求体验证失败
- `429`：登录限流
- `500`：服务内部错误
- `504`：数据库连接或查询超时

建议错误体：

```json
{
  "detail": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "用户名或密码错误"
  }
}
```

建议错误码：

- `AUTH_INVALID_CREDENTIALS`
- `AUTH_SESSION_EXPIRED`
- `AUTH_CSRF_INVALID`
- `AUTH_FORBIDDEN`
- `LIVE_NOT_FOUND`
- `FAVORITE_LIVE_NOT_FOUND`
- `USER_USERNAME_CONFLICT`
- `VALIDATION_ERROR`

## 7. 前端实现约定

### 7.1 网络请求

前端统一约定：

- 所有请求使用 `credentials: "include"`
- 所有写请求带 `X-CSRF-Token`
- 登录成功后，CSRF Token 仅保存在内存态，不写入 `localStorage`

### 7.2 收藏来源切换

未登录模式：

- 不显示“收藏”页签
- 不显示星标入口
- 不保留任何本地收藏状态

登录模式：

- 收藏完全以服务端为准
- 星标操作直接调用收藏接口
- 收藏页直接使用服务端分页接口

### 7.3 页面权限

建议行为：

- 未登录时不显示“收藏”页签
- 未登录时隐藏“控制台”页签，或点击后打开登录弹窗
- 已登录但无 `editor` 权限时，显示“无权限访问控制台”
- 收到 `401` 时，前端自动清理内存登录态并回到匿名模式

## 8. 页面流转

### 8.1 启动流转

```mermaid
flowchart TD
  A["App 启动"] --> B["GET /api/auth/me"]
  B -->|401 或 authenticated=false| C["匿名模式"]
  B -->|200 且 authenticated=true| D["登录模式"]
  C --> E["仅显示全量页"]
  D --> F["显示全量页 + 收藏页"]
  E --> G["GET /api/lives"]
  F --> G
  D --> H["收藏页使用 /api/me/favorites/lives"]
```

### 8.2 登录后收藏初始化

```mermaid
flowchart TD
  A["用户点击登录"] --> B["POST /api/auth/login"]
  B --> C["返回 user + csrf_token + favorite_live_ids"]
  C --> D["前端切换到登录模式"]
  D --> E["显示收藏页与星标入口"]
```

### 8.3 星标切换

```mermaid
flowchart TD
  A["点击星标"] --> B{"目标状态"}
  B -->|收藏| C["PUT /api/me/favorites/lives/{id}"]
  B -->|取消| D["DELETE /api/me/favorites/lives/{id}"]
  C --> E["更新前端收藏状态"]
  D --> E
```
