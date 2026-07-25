# MotoParts ERP — 项目总结（截至 2026-07-24）

给新对话用的开场白：
> "这是之前项目总结，请继续开发，不要改变现有架构。之前做好的所有东西（代码、文件、系统架构、进度）全部保留，不要删除，不要重新开始。请继续现在的项目状态。保持现有功能和UI不变。以后回答简短一点，不要重复解释，不要重新生成已经完成的代码，只修改需要的部分。"

## 关键地址 / ID
- 正式网站：https://motoparts-erp.vercel.app
- GitHub 仓库：https://github.com/zenith-chloe/SP-TIK （main 分支，push 后 Vercel 自动部署）
- 本地项目路径：`C:\Users\zenit\SP.TIKTOK AI`
- Vercel 项目：`motoparts-erp`（team_4fzOoVLGjlRnWM9X4t7GkMyQ）
- Supabase 项目：`motoparts-oms`（ref: `dtttdgdkhayzchmfptjt`）
- Shopee App：`ECOM Z TEST 1`（Test Partner_id: 1239076），Go-Live 申请已提交，审核中（24小时内出结果，结果发到 zenith.digital.ai@gmail.com）

## 系统架构
- 前端：React 18 + Vite + Tailwind CSS，部署在 Vercel（Git 自动部署）
- 后端：Supabase（Postgres 数据库 + Auth 登录 + Edge Functions）
- Shopee 对接：3 个 Supabase Edge Function 处理 OAuth 授权 + 订单同步
- 登录：Supabase Auth 邮箱密码登录（owner 账号：zenith.digital.ai@gmail.com）
- 多语言：中/英切换，用 `t(zh, en)` 闭包函数贯穿所有组件

## 文件结构
```
package.json / vite.config.js / postcss.config.js / tailwind.config.js / index.html
src/
  index.css
  main.jsx                  — 入口，渲染 App
  erp-mvp-demo.jsx           — App 根组件 + LoginScreen（登录页 + 侧边栏 + 路由）
  shared.jsx                 — Supabase client、mock 数据常量、DB↔UI 映射函数、NAV 菜单
  pagesOverviewOrders.jsx    — KPICard, Overview（总览）, Orders（订单管理）, OrderDrawer, Inventory（库存）
  pagesMove.jsx              — ProductMove（搬仓/搬店）, StoreManagement（店铺管理）, OAuthConnectModal
  pagesImportFinance.jsx     — ManualImport（手动导入）, Finance（财务）, AIPanel, Roles, AdsSpend, PrintSlip
public/
  privacy-policy.html
  terms-of-service.html
supabase/functions/
  shopee-auth-start/{index.ts, shopee.ts}      — 生成 Shopee 授权链接
  shopee-auth-callback/{index.ts, shopee.ts}   — 接收回调，换取 access_token 存入 platform_accounts
  shopee-sync-orders/{index.ts, shopee.ts}     — 拉取 Shopee 订单列表/详情，写入 orders + order_items
```

## 数据库设计（Supabase Postgres，RLS 要求 `auth.uid() IS NOT NULL`）
- `profiles` — user_id, role, full_name
- `platform_accounts` — id, platform(shopee/tiktok), account_name, access_token, refresh_token, shop_id, token_expires_at, created_at
- `products` — sku, name, stock_qty, ...
- `orders` — id, order_no, platform, buyer_name, buyer_phone, shipping_address, tracking_no, order_status, shipping_fee, order_date
- `order_items` — order_id, sku, product_name, qty, unit_price
- 已加唯一约束支持 Shopee 同步时的 upsert

## 已完成功能
1. 真实 Supabase Auth 登录（取代原本的假登录）
2. Shopee OAuth 授权全流程跑通（沙盒环境验证成功：测试店铺 227771854，测试订单 260724G9P3BC8J）
3. 订单从 Shopee 沙盒真实同步进数据库（orders + order_items）
4. 前端已接真实数据：总览(Overview)、订单管理(Orders)、库存(Inventory)、店铺管理(StoreManagement)、订单状态更新
5. 全站中英双语切换
6. 正式部署上线 + 隐私政策/服务条款页面
7. GitHub + Vercel Git 集成，push 自动部署
8. Shopee Go-Live 申请已提交，审核中
9. **TikTok Shop 真实 API 对接已打通**：Partner Center App "KS genuine" 已发布(On)，OAuth 授权全流程跑通（真实店铺 KS GENUINE PARTS，shop_id 7495122802545625209），订单同步测试成功（一次同步 50 笔订单/51 商品项写入数据库）。3个 Edge Function：tiktok-auth-start / tiktok-auth-callback / tiktok-sync-orders，需要的 scope 权限：Order Information + Shop Authorized Information（+ Fulfillment/Finance/Return等已开）

## 未完成 / 仍是本地演示数据（没有接真实数据库）
1. **ManualImport（手动导入订单）** — 导入后只存在浏览器 React state，刷新页面就消失，没有写入 `orders`/`order_items` 表
2. **ProductMove（仓库搬仓 / 店铺搬家）** — 操作只改本地 state，没有写入 `products.stock_qty`，也没有搬仓记录表
3. **Finance（财务）、AdsSpend（广告费用）、AIPanel（AI功能）、Roles（角色权限）** — 目前显示的还是最初的 mock 演示数据，没有从真实 `orders` 表计算
4. 前端"店铺管理"里"使用 TikTok Shop 登录连接"按钮，目前还是假的 UI 预览（OAuthConnectModal 模拟弹窗），没有真的调用 tiktok-auth-start（后端已经打通，只差前端接线）
5. 没有自动化测试
6. Shopee Go-Live 表单里的 IP 白名单先用占位值 `0.0.0.0` 过关（因为 Supabase Edge Functions 没有固定出口 IP，且当时"Enable IP Whitelist"开关是关闭的）——以后如果 Shopee 要求真正启用白名单，需要另外搭一个有固定 IP 的出站代理

## 下一步开发步骤（按优先级）
1. 等 Shopee Go-Live 审核结果（预计24小时内）
2. 把 ManualImport 导入逻辑改成真正写入 `orders` + `order_items` 表（目前只有 `onImport` 回调改 React state）
3. 把 ProductMove 的搬仓/搬店操作改成真正 update `products` 表（可能需要新建一张 `transfer_logs` 表记录历史）
4. 把 Finance / AdsSpend 改成基于真实 `orders` 表计算，而不是 `shared.jsx` 里的 mock 数据
5. 视需要决定 Roles & Permissions 是否要做成真正的权限控制（目前只是好看的表格）
6. 如果要接入 TikTok Shop 真实 API，参考 Shopee 那 3 个 Edge Function 的结构做一套对应的
7. 如果 Shopee 后续要求真正启用 IP 白名单，需要部署一个固定 IP 的出站代理，替换占位 IP
