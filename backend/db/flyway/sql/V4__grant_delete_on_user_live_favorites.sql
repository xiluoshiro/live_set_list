-- 收藏服务端化需要允许运行时写账号删除 user_live_favorites 记录，
-- 这样取消收藏才能继续沿用 live_project_super_ro，而不必切换到更高权限账号。

GRANT DELETE ON TABLE public.user_live_favorites TO live_project_super_ro;
