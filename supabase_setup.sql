-- FileShare Auth + RLS migration
-- Chạy toàn bộ trong Supabase Dashboard > SQL Editor.
-- Bucket công khai để mọi người tải/xem; chỉ tài khoản đăng nhập mới upload.
-- Mỗi người chỉ được xóa file do chính mình tải lên.

insert into storage.buckets (id, name, public, file_size_limit)
values ('public-files', 'public-files', true, 52428800)
on conflict (id) do update
set public = true, file_size_limit = 52428800;

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  object_path text not null unique,
  original_name text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  mime_type text not null default 'application/octet-stream',
  created_at timestamptz not null default now()
);

-- Thêm chủ sở hữu; các file cũ (nếu có) vẫn xem/tải được nhưng không có chủ sở hữu để xóa qua giao diện.
alter table public.files add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.files enable row level security;

-- Thu hồi quyền ghi công khai của bản starter trước đó.
revoke insert, update, delete on public.files from anon;
revoke insert, update on public.files from authenticated;
grant select on public.files to anon, authenticated;
grant insert, delete on public.files to authenticated;

drop policy if exists "Anyone can read file metadata" on public.files;
drop policy if exists "Anyone can add file metadata" on public.files;
drop policy if exists "Public can read file metadata" on public.files;
drop policy if exists "Signed-in users add their own metadata" on public.files;
drop policy if exists "Owners delete their own metadata" on public.files;

create policy "Public can read file metadata"
on public.files for select
to anon, authenticated
using (true);

create policy "Signed-in users add their own metadata"
on public.files for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and size_bytes > 0
  and size_bytes <= 52428800
  and length(original_name) between 1 and 255
  and length(object_path) between 3 and 150
  and split_part(object_path, '/', 1) = (select auth.uid())::text
  and exists (
    select 1 from storage.objects o
    where o.bucket_id = 'public-files'
      and o.name = object_path
      and o.owner_id = (select auth.uid())::text
  )
);

create policy "Owners delete their own metadata"
on public.files for delete
to authenticated
using (owner_id = (select auth.uid()));

-- Storage: ai cũng đọc được object trong bucket public. INSERT/DELETE yêu cầu JWT hợp lệ
-- và object phải nằm trong thư mục có tên là user ID của người thao tác.
drop policy if exists "Anyone can view objects in public-files" on storage.objects;
drop policy if exists "Anyone can upload to public-files" on storage.objects;
drop policy if exists "Authenticated users upload to own folder" on storage.objects;
drop policy if exists "Owners delete objects in own folder" on storage.objects;

create policy "Public can read objects in public-files"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'public-files');

create policy "Authenticated users upload to own folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'public-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Owners delete objects in own folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'public-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Không tạo UPDATE policy: client không thể ghi đè file đã có.


-- ============================================================
-- FileShare: short share URLs + live Storage usage counter
-- Có thể chạy lại an toàn sau khi đã chạy phần SQL ở trên.
-- ============================================================

alter table public.files add column if not exists share_slug text;

-- Tạo slug đọc được cho các file cũ, thêm hậu tố ID để tránh trùng.
update public.files
set share_slug = coalesce(
  nullif(trim(both '-' from regexp_replace(lower(original_name), '[^a-z0-9]+', '-', 'g')), ''),
  'tep'
) || '-' || left(replace(id::text, '-', ''), 6)
where share_slug is null or share_slug = '';

create unique index if not exists files_share_slug_key on public.files (share_slug);
alter table public.files alter column share_slug set not null;

-- Tổng byte thực tế trong Storage của project này (tất cả buckets),
-- đọc trực tiếp metadata của storage.objects; không dựa vào bảng files.
create or replace function public.get_project_storage_usage()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select coalesce(sum(
    case
      when (o.metadata ->> 'size') ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint
      else 0
    end
  ), 0)::bigint
  from storage.objects as o;
$$;

revoke all on function public.get_project_storage_usage() from public;
grant execute on function public.get_project_storage_usage() to anon, authenticated;

-- RLS bổ sung: slug không được để trống và có giới hạn độ dài.
drop policy if exists "Signed-in users add their own metadata" on public.files;
create policy "Signed-in users add their own metadata"
on public.files for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and size_bytes > 0
  and size_bytes <= 52428800
  and length(original_name) between 1 and 255
  and length(object_path) between 3 and 150
  and length(share_slug) between 1 and 90
  and share_slug ~ '^[a-z0-9-]+$'
  and split_part(object_path, '/', 1) = (select auth.uid())::text
  and exists (
    select 1 from storage.objects o
    where o.bucket_id = 'public-files'
      and o.name = object_path
      and o.owner_id = (select auth.uid())::text
  )
);
