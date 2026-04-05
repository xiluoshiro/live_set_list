-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1


--
-- Name: band_attrs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.band_attrs (
    id integer NOT NULL,
    band_abbr text NOT NULL,
    band_name text NOT NULL,
    band_members text[]
);


--
-- Name: live_attrs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_attrs (
    id integer NOT NULL,
    live_date date NOT NULL,
    live_title text NOT NULL,
    is_internal boolean DEFAULT true NOT NULL,
    url text NOT NULL,
    opening_time time with time zone NOT NULL,
    start_time time with time zone NOT NULL,
    venue_id integer NOT NULL
);


--
-- Name: live_attrs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.live_attrs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: live_attrs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.live_attrs_id_seq OWNED BY public.live_attrs.id;


--
-- Name: live_setlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_setlist (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT live_setlist_id_not_null NOT NULL,
    live_id integer CONSTRAINT live_setlist_live_id_not_null NOT NULL,
    song_id integer CONSTRAINT live_setlist_song_id_not_null NOT NULL,
    absolute_order integer CONSTRAINT live_setlist_absolute_order_not_null NOT NULL,
    segment_type text CONSTRAINT live_setlist_segment_type_not_null NOT NULL,
    sub_order integer CONSTRAINT live_setlist_sub_order_not_null NOT NULL,
    is_short boolean DEFAULT false CONSTRAINT live_setlist_is_short_not_null NOT NULL,
    band_member jsonb CONSTRAINT live_setlist_band_member_not_null NOT NULL,
    other_member jsonb,
    comment text
);


--
-- Name: song_list; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.song_list (
    id integer NOT NULL,
    song_name text NOT NULL,
    band_id integer NOT NULL,
    is_cover boolean DEFAULT false NOT NULL
);


--
-- Name: song_list_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.song_list_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: song_list_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.song_list_id_seq OWNED BY public.song_list.id;


--
-- Name: venue_list; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_list (
    id integer NOT NULL,
    venue text NOT NULL
);


--
-- Name: venue_list_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.venue_list_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: venue_list_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.venue_list_id_seq OWNED BY public.venue_list.id;


--
-- Name: live_attrs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_attrs ALTER COLUMN id SET DEFAULT nextval('public.live_attrs_id_seq'::regclass);


--
-- Name: song_list id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_list ALTER COLUMN id SET DEFAULT nextval('public.song_list_id_seq'::regclass);


--
-- Name: venue_list id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_list ALTER COLUMN id SET DEFAULT nextval('public.venue_list_id_seq'::regclass);


--
-- Name: band_attrs band_attrs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.band_attrs
    ADD CONSTRAINT band_attrs_pkey PRIMARY KEY (id);


--
-- Name: live_attrs live_attrs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_attrs
    ADD CONSTRAINT live_attrs_pkey PRIMARY KEY (id);


--
-- Name: live_setlist live_setlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_setlist
    ADD CONSTRAINT live_setlist_pkey PRIMARY KEY (id);


--
-- Name: song_list song_list_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_list
    ADD CONSTRAINT song_list_pkey PRIMARY KEY (id);


--
-- Name: song_list song_list_song_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_list
    ADD CONSTRAINT song_list_song_name_key UNIQUE (song_name);


--
-- Name: live_setlist unique_live_song_order; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_setlist
    ADD CONSTRAINT unique_live_song_order UNIQUE (live_id, absolute_order);


--
-- Name: venue_list venue_list_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_list
    ADD CONSTRAINT venue_list_pkey PRIMARY KEY (id);


--
-- Name: song_list fk_band_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_list
    ADD CONSTRAINT fk_band_id FOREIGN KEY (band_id) REFERENCES public.band_attrs(id);


--
-- Name: live_attrs live_attrs_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_attrs
    ADD CONSTRAINT live_attrs_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venue_list(id) NOT VALID;


--
-- Name: live_setlist live_setlist_live_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_setlist
    ADD CONSTRAINT live_setlist_live_id_fkey FOREIGN KEY (live_id) REFERENCES public.live_attrs(id);


--
-- Name: live_setlist live_setlist_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_setlist
    ADD CONSTRAINT live_setlist_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.song_list(id);


