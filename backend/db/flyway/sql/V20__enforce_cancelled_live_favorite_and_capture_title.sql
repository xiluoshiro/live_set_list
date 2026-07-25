SET ROLE live_project_owner;

ALTER TABLE public.live_schedule_history
    ADD COLUMN previous_live_title text;

CREATE OR REPLACE FUNCTION public.enforce_live_favorite_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.live_attrs
        WHERE id = NEW.live_id
          AND event_status = 'cancelled'
    ) THEN
        RAISE EXCEPTION 'cancelled Live cannot be favorited'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER user_live_favorites_reject_cancelled
BEFORE INSERT OR UPDATE OF live_id
ON public.user_live_favorites
FOR EACH ROW
EXECUTE FUNCTION public.enforce_live_favorite_status();

CREATE OR REPLACE FUNCTION public.remove_cancelled_live_favorites()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW.event_status = 'cancelled' AND OLD.event_status IS DISTINCT FROM NEW.event_status THEN
        DELETE FROM public.user_live_favorites WHERE live_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER live_attrs_remove_favorites_when_cancelled
AFTER UPDATE OF event_status
ON public.live_attrs
FOR EACH ROW
EXECUTE FUNCTION public.remove_cancelled_live_favorites();

DELETE FROM public.user_live_favorites favorite
USING public.live_attrs live
WHERE favorite.live_id = live.id
  AND live.event_status = 'cancelled';

RESET ROLE;
