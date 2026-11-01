-- ============================================================================
-- 智绘几何 · Supabase 初始化脚本
-- 项目 ref: gdurwjynamvzhsacpsna  |  URL: https://gdurwjynamvzhsacpsna.supabase.co
--
-- 用法：登录 Supabase 控制台 → 该项目的 SQL Editor → 粘贴本文件全部内容 → Run
-- 只需运行一次。已存在对象会被 CREATE OR REPLACE / IF NOT EXISTS 安全跳过。
--
-- 设计要点：
--   1. 数据权限完全靠 RLS + SECURITY DEFINER 存储过程，service_role 密钥只存于
--      Supabase 侧，不进仓库、不进前端。
--   2. activation_codes 对客户端「完全拒绝」直接访问，只能通过存储过程操作。
--   3. 新用户注册时触发器自动建 profiles；管理员邮箱（见 admin_emails()）自动提权。
-- ============================================================================

-- 确保 pgcrypto 可用（gen_random_bytes 依赖）
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) 表结构
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text,
  display_name      text,
  role              text not null default 'user' check (role in ('user', 'admin')),
  membership       text not null default 'none' check (membership in ('none', 'lifetime')),
  membership_since  bigint,
  membership_expires bigint,
  created_at       bigint not null default extract(epoch from now())::bigint
);

create table if not exists public.boards (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null default '未命名画板',
  mode        text not null default '2d' check (mode in ('2d', '3d')),
  content     text,
  created_at  bigint not null default extract(epoch from now())::bigint,
  updated_at  bigint not null default extract(epoch from now())::bigint
);
create index if not exists idx_boards_user on public.boards(user_id, updated_at desc);

create table if not exists public.activation_codes (
  code         text primary key,
  type         text not null default 'lifetime',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   bigint not null default extract(epoch from now())::bigint,
  claimed_by   uuid references auth.users(id) on delete set null,
  claimed_at   bigint,
  active       boolean not null default true
);
create index if not exists idx_codes_claimed on public.activation_codes(claimed_by);

-- ---------------------------------------------------------------------------
-- 2) 辅助函数（必须定义在前，供下方 RLS 策略引用）
-- ---------------------------------------------------------------------------

-- 管理员邮箱白名单（在此增删即可调整管理员）
create or replace function public.admin_emails()
returns text[]
language sql
security definer
set search_path = public
as $$
  select array['3616927242@qq.com'];
$$;

-- 当前用户是否为管理员（供 RLS 策略与存储过程复用）
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- 3) 行级安全（RLS）
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.boards            enable row level security;
alter table public.activation_codes  enable row level security;

-- profiles：用户读写自己；管理员（is_admin()）读写全部
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles for select using (auth.uid() = id);
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert with check (auth.uid() = id);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles for all using (public.is_admin()) with check (public.is_admin());

-- boards：仅本人
drop policy if exists boards_all on public.boards;
create policy boards_all on public.boards for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- activation_codes：不创建任何 policy → 客户端默认全部被拒，只能通过存储过程访问

-- ---------------------------------------------------------------------------
-- 4) 高权限存储过程（SECURITY DEFINER）
-- ---------------------------------------------------------------------------

-- 兑换激活码为长期会员
create or replace function public.redeem_activation_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
  v_row  public.activation_codes%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  v_code := upper(trim(p_code));
  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_code');
  end if;
  select * into v_row from public.activation_codes where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if not v_row.active then
    return jsonb_build_object('ok', false, 'error', 'code_disabled');
  end if;
  if v_row.claimed_by is not null then
    return jsonb_build_object('ok', false, 'error', 'code_used');
  end if;
  update public.activation_codes
     set claimed_by = v_uid, claimed_at = extract(epoch from now())::bigint
   where code = v_code;
  update public.profiles
     set membership = 'lifetime',
         membership_since = extract(epoch from now())::bigint,
         membership_expires = null
   where id = v_uid;
  return jsonb_build_object('ok', true, 'membership', 'lifetime');
end;
$$;

-- 管理员：列出激活码
create or replace function public.admin_list_codes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
            from public.activation_codes c);
end;
$$;

-- 管理员：批量生成激活码
create or replace function public.admin_create_codes(n integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  i      int;
  v_code text;
  v_codes text[] := '{}';
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 去除易混字符 I/O/0/1
  buf    bytea;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  n := greatest(1, least(50, coalesce(n, 1)));
  for i in 1..n loop
    buf := extensions.gen_random_bytes(12);
    v_code := '';
    for j in 0..11 loop
      v_code := v_code || substr(alphabet, (get_byte(buf, j) % length(alphabet)) + 1, 1);
    end loop;
    insert into public.activation_codes (code, type, created_by, created_at, active)
      values (v_code, 'lifetime', v_uid, extract(epoch from now())::bigint, true)
      on conflict (code) do nothing;
    v_codes := array_append(v_codes, v_code);
  end loop;
  return to_jsonb(v_codes);
end;
$$;

-- 管理员：停用某个激活码
create or replace function public.admin_disable_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.activation_codes set active = false where code = upper(trim(p_code));
  return jsonb_build_object('ok', true);
end;
$$;

-- 管理员：列出全部用户
create or replace function public.admin_list_users()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id, 'email', u.email,
           'created_at', p.created_at * 1000,
           'role', p.role, 'membership', p.membership,
           'membership_since', p.membership_since
         ) order by p.created_at desc nulls last), '[]'::jsonb)
            from auth.users u
            left join public.profiles p on p.id = u.id);
end;
$$;

-- 管理员：设置某用户会员状态
create or replace function public.admin_set_membership(p_user uuid, p_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_type not in ('none', 'lifetime') then raise exception 'bad_type'; end if;
  update public.profiles
     set membership = p_type,
         membership_since = case when p_type = 'none' then null else extract(epoch from now())::bigint end,
         membership_expires = null
   where id = p_user;
  return jsonb_build_object('ok', true);
end;
$$;

-- 回填：把指定邮箱账号提为管理员（存量账号用；首次运行请执行文件末尾示例）
create or replace function public.set_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set role = 'admin' where lower(email) = lower(p_email);
end;
$$;

-- 自助删除账号（仅能删自己；级联删除 profiles / boards）
create or replace function public.delete_self_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) 新用户自动建 profile（含管理员识别）
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    case when lower(new.email) = any(public.admin_emails()) then 'admin' else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 6) 授权执行（客户端可调用存储过程；表访问仍由 RLS 兜底）
-- ---------------------------------------------------------------------------
grant execute on function public.is_admin()               to anon, authenticated;
grant execute on function public.redeem_activation_code(text)   to anon, authenticated;
grant execute on function public.admin_list_codes()       to anon, authenticated;
grant execute on function public.admin_create_codes(integer)    to anon, authenticated;
grant execute on function public.admin_disable_code(text)      to anon, authenticated;
grant execute on function public.admin_list_users()       to anon, authenticated;
grant execute on function public.admin_set_membership(uuid, text) to anon, authenticated;
grant execute on function public.set_admin(text)          to authenticated;
grant execute on function public.delete_self_account()     to authenticated;

-- ============================================================================
-- 首次运行后，若你已有账号，请把指定邮箱提为管理员（取消下一行注释并运行）：
--   select public.set_admin('3616927242@qq.com');
-- ============================================================================
