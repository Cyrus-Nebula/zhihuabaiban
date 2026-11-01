# 智绘几何 · Supabase 迁移交接指南

代码已合并到 `main`（GitHub：`Cyrus-Nebula/zhihuabaiban`），Supabase 版本即为线上版本。
本指南是「你这边需要手动做的几步」，我无法在沙箱里直连你的 Supabase 库，所以建表 SQL 需要你点一下 Run。

## 一、建库（一次性，约 1 分钟）

1. 打开 Supabase 控制台 → 项目 `gdurwjynamvzhsacpsna` → 左侧 **SQL Editor**
2. 新建一个查询，把本目录 `setup.sql` 的**全部内容**粘贴进去
3. 点 **Run** 一次（已用 `if not exists` / `or replace`，可重复运行）

脚本会创建：
- 三张表：`profiles`（账号资料/角色/会员）、`boards`（画板云端同步）、`activation_codes`（激活码）
- RLS 行级安全：`boards` 仅本人；`activation_codes` 客户端完全不可直接访问
- 存储过程（`SECURITY DEFINER`，前端用 anon key 即可调用）：
  - `redeem_activation_code` 兑换会员
  - `admin_list_codes` / `admin_create_codes` / `admin_disable_code` 管理员激活码
  - `admin_list_users` / `admin_set_membership` 管理员用户管理
  - `delete_self_account` 自助删号
  - `handle_new_user` 触发器：新用户自动建 profile，管理员邮箱（`3616927242@qq.com`）自动提权

4. （可选）把你自己的账号提为管理员，在 SQL Editor 再跑一句：
   ```sql
   select public.set_admin('3616927242@qq.com');
   ```

## 二、开启第三方登录（OAuth）

> 本次只保留 **Google + GitHub**（微信/QQ 暂未接，不影响邮箱密码登录）。

Supabase 控制台 → **Authentication → Providers**：
- 打开 **Google**：去 Google Cloud 建 OAuth 客户端，填 Client ID / Secret（回调 `https://gdurwjynamvzhsacpsna.supabase.co/auth/v1/callback`）
- 打开 **GitHub**：去 GitHub Developer Settings 建 OAuth App，填 Client ID / Secret（回调同上）
- 前端会自动检测已启用的 provider 并显示按钮

## 三、注册方式（二选一）

- **默认**：Supabase 开启「注册需邮件验证」→ 注册后会发验证邮件，点开后才能登录。
- **想注册后立即登录**：Authentication → Providers → 顶部关掉 **Confirm sign-ups**（仅在你信任注册来源时）。

## 四、找回密码

已改为 Supabase 标准流程：`resetPasswordForEmail` → 用户邮箱收到带 `token_hash` 的重置链接 → 打开 `reset.html` 设新密码（无需自建后端）。

## 五、部署

Cloudflare Pages：
- 把生产分支切到 `supabase-migration`（或合并到 `main` 后部署 `main`）
- **环境变量**：无需新增。anon key 已写进 `js/supabase-config.js`；`service_role` 仅存于 Supabase 侧。
- 既有 `LLM_API_KEY` 等 AI 配置保持不动，AI 接口不受影响。

## 六、隐私说明

会员/管理员的高权限逻辑现在在 **Supabase 数据库（存储过程）** 里，不在 GitHub 仓库中。因此仓库保持 **public** 也不会暴露会员算法代码——这正是之前「会员代码不想开源」诉求的解法。

## 七、回退

若线上出问题：Cloudflare 切回 `main`（D1 旧版），账号数据互不干扰（两套独立后端）。
