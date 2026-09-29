import pytest
from pydantic import ValidationError

from app.schemas.song_catalog import AlbumUpdate, AlbumWrite, GroupCreate, VersionCreate, VersionUpdate


# 测试点：名称与 URL 一起保留顺序并修剪空格，旧字符串转成未命名封面，省略与清空可区分。
def test_album_links_preserve_urls_and_defaults():
    first = "https://images.example.test/cover?id=2&size=large#front"
    second = "https://images.example.test/cover?id=1"
    album = AlbumWrite.model_validate({"album_name": "盘", "album_url": " https://example.test/disc/1 ",
                                      "cover_urls": [{"url": f" {first} ", "name": " 初回限定盤 "}, second]})
    assert album.album_url == "https://example.test/disc/1"
    assert album.model_dump()["cover_urls"] == [{"url": first, "name": "初回限定盤"}, {"url": second, "name": ""}]
    assert AlbumWrite(album_name="盘", album_url="  ").album_url is None
    assert AlbumWrite(album_name="盘").cover_urls == []
    omitted = AlbumUpdate(album_name="盘", expected_revision=1)
    cleared = AlbumUpdate(album_name="盘", expected_revision=1, album_url=None, cover_urls=[])
    assert "cover_urls" not in omitted.model_fields_set
    assert {"album_url", "cover_urls"} <= cleared.model_fields_set


# 测试点：歌曲各写入口与专辑拒绝危险协议、凭据、控制字符、空值或超长地址，并定位出错的封面。
@pytest.mark.parametrize("model,fields", [(AlbumWrite, {"album_name": "盘"}), (GroupCreate, {"song_name": "曲", "group_name": "曲", "ownership": {"mode": "pending"}}), (VersionCreate, {"song_name": "曲", "group_id": 1, "expected_group_revision": 1, "ownership": {"mode": "pending"}}), (VersionUpdate, {"song_name": "曲", "expected_revision": 1})])
@pytest.mark.parametrize("url", [
    "http://example.test/a", "//example.test/a", "data:image/png;base64,abc", "javascript:alert(1)",
    "file:///a.png", "https://", "https://user:pass@example.test/a", "https://@example.test/a",
    "https://example.test/\na", "\thttps://example.test/a", "https://example.test/a\x7f",
    "https://example.test/a b", "https://example.test\\evil", "", "   ", None,
    "https://example.test/" + "a" * 2048,
])
def test_invalid_cover_url_has_item_location(model, fields, url):
    with pytest.raises(ValidationError) as error:
        model.model_validate({**fields, "cover_urls": [{"url": "https://example.test/ok"}, {"url": url}]})
    assert error.value.errors()[0]["loc"] == ("cover_urls", 1, "url")


# 测试点：不同名称仍不能重复 URL，允许同名不同图，数组数量和空数组边界明确。
def test_duplicate_and_cover_count_limits():
    with pytest.raises(ValidationError) as error:
        AlbumWrite.model_validate({"album_name": "盘", "cover_urls": [
            {"url": "https://example.test/a", "name": "正面"}, {"url": " https://example.test/a ", "name": "背面"}]})
    assert error.value.errors()[0]["loc"] == ("cover_urls", 1, "url")
    covers = [{"url": f"https://example.test/{i}", "name": "同名"} for i in range(20)]
    assert AlbumWrite.model_validate({"album_name": "盘", "cover_urls": covers}).model_dump()["cover_urls"] == covers
    with pytest.raises(ValidationError):
        AlbumWrite.model_validate({"album_name": "盘", "cover_urls": covers + [{"url": "https://example.test/20"}]})
    with pytest.raises(ValidationError):
        AlbumWrite.model_validate({"album_name": "盘", "cover_urls": None})


# 测试点：名称允许省略、空白及 255 字，拒绝超长或非字符串并定位具体名称字段。
def test_cover_name_validation():
    for name in ("", "   ", "名" * 255):
        cover = AlbumWrite.model_validate({"album_name": "盘", "cover_urls": [{"url": "https://example.test/a", "name": name}]}).cover_urls[0]
        assert cover.name == name.strip()
    for name in ("名" * 256, None, 123, {}):
        with pytest.raises(ValidationError) as error:
            AlbumWrite.model_validate({"album_name": "盘", "cover_urls": [{"url": "https://example.test/a", "name": name}]})
        assert error.value.errors()[0]["loc"] == ("cover_urls", 0, "name")


# 测试点：专辑页面与封面采用相同 HTTPS 校验，显式 null 可清除页面。
@pytest.mark.parametrize("url", ["http://example.test", "https://user@example.test", "\n", "https://"])
def test_invalid_album_page(url):
    with pytest.raises(ValidationError) as error:
        AlbumWrite(album_name="盘", album_url=url)
    assert error.value.errors()[0]["loc"] == ("album_url",)
