-- `INSERT ... ON CONFLICT DO NOTHING` 在收藏写接口里也会触发表级读取权限校验，
-- 因此 user_rw 除了写权限外，还需要对收藏表本身拥有 SELECT。

GRANT SELECT ON TABLE public.user_live_favorites TO live_project_user_rw;
