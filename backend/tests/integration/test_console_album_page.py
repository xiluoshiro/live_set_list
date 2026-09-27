import pytest

from tests.integration.test_song_catalog_api import auth

pytestmark = pytest.mark.integration


# 测试点：超过 500 张专辑仍可逐页找到，日期倒序且未知日期在后，查询支持字面名称、发行标识和 ID。
def test_album_query_and_pagination(integration_test_client, integration_admin_connection):
    client = integration_test_client
    auth(client)
    with integration_admin_connection.cursor() as cur:
        cur.execute("""INSERT INTO albums(album_name, release_label)
            SELECT '分页核对 ' || n, '' FROM generate_series(1, 502) n RETURNING id""")
        unknown_ids = [row[0] for row in cur.fetchall()]
        cur.execute("""INSERT INTO albums(album_name, release_label, release_date)
            VALUES ('分页核对 旧盘', '发行检索', '2025-01-01'),
                   ('分页核对 新盘', '发行检索', '2026-01-01') RETURNING id""")
        older_id, newer_id = [row[0] for row in cur.fetchall()]
        cur.execute("INSERT INTO albums(album_name) VALUES ('100%_盤'), ('100AB盤') RETURNING id")
        literal_id = cur.fetchone()[0]
    integration_admin_connection.commit()

    response = client.get('/api/console/albums', params={'q': '分页核对'})
    assert response.status_code == 200, response.text
    first = response.json()
    assert (first['page'], first['page_size'], first['total'], first['total_pages']) == (1, 20, 504, 26)
    assert [item['album_id'] for item in first['items'][:3]] == [newer_id, older_id, unknown_ids[-1]]
    last = client.get('/api/console/albums', params={'q': '分页核对', 'page': 999}).json()
    assert last['page'] == 26
    assert [item['album_id'] for item in last['items']] == list(reversed(unknown_ids[:4]))
    releases = client.get('/api/console/albums', params={'q': ' 发行检索 ', 'limit': 1}).json()
    assert releases['total'] == 2 and releases['total_pages'] == 2
    assert [item['album_id'] for item in releases['items']] == [newer_id]
    for query in ['100%_盤', str(literal_id)]:
        found = client.get('/api/console/albums', params={'q': query}).json()
        assert found['total'] == 1
        assert found['items'][0]['album_id'] == literal_id
    empty = client.get('/api/console/albums', params={'q': '不存在的发行', 'page': 9}).json()
    assert empty == {'items': [], 'page': 1, 'page_size': 20, 'total': 0, 'total_pages': 1}


# 测试点：已保存专辑收录返回歌曲版本及真实归属，重新打开编辑页后仍可区分同名版本。
def test_album_tracks_keep_version_and_ownership(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    song = client.post('/api/console/songs', headers=headers, json={
        'group_id': 1, 'expected_group_revision': 1, 'song_name': '同名曲', 'version_label': 'Acoustic',
        'ownership': {'mode': 'bands', 'band_ids': [1, 2]},
    }).json()['item']
    response = client.post('/api/console/albums', headers=headers, json={
        'album_name': '版本核对盘', 'tracks': [{'song_id': song['song_id']}],
    })
    assert response.status_code == 201, response.text
    album = client.get(f"/api/console/albums/{response.json()['album_id']}").json()
    track = album['tracks'][0]
    assert (track['song_id'], track['song_name'], track['version_label']) == (song['song_id'], '同名曲', 'Acoustic')
    assert track['band_name'] == ' / '.join(band['band_name'] for band in song['ownership']['bands'])
