import pytest
from pydantic import ValidationError

from app.schemas.song_catalog import AlbumUpdate, AlbumWrite


# 测试点：保留带参数的原始 URL 和封面顺序，仅修剪首尾空格，空页面归一为 null。
def test_album_links_preserve_urls_and_defaults():
    first = "https://images.example.test/cover?id=2&size=large#front"
    second = "https://images.example.test/cover?id=1"
    album = AlbumWrite(album_name="盘", album_url=" https://example.test/disc/1 ", cover_urls=[f" {first} ", second])
    assert album.album_url == "https://example.test/disc/1"
    assert album.cover_urls == [first, second]
    assert AlbumWrite(album_name="盘", album_url="  ").album_url is None
    assert AlbumWrite(album_name="盘").cover_urls == []
    omitted = AlbumUpdate(album_name="盘", expected_revision=1)
    cleared = AlbumUpdate(album_name="盘", expected_revision=1, album_url=None, cover_urls=[])
    assert "cover_urls" not in omitted.model_fields_set
    assert {"album_url", "cover_urls"} <= cleared.model_fields_set


# 测试点：不接受危险协议、凭据、控制字符、空值或超长地址，并定位出错的封面。
@pytest.mark.parametrize("url", [
    "http://example.test/a", "//example.test/a", "data:image/png;base64,abc", "javascript:alert(1)",
    "file:///a.png", "https://", "https://user:pass@example.test/a", "https://@example.test/a",
    "https://example.test/\na", "\thttps://example.test/a", "https://example.test/a\x7f",
    "https://example.test/a b", "https://example.test\\evil", "", "   ", None,
    "https://example.test/" + "a" * 2048,
])
def test_invalid_cover_url_has_item_location(url):
    with pytest.raises(ValidationError) as error:
        AlbumWrite.model_validate({"album_name": "盘", "cover_urls": ["https://example.test/ok", url]})
    assert error.value.errors()[0]["loc"] == ("cover_urls", 1)


# 测试点：修剪后重复的封面可定位到重复项，数组数量和空数组边界明确。
def test_duplicate_and_cover_count_limits():
    with pytest.raises(ValidationError) as error:
        AlbumWrite(album_name="盘", cover_urls=["https://example.test/a", " https://example.test/a "])
    assert error.value.errors()[0]["loc"] == ("cover_urls", 1)
    urls = [f"https://example.test/{i}" for i in range(20)]
    assert AlbumWrite(album_name="盘", cover_urls=urls).cover_urls == urls
    with pytest.raises(ValidationError):
        AlbumWrite(album_name="盘", cover_urls=urls + ["https://example.test/20"])
    with pytest.raises(ValidationError):
        AlbumWrite.model_validate({"album_name": "盘", "cover_urls": None})


# 测试点：专辑页面与封面采用相同 HTTPS 校验，显式 null 可清除页面。
@pytest.mark.parametrize("url", ["http://example.test", "https://user@example.test", "\n", "https://"])
def test_invalid_album_page(url):
    with pytest.raises(ValidationError) as error:
        AlbumWrite(album_name="盘", album_url=url)
    assert error.value.errors()[0]["loc"] == ("album_url",)
