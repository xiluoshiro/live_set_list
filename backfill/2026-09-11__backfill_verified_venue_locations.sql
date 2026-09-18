\set ON_ERROR_STOP on

-- Target: LiveSetList main database `live_statistic` at Flyway V31.
-- Preconditions: all 153 target Venue rows are unmerged physical rows whose
-- location fields are still empty and whose location_revision is still 1.
-- Reviewed source: docs/design/venue-coordinate-candidates-2026-09-10.md
-- This is a one-time data backfill kept outside Flyway schema migrations so a
-- fresh database can still migrate before application seed data is loaded.
-- It writes 43 localities, 153 Venue locations and 154 system audit rows.
-- Existing Live timezone snapshots and venue_map_links are intentionally unchanged.

DO $block$
DECLARE
    current_flyway_version text;
BEGIN
    IF current_database() <> 'live_statistic' THEN
        RAISE EXCEPTION 'Refusing venue backfill on database %; expected live_statistic', current_database();
    END IF;

    SELECT version
    INTO current_flyway_version
    FROM public.flyway_schema_history
    WHERE success
    ORDER BY installed_rank DESC
    LIMIT 1;

    IF current_flyway_version IS DISTINCT FROM '31' THEN
        RAISE EXCEPTION 'Venue backfill requires Flyway V31; current version is %',
            COALESCE(current_flyway_version, '<none>');
    END IF;
END
$block$;

BEGIN;
SET LOCAL ROLE live_project_owner;

CREATE TEMP TABLE _locality_backfill (
    locality_key text PRIMARY KEY,
    country_code text NOT NULL,
    admin_area text,
    locality_name text NOT NULL,
    timezone_id text NOT NULL
) ON COMMIT DROP;

INSERT INTO _locality_backfill (locality_key, country_code, admin_area, locality_name, timezone_id) VALUES
    ('JP_SAITAMA_SAITAMA', 'JP', '埼玉県', 'さいたま市', 'Asia/Tokyo'),
    ('JP_AICHI_NAGOYA', 'JP', '愛知県', '名古屋市', 'Asia/Tokyo'),
    ('JP_TOKYO_WARDS', 'JP', '東京都', '東京都区部', 'Asia/Tokyo'),
    ('JP_YAMANASHI_FUJIKAWAGUCHIKO', 'JP', '山梨県', '富士河口湖町', 'Asia/Tokyo'),
    ('CN_SHANGHAI', 'CN', NULL, '上海市', 'Asia/Shanghai'),
    ('JP_TOKYO_CHOFU', 'JP', '東京都', '調布市', 'Asia/Tokyo'),
    ('JP_CHIBA_CHIBA', 'JP', '千葉県', '千葉市', 'Asia/Tokyo'),
    ('JP_KANAGAWA_YOKOHAMA', 'JP', '神奈川県', '横浜市', 'Asia/Tokyo'),
    ('JP_OSAKA_OSAKA', 'JP', '大阪府', '大阪市', 'Asia/Tokyo'),
    ('JP_HYOGO_KOBE', 'JP', '兵庫県', '神戸市', 'Asia/Tokyo'),
    ('JP_TOKYO_TACHIKAWA', 'JP', '東京都', '立川市', 'Asia/Tokyo'),
    ('JP_CHIBA_FUNABASHI', 'JP', '千葉県', '船橋市', 'Asia/Tokyo'),
    ('JP_FUKUOKA_FUKUOKA', 'JP', '福岡県', '福岡市', 'Asia/Tokyo'),
    ('JP_IBARAKI_HITACHINAKA', 'JP', '茨城県', 'ひたちなか市', 'Asia/Tokyo'),
    ('JP_HOKKAIDO_SAPPORO', 'JP', '北海道', '札幌市', 'Asia/Tokyo'),
    ('PH_QUEZON', 'PH', 'Metro Manila', 'Quezon City', 'Asia/Manila'),
    ('TW_TAOYUAN', 'TW', NULL, '桃園市', 'Asia/Taipei'),
    ('JP_SAITAMA_TOKOROZAWA', 'JP', '埼玉県', '所沢市', 'Asia/Tokyo'),
    ('TW_NEW_TAIPEI', 'TW', NULL, '新北市', 'Asia/Taipei'),
    ('KR_SEOUL', 'KR', NULL, 'Seoul', 'Asia/Seoul'),
    ('SG_SINGAPORE', 'SG', NULL, 'Singapore', 'Asia/Singapore'),
    ('JP_NAGANO_SAKU', 'JP', '長野県', '佐久市', 'Asia/Tokyo'),
    ('JP_KANAGAWA_YOKOSUKA', 'JP', '神奈川県', '横須賀市', 'Asia/Tokyo'),
    ('US_CA_ANAHEIM', 'US', 'CA', 'Anaheim', 'America/Los_Angeles'),
    ('TW_TAIPEI', 'TW', NULL, '臺北市', 'Asia/Taipei'),
    ('US_CA_LONG_BEACH', 'US', 'CA', 'Long Beach', 'America/Los_Angeles'),
    ('JP_FUKUOKA_KITAKYUSHU', 'JP', '福岡県', '北九州市', 'Asia/Tokyo'),
    ('JP_KANAGAWA_KAWASAKI', 'JP', '神奈川県', '川崎市', 'Asia/Tokyo'),
    ('JP_HIROSHIMA_HIROSHIMA', 'JP', '広島県', '広島市', 'Asia/Tokyo'),
    ('JP_KUMAMOTO_KUMAMOTO', 'JP', '熊本県', '熊本市', 'Asia/Tokyo'),
    ('JP_SAITAMA_KONOSU', 'JP', '埼玉県', '鴻巣市', 'Asia/Tokyo'),
    ('HK_HONG_KONG', 'HK', NULL, '香港', 'Asia/Hong_Kong'),
    ('JP_OSAKA_SUITA', 'JP', '大阪府', '吹田市', 'Asia/Tokyo'),
    ('JP_SHIGA_KUSATSU', 'JP', '滋賀県', '草津市', 'Asia/Tokyo'),
    ('US_CA_LOS_ANGELES', 'US', 'CA', 'Los Angeles', 'America/Los_Angeles'),
    ('JP_NAGASAKI_SASEBO', 'JP', '長崎県', '佐世保市', 'Asia/Tokyo'),
    ('JP_SHIZUOKA_SHIZUOKA', 'JP', '静岡県', '静岡市', 'Asia/Tokyo'),
    ('JP_SHIZUOKA_FUKUROI', 'JP', '静岡県', '袋井市', 'Asia/Tokyo'),
    ('JP_AICHI_KARIYA', 'JP', '愛知県', '刈谷市', 'Asia/Tokyo'),
    ('KR_GYEONGGI_GOYANG', 'KR', 'Gyeonggi-do', 'Goyang-si', 'Asia/Seoul'),
    ('JP_MIYAGI_SENDAI', 'JP', '宮城県', '仙台市', 'Asia/Tokyo'),
    ('JP_CHIBA_URAYASU', 'JP', '千葉県', '浦安市', 'Asia/Tokyo'),
    ('JP_YAMANASHI_FUJIYOSHIDA', 'JP', '山梨県', '富士吉田市', 'Asia/Tokyo');

CREATE TEMP TABLE _venue_location_backfill (
    venue_id integer PRIMARY KEY,
    expected_venue text NOT NULL,
    locality_key text NOT NULL REFERENCES _locality_backfill(locality_key),
    address text NOT NULL,
    latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude numeric(10,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180)
) ON COMMIT DROP;

-- address is production-facing data: keep only searchable address and necessary premise details.
-- Language follows the venue corpus: Japanese for Japan, Simplified Chinese for mainland
-- China, Traditional Chinese for Taiwan/Hong Kong, and English for every other country.
-- Provenance, confidence, historical status, and verification notes belong in the candidate ledger.
INSERT INTO _venue_location_backfill
    (venue_id, expected_venue, locality_key, address, latitude, longitude) VALUES
    (1, 'さいたまスーパーアリーナ', 'JP_SAITAMA_SAITAMA', '埼玉県さいたま市中央区新都心8', 35.894889, 139.630831),
    (2, '愛知県芸術劇場 大ホール', 'JP_AICHI_NAGOYA', '愛知県名古屋市東区東桜1-13-2', 35.170862, 136.911267),
    (3, '有明アリーナ', 'JP_TOKYO_WARDS', '東京都江東区有明1-11-1', 35.643430, 139.794400),
    (4, '河口湖ステラシアター', 'JP_YAMANASHI_FUJIKAWAGUCHIKO', '山梨県南都留郡富士河口湖町船津5577', 35.480260, 138.759710),
    (5, '上海宛平剧院 大剧场', 'CN_SHANGHAI', '上海市徐汇区中山南二路857-859号', 31.186911, 121.447017),
    (6, '京王アリーナTOKYO', 'JP_TOKYO_CHOFU', '東京都調布市西町290-11', 35.665140, 139.524400),
    (7, '上海静安体育中心', 'CN_SHANGHAI', '上海市静安区汶水路116号', 31.293250, 121.448740),
    (8, '神奈川県民ホール 大ホール', 'JP_KANAGAWA_YOKOHAMA', '神奈川県横浜市中区山下町3-1', 35.445975, 139.647154),
    (9, 'Zepp Osaka Bayside', 'JP_OSAKA_OSAKA', '大阪府大阪市此花区桜島1-1-61', 34.662010, 135.434860),
    (10, '国家会展中心（上海）虹馆EH', 'CN_SHANGHAI', '上海市青浦区崧泽大道333号，国家会展中心（上海）虹馆EH', 31.192892, 121.300132),
    (11, '千葉市蘇我スポーツ公園', 'JP_CHIBA_CHIBA', '千葉県千葉市中央区川崎町1-20', 35.574790, 140.124264),
    (12, '日本武道館', 'JP_TOKYO_WARDS', '東京都千代田区北の丸公園2-3', 35.693360, 139.749870),
    (13, '横浜アリーナ', 'JP_KANAGAWA_YOKOHAMA', '神奈川県横浜市港北区新横浜3-10', 35.512270, 139.620190),
    (14, 'Kアリーナ横浜', 'JP_KANAGAWA_YOKOHAMA', '神奈川県横浜市西区みなとみらい6-2-14', 35.464710, 139.630720),
    (15, 'Zepp DiverCity (TOKYO)', 'JP_TOKYO_WARDS', '東京都江東区青海1-1-10、ダイバーシティ東京 プラザ', 35.625400, 139.775600),
    (16, 'グランキューブ大阪 メインホール', 'JP_OSAKA_OSAKA', '大阪府大阪市北区中之島5-3-51、大阪府立国際会議場5F', 34.689390, 135.486270),
    (17, '東京国際フォーラム ホールA', 'JP_TOKYO_WARDS', '東京都千代田区丸の内3-5-1、Aブロック1-7F', 35.676670, 139.764440),
    (18, 'KT Zepp Yokohama', 'JP_KANAGAWA_YOKOHAMA', '神奈川県横浜市西区みなとみらい4-3-6', 35.459750, 139.625910),
    (19, '浦发银行东方体育中心', 'CN_SHANGHAI', '上海市浦东新区泳耀路300号', 31.159567, 121.472869),
    (20, '国家会展中心（上海）', 'CN_SHANGHAI', '上海市青浦区崧泽大道333号', 31.191680, 121.297520),
    (21, 'TACHIKAWA STAGE GARDEN', 'JP_TOKYO_TACHIKAWA', '東京都立川市緑町3-3 N1', 35.704805, 139.411841),
    (22, 'LaLa arena TOKYO-BAY', 'JP_CHIBA_FUNABASHI', '千葉県船橋市浜町2-5-15', 35.683840, 139.989700),
    (23, '神戸ワールド記念ホール', 'JP_HYOGO_KOBE', '兵庫県神戸市中央区港島中町6-12-2', 34.663950, 135.210150),
    (24, '東京ガーデンシアター', 'JP_TOKYO_WARDS', '東京都江東区有明2-1-6', 35.637730, 139.792040),
    (25, '梅赛德斯-奔驰文化中心', 'CN_SHANGHAI', '上海市浦东新区世博大道1200号', 31.191291, 121.489391),
    (26, 'Zepp Fukuoka', 'JP_FUKUOKA_FUKUOKA', '福岡県福岡市中央区地行浜2-2-1', 33.600700, 130.378600),
    (27, 'Zepp Namba', 'JP_OSAKA_OSAKA', '大阪府大阪市浪速区敷津東2-1-39', 34.655900, 135.505000),
    (28, 'Zepp Nagoya', 'JP_AICHI_NAGOYA', '愛知県名古屋市中村区平池町4-60-7', 35.163362, 136.884742),
    (29, 'Zepp Haneda (TOKYO)', 'JP_TOKYO_WARDS', '東京都大田区羽田空港1-1-4、HANEDA INNOVATION CITY ZONE H', 35.549400, 139.779800),
    (30, '下北沢GARDEN', 'JP_TOKYO_WARDS', '東京都世田谷区北沢2-4-5、mosia B1F', 35.659268, 139.671558),
    (31, 'SGC HALL ARIAKE', 'JP_TOKYO_WARDS', '東京都江東区有明3-3-8、TOKYO DREAM PARK 1F', 35.634000, 139.788000),
    (33, 'TOYOTA ARENA TOKYO', 'JP_TOKYO_WARDS', '東京都江東区青海1-3-1', 35.626560, 139.782650),
    (34, 'ぴあアリーナMM', 'JP_KANAGAWA_YOKOHAMA', '神奈川県横浜市西区みなとみらい3-2-2', 35.455820, 139.628430),
    (35, '幕張メッセ 国際展示場ホール', 'JP_CHIBA_CHIBA', '千葉県千葉市美浜区中瀬2-1', 35.648333, 140.034722),
    (36, 'Kanadevia Hall', 'JP_TOKYO_WARDS', '東京都文京区後楽1-3-61、MEETS PORT 1F', 35.703300, 139.754600),
    (37, 'COOL JAPAN PARK OSAKA WWホール', 'JP_OSAKA_OSAKA', '大阪府大阪市中央区大阪城3-6', 34.684700, 135.533700),
    (38, '神戸国際会館こくさいホール', 'JP_HYOGO_KOBE', '兵庫県神戸市中央区御幸通8-1-6、神戸国際会館', 34.692260, 135.195840),
    (39, 'Crypto.com Arena', 'US_CA_LOS_ANGELES', '1111 S Figueroa St, Los Angeles, CA 90015', 34.043020, -118.266870),
    (40, 'LOFT/PLUSONE', 'JP_TOKYO_WARDS', '東京都新宿区歌舞伎町1-14-7、林ビルB2F', 35.694596, 139.702177),
    (41, '大佳河濱公園', 'TW_TAIPEI', '臺北市中山區濱江街5號', 25.076000, 121.535000),
    (42, '東京ビッグサイト', 'JP_TOKYO_WARDS', '東京都江東区有明3-11-1', 35.630161, 139.793739),
    (43, '松下IMPホール', 'JP_OSAKA_OSAKA', '大阪府大阪市中央区城見1-3-7、松下IMPビル2F', 34.691720, 135.530690),
    (44, 'Zepp New Taipei', 'TW_NEW_TAIPEI', '新北市新莊區新北大道四段3號8樓', 25.059680, 121.449570),
    (45, 'KOREA UNIV. TIGER DOME', 'KR_SEOUL', '145 Anam-ro, Seongbuk-gu, Seoul 02841, South Korea', 37.592550, 127.024900),
    (46, 'The Star Theatre', 'SG_SINGAPORE', 'The Star, 1 Vista Exchange Green, Singapore 138617', 1.306920, 103.788394),
    (47, 'おおきにアリーナ舞洲', 'JP_OSAKA_OSAKA', '大阪府大阪市此花区北港緑地2-2-15', 34.665566, 135.397620),
    (48, '幕張メッセ イベントホール', 'JP_CHIBA_CHIBA', '千葉県千葉市美浜区中瀬2-1', 35.648230, 140.034700),
    (49, '朝日生命ホール', 'JP_OSAKA_OSAKA', '大阪府大阪市中央区高麗橋4-2-16', 34.689800, 135.500310),
    (50, 'Lives NAGOYA', 'JP_AICHI_NAGOYA', '愛知県名古屋市港区金城ふ頭2-7-1、Maker''s Pier', 35.050000, 136.846916),
    (51, '日経ホール', 'JP_TOKYO_WARDS', '東京都千代田区大手町1-3-7、日経ビル3F', 35.688741, 139.762330),
    (52, '飛行船シアター', 'JP_TOKYO_WARDS', '東京都台東区東上野4-24-11', 35.715561, 139.782013),
    (53, '大宮ソニックシティ 大ホール', 'JP_SAITAMA_SAITAMA', '埼玉県さいたま市大宮区桜木町1-7-5', 35.906900, 139.623700),
    (54, '代官山UNIT', 'JP_TOKYO_WARDS', '東京都渋谷区恵比寿西1-34-17、ZaHOUSEビルB2F', 35.647112, 139.702325),
    (55, 'アニメイトシアター', 'JP_TOKYO_WARDS', '東京都豊島区東池袋1-20-7、アニメイト池袋本店 北館B2F', 35.731310, 139.715540),
    (56, '学校跡地の飯田橋でっかいレンタルスペース', 'JP_TOKYO_WARDS', '東京都新宿区揚場町2-28', 35.702144, 139.740455),
    (57, 'イイノホール', 'JP_TOKYO_WARDS', '東京都千代田区内幸町2-1-1', 35.670980, 139.750627),
    (58, '駒場公園', 'JP_NAGANO_SAKU', '長野県佐久市猿久保字丸山55', 36.254864, 138.485756),
    (59, 'duo MUSIC EXCHANGE', 'JP_TOKYO_WARDS', '東京都渋谷区道玄坂2-14-8、O-EASTビル1F', 35.658715, 139.695526),
    (60, '国営ひたち海浜公園', 'JP_IBARAKI_HITACHINAKA', '茨城県ひたちなか市馬渡字大沼605-4', 36.402500, 140.594300),
    (61, 'GARDEN 新木場 FACTORY', 'JP_TOKYO_WARDS', '東京都江東区新木場2-8-2', 35.638599, 139.827756),
    (62, 'Zepp Sapporo', 'JP_HOKKAIDO_SAPPORO', '北海道札幌市中央区南9条西4-4', 43.049350, 141.353170),
    (63, 'Smart Araneta Coliseum', 'PH_QUEZON', 'General Araneta Ave, Quezon City 1109, Philippines', 14.620710, 121.053400),
    (64, '桃園会展中心', 'TW_TAOYUAN', '桃園市中壢區領航北路一段99號', 25.003200, 121.200400),
    (65, 'UMEDA CLUB QUATTRO', 'JP_OSAKA_OSAKA', '大阪府大阪市北区太融寺町8-17、プラザ梅田10F', 34.701767, 135.502308),
    (66, 'NAGOYA CLUB QUATTRO', 'JP_AICHI_NAGOYA', '愛知県名古屋市中区栄3-29-1、名古屋パルコ東館8F', 35.163710, 136.908338),
    (67, 'Spotify O-EAST', 'JP_TOKYO_WARDS', '東京都渋谷区道玄坂2-14-8、O-EASTビル2F', 35.658715, 139.695526),
    (68, '豊洲PIT', 'JP_TOKYO_WARDS', '東京都江東区豊洲6-1-23', 35.649680, 139.788310),
    (69, 'ところざわサクラタウン ジャパンパビリオン ホールA', 'JP_SAITAMA_TOKOROZAWA', '埼玉県所沢市東所沢和田3-31-3、ところざわサクラタウン', 35.797194, 139.506833),
    (70, 'LINE CUBE SHIBUYA', 'JP_TOKYO_WARDS', '東京都渋谷区宇田川町1-1', 35.664100, 139.698530),
    (71, '新都市ホール', 'JP_KANAGAWA_YOKOHAMA', '神奈川県横浜市西区高島2-18-1、横浜新都市ビル9F', 35.465421, 139.625109),
    (72, '心斎橋BIGCAT', 'JP_OSAKA_OSAKA', '大阪府大阪市中央区西心斎橋1-6-14、BIGSTEP 4F', 34.672500, 135.498700),
    (73, 'Zepp Shinjuku (TOKYO)', 'JP_TOKYO_WARDS', '東京都新宿区歌舞伎町1-29-1、東急歌舞伎町タワーB1-B4F', 35.695580, 139.700770),
    (74, 'Veats Shibuya', 'JP_TOKYO_WARDS', '東京都渋谷区宇田川町33-1、グランド東京渋谷ビルB1-B2F', 35.660766, 139.697432),
    (75, '秋葉原エンタス', 'JP_TOKYO_WARDS', '東京都千代田区外神田1-2-7、オノデン本館5F', 35.698290, 139.771010),
    (76, '六本木BIGHOUSE', 'JP_TOKYO_WARDS', '東京都港区六本木5-18-2、大昌第二ビルB1F', 35.661249, 139.737251),
    (77, '1000 CLUB', 'JP_KANAGAWA_YOKOHAMA', '神奈川県横浜市西区南幸2-1-5', 35.463221, 139.618737),
    (78, '日比谷公園大音楽堂', 'JP_TOKYO_WARDS', '東京都千代田区日比谷公園1-5', 35.672361, 139.754028),
    (79, '中池袋公園', 'JP_TOKYO_WARDS', '東京都豊島区東池袋1-16-1', 35.731500, 139.715000),
    (80, '大阪城ホール', 'JP_OSAKA_OSAKA', '大阪府大阪市中央区大阪城3-1', 34.689681, 135.530106),
    (81, 'カナモトホール(札幌市民ホール)', 'JP_HOKKAIDO_SAPPORO', '北海道札幌市中央区北1条西1丁目', 43.062180, 141.355540),
    (82, '福岡サンパレス', 'JP_FUKUOKA_FUKUOKA', '福岡県福岡市博多区築港本町2-1', 33.603870, 130.402320),
    (83, 'TFTホール 1000', 'JP_TOKYO_WARDS', '東京都江東区有明3-6-11、TFTビル西館2F', 35.630300, 139.789400),
    (84, '横須賀芸術劇場', 'JP_KANAGAWA_YOKOSUKA', '神奈川県横須賀市本町3-27、ベイスクエアよこすか一番館4F', 35.281363, 139.662998),
    (85, '大阪市中央公会堂「大集会室」', 'JP_OSAKA_OSAKA', '大阪府大阪市北区中之島1-1-27', 34.693530, 135.504010),
    (86, '山野ホール', 'JP_TOKYO_WARDS', '東京都渋谷区代々木1-53-1', 35.684194, 139.699406),
    (87, '中野サンプラザホール', 'JP_TOKYO_WARDS', '東京都中野区中野4-1-1', 35.707570, 139.664690),
    (88, '富士急ハイランド・コニファーフォレスト', 'JP_YAMANASHI_FUJIYOSHIDA', '山梨県富士吉田市新西原5-6-1', 35.481650, 138.775380),
    (89, 'ベルサール秋葉原', 'JP_TOKYO_WARDS', '東京都千代田区外神田3-12-8', 35.699920, 139.770960),
    (90, 'ベルーナドーム', 'JP_SAITAMA_TOKOROZAWA', '埼玉県所沢市上山口2135', 35.768500, 139.420500),
    (91, 'コカ・コーラ SUMMER STATION LIVEアリーナ（六本木ヒルズアリーナ）', 'JP_TOKYO_WARDS', '東京都港区六本木6-10-1、六本木ヒルズ', 35.659680, 139.730110),
    (92, 'サイエンスホール（科学技術館）', 'JP_TOKYO_WARDS', '東京都千代田区北の丸公園2-1、科学技術館B2F', 35.691440, 139.752799),
    (93, '名古屋国際会議場センチュリーホール', 'JP_AICHI_NAGOYA', '愛知県名古屋市熱田区熱田西町1-1', 35.132081, 136.898050),
    (94, '新宿LOFT', 'JP_TOKYO_WARDS', '東京都新宿区歌舞伎町1-12-9、タテハナビルB2F', 35.695366, 139.702633),
    (95, 'パシフィコ横浜 展示ホール', 'JP_KANAGAWA_YOKOHAMA', '神奈川県横浜市西区みなとみらい1-1-1', 35.459900, 139.635380),
    (96, '神戸上屋劇場', 'JP_HYOGO_KOBE', '兵庫県神戸市中央区波止場町6-3、甲陽運輸内1F', 34.683692, 135.185164),
    (97, 'ディファ有明', 'JP_TOKYO_WARDS', '東京都江東区有明1-3-25', 35.638722, 139.789222),
    (98, '有明コロシアム', 'JP_TOKYO_WARDS', '東京都江東区有明2-2-22、有明テニスの森公園', 35.636460, 139.790100),
    (99, 'アニメイト新宿', 'JP_TOKYO_WARDS', '東京都新宿区新宿3-17-17', 35.692472, 139.703329),
    (100, 'AKIHABARAゲーマーズ本店', 'JP_TOKYO_WARDS', '東京都千代田区外神田1-14-7', 35.698330, 139.771651),
    (101, '品川ステラボール', 'JP_TOKYO_WARDS', '東京都港区高輪4-10-30、品川プリンスホテル', 35.627775, 139.735481),
    (102, 'Singapore Expo', 'SG_SINGAPORE', '1 Expo Dr, Singapore 486150', 1.334033, 103.958931),
    (103, '名古屋城二之丸広場', 'JP_AICHI_NAGOYA', '愛知県名古屋市中区本丸1-1、名古屋城二之丸広場', 35.184437, 136.901332),
    (104, '池袋サンシャインシティ噴水広場', 'JP_TOKYO_WARDS', '東京都豊島区東池袋3-1-1、サンシャインシティ アルパB1', 35.729097, 139.719089),
    (105, 'EXシアター六本木', 'JP_TOKYO_WARDS', '東京都港区西麻布1-2-9', 35.661210, 139.727270),
    (106, 'Long Beach Convention and Entertainment Center', 'US_CA_LONG_BEACH', '300 E Ocean Blvd, Long Beach, CA 90802', 33.764740, -118.189230),
    (107, 'Suntec Convention & Exhibition Centre', 'SG_SINGAPORE', '1 Raffles Boulevard, Singapore 039593', 1.293600, 103.855000),
    (108, 'インテックス大阪', 'JP_OSAKA_OSAKA', '大阪府大阪市住之江区南港北1-5-102', 34.637250, 135.419930),
    (109, '台北世界貿易中心南港展覽館', 'TW_TAIPEI', '臺北市南港區經貿二路1號（1館）', 25.056500, 121.618090),
    (110, '詩涼子街頭實況攝影棚', 'TW_TAIPEI', '臺北市萬華區成都路6號', 25.041991, 121.507583),
    (111, 'ハウステンボス', 'JP_NAGASAKI_SASEBO', '長崎県佐世保市ハウステンボス町1-1', 33.085936, 129.789883),
    (112, 'MEGABOX DONGDAEMUN', 'KR_SEOUL', 'Good Morning City 9F, 247 Jangchungdan-ro, Jung-gu, Seoul 04564, South Korea', 37.566380, 127.007390),
    (113, 'タワーレコード渋谷店', 'JP_TOKYO_WARDS', '東京都渋谷区神南1-22-14', 35.661890, 139.701095),
    (114, 'マイナビBLITZ赤坂', 'JP_TOKYO_WARDS', '東京都港区赤坂5-3-2', 35.672520, 139.735274),
    (115, 'TSUTAYA IKEBUKURO AKビル店', 'JP_TOKYO_WARDS', '東京都豊島区東池袋1-2-9、池袋AKビル', 35.729750, 139.713800),
    (116, '上海世博展览馆', 'CN_SHANGHAI', '上海市浦东新区国展路1099号', 31.181207, 121.490475),
    (117, 'ベルーナドーム前広場', 'JP_SAITAMA_TOKOROZAWA', '埼玉県所沢市上山口2135、ベルーナドーム', 35.768500, 139.420500),
    (118, '東京ドーム', 'JP_TOKYO_WARDS', '東京都文京区後楽1-3-61', 35.705510, 139.751970),
    (119, 'ZOZOマリンスタジアム', 'JP_CHIBA_CHIBA', '千葉県千葉市美浜区美浜1', 35.645239, 140.030922),
    (120, 'カルッツかわさき', 'JP_KANAGAWA_KAWASAKI', '神奈川県川崎市川崎区富士見1-1-4', 35.529620, 139.708930),
    (121, '台北世貿中心展覽一館', 'TW_TAIPEI', '臺北市信義區信義路五段5號', 25.033765, 121.562380),
    (122, '刈谷市総合文化センター アイリス 大ホール', 'JP_AICHI_KARIYA', '愛知県刈谷市若松町2-104', 34.989255, 137.006893),
    (123, '富士急ハイランド 園内ステージ', 'JP_YAMANASHI_FUJIYOSHIDA', '山梨県富士吉田市新西原5-6-1、富士急ハイランド', 35.485070, 138.778620),
    (125, 'Anaheim Convention Center', 'US_CA_ANAHEIM', '800 W Katella Ave, Anaheim, CA 92802', 33.800570, -117.920720),
    (126, '両国国技館', 'JP_TOKYO_WARDS', '東京都墨田区横網1-3-28', 35.697030, 139.793457),
    (127, 'イオンシネマ板橋', 'JP_TOKYO_WARDS', '東京都板橋区徳丸2-6-1、イオン板橋ショッピングセンター5F', 35.770033, 139.660993),
    (128, 'スペースFS汐留', 'JP_TOKYO_WARDS', '東京都港区東新橋1-1-16、汐留FSビル', 35.665668, 139.760057),
    (129, 'パシフィコ横浜 国立大ホール', 'JP_KANAGAWA_YOKOHAMA', '神奈川県横浜市西区みなとみらい1-1-1', 35.457833, 139.636667),
    (130, '舞浜アンフィシアター', 'JP_CHIBA_URAYASU', '千葉県浦安市舞浜2-50', 35.632606, 139.889169),
    (131, '池袋サンシャインシティ', 'JP_TOKYO_WARDS', '東京都豊島区東池袋3-1-1', 35.729120, 139.719140),
    (132, 'ゲーマーズ新宿店', 'JP_TOKYO_WARDS', '東京都渋谷区代々木2-10-1、新宿サンセイビル4F', 35.688077, 139.698400),
    (133, 'ミクニワールドスタジアム北九州', 'JP_FUKUOKA_KITAKYUSHU', '福岡県北九州市小倉北区浅野3-9-33', 33.891120, 130.888730),
    (134, '清水マリンパーク', 'JP_SHIZUOKA_SHIZUOKA', '静岡県静岡市清水区日の出町', 35.010030, 138.494747),
    (135, 'Zepp Tokyo', 'JP_TOKYO_WARDS', '東京都江東区青海1-3-11', 35.625831, 139.782219),
    (136, '静岡エコパアリーナ', 'JP_SHIZUOKA_FUKUROI', '静岡県袋井市愛野2300-1、エコパ', 34.745520, 137.968410),
    (137, '天王洲銀河劇場', 'JP_TOKYO_WARDS', '東京都品川区東品川2-3-16、シーフォートスクエア2F', 35.623500, 139.751267),
    (139, '神戸芸術センター 芸術劇場', 'JP_HYOGO_KOBE', '兵庫県神戸市中央区熊内橋通7-1-13', 34.704050, 135.198330),
    (140, '広島国際会議場（フェニックスホール）', 'JP_HIROSHIMA_HIROSHIMA', '広島県広島市中区中島町1-5', 34.392083, 132.451028),
    (141, '熊本城ホール シビックホール', 'JP_KUMAMOTO_KUMAMOTO', '熊本県熊本市中央区桜町3-40', 32.800961, 130.704458),
    (142, 'ナディアパークデザインホール', 'JP_AICHI_NAGOYA', '愛知県名古屋市中区栄3-18-1、ナディアパーク', 35.165558, 136.905747),
    (143, '道新ホール', 'JP_HOKKAIDO_SAPPORO', '北海道札幌市中央区大通西3丁目6、道新ビル大通館8F', 43.061413, 141.353256),
    (144, '鴻巣市文化センター(クレアこうのす) 大ホール', 'JP_SAITAMA_KONOSU', '埼玉県鴻巣市中央29-1', 36.067576, 139.522618),
    (145, 'Grand Peace Palace', 'KR_SEOUL', '26 Kyungheedae-ro, Dongdaemun-gu, Seoul 02447, South Korea', 37.598611, 127.052732),
    (146, '國立體育大學綜合體育館（林口體育館）', 'TW_TAOYUAN', '桃園市龜山區文化一路250號', 25.034580, 121.383500),
    (147, 'AsiaWorld-Expo, Hall 10', 'HK_HONG_KONG', '亞洲國際博覽館10號館，香港新界大嶼山香港國際機場航展道1號', 22.321440, 113.943250),
    (148, '万博記念公園', 'JP_OSAKA_SUITA', '大阪府吹田市千里万博公園1-1', 34.810122, 135.527600),
    (149, '東急歌舞伎町タワーステージ', 'JP_TOKYO_WARDS', '東京都新宿区歌舞伎町1-29-1、東急歌舞伎町タワー', 35.695889, 139.700389),
    (150, '烏丸半島芝生広場', 'JP_SHIGA_KUSATSU', '滋賀県草津市下物町1091', 35.074250, 135.935020),
    (151, 'パシフィコ横浜 会議センターメインホール', 'JP_KANAGAWA_YOKOHAMA', '神奈川県横浜市西区みなとみらい1-1-1、会議センター', 35.458330, 139.636390),
    (152, 'Shibuya Hikarie', 'JP_TOKYO_WARDS', '東京都渋谷区渋谷2-21-1', 35.659150, 139.703970),
    (153, 'Spotify O-WEST', 'JP_TOKYO_WARDS', '東京都渋谷区円山町2-3、2F', 35.658480, 139.695320),
    (154, '大手町三井ホール', 'JP_TOKYO_WARDS', '東京都千代田区大手町1-2-1、Otemachi One 3F', 35.687847, 139.762453),
    (155, 'KINTEX HALL', 'KR_GYEONGGI_GOYANG', 'KINTEX 2, 217-59 Kintex-ro, Ilsanseo-gu, Goyang-si, Gyeonggi-do 10390, South Korea', 37.666060, 126.741905),
    (156, '仙台サンプラザホール', 'JP_MIYAGI_SENDAI', '宮城県仙台市宮城野区榴岡5-11-1', 38.257720, 140.894070);

DO $block$
BEGIN
    IF (SELECT count(*) FROM _venue_location_backfill) <> 153 THEN
        RAISE EXCEPTION 'Expected 153 reviewed venue rows';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM _venue_location_backfill backfill
        LEFT JOIN public.venue_list venue
          ON venue.id = backfill.venue_id
         AND venue.venue = backfill.expected_venue
        WHERE venue.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Venue ID/name precondition failed';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM _venue_location_backfill backfill
        JOIN public.venue_list venue ON venue.id = backfill.venue_id
        WHERE venue.venue_kind <> 'physical'
           OR venue.merged_into_venue_id IS NOT NULL
           OR venue.locality_id IS NOT NULL
           OR venue.address IS NOT NULL
           OR venue.latitude IS NOT NULL
           OR venue.longitude IS NOT NULL
           OR venue.timezone_id IS NOT NULL
           OR venue.location_verified_at IS NOT NULL
           OR venue.location_revision <> 1
    ) THEN
        RAISE EXCEPTION 'Venue location state changed; regenerate and review the backfill';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM _locality_backfill source
        JOIN public.geo_localities locality
          ON locality.country_code = source.country_code
         AND locality.admin_area IS NOT DISTINCT FROM source.admin_area
         AND locality.locality_name = source.locality_name
        GROUP BY source.locality_key
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate locality rows already exist';
    END IF;
END
$block$;

INSERT INTO public.geo_localities (country_code, admin_area, locality_name, timezone_id)
SELECT source.country_code, source.admin_area, source.locality_name, source.timezone_id
FROM _locality_backfill source
WHERE NOT EXISTS (
    SELECT 1
    FROM public.geo_localities locality
    WHERE locality.country_code = source.country_code
      AND locality.admin_area IS NOT DISTINCT FROM source.admin_area
      AND locality.locality_name = source.locality_name
);

DO $block$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM _locality_backfill source
        LEFT JOIN public.geo_localities locality
          ON locality.country_code = source.country_code
         AND locality.admin_area IS NOT DISTINCT FROM source.admin_area
         AND locality.locality_name = source.locality_name
         AND locality.timezone_id = source.timezone_id
        GROUP BY source.locality_key
        HAVING count(locality.id) <> 1
    ) THEN
        RAISE EXCEPTION 'Locality resolution or timezone precondition failed';
    END IF;
END
$block$;

UPDATE public.venue_list venue
SET locality_id = locality.id,
    address = backfill.address,
    latitude = backfill.latitude,
    longitude = backfill.longitude,
    timezone_id = NULL,
    location_revision = venue.location_revision + 1,
    location_verified_at = transaction_timestamp()
FROM _venue_location_backfill backfill
JOIN _locality_backfill source ON source.locality_key = backfill.locality_key
JOIN public.geo_localities locality
  ON locality.country_code = source.country_code
 AND locality.admin_area IS NOT DISTINCT FROM source.admin_area
 AND locality.locality_name = source.locality_name
 AND locality.timezone_id = source.timezone_id
WHERE venue.id = backfill.venue_id;

DO $block$
BEGIN
    IF (
        SELECT count(*)
        FROM _venue_location_backfill backfill
        JOIN public.venue_list venue ON venue.id = backfill.venue_id
        JOIN public.geo_localities locality ON locality.id = venue.locality_id
        JOIN _locality_backfill source ON source.locality_key = backfill.locality_key
        WHERE venue.address = backfill.address
          AND venue.latitude = backfill.latitude
          AND venue.longitude = backfill.longitude
          AND venue.timezone_id IS NULL
          AND venue.location_revision = 2
          AND venue.location_verified_at IS NOT NULL
          AND locality.country_code = source.country_code
          AND locality.admin_area IS NOT DISTINCT FROM source.admin_area
          AND locality.locality_name = source.locality_name
          AND locality.timezone_id = source.timezone_id
    ) <> 153 THEN
        RAISE EXCEPTION 'Venue location postcondition failed';
    END IF;
END
$block$;

INSERT INTO public.audit_logs
    (user_id, action, resource_type, resource_id, payload_json)
SELECT
    NULL,
    'venue_location_update',
    'venue',
    backfill.venue_id::text,
    jsonb_build_object(
        'source', 'editor_verified_wgs84_backfill',
        'locality_id', venue.locality_id,
        'address', venue.address,
        'latitude', venue.latitude,
        'longitude', venue.longitude,
        'timezone_id', venue.timezone_id,
        'effective_timezone_id', locality.timezone_id,
        'location_revision', venue.location_revision,
        'location_verified_at', venue.location_verified_at
    )
FROM _venue_location_backfill backfill
JOIN public.venue_list venue ON venue.id = backfill.venue_id
JOIN public.geo_localities locality ON locality.id = venue.locality_id;

INSERT INTO public.audit_logs
    (user_id, action, resource_type, resource_id, payload_json)
VALUES (
    NULL,
    'venue_location_backfill',
    'venue_collection',
    '2026-09-11',
    jsonb_build_object(
        'venue_count', 153,
        'locality_count', (SELECT count(*) FROM _locality_backfill),
        'coordinate_system', 'WGS84',
        'live_timezone_snapshots_updated', 0
    )
);

RESET ROLE;
COMMIT;
