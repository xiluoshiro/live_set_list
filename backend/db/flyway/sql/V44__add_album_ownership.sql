SET ROLE live_project_owner;

ALTER TABLE public.albums ADD COLUMN owner_mode text
    CHECK (owner_mode IN ('bands', 'members', 'mixed'));
CREATE TABLE public.album_bands (
    album_id integer NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
    band_id integer NOT NULL REFERENCES public.band_attrs(id),
    display_order integer NOT NULL CHECK (display_order > 0),
    PRIMARY KEY (album_id, band_id)
);
CREATE TABLE public.album_member_groups (
    album_id integer NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
    band_id integer NOT NULL REFERENCES public.band_attrs(id),
    display_order integer NOT NULL CHECK (display_order > 0),
    PRIMARY KEY (album_id, band_id)
);
CREATE TABLE public.album_members (
    album_id integer NOT NULL,
    band_id integer NOT NULL,
    member_id integer NOT NULL REFERENCES public.members(id),
    display_order integer NOT NULL CHECK (display_order > 0),
    PRIMARY KEY (album_id, member_id),
    FOREIGN KEY (album_id, band_id) REFERENCES public.album_member_groups(album_id, band_id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);

CREATE FUNCTION public.lock_album_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.album_id <> NEW.album_id THEN
        RAISE EXCEPTION 'Move ownership using delete and insert' USING ERRCODE = '23514';
    END IF;
    IF TG_OP <> 'INSERT' THEN
        PERFORM 1 FROM public.albums WHERE id = OLD.album_id FOR UPDATE;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        PERFORM 1 FROM public.albums WHERE id = NEW.album_id FOR UPDATE;
        RETURN NEW;
    END IF;
    RETURN OLD;
END $$;
CREATE FUNCTION public.check_album_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target integer; mode text; has_bands boolean; has_groups boolean;
BEGIN
    IF TG_TABLE_NAME = 'albums' THEN target := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN target := OLD.album_id;
    ELSE target := NEW.album_id;
    END IF;
    SELECT owner_mode INTO mode FROM public.albums WHERE id = target;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT EXISTS(SELECT 1 FROM public.album_bands WHERE album_id = target),
           EXISTS(SELECT 1 FROM public.album_member_groups WHERE album_id = target)
    INTO has_bands, has_groups;
    IF (mode IS NULL AND (has_bands OR has_groups))
       OR (mode = 'bands' AND (NOT has_bands OR has_groups))
       OR (mode = 'members' AND (has_bands OR NOT has_groups))
       OR (mode = 'mixed' AND (NOT has_bands OR NOT has_groups))
       OR EXISTS(SELECT 1 FROM public.album_member_groups g WHERE g.album_id = target
                 AND NOT EXISTS(SELECT 1 FROM public.album_members m
                                WHERE m.album_id = g.album_id AND m.band_id = g.band_id)) THEN
        RAISE EXCEPTION 'Invalid ownership for album %', target USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER album_ownership_check AFTER INSERT OR UPDATE ON public.albums
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_album_ownership();
DO $$ DECLARE relation text; BEGIN
    FOREACH relation IN ARRAY ARRAY['album_bands', 'album_member_groups', 'album_members'] LOOP
        EXECUTE format('CREATE TRIGGER album_ownership_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.lock_album_ownership()', relation);
        EXECUTE format('CREATE CONSTRAINT TRIGGER album_ownership_check AFTER INSERT OR UPDATE OR DELETE ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_album_ownership()', relation);
    END LOOP;
END $$;
GRANT SELECT ON public.album_bands, public.album_member_groups, public.album_members
    TO live_project_ro, live_project_user_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.album_bands, public.album_member_groups, public.album_members
    TO live_project_super_ro;
RESET ROLE;
