import json
import unicodedata
from pathlib import Path
from typing import Any


CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "song_lookup_punctuation_groups.json"


def _load_punctuation_groups() -> list[list[str]]:
    """Load the shared song lookup punctuation equivalence groups."""
    with CONFIG_PATH.open(encoding="utf-8") as config_file:
        raw_config: dict[str, Any] = json.load(config_file)

    groups = raw_config.get("groups")
    if not isinstance(groups, list):
        raise ValueError("song lookup punctuation config must contain a groups list")

    normalized_groups: list[list[str]] = []
    for group in groups:
        if not isinstance(group, list) or len(group) == 0:
            raise ValueError("song lookup punctuation groups must be non-empty lists")
        normalized_group: list[str] = []
        for value in group:
            if not isinstance(value, str) or len(value) != 1:
                raise ValueError("song lookup punctuation entries must be single-character strings")
            normalized_group.append(value)
        normalized_groups.append(normalized_group)
    return normalized_groups


SONG_LOOKUP_PUNCTUATION_GROUPS = _load_punctuation_groups()


def _build_punctuation_translation() -> tuple[dict[int, str], str, str]:
    """Build Python and PostgreSQL translate maps from shared punctuation groups."""
    python_translation: dict[int, str] = {}
    sql_from_chars: list[str] = []
    sql_to_chars: list[str] = []
    seen_chars: set[str] = set()

    for group in SONG_LOOKUP_PUNCTUATION_GROUPS:
        replacement = group[0]
        for value in group:
            python_translation[ord(value)] = replacement
            if value not in seen_chars:
                sql_from_chars.append(value)
                sql_to_chars.append(replacement)
                seen_chars.add(value)

    return python_translation, "".join(sql_from_chars), "".join(sql_to_chars)


SONG_LOOKUP_PUNCTUATION_TRANSLATION, SONG_LOOKUP_SQL_FROM_CHARS, SONG_LOOKUP_SQL_TO_CHARS = (
    _build_punctuation_translation()
)


def normalize_song_lookup_text(value: str) -> str:
    """Normalize song names for lookup-only punctuation equivalence."""
    return unicodedata.normalize("NFKC", value).translate(SONG_LOOKUP_PUNCTUATION_TRANSLATION).strip().lower()
