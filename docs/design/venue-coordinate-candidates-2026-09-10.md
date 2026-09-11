# Venue 坐标回填台账

- 开始日期：2026-09-10
- 范围：本地 `live_statistic` 的 153 个实体 Venue。
- 目的：提供可用于地图上大致定位 Venue 的坐标回填资料；已写入本地主库，尚未建立地图平台详情关联，也不会修改任何 Live 的时区快照。
- 坐标基准：WGS84。
- 定位语义：坐标表示 Venue 实体在地图上直接搜索得到的地点点位。独立建筑采用建筑地点点位；大型园区、公园、会展中心或多厅设施采用地图返回的入口或中心点。它不表示每场 Live 的舞台、楼层、检票口或交通到达点。
- 历史语义：已迁址或关闭的 Venue 使用对应 Live 发生时的历史旧址；同名实体必须结合 Live 与地址消歧。
- 地址语义：“官方地址／实体核验”列只保存可直接展示和搜索的地址正文，以及必要的楼宇、楼层或馆区信息；来源可信度、历史状态和核验过程只写入“坐标来源”与“定位说明”，不得混入回填地址。
- 地址语言：日本使用日语，中国大陆使用简体中文，台湾／香港使用繁体中文，其余国家一律使用英文；不因当地官方语言另行切换。
- 回填边界：表中“可回填”表示 venue_list.latitude / longitude 的 Venue 级定位可采用；地址、locality_id 和 IANA 时区按配套 SQL 一并维护，地图平台地点关联仍需另行维护。本台账本身不是远程执行授权。
- 覆盖审计（2026-09-11，修订）：153/153 个实体 Venue 均有可回填的 WGS84 Venue 级坐标。除既有的駒場公園、Zepp Osaka Bayside 修正外，本轮又修正愛知県芸術劇場、飯田橋场地、NAGOYA CLUB QUATTRO、TSUTAYA IKEBUKURO AKビル店和 Zepp Tokyo 的明显错位点；园区／多厅／楼内场馆按上述定位语义采用设施点。
- 回填准备（2026-09-11）：地址栏已补齐为 153/153；结构化回填将场馆映射到 43 个城市／地区和 8 个 IANA 时区。
- 回填 SQL：[2026-09-11__backfill_verified_venue_locations.sql](../../backend/db/postgres/backfill/2026-09-11__backfill_verified_venue_locations.sql)。已于 2026-09-12 在本地主库执行并验证；随后由用户在远程执行并将远程备份恢复到本地。本轮只读复核恢复后的本地库：153/153 个实体 Venue 位置资料完整、43 个城市覆盖 8 个 IANA 时区、594 条既有 Live 仍为 `legacy_offset`、`venue_map_links` 为 0。SQL 不会修改既有 Live 时区快照。

| Venue ID | 场馆 | 官方地址／实体核验 | Venue 级 WGS84 坐标 | 坐标来源 | 结论 | 定位说明 |
| ---: | --- | --- | --- | --- | --- | --- |
| 24 | 東京ガーデンシアター | 東京都江東区有明2-1-6 | 35.637730, 139.792040 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W1357127331) | 可回填 | 采用 OSM 建筑点作 Venue 级定位；Wikidata 建筑点相差约 55m，在本用途下属于同一场馆。 |
| 42 | 東京ビッグサイト | 東京都江東区有明3-11-1 | 35.630161, 139.793739 | [东京 Big Sight 官方地址](https://www.bigsight.jp/visitor/access/)；[Wikidata Q3465013](https://www.wikidata.org/wiki/Q3465013) | 可回填 | 采用东京 Big Sight 建筑群中心点；东/西/南展示栋差异不写入地址。 |
| 89 | ベルサール秋葉原 | 東京都千代田区外神田3-12-8 | 35.699920, 139.770960 | [OpenStreetMap/Mapcarta](https://mapcarta.com/N4865721302) | 可回填 | 官方地址与 OSM 场馆地点一致，采用该地点点位。 |
| 35 | 幕張メッセ 国際展示場ホール | 千葉県千葉市美浜区中瀬2-1 | 35.648333, 140.034722 | [Wikimedia Commons 的幕张展览馆条目](https://commons.wikimedia.org/wiki/Category:Makuhari_Messe) | 可回填 | 当前 Venue 未细分 1–8、9–11 等厅，采用国际展示场复合设施点作 Venue 级定位。 |
| 1 | さいたまスーパーアリーナ | 埼玉県さいたま市中央区新都心8 | 35.894889, 139.630831 | [Wikidata Q1052149](https://www.wikidata.org/wiki/Q1052149) | 可回填 | 官方地址与场馆实体一致；坐标由 Wikidata DMS 转换。 |
| 3 | 有明アリーナ | 東京都江東区有明1-11-1 | 35.643430, 139.794400 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W746064107) | 可回填 | 官方地址与 OSM 建筑要素一致。 |
| 52 | 飛行船シアター | 東京都台東区東上野4-24-11 | 35.715561, 139.782013 | [Google Maps 场馆点](https://www.google.com/maps/place/HIKOSEN+Theater/@35.7155608,139.7820131,17z) | 可回填 | Google Maps 直接以 HIKOSEN Theater 返回场馆点；按数据库字段精度四舍五入至 6 位小数。 |
| 88 | 富士急ハイランド・コニファーフォレスト | 山梨県富士吉田市新西原5-6-1 | 35.481650, 138.775380 | [OpenStreetMap/Mapcarta 场馆点](https://mapcarta.com/N5921953885) | 可回填 | 采用地图直接搜索“コニファーフォレスト”返回的独立设施点，不采用富士急ハイランド园区中心。 |
| 23 | 神戸ワールド記念ホール | 兵庫県神戸市中央区港島中町6-12-2 | 34.663950, 135.210150 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W182322091) | 可回填 | 官方地址与 OSM 建筑要素一致。 |
| 36 | Kanadevia Hall | 東京都文京区後楽1-3-61、MEETS PORT 1F | 35.703300, 139.754600 | [官方交通页](https://www.tokyo-dome.co.jp/tdc-hall/access/)；[地图候选](https://tixvoy.com/ja/venues/kanadevia-hall) | 可回填 | 2025-04 由 TOKYO DOME CITY HALL 更名；采用承载场馆的 MEETS PORT 建筑点。 |
| 9 | Zepp Osaka Bayside | 大阪府大阪市此花区桜島1-1-61 | 34.662010, 135.434860 | [Zepp 官方交通页](https://www.zepp.co.jp/hall/osakabayside/)；[OpenStreetMap/Mapcarta 建筑点](https://mapcarta.com/W497899204) | 可回填 | 修正原 TIXVOY 候选的约 861m 偏差；采用名称、地址均匹配的 OSM 场馆建筑点。 |
| 28 | Zepp Nagoya | 愛知県名古屋市中村区平池町4-60-7 | 35.163362, 136.884742 | [Zepp 官方场馆页](https://www.zepp.co.jp/hall/nagoya/)；[MapFan 世界测地系场馆点](https://mapfan.com/spots/SC3AH%2CJ%2C2F0) | 可回填 | 采用 MapFan 直接搜索 Zepp Nagoya 返回的场馆点；与 Wikidata 点仅有数米差异。 |
| 6 | 京王アリーナTOKYO | 東京都調布市西町290-11 | 35.665140, 139.524400 | [官方交通页](https://keio-arena.tokyo/access/)；[OSM 地图点](https://mapcarta.com/W991627480) | 可回填 | 场馆建筑要素，与相邻味之素体育场分离。 |
| 11 | 千葉市蘇我スポーツ公園 | 千葉県千葉市中央区川崎町1-20 | 35.574790, 140.124264 | [NAVITIME 地点页](https://www.navitime.co.jp/poi?spot=02064-2163) | 可回填 | 采用地图返回的公园地点点位；Live 标题中的不同 Festival Stage 不在 Venue 坐标层表达。 |
| 29 | Zepp Haneda (TOKYO) | 東京都大田区羽田空港1-1-4、HANEDA INNOVATION CITY ZONE H | 35.549400, 139.779800 | [TIXVOY 场馆页](https://tixvoy.com/en/venues/zepp-haneda) | 可回填 | 采用 HANEDA INNOVATION CITY ZONE H 内的场馆地点点位；具体入口不在本字段表达。 |
| 137 | 天王洲銀河劇場 | 東京都品川区東品川2-3-16、シーフォートスクエア2F | 35.623500, 139.751267 | [官方交通页](https://www.gingeki.jp/access)；[MapFan 世界测地系](https://mapfan.com/spots/SC3AH%2CJ%2CTT) | 可回填 | 楼宇内剧场，坐标为场馆点；实际入口按活动复核。 |
| 12 | 日本武道館 | 東京都千代田区北の丸公園2-3 | 35.693360, 139.749870 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W43896730) | 可回填 | 官方地址与 OSM 场馆建筑要素一致。 |
| 13 | 横浜アリーナ | 神奈川県横浜市港北区新横浜3-10 | 35.512270, 139.620190 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W123630243) | 可回填 | 官方地址与 OSM 场馆建筑要素一致。 |
| 18 | KT Zepp Yokohama | 神奈川県横浜市西区みなとみらい4-3-6 | 35.459750, 139.625910 | [Zepp 官方场馆页](https://www.zepp.co.jp/hall/yokohama/)；[OSM 地图点](https://mapcarta.com/W827816737) | 可回填 | OSM theatre 建筑要素与官方地址一致。 |
| 21 | TACHIKAWA STAGE GARDEN | 東京都立川市緑町3-3 N1 | 35.704805, 139.411841 | [MapFan 地点页](https://mapfan.com/spots/SC3AH%2CJ%2C8M0) | 可回填 | 官方地址与地图地点一致。 |
| 130 | 舞浜アンフィシアター | 千葉県浦安市舞浜2-50 | 35.632606, 139.889169 | [场馆官方资料](https://www.maihama-amphitheater.jp/facilities/)；[MapFan 世界测地系](https://mapfan.com/spots/SC3AH%2CJ%2C3Z0) | 可回填 | 场馆建筑级地图点，与官方地址一致。 |
| 10 | 国家会展中心（上海）虹馆EH | 上海市青浦区崧泽大道333号，国家会展中心（上海）虹馆EH | 31.192892, 121.300132 | [国家会展中心（上海）官方交通页](https://www.neccsh.com/cecsh/traffic) | 可回填 | 国家会展中心园区级点位；虹馆 EH 属园区内展馆，地址保留馆区信息。 |
| 15 | Zepp DiverCity (TOKYO) | 東京都江東区青海1-1-10、ダイバーシティ東京 プラザ | 35.625400, 139.775600 | [Zepp 官方场馆页](https://www.zepp.co.jp/hall/divercity/)；[地图候选](https://tixvoy.com/en/venues/zepp-divercity-tokyo) | 可回填 | 商场内二层场馆，采用场馆级点位；具体入口不在本字段表达。 |
| 25 | 梅赛德斯-奔驰文化中心 | 上海市浦东新区世博大道1200号 | 31.191291, 121.489391 | [场馆官方交通页](https://www.mercedes-benzarena.com/trafficguide.html)；[MusicBrainz 场馆点](https://musicbrainz.org/place/d4ab6072-a4e3-4bc0-a3be-8e24b9d1e559) | 可回填 | 地址改用场馆官方门牌；坐标采用 MusicBrainz WGS84 场馆点。 |
| 31 | SGC HALL ARIAKE | 東京都江東区有明3-3-8、TOKYO DREAM PARK 1F | 35.634000, 139.788000 | [场馆官方页](https://tdp.tv-asahi.co.jp/hall/)；[Google Maps 场馆搜索](https://www.google.com/maps/search/SGC%20HALL%20ARIAKE%20%E6%9D%B1%E4%BA%AC%E9%83%BD)；[坐标资料](https://tixvoy.com/en/venues/sgc-hall-ariake) | 可回填 | 官方地址、Google Maps 场馆实体与坐标资料一致；采用场馆级点位。 |
| 34 | ぴあアリーナMM | 神奈川県横浜市西区みなとみらい3-2-2 | 35.455820, 139.628430 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W543069456) | 可回填 | 官方地址与 OSM 场馆建筑要素一致。 |
| 60 | 国営ひたち海浜公園 | 茨城県ひたちなか市馬渡字大沼605-4 | 36.402500, 140.594300 | [TIXVOY 场馆页](https://tixvoy.com/ja/venues/hitachi-seaside-park) | 可回填 | 采用地图返回的公园地点点位；不同年份 Festival Stage 的位置不在 Venue 坐标层表达。 |
| 61 | GARDEN 新木場 FACTORY | 東京都江東区新木場2-8-2 | 35.638599, 139.827756 | [OpenStreetMap 建筑](https://www.openstreetmap.org/way/170624596) | 可回填 | OSM 的 GARDEN SHINKIBA FACTORY 建筑要素。 |
| 113 | タワーレコード渋谷店 | 東京都渋谷区神南1-22-14 | 35.661890, 139.701095 | [门店官方资料](https://tower.jp/store/kanto/Shibuya%C2%A0/)；[OSM Nominatim 地图点](https://nominatim.openstreetmap.org/ui/search.html?q=Tower+Records+Shibuya) | 可回填 | OSM 建筑要素与官方地址一致；店内活动区无需单列坐标。 |
| 131 | 池袋サンシャインシティ | 東京都豊島区東池袋3-1-1 | 35.729120, 139.719140 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W250938764) | 可回填 | 复合商业设施；若实际演出在喷泉广场等子场地，应创建或选择子场馆。 |
| 14 | Kアリーナ横浜 | 神奈川県横浜市西区みなとみらい6-2-14 | 35.464710, 139.630720 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W934667675) | 可回填 | OSM 建筑要素返回场馆点。 |
| 20 | 国家会展中心（上海） | 上海市青浦区崧泽大道333号 | 31.191680, 121.297520 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W345301248) | 可回填 | 当前 Venue 表示整个展馆，采用复合设施点；虹馆 EH 等具体 Venue 使用各自坐标。 |
| 26 | Zepp Fukuoka | 福岡県福岡市中央区地行浜2-2-1 | 33.600700, 130.378600 | [TIXVOY 场馆页](https://tixvoy.com/en/venues/zepp-fukuoka) | 可回填 | 采用地图直接搜索场馆返回的地点点位；具体入口不在本字段表达。 |
| 48 | 幕張メッセ イベントホール | 千葉県千葉市美浜区中瀬2-1 | 35.648230, 140.034700 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W242014403) | 可回填 | 与国际展示厅分离的独立建筑。 |
| 59 | duo MUSIC EXCHANGE | 東京都渋谷区道玄坂2-14-8、O-EASTビル1F | 35.658715, 139.695526 | [OpenStreetMap 点](https://www.openstreetmap.org/node/2214619702) | 可回填 | OSM 场馆节点，名称与道玄坂 2-14-8 地址一致。 |
| 70 | LINE CUBE SHIBUYA | 東京都渋谷区宇田川町1-1 | 35.664100, 139.698530 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W397183780) | 可回填 | OSM 场馆建筑要素返回场馆点。 |
| 107 | Suntec Convention & Exhibition Centre | 1 Raffles Boulevard, Singapore 039593 | 1.293600, 103.855000 | [场馆资料](https://kiwi.itspektar.net/content/wikipedia_en_all_maxi/A/Suntec_Singapore_Convention_and_Exhibition_Centre) | 可回填 | 会展中心内活动厅位待进一步细分。 |
| 27 | Zepp Namba | 大阪府大阪市浪速区敷津東2-1-39 | 34.655900, 135.505000 | [TIXVOY 场馆页](https://tixvoy.com/en/venues/zepp-namba-osaka) | 可回填 | 采用地图直接搜索场馆返回的地点点位；具体入口不在本字段表达。 |
| 43 | 松下IMPホール | 大阪府大阪市中央区城見1-3-7、松下IMPビル2F | 34.691720, 135.530690 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W42031164) | 可回填 | 楼宇内厅馆，候选为建筑点。 |
| 51 | 日経ホール | 東京都千代田区大手町1-3-7、日経ビル3F | 35.688741, 139.762330 | [MapFan 地点页](https://mapfan.com/spots/SC3AH%2CJ%2C0C) | 可回填 | 地点页直接返回大厅点。 |
| 62 | Zepp Sapporo | 北海道札幌市中央区南9条西4-4 | 43.049350, 141.353170 | [OpenStreetMap/Mapcarta](https://mapcarta.com/N5603040046) | 可回填 | 官方地址与 OSM 场馆点一致。 |
| 69 | ところざわサクラタウン ジャパンパビリオン ホールA | 埼玉県所沢市東所沢和田3-31-3、ところざわサクラタウン | 35.797194, 139.506833 | [Sakura Town 坐标资料](https://please.untaint.us/?url=https%3A%2F%2Fja.wikipedia.org%2Fwiki%2F%E3%81%A8%E3%81%93%E3%82%8D%E3%81%96%E3%82%8F%E3%82%B5%E3%82%AF%E3%83%A9%E3%82%BF%E3%82%A6%E3%83%B3%23%E9%9B%86%E5%AE%A2%E3%82%A8%E3%83%AA%E3%82%A2)；[日本国家旅游局](https://www.japan.travel/en/spot/2085/) | 可回填 | 官方资料确认 Japan Pavilion 位于该园区；采用 Sakura Town 园区地点点位，Hall A 入口不在本字段表达。 |
| 76 | 六本木BIGHOUSE | 東京都港区六本木5-18-2、大昌第二ビルB1F | 35.661249, 139.737251 | [Ticket Pia 场馆地址](https://t.pia.jp/pia/venue/venue.do?venueCd=RPBH)；[Google Maps 地址检索](https://www.google.com/maps/search/?api=1&query=%E5%A4%A7%E6%98%8C%E7%AC%AC2%E3%83%93%E3%83%AB%20%E5%85%AD%E6%9C%AC%E6%9C%A85-18-2) | 可回填 | Google Maps 对“大昌第2ビル 六本木5-18-2”的建筑中心点；六本木BIGHOUSE 位于 B1。 |
| 80 | 大阪城ホール | 大阪府大阪市中央区大阪城3-1 | 34.689681, 135.530106 | [MapFan 地点页](https://mapfan.com/spots/SC3A3%2CJ%2CI0) | 可回填 | 地点页直接返回大厅点。 |
| 90 | ベルーナドーム | 埼玉県所沢市上山口2135 | 35.768500, 139.420500 | [TheSportsDB 场馆资料](https://www.thesportsdb.com/venue/22938-belluna-dome) | 可回填 | 公开场馆资料与历史名称西武巨蛋相符。 |
| 100 | AKIHABARAゲーマーズ本店 | 東京都千代田区外神田1-14-7 | 35.698330, 139.771651 | [NAVITIME 地点页](https://www.navitime.co.jp/poi?spot=91001-ani00064) | 可回填 | 地点页直接返回门店点。 |
| 108 | インテックス大阪 | 大阪府大阪市住之江区南港北1-5-102 | 34.637250, 135.419930 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W493551116/Map) | 可回填 | 多展厅复合设施，候选仅为总体点。 |
| 2 | 愛知県芸術劇場 大ホール | 愛知県名古屋市東区東桜1-13-2 | 35.170862, 136.911267 | [爱知县艺术剧场官方设施页](https://www-stage.aac.pref.aichi.jp/facility/main.html)；[MapFan 建筑点](https://mapfan.com/spots/SC3AH%2CJ%2C27) | 可回填 | 官方地址与 MapFan 世界测地系建筑点一致；原坐标误落在名古屋市役所附近。 |
| 4 | 河口湖ステラシアター | 山梨県南都留郡富士河口湖町船津5577 | 35.480260, 138.759710 | [Mapcarta 场馆点](https://mapcarta.com/33942394) | 可回填 | 官方地址与地点名称一致。 |
| 37 | COOL JAPAN PARK OSAKA WWホール | 大阪府大阪市中央区大阪城3-6 | 34.684700, 135.533700 | [场馆官方资料](https://cjpo.jp/theater/)；[WW Hall 地图候选](https://tixvoy.com/en/venues/cool-japan-park-osaka-ww-hall) | 可回填 | 已定位至 WW Hall；与综合设施中心点相近，入口按活动复核。 |
| 44 | Zepp New Taipei | 新北市新莊區新北大道四段3號8樓 | 25.059680, 121.449570 | [新北市开放资料](https://media.taiwan.net.tw/zh-tw/portal/travel/details/attraction_382000000a_403749) | 可回填 | 官方开放资料直接提供场馆坐标。 |
| 58 | 駒場公園 | 長野県佐久市猿久保字丸山55 | 36.254864, 138.485756 | [佐久市官方场馆页](https://www.city.saku.nagano.jp/shisetsu/koen/saku/komaba.html)；[佐久市公园开放数据](https://linkdata.org/work/rdf1s847i/saku_parklist.html) | 可回填 | 数据库中的 Live 均为ナガノアニエラフェスタ，实际场地是佐久市駒場公園；已修正原先误选的东京同名公园。采用公园开放数据点作 Venue 级定位。 |
| 73 | Zepp Shinjuku (TOKYO) | 東京都新宿区歌舞伎町1-29-1、東急歌舞伎町タワーB1-B4F | 35.695580, 139.700770 | [OpenStreetMap/Mapcarta](https://mapcarta.com/N11045809946) | 可回填 | OSM 返回场馆点。 |
| 95 | パシフィコ横浜 展示ホール | 神奈川県横浜市西区みなとみらい1-1-1 | 35.459900, 139.635380 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W45537786) | 可回填 | 展示厅群；具体公演可能在 Hall A/B/C。 |
| 125 | Anaheim Convention Center | 800 W Katella Ave, Anaheim, CA 92802 | 33.800570, -117.920720 | [OpenStreetMap/Mapcarta](https://mapcarta.com/22993306) | 可回填 | 复合会展中心，候选为设施点。 |
| 19 | 浦发银行东方体育中心 | 上海市浦东新区泳耀路300号 | 31.159567, 121.472869 | [场馆资料](https://zh.wikipedia.org/wiki/%E4%B8%8A%E6%B5%B7%E4%B8%9C%E6%96%B9%E4%BD%93%E8%82%B2%E4%B8%AD%E5%BF%83)；[WGS84 坐标资料](https://hackcn.de/wiki/%E4%B8%8A%E6%B5%B7%E4%B8%9C%E6%96%B9%E4%BD%93%E8%82%B2%E4%B8%AD%E5%BF%83) | 可回填 | 为浦发银行东方体育中心主场馆级坐标；未采用高德坐标。 |
| 22 | LaLa arena TOKYO-BAY | 千葉県船橋市浜町2-5-15 | 35.683840, 139.989700 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W1348400191) | 可回填 | 官方地址与 OSM 建筑要素一致。 |
| 30 | 下北沢GARDEN | 東京都世田谷区北沢2-4-5、mosia B1F | 35.659268, 139.671558 | [世田谷音乐资料](https://www.setagayamusic-pd.com/image/info/04/04setagaya_paper_p20-p25.pdf)；[Google Maps 地址检索](https://www.google.com/maps/search/?api=1&query=%E4%B8%8B%E5%8C%97%E6%B2%A2GARDEN%20%E5%8C%97%E6%B2%A22-4-5) | 可回填 | Google Maps 对历史地址 北沢2-4-5 mosia B1F 的建筑中心点；场馆已关闭，不作为现存场馆详情。 |
| 33 | TOYOTA ARENA TOKYO | 東京都江東区青海1-3-1 | 35.626560, 139.782650 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W328162164) | 可回填 | 官方地址与 OSM 场馆要素一致。 |
| 40 | LOFT/PLUSONE | 東京都新宿区歌舞伎町1-14-7、林ビルB2F | 35.694596, 139.702177 | [场馆官方交通页](https://www.loft-prj.co.jp/schedule/plusone/access)；[建筑地图点](https://host-work.com/tokyo/a7/shopcd1886/map/) | 可回填 | LOFT/PLUS ONE 位于林大楼 B2；建筑点与官方地址一致。 |
| 41 | 大佳河濱公園 | 臺北市中山區濱江街5號 | 25.076000, 121.535000 | [Dajia Riverside Park 资料](https://wiki.arcsnet.dev/content/wikipedia_en_all_maxi_2026-02/Dajia_Riverside_Park) | 可回填 | 采用地图返回的河滨公园地点点位；每次活动布置不在 Venue 坐标层表达。 |
| 49 | 朝日生命ホール | 大阪府大阪市中央区高麗橋4-2-16 | 34.689800, 135.500310 | [OpenStreetMap/Mapcarta](https://mapcarta.com/N5993409162) | 可回填 | OSM 返回剧场点。 |
| 50 | Lives NAGOYA | 愛知県名古屋市港区金城ふ頭2-7-1、Maker's Pier | 35.050000, 136.846916 | [名古屋官方场馆资料](https://www.nagoya-info.jp/location/search/detail/187/)；[Maker’s Pier 地址坐标](https://www.tokuinfo.com/gourmet/23/2/gaafmvgbbe.htm) | 可回填 | 官方确认 Lives NAGOYA 在 Maker’s Pier 内；采用同门牌园区地图商户点作 Venue 级定位。 |
| 54 | 代官山UNIT | 東京都渋谷区恵比寿西1-34-17、ZaHOUSEビルB2F | 35.647112, 139.702325 | [Wikimedia Commons 地理标记照片](https://commons.wikimedia.org/wiki/File:Daikanyama_UNIT_in_TOKYO_JAPAN.jpg)；[场馆资料](https://www.tokyoclubs.info/en/clubs/daikanyama-unit/) | 可回填 | 照片拍摄点位于承载 UNIT 的 The House Building 外，适合作为建筑级候选点。 |

| 56 | 学校跡地の飯田橋でっかいレンタルスペース | 東京都新宿区揚場町2-28 | 35.702144, 139.740455 | [场馆官方交通页](https://mrdekkai.com/map/) | 可回填 | 地址取自官方交通页，坐标取其嵌入 Google 地图的建筑点；原坐标误落在文京区春日附近。 |
| 57 | イイノホール | 東京都千代田区内幸町2-1-1 | 35.670980, 139.750627 | [MusicBrainz 场馆资料](https://musicbrainz.org/place/b2169554-6bbd-408a-ac21-615207842cff/map) | 可回填 | 单一剧场点；待以官方地图嵌入或 OSM 复核。 |
| 68 | 豊洲PIT | 東京都江東区豊洲6-1-23 | 35.649680, 139.788310 | [OpenStreetMap/Mapcarta](https://mapcarta.com/N5290907221) | 可回填 | OSM theatre 节点，与官方地址一致。 |
| 71 | 新都市ホール | 神奈川県横浜市西区高島2-18-1、横浜新都市ビル9F | 35.465421, 139.625109 | [MapFan](https://mapfan.com/spots/S54IA%2CJ%2CTF5UI0) | 可回填 | 楼内会场，候选为楼宇定位点；官方地址一致。 |
| 79 | 中池袋公園 | 東京都豊島区東池袋1-16-1 | 35.731500, 139.715000 | [丰岛区官方设施页](https://www.city.toshima.lg.jp/340/shisetsu/koen/020.html)；[地图资料](https://visual.information.jp/geography/map/pl99217/) | 可回填 | 采用地图返回的公园地点点位；活动舞台不在 Venue 坐标层表达。 |

| 81 | カナモトホール(札幌市民ホール) | 北海道札幌市中央区北1条西1丁目 | 43.062180, 141.355540 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W155589932) | 可回填 | OSM 场馆要素与官网地址一致。 |
| 82 | 福岡サンパレス | 福岡県福岡市博多区築港本町2-1 | 33.603870, 130.402320 | [OpenStreetMap/Mapcarta](https://mapcarta.com/32812640) | 可回填 | 酒店与演出厅复合体；候选为建筑点。 |
| 83 | TFTホール 1000 | 東京都江東区有明3-6-11、TFTビル西館2F | 35.630300, 139.789400 | [TFT 官方资料](https://www.bigsight.jp/english/organizer/buildings/tft/pdf/brochure_tft.pdf)；[地图候选](https://cosermap.com/anime/reunion) | 可回填 | 官方资料确认 HALL 1000 在 TFT 西馆；坐标为该西馆建筑级候选点。 |
| 86 | 山野ホール | 東京都渋谷区代々木1-53-1 | 35.684194, 139.699406 | [场馆资料](https://sogotokyo.com/live_place/detail/214)；[带 GPS 的场馆照片](https://commons.wikimedia.org/wiki/File%3AYamano_Hall.jpg) | 可回填 | 场馆建筑级坐标，与地址一致。 |

| 91 | コカ・コーラ SUMMER STATION LIVEアリーナ（六本木ヒルズアリーナ） | 東京都港区六本木6-10-1、六本木ヒルズ | 35.659680, 139.730110 | [Google Maps](https://www.google.com/maps/search/%E5%85%AD%E6%9C%AC%E6%9C%A8%E3%83%92%E3%83%AB%E3%82%BA%E3%82%A2%E3%83%AA%E3%83%BC%E3%83%8A)；[GPS 资料](https://japan.worldplaces.me/review/230526187-roppongi-hills-arena.html) | 可回填 | 六本木 Hills Arena 场地坐标。 |
| 92 | サイエンスホール（科学技術館） | 東京都千代田区北の丸公園2-1、科学技術館B2F | 35.691440, 139.752799 | [NAVITIME](https://www.navitime.co.jp/poi?spot=02022-93999)；[科学技术馆官方](https://event-jsf.jp/facility) | 可回填 | 楼内 B2F 会场，候选为建筑点；官方确认同址。 |
| 93 | 名古屋国際会議場センチュリーホール | 愛知県名古屋市熱田区熱田西町1-1 | 35.132081, 136.898050 | [Wikimedia Commons 设施坐标](https://commons.wikimedia.org/wiki/Category%3ANagoya_Congress_Center)；[会场官方](https://nagoya-congress-center.jp/facility/century_hall/) | 可回填 | 采用会展中心园区设施点；指定厅楼层不在本字段表达。 |
| 98 | 有明コロシアム | 東京都江東区有明2-2-22、有明テニスの森公園 | 35.636460, 139.790100 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W149130179) | 可回填 | OSM 体育馆建筑要素。 |

| 101 | 品川ステラボール | 東京都港区高輪4-10-30、品川プリンスホテル | 35.627775, 139.735481 | [TIXVOY 场馆页](https://tixvoy.com/ja/venues/shinagawa-stella-ball)；[MapFan 世界测地系](https://mapfan.com/spots/SC3AH%2CJ%2CEN0) | 可回填 | 场馆建筑级坐标，与酒店综合体其他设施区分。 |
| 106 | Long Beach Convention and Entertainment Center | 300 E Ocean Blvd, Long Beach, CA 90802 | 33.764740, -118.189230 | [OpenStreetMap/Mapcarta](https://mapcarta.com/23081558) | 可回填 | 采用多场馆园区地点点位；具体 Live 厅不在 Venue 坐标层表达。 |
| 118 | 東京ドーム | 東京都文京区後楽1-3-61 | 35.705510, 139.751970 | [OpenStreetMap/Mapcarta](https://mapcarta.com/29355332) | 可回填 | OSM 体育场建筑要素。 |

| 126 | 両国国技館 | 東京都墨田区横網1-3-28 | 35.697030, 139.793457 | [MapFan](https://mapfan.com/spots/SCCQ4%2CJ%2C8WE) | 可回填 | 地图服务 WGS84 点，与官方地址一致。 |
| 133 | ミクニワールドスタジアム北九州 | 福岡県北九州市小倉北区浅野3-9-33 | 33.891120, 130.888730 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W88460004)；[官方场馆资料](https://league-one.jp/stadium/37) | 可回填 | OSM 体育场要素与官方地址一致。 |
| 135 | Zepp Tokyo | 東京都江東区青海1-3-11 | 35.625831, 139.782219 | [Wikidata Q83202611](https://www.wikidata.org/wiki/Q83202611)；[东京都文化设施资料](https://www.seikatubunka.metro.tokyo.lg.jp/bunka/bunka_seisaku/houshin_torikumi/files/0000000823/hall.pdf) | 可回填 | 地址和坐标均为已关闭场馆的历史原址；原坐标误落在有明地区。 |

| 139 | 神戸芸術センター 芸術劇場 | 兵庫県神戸市中央区熊内橋通7-1-13 | 34.704050, 135.198330 | [OpenStreetMap/Mapcarta](https://mapcarta.com/N6768687395) | 可回填 | OSM theatre 节点。 |
| 140 | 広島国際会議場（フェニックスホール） | 広島県広島市中区中島町1-5 | 34.392083, 132.451028 | [会场官方](https://www.pcf.city.hiroshima.jp/icch/phoenix.html)；[位置资料](https://ja.wikid.org/%E5%BA%83%E5%B3%B6%E5%9B%BD%E9%9A%9B%E4%BC%9A%E8%AD%B0%E5%A0%B4) | 可回填 | 会议中心内厅；候选为建筑点。 |
| 141 | 熊本城ホール シビックホール | 熊本県熊本市中央区桜町3-40 | 32.800961, 130.704458 | [熊本市设施资料](https://www.city.kumamoto.jp/dynamic/info/pub/detail.aspx?c_id=59&id=400) | 可回填 | 采用官方地图给出的园区点；Civic Hall 楼层与入口不在本字段表达。 |
| 142 | ナディアパークデザインホール | 愛知県名古屋市中区栄3-18-1、ナディアパーク | 35.165558, 136.905747 | [Nadya Park 官方资料](https://nadyapark.jp/info/about.php)；[设施坐标资料](https://ytdyklly.blogspot.com/2019/02/blog-post_221.html) | 可回填 | 采用 Nadya Park 复合体地点点位；Design Hall 楼层与入口不在本字段表达。 |

| 143 | 道新ホール | 北海道札幌市中央区大通西3丁目6、道新ビル大通館8F | 43.061413, 141.353256 | [Google Maps 直达场馆点](https://www.google.co.jp/maps/place/%E9%81%93%E6%96%B0%E3%83%9B%E3%83%BC%E3%83%AB/@43.0614134,141.3510669,17z/data=!3m1!4b1!4m5!3m4!1s0x5f0b299d0f8060b1:0xfe5256c95fb6f49e!8m2!3d43.0614134!4d141.3532556) | 可回填 | 采用道新大通馆建筑点；楼内 8F 与场馆历史状态不影响 Venue 级定位。 |
| 144 | 鴻巣市文化センター(クレアこうのす) 大ホール | 埼玉県鴻巣市中央29-1 | 36.067576, 139.522618 | [MapFan](https://mapfan.com/spots/SC3AH%2CJ%2CE00)；[场馆官方交通页](https://clea-konosu.com/access/) | 可回填 | MapFan 标明世界测地系坐标，官方页面确认文化中心地址；大音乐厅位于该建筑内。 |
| 146 | 國立體育大學綜合體育館（林口體育館） | 桃園市龜山區文化一路250號 | 25.034580, 121.383500 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W197551686) | 可回填 | OSM 体育馆要素；公开资料坐标存在约数十米差异，后续以入口点复核。 |
| 147 | AsiaWorld-Expo, Hall 10 | 亞洲國際博覽館10號館，香港新界大嶼山香港國際機場航展道1號 | 22.321440, 113.943250 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W23398992)；[官方场馆图](https://www.asiaworld-expo.com/en-us/visiting/venue-map/) | 可回填 | Hall 10 位于大型展馆内；采用园区建筑点，单个厅入口不在本字段表达。 |

| 148 | 万博記念公園 | 大阪府吹田市千里万博公園1-1 | 34.810122, 135.527600 | [Wikidata](https://www.wikidata.org/wiki/Q4817249)；[公园官方交通页](https://www.expo70-park.jp/guide/access/) | 可回填 | 采用地图返回的公园中心点作 Venue 级定位；当次活动区域和入口不在本字段表达。 |
| 149 | 東急歌舞伎町タワーステージ | 東京都新宿区歌舞伎町1-29-1、東急歌舞伎町タワー | 35.695889, 139.700389 | [大厦楼层指南](https://www.tokyu-kabukicho-tower.jp/assets/pdf/floorguide/en.pdf)；[Wikidata 建筑点](https://www.wikidata.org/wiki/Q109595002) | 可回填 | 采用东急歌舞伎町塔建筑点；Stage 的具体活动区与入口不在本字段表达。 |
| 150 | 烏丸半島芝生広場 | 滋賀県草津市下物町1091 | 35.074250, 135.935020 | [Apple Maps 场地点](https://maps.apple.com/place?place-id=I3B22C13DA5102CBB)；[活动交通页](https://biwakolaa.com/) | 可回填 | 大型户外草坪采用地图可直接搜索的场地区域点；地址使用公开活动资料一致的门牌。 |
| 152 | Shibuya Hikarie | 東京都渋谷区渋谷2-21-1 | 35.659150, 139.703970 | [OpenStreetMap/Mapcarta](https://mapcarta.com/es/28406248)；[Google Maps 场馆页](https://www.google.com/maps/search/%E6%B8%8B%E8%B0%B7%E3%83%92%E3%82%AB%E3%83%AA%E3%82%A8) | 可回填 | 采用 Shibuya Hikarie 综合体地点点位；Hall、Theatre Orb 等楼层场地不在本字段表达。 |

| 5 | 上海宛平剧院 大剧场 | 上海市徐汇区中山南二路857-859号 | 31.186911, 121.447017 | [高德地点页](https://ditu.amap.com/place/B0HDVUXPY7)；[上海市文旅资料](https://whlyj.sh.gov.cn/cmsres/31/31da31e260c64ee989507dfa3ce6928a/8b0a4016e8e367d01dfd72fbd4746ed4.pdf) | 可回填 | 高德给出 GCJ-02（31.185011, 121.451612），已用标准 GCJ-02 反算为 WGS84；地址与上海市文旅资料一致。 |
| 120 | カルッツかわさき | 神奈川県川崎市川崎区富士見1-1-4 | 35.529620, 139.708930 | [OpenStreetMap/Mapcarta](https://mapcarta.com/N6246661486) | 可回填 | OSM theatre 节点。 |
| 151 | パシフィコ横浜 会議センターメインホール | 神奈川県横浜市西区みなとみらい1-1-1、会議センター | 35.458330, 139.636390 | [Mapion 场馆资料](https://www.mapion.co.jp/phonebook/M04101/14103/0000PCY1_001pa/)；[Pacifico 官方资料](https://plan.pacifico.co.jp/) | 可回填 | 采用会议中心设施点；主厅楼层与入口不在本字段表达。 |
| 154 | 大手町三井ホール | 東京都千代田区大手町1-2-1、Otemachi One 3F | 35.687847, 139.762453 | [MapFan](https://mapfan.com/spots/SC3AH%2CJ%2CKM0)；[场馆官方资料](https://www.mitsui-hall-conference.jp/place/otemachi-mitsui-hall/) | 可回填 | 楼内 3F 会场，地图服务点与官方地址一致。 |

| 7 | 上海静安体育中心 | 上海市静安区汶水路116号 | 31.293250, 121.448740 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W1460637638) | 可回填 | OSM 体育中心要素；与高德原始坐标差异较大，以 WGS84 OSM 点为候选。 |
| 8 | 神奈川県民ホール 大ホール | 神奈川県横浜市中区山下町3-1 | 35.445975, 139.647154 | [NAVITIME](https://www.navitime.co.jp/poi?spot=91001-ani00694)；[场馆官方](https://www.kanagawa-kenminhall.com/about/mainhall) | 可回填 | 主馆大音乐厅；目前处于休馆状态，候选为历史建筑点。 |
| 16 | グランキューブ大阪 メインホール | 大阪府大阪市北区中之島5-3-51、大阪府立国際会議場5F | 34.689390, 135.486270 | [OpenStreetMap/Mapcarta](https://mapcarta.com/fr/W179071378)；[楼层指南](https://www.gco.co.jp/visitor/floor/) | 可回填 | 会议中心内 5F 主厅，候选为建筑点。 |
| 17 | 東京国際フォーラム ホールA | 東京都千代田区丸の内3-5-1、Aブロック1-7F | 35.676670, 139.764440 | [东京国际论坛官方](https://www.t-i-forum.co.jp/visitors/facilities/a/?tab=3)；[位置资料](https://ja.wikid.org/%E6%9D%B1%E4%BA%AC%E5%9B%BD%E9%9A%9B%E3%83%95%E3%82%A9%E3%83%BC%E3%83%A9%E3%83%A0) | 可回填 | 园区内 A Block 指定厅，候选为设施点。 |

| 38 | 神戸国際会館こくさいホール | 兵庫県神戸市中央区御幸通8-1-6、神戸国際会館 | 34.692260, 135.195840 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W182492341) | 可回填 | 楼内剧场（入口在 2F）；候选为建筑点。 |
| 39 | Crypto.com Arena | 1111 S Figueroa St, Los Angeles, CA 90015 | 34.043020, -118.266870 | [OpenStreetMap/Mapcarta](https://mapcarta.com/31685240) | 可回填 | OSM 体育场建筑要素。 |
| 45 | KOREA UNIV. TIGER DOME | 145 Anam-ro, Seongbuk-gu, Seoul 02841, South Korea | 37.592550, 127.024900 | [OSM Mapcarta](https://mapcarta.com/W172672467)；[高丽大学官方](https://www.korea.edu/mbshome/mbs/en/subview.do?id=en_060301000000) | 可回填 | Hwajeong Gymnasium（Tiger Dome）建筑要素；与高丽大学官方场地名称、首尔校区地址一致。 |
| 46 | The Star Theatre | The Star, 1 Vista Exchange Green, Singapore 138617 | 1.306920, 103.788394 | [Wikidata](https://www.wikidata.org/wiki/Q128792206)；[场馆交通页](https://www.thestar.sg/getting-to-the-star) | 可回填 | Theatre 位于综合体上层；候选为建筑点。 |

| 47 | おおきにアリーナ舞洲 | 大阪府大阪市此花区北港緑地2-2-15 | 34.665566, 135.397620 | [MapFan 世界测地系](https://mapfan.com/spots/SCCQ4%2CJ%2CY) | 可回填 | 场馆建筑级坐标，与正式地址一致。 |
| 53 | 大宮ソニックシティ 大ホール | 埼玉県さいたま市大宮区桜木町1-7-5 | 35.906900, 139.623700 | [大宫 Sonic City 官方](https://www.sonic-city.or.jp/visitors/hall.html)；[场馆坐标资料](https://tixvoy.com/ja/venues/omiya-sonic-city-main-hall) | 可回填 | 场馆建筑内大音乐厅，候选为建筑点。 |
| 55 | アニメイトシアター | 東京都豊島区東池袋1-20-7、アニメイト池袋本店 北館B2F | 35.731310, 139.715540 | [剧场官方页](https://www.animate.co.jp/theater/)；[池袋本店官方访问页](https://www.animate.co.jp/shop/ikebukuro/access/)；[地图候选](https://japanpass.com/en/explore/tokyo/tokyo/animate-ikebukuro/) | 可回填 | 坐标为池袋本店北馆建筑级；剧场位于 B2F，实际入口已有官方说明。 |
| 63 | Smart Araneta Coliseum | General Araneta Ave, Quezon City 1109, Philippines | 14.620710, 121.053400 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W4935803) | 可回填 | OSM 体育场建筑要素。 |

| 64 | 桃園会展中心 | 桃園市中壢區領航北路一段99號 | 25.003200, 121.200400 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W747024873)；[MusicBrainz](https://musicbrainz.org/place/f79831a9-cee2-4455-b268-60938133ff23) | 可回填 | 采用会展综合体地点点位；展览栋或会议中心栋不在本字段表达。 |
| 65 | UMEDA CLUB QUATTRO | 大阪府大阪市北区太融寺町8-17、プラザ梅田10F | 34.701767, 135.502308 | [Mapion 建筑点](https://www.mapion.co.jp/m2/basic/34.70176702%2C135.50230786%2C16?icon=home%7C135.50230786%2C34.70176702&poi=GJ001124914-001&size=628x628&t=print_pd)；[场馆官方](https://www.club-quattro.com/umeda/) | 可回填 | Plaza Umeda 建筑点；官方确认 UMEDA CLUB QUATTRO 位于 10F。 |
| 66 | NAGOYA CLUB QUATTRO | 愛知県名古屋市中区栄3-29-1、名古屋パルコ東館8F | 35.163710, 136.908338 | [CLUB QUATTRO 官方页](https://www.club-quattro.com/nagoya/) | 可回填 | 地址取自官方页，坐标取其嵌入 Google 地图的名古屋 PARCO 东馆建筑点；原候选误落在名古屋站附近。 |
| 67 | Spotify O-EAST | 東京都渋谷区道玄坂2-14-8、O-EASTビル2F | 35.658715, 139.695526 | [OpenStreetMap 点](https://www.openstreetmap.org/node/2214619702)；[场馆官方](https://shibuya-o.com/contact/) | 可回填 | O-EAST 与 duo MUSIC EXCHANGE 位于同一 O-EAST Building；官方确认其为 2F。 |

| 72 | 心斎橋BIGCAT | 大阪府大阪市中央区西心斎橋1-6-14、BIGSTEP 4F | 34.672500, 135.498700 | [TIXVOY 场馆资料](https://tixvoy.com/en/venues/bigcat)；[Mapcarta 楼宇点](https://mapcarta.com/W162045996) | 可回填 | 楼内 4F 场地，候选为 BIGSTEP 建筑点。 |
| 74 | Veats Shibuya | 東京都渋谷区宇田川町33-1、グランド東京渋谷ビルB1-B2F | 35.660766, 139.697432 | [OpenStreetMap / Photon 建筑要素](https://www.openstreetmap.org/way/607516262)；[场馆官方](https://veats.jp/schedule/3519/) | 可回填 | Photon 返回 Grand Tokyo Shibuya Building 建筑要素；官方确认 Veats 位于其 B1-B2。 |
| 75 | 秋葉原エンタス | 東京都千代田区外神田1-2-7、オノデン本館5F | 35.698290, 139.771010 | [OSM Mapcarta](https://mapcarta.com/N1915175462)；[Google Maps](https://www.google.com/maps/search/%E7%A7%8B%E8%91%89%E5%8E%9F%E3%82%A8%E3%83%B3%E3%82%BF%E3%82%B9%2C%20%E6%9D%B1%E4%BA%AC%E9%83%BD%E5%8D%83%E4%BB%A3%E7%94%B0%E5%8C%BA%E5%A4%96%E7%A5%9E%E7%94%B01-2-7%20%E3%82%AA%E3%83%8E%E3%83%87%E3%83%B3%E7%A7%8B%E8%91%89%E5%8E%9F%E6%9C%AC%E9%A4%A8%E3%83%93%E3%83%AB5F) | 可回填 | ENTAS 位于 Onoden 本馆 5F；坐标为该建筑的 OSM 节点。 |
| 77 | 1000 CLUB | 神奈川県横浜市西区南幸2-1-5 | 35.463221, 139.618737 | [NAVITIME](https://www.navitime.co.jp/poi?spot=00004-14104900159) | 可回填 | 地图服务点与场馆地址一致。 |

| 78 | 日比谷公園大音楽堂 | 東京都千代田区日比谷公園1-5 | 35.672361, 139.754028 | [Wikidata](https://www.wikidata.org/wiki/Q11509589)；[千代田观光协会](https://visit-chiyoda.tokyo/app/en/spot/detail/551) | 可回填 | Wikidata 的日比谷公园大音乐堂坐标；官方页面地址为日比谷公园 1-5。 |
| 84 | 横須賀芸術劇場 | 神奈川県横須賀市本町3-27、ベイスクエアよこすか一番館4F | 35.281363, 139.662998 | [MapFan](https://mapfan.com/spots/SC3AH%2CJ%2CF7)；[场馆官方交通页](https://www.yokosuka-arts.or.jp/information/access/) | 可回填 | 楼内剧场，候选为建筑点。 |
| 85 | 大阪市中央公会堂「大集会室」 | 大阪府大阪市北区中之島1-1-27 | 34.693530, 135.504010 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W162382613)；[大阪市资料](https://www.manabi.city.osaka.lg.jp/yoyaku/shisetsuInfoDetailInfo.html?shisetsu_code=61) | 可回填 | 历史建筑内 1F 大集会室，候选为建筑点。 |
| 87 | 中野サンプラザホール | 東京都中野区中野4-1-1 | 35.707570, 139.664690 | [OpenStreetMap/Mapcarta](https://mapcarta.com/34078344)；[中野区存档资料](https://www.city.tokyo-nakano.lg.jp/kanko/city-promotion/Sunplaza_3D.html) | 可回填 | 2023 年闭馆；候选仅用于历史 Live 记录。 |

| 94 | 新宿LOFT | 東京都新宿区歌舞伎町1-12-9、タテハナビルB2F | 35.695366, 139.702633 | [场馆官方页](https://www.loft-prj.co.jp/schedule/loft/about)；[Mapion 地图点](https://www.mapion.co.jp/m2/35.69536616%2C139.70263298%2C16/poi%3D0000SLFT_001pa) | 可回填 | 场馆在 Tatehana Building B2；坐标为场馆地图点。 |
| 96 | 神戸上屋劇場 | 兵庫県神戸市中央区波止場町6-3、甲陽運輸内1F | 34.683692, 135.185164 | [历史活动地图坐标](https://mixi.jp/view_bbs.pl?comm_id=1207520&id=50982418)；[Sound Creator 场馆资料](https://www.sound-c.co.jp/index.php/hall/detail/349/) | 可回填 | 历史活动地图的 DMS 坐标换算为 WGS84，且与波止场町 6-3 场馆资料一致；采用历史建筑点。 |
| 97 | ディファ有明 | 東京都江東区有明1-3-25 | 35.638722, 139.789222 | [MusicBrainz 历史场馆资料](https://musicbrainz.org/place/364be365-374f-4379-93e0-f0cc085a231c) | 可回填 | 2018-06-30 闭馆；候选仅用于历史 Live。 |
| 99 | アニメイト新宿 | 東京都新宿区新宿3-17-17 | 35.692472, 139.703329 | [旧址迁移报道](https://www.oricon.co.jp/news/2161893/)；[旧址地图点](https://www.navitime.co.jp/poi?spot=07008-0000027314) | 可回填 | 采用 2016 年 Live 发生时的新宿 3-17-17 历史旧址，不使用之后的 Shinjuku Marui Men 店址。 |

| 102 | Singapore Expo | 1 Expo Dr, Singapore 486150 | 1.334033, 103.958931 | [MusicBrainz 场馆资料](https://musicbrainz.org/place/2cb9a869-8eea-4b18-8431-2f9a36cbaf9a/map)；[官方园区图](https://www.singaporeexpo.com.sg/content/dam/singaporexpo/your-expo/brochures/Singapore%20EXPO%20Sales%20Brochure.pdf.coredownload.inline.pdf) | 可回填 | 采用多厅展馆地点点位；具体 Hall/Arena 不在 Venue 坐标层表达。 |
| 103 | 名古屋城二之丸広場 | 愛知県名古屋市中区本丸1-1、名古屋城二之丸広場 | 35.184437, 136.901332 | [新闻地图](https://meieki.keizai.biz/mapnews/1237/) | 可回填 | 新闻地图直接标注名古屋城二之丸广场坐标。 |
| 104 | 池袋サンシャインシティ噴水広場 | 東京都豊島区東池袋3-1-1、サンシャインシティ アルパB1 | 35.729097, 139.719089 | [Anime Tourism 地图资料](https://anime-tourism.jp/t/639/420-38/) | 可回填 | 商业综合体内吹拔前广场，候选为广场点。 |
| 105 | EXシアター六本木 | 東京都港区西麻布1-2-9 | 35.661210, 139.727270 | [OpenStreetMap/Mapcarta](https://mapcarta.com/N4784623782)；[场馆官方](https://ex-theater.jp/) | 可回填 | OSM theatre 节点与官方地址一致。 |

| 109 | 台北世界貿易中心南港展覽館 | 臺北市南港區經貿二路1號（1館） | 25.056500, 121.618090 | [OpenStreetMap/Mapcarta](https://mapcarta.com/29825010) | 可回填 | 双展馆复合体；候选为 Hall 1 设施点。 |
| 110 | 詩涼子街頭實況攝影棚 | 臺北市萬華區成都路6號 | 25.041991, 121.507583 | [场地历史资料](https://www.pickoneplace.com/blog/view/79)；[OpenStreetMap / Photon 门牌点](https://www.openstreetmap.org/node/10907773265) | 可回填 | 通过相关 Live 标题反查确认历史场地为台北市万华区成都路 6 号；OSM 门牌点为该地址。 |
| 111 | ハウステンボス | 長崎県佐世保市ハウステンボス町1-1 | 33.085936, 129.789883 | [Huis Ten Bosch 坐标资料](https://ja.wikid.org/%E3%83%8F%E3%82%A6%E3%82%B9%E3%83%86%E3%83%B3%E3%83%9C%E3%82%B9)；[园区官方地图](https://english.huistenbosch.co.jp/map/?action=show&cat=84&lang=ja&sid=80438) | 可回填 | 采用主题园区中心点；实际舞台、区域和入口不在 Venue 坐标层表达。 |
| 112 | MEGABOX DONGDAEMUN | Good Morning City 9F, 247 Jangchungdan-ro, Jung-gu, Seoul 04564, South Korea | 37.566380, 127.007390 | [OpenStreetMap/Mapcarta](https://mapcarta.com/N5373168207)；[影城资料](https://locatecinemas.com/cinemas/south-korea/seoul/megabox-dongdaemun-7c5e7f24/) | 可回填 | 楼内 9F 影城，候选为建筑点。 |

| 114 | マイナビBLITZ赤坂 | 東京都港区赤坂5-3-2 | 35.672520, 139.735274 | [旧址资料](https://kiwix.scoggi.net/content/wikipedia_en_all_maxi_2023-11/A/Akasaka_Blitz)；[闭馆公告](https://akasaka.keizai.biz/headline/3358/) | 可回填 | 2020-09-22 闭馆；仅可作为历史 Live 场地坐标。 |
| 115 | TSUTAYA IKEBUKURO AKビル店 | 東京都豊島区東池袋1-2-9、池袋AKビル | 35.729750, 139.713800 | [LiveFans 历史场馆资料](https://www.livefans.jp/venues/10727)；[Yahoo! 地图现址建筑](https://map.yahoo.co.jp/v3/place/gpSG1ZcmMyk) | 可回填 | 历史场馆门牌为池袋 AK ビル；坐标采用该门牌所在建筑的 WGS84 近似中心点，满足历史 Live 的大致定位。 |
| 116 | 上海世博展览馆 | 上海市浦东新区国展路1099号 | 31.181207, 121.490475 | [场馆资料](https://www.metal-am.com/locations/shanghai-world-expo-exhibition-and-convention-center-3/)；[展馆资料](https://portal.messefrankfurt.com.hk/services/core/pool/oms/9111.pdf) | 可回填 | Shanghai World Expo Exhibition and Convention Center 的 WGS84 坐标；资料同时确认国展路 1099 号。 |
| 117 | ベルーナドーム前広場 | 埼玉県所沢市上山口2135、ベルーナドーム | 35.768500, 139.420500 | [Belluna Dome 坐标资料](https://tripomatic.com/en/poi/belluna-dome-poi:40267585)；[西武狮官方的前广场位置说明](https://www.seibulions.co.jp/news/detail/202300240675.html) | 可回填 | 地图搜索未提供独立广场地点点位，采用所属 Belluna Dome 地点点位作 Venue 级定位；与 Dome 共点是有意的近似，不表示建筑内部。 |
| 119 | ZOZOマリンスタジアム | 千葉県千葉市美浜区美浜1 | 35.645239, 140.030922 | [Wikidata](https://www.wikidata.org/wiki/Q486192)；[OSM Mapcarta](https://mapcarta.com/W617646765) | 可回填 | ZOZO Marine Stadium 建筑要素坐标。 |
| 121 | 台北世貿中心展覽一館 | 臺北市信義區信義路五段5號 | 25.033765, 121.562380 | [TWTC 官方 Hall 1 资料](https://www.twtc.com.tw/Floor1)；[台湾观光署坐标](https://eng.taiwan.net.tw/m1.aspx?id=A12-00415&sNo=0002016) | 可回填 | 对应信义路五段5号的展览一馆，不是南港展览馆。 |
| 122 | 刈谷市総合文化センター アイリス 大ホール | 愛知県刈谷市若松町2-104 | 34.989255, 137.006893 | [MapFan 世界测地系](https://mapfan.com/spots/SC3AH%2CJ%2CYK0)；[会场地址](https://www.mapion.co.jp/phonebook/M04101/23210/0000KBS1_001pa/) | 可回填 | 大厅在文化中心建筑内；坐标为建筑级。 |
| 123 | 富士急ハイランド 園内ステージ | 山梨県富士吉田市新西原5-6-1、富士急ハイランド | 35.485070, 138.778620 | [园区地图](https://bmmpa8302.mpme.jp/map/)；[OSM 地图点](https://mapcarta.com/33942366/Map) | 可回填 | 园内舞台名称/位置可随活动调整；坐标仅为园区级。 |
| 127 | イオンシネマ板橋 | 東京都板橋区徳丸2-6-1、イオン板橋ショッピングセンター5F | 35.770033, 139.660993 | [场馆资料](https://cinema.pmil.me/en/aeon-itabashi?context=search)；[Apple Maps](https://maps.apple.com/place?_provider=9902&place-id=IAD684E438ED2AF0F) | 可回填 | 该资料列出 AEON CINEMA Itabashi 的坐标，地址与 Apple Maps 场馆详情一致。 |
| 128 | スペースFS汐留 | 東京都港区東新橋1-1-16、汐留FSビル | 35.665668, 139.760057 | [汐留FS大楼坐标页](https://toku-p.earth-car.com/parking-search/35.6656682-139.7600568-16/%E6%B1%90%E7%95%99%EF%BC%A6%EF%BC%B3%E3%83%93%E3%83%AB)；[场地/建筑地址](https://harao.tokyo/sites/hro/buildingpage/120266/1) | 可回填 | 来源 URL 明示汐留FS大楼的 WGS84 坐标；为建筑点。 |
| 129 | パシフィコ横浜 国立大ホール | 神奈川県横浜市西区みなとみらい1-1-1 | 35.457833, 139.636667 | [场馆官方页](https://plan.pacifico.co.jp/national-convention-hall)；[带 GPS 的建筑照片](https://commons.wikimedia.org/wiki/File%3APacifico_Yokohama_National_Convention_Hall.JPG) | 可回填 | 坐标为国立大ホール建筑；入口以当次活动指引为准。 |
| 132 | ゲーマーズ新宿店 | 東京都渋谷区代々木2-10-1、新宿サンセイビル4F | 35.688077, 139.698400 | [2019 年店铺地址资料](https://magi.camp/blogs/2029909363)；[OpenStreetMap 新宿サンセイビル](https://www.openstreetmap.org/way/138522511) | 可回填 | 采用 2019-07-31 Live 发生时的新宿サンセイビル建筑点，已修正原先笼统且错误的“新宿3丁目”地址。 |
| 134 | 清水マリンパーク | 静岡県静岡市清水区日の出町 | 35.010030, 138.494747 | [静冈市官方观光页](https://www.visit-shizuoka.com/spot/detail_12.html)；[MapFan 世界测地系](https://mapfan.com/spots/SC54Q%2CJ%2CU5) | 可回填 | 官方地址本身未标番地；坐标采用地图可直接搜索的户外公园点，具体舞台和入口不在 Venue 坐标层表达。 |
| 136 | 静岡エコパアリーナ | 静岡県袋井市愛野2300-1、エコパ | 34.745520, 137.968410 | [官方场馆页](https://www.ecopa.jp/facility/arena/)；[OSM 地图点](https://mapcarta.com/W510576754) | 可回填 | OSM 建筑要素明确为 ECOPA ARENA，与体育场分离。 |
| 145 | Grand Peace Palace | 26 Kyungheedae-ro, Dongdaemun-gu, Seoul 02447, South Korea | 37.598611, 127.052732 | [活动官方页](https://bang-dream.com/events/kimchikura-fes-26/)；[OpenStreetMap 点](https://www.openstreetmap.org/way/261207462) | 可回填 | 庆熙大学和平殿堂建筑要素，与官方活动页的 Seoul / Kyung Hee University 一致。 |
| 153 | Spotify O-WEST | 東京都渋谷区円山町2-3、2F | 35.658480, 139.695320 | [OSM Mapcarta](https://mapcarta.com/N5010999142)；[场馆官方](https://shibuya-o.com/contact/) | 可回填 | OSM 的 Spotify O-WEST 场馆节点；官方确认地址为圆山町 2-3 2F。 |
| 155 | KINTEX HALL | KINTEX 2, 217-59 Kintex-ro, Ilsanseo-gu, Goyang-si, Gyeonggi-do 10390, South Korea | 37.666060, 126.741905 | [第 2 展示场地址](https://k-dex.kr/eng/visitor/location/)；[KINTEX 官方手册](https://www.kintex.com/download/formatModal/KINTEX_Organizer%27s%20Guide.pdf) | 可回填 | 已消歧为 KINTEX 第 2 展示场 7–10 厅；采用第 2 展示场建筑点，地址使用该建筑的 217-59 门牌。 |
| 156 | 仙台サンプラザホール | 宮城県仙台市宮城野区榴岡5-11-1 | 38.257720, 140.894070 | [OpenStreetMap/Mapcarta](https://mapcarta.com/W246879720) | 可回填 | OSM 建筑要素。 |
## 已用官方资料

- [东京花园剧场：交通与地址](https://www.shopping-sumitomo-rd.com/tokyo_garden_theater/access/)
- [东京 Big Sight：主办方联系地址](https://www.bigsight.jp/organizer/contact/)
- [Bell Salle 秋叶原：设施页与地址](https://www.bellesalle.co.jp/shisetsu/tokyo/bs_akihabara/)
- [幕张展览馆：交通与地址](https://www.m-messe.co.jp/access/?hl=ja)

台账已完成 153 个实体 Venue 的 Venue 级 WGS84 坐标覆盖。表内关于楼层、入口、展厅和活动舞台的说明是精度边界，不再作为坐标回填阻塞项；数据库回填仍应使用带目标库确认、修订号和审计记录的受控更新流程。
