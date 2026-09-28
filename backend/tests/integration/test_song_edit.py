"""The console's whole-page save must commit or roll back as a unit."""
import copy

import pytest

from tests.integration.test_song_catalog_api import auth

pytestmark = pytest.mark.integration


def make_group(client, headers, name):
    response = client.post('/api/console/song-groups', headers=headers, json={
        'group_name': name, 'song_name': name, 'ownership': {'mode': 'bands', 'band_ids': [1]},
    })
    assert response.status_code == 201, response.text
    return response.json()['item']


def add_version(client, headers, group_id, label):
    group = client.get(f'/api/song-groups/{group_id}').json()
    response = client.post('/api/console/songs', headers=headers, json={
        'group_id': group_id, 'expected_group_revision': group['revision'], 'song_name': '版本歌曲',
        'version_label': label, 'ownership': {'mode': 'bands', 'band_ids': [1]},
    })
    assert response.status_code == 201, response.text
    return response.json()['item']


def edit_payload(client, song_id):
    song = client.get(f'/api/songs/{song_id}').json()
    group = client.get(f"/api/song-groups/{song['group_id']}").json()
    return {
        'song_name': song['song_name'], 'version_label': song['version_label'], 'cover_urls': song['cover_urls'],
        'expected_revision': song['revision'],
        'ownership': {key: song['ownership'][key] for key in ('mode', 'band_ids', 'member_groups')},
        'group': {'group_id': group['group_id'], 'group_name': group['group_name'],
                  'expected_revision': group['revision'], 'song_ids': [v['song_id'] for v in group['versions']]},
    }


def audit_count(conn, song_id):
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM audit_logs WHERE resource_type = 'song' AND resource_id = %s AND action = 'song_edit'", (str(song_id),))
        return cur.fetchone()[0]


def test_whole_page_save_updates_public_references_once(integration_test_client, integration_admin_connection):
    client = integration_test_client
    headers = auth(client)
    default = make_group(client, headers, '统一提交')
    sibling = add_version(client, headers, default['group_id'], '另一版本')
    sid = default['song_id']
    album = client.post('/api/console/albums', headers=headers, json={
        'album_name': '引用专辑', 'tracks': [{'song_id': sid}],
    }).json()
    payload = edit_payload(client, sid)
    payload.update(song_name='全局新名称', cover_urls=['https://example.test/cover.png'],
                   ownership={'mode': 'bands', 'band_ids': [2]}, ownership_reason='官方资料更正')
    payload['group']['group_name'] = '全局新组名'
    payload['group']['song_ids'].reverse()
    result = client.put(f'/api/console/songs/{sid}/edit', headers=headers, json=payload)
    assert result.status_code == 200, result.text
    saved = result.json()
    assert saved['item']['revision'] == payload['expected_revision'] + 1
    assert saved['group']['revision'] == payload['group']['expected_revision'] + 1
    assert [v['song_id'] for v in saved['group']['versions']] == [sibling['song_id'], sid]
    assert saved['item']['ownership']['band_ids'] == [2]
    assert client.get(f'/api/songs/{sid}').json() == saved['item']
    assert client.get(f"/api/albums/{album['album_id']}").json()['tracks'][0]['song_name'] == '全局新名称'
    assert client.get(f"/api/songs/{sibling['song_id']}").json()['song_name'] == '版本歌曲'
    assert audit_count(integration_admin_connection, sid) == 1
    # A retry of an already committed operation cannot duplicate it.
    assert client.put(f'/api/console/songs/{sid}/edit', headers=headers, json=payload).status_code == 409
    assert audit_count(integration_admin_connection, sid) == 1


@pytest.mark.parametrize('failure', ['ownership_fk', 'duplicate_label', 'group_revision', 'song_revision', 'members_missing', 'reason'])
def test_failed_combined_save_leaves_no_partial_changes(integration_test_client, integration_admin_connection, failure):
    client = integration_test_client
    headers = auth(client)
    default = make_group(client, headers, '回滚组')
    song = add_version(client, headers, default['group_id'], '非默认版本')
    sid = song['song_id']
    before = client.get(f"/api/song-groups/{song['group_id']}").json()
    payload = edit_payload(client, sid)
    payload.update(song_name='不应保存', ownership={'mode': 'bands', 'band_ids': [2]}, ownership_reason='核实')
    payload['group']['group_name'] = '不应保存的组名'
    payload['group']['song_ids'].reverse()
    status = 422
    if failure == 'ownership_fk':
        payload['ownership']['band_ids'] = [999999]
    elif failure == 'duplicate_label':
        payload['version_label'] = ''  # Deferred unique constraint fails at commit, after all writes.
        status = 409
    elif failure == 'group_revision':
        payload['group']['expected_revision'] += 1
        status = 409
    elif failure == 'song_revision':
        payload['expected_revision'] += 1
        status = 409
    elif failure == 'members_missing':
        payload['group']['song_ids'] = [sid]
    else:
        payload['ownership_reason'] = ' '
    result = client.put(f'/api/console/songs/{sid}/edit', headers=headers, json=payload)
    assert result.status_code == status, result.text
    assert client.get(f"/api/song-groups/{song['group_id']}").json() == before
    assert audit_count(integration_admin_connection, sid) == 0


def test_move_and_source_group_changes_commit_together(integration_test_client):
    client = integration_test_client
    headers = auth(client)
    source = make_group(client, headers, '原组')
    song = add_version(client, headers, source['group_id'], '可移动版本')
    destination = make_group(client, headers, '目标组')
    sid = song['song_id']
    payload = edit_payload(client, sid)
    payload['song_name'] = '移动后的名称'
    payload['group']['group_name'] = '原组新名称'
    payload['move_to_group'] = {'group_id': destination['group_id'], 'expected_revision': 1, 'reason': '修正归组'}
    stale = copy.deepcopy(payload)
    stale['move_to_group']['expected_revision'] = 2
    assert client.put(f'/api/console/songs/{sid}/edit', headers=headers, json=stale).status_code == 409
    assert client.get(f"/api/song-groups/{source['group_id']}").json()['group_name'] == '原组'
    result = client.put(f'/api/console/songs/{sid}/edit', headers=headers, json=payload)
    assert result.status_code == 200, result.text
    saved = result.json()
    assert saved['item']['group_id'] == destination['group_id']
    assert saved['item']['version_order'] == 2
    assert saved['group']['revision'] == 2
    old_group = client.get(f"/api/song-groups/{source['group_id']}").json()
    assert old_group['group_name'] == '原组新名称'
    assert [v['song_id'] for v in old_group['versions']] == [source['song_id']]
    assert old_group['versions'][0]['version_order'] == 1
    # Default versions cannot be moved even if a non-default label is supplied.
    default_payload = edit_payload(client, source['song_id'])
    default_payload['version_label'] = '变更标识'
    default_payload['move_to_group'] = {'group_id': destination['group_id'], 'expected_revision': 2, 'reason': '不允许'}
    assert client.put(f"/api/console/songs/{source['song_id']}/edit", headers=headers, json=default_payload).status_code == 409


# 测试点：旧移组留下序号空缺后，资料或组名修改仍可保存且保留全部版本序号。
@pytest.mark.parametrize(('field', 'version_index'), [
    ('song_name', 1), ('song_name', 2), ('version_label', 2),
    ('cover_urls', 2), ('ownership', 2), ('group_name', 2),
])
def test_metadata_edit_preserves_gapped_version_order(integration_test_client, field, version_index):
    client = integration_test_client
    headers = auth(client)
    source = make_group(client, headers, '序号空缺组')
    moved = add_version(client, headers, source['group_id'], '移出版本')
    add_version(client, headers, source['group_id'], '第三版本')
    add_version(client, headers, source['group_id'], '第四版本')
    destination = make_group(client, headers, '移入组')
    result = client.put(f"/api/console/songs/{moved['song_id']}/group", headers=headers, json={
        'group_id': destination['group_id'], 'expected_revision': moved['revision'], 'reason': '归组更正',
    })
    assert result.status_code == 200, result.text
    before = client.get(f"/api/song-groups/{source['group_id']}").json()
    assert [version['version_order'] for version in before['versions']] == [1, 3, 4]
    sid = before['versions'][version_index]['song_id']
    payload = edit_payload(client, sid)
    if field == 'ownership':
        payload.update(ownership={'mode': 'bands', 'band_ids': [2]}, ownership_reason='归属核实')
    elif field == 'cover_urls':
        payload[field] = ['https://example.test/updated.png']
    elif field == 'group_name':
        payload['group'][field] = '更新后的组名'
    else:
        payload[field] = '更新后的资料'
    result = client.put(f'/api/console/songs/{sid}/edit', headers=headers, json=payload)
    assert result.status_code == 200, result.text
    saved = result.json()
    after = client.get(f"/api/song-groups/{source['group_id']}").json()
    assert after == saved['group']
    assert [(version['song_id'], version['version_order']) for version in after['versions']] == [
        (version['song_id'], version['version_order']) for version in before['versions']
    ]
    assert saved['item']['revision'] == payload['expected_revision'] + 1
    assert after['revision'] == before['revision'] + (1 if field == 'group_name' else 0)
    if field == 'ownership':
        assert saved['item']['ownership']['band_ids'] == [2]
    elif field == 'group_name':
        assert after['group_name'] == payload['group']['group_name']
    else:
        assert saved['item'][field] == payload[field]
    if field != 'group_name':
        assert [version for version in after['versions'] if version['song_id'] != sid] == [
            version for version in before['versions'] if version['song_id'] != sid
        ]


def test_edit_requires_auth_csrf_and_valid_group_membership(integration_test_client):
    client = integration_test_client
    assert client.put('/api/console/songs/1/edit', json={}).status_code == 401
    headers = auth(client)
    song = make_group(client, headers, '权限检查')
    sid = song['song_id']
    payload = edit_payload(client, sid)
    assert client.put(f'/api/console/songs/{sid}/edit', json=payload).status_code == 403
    payload['group']['song_ids'] *= 2
    assert client.put(f'/api/console/songs/{sid}/edit', headers=headers, json=payload).status_code == 422
