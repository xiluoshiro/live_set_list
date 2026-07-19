import json
import re
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


def _build_sql_character_class(values: list[str]) -> str:
    """Build a PostgreSQL regular-expression character class from configured punctuation."""
    ordered: list[str] = []
    if "]" in values:
        ordered.append("]")
    if "-" in values:
        ordered.append("-")
    for value in values:
        if value in {"]", "-"}:
            continue
        ordered.append(f"\\{value}" if value in {"\\", "^", "["} else value)
    return f"[{''.join(ordered)}]"


def _build_punctuation_translation() -> tuple[
    dict[int, str],
    str,
    str,
    tuple[str, ...],
    tuple[str, str, str, str],
]:
    """Build Python and PostgreSQL translate maps from shared punctuation groups."""
    python_translation: dict[int, str] = {}
    sql_from_chars: list[str] = []
    sql_to_chars: list[str] = []
    canonical_punctuation: list[str] = []
    seen_chars: set[str] = set()

    for group in SONG_LOOKUP_PUNCTUATION_GROUPS:
        replacement = group[0]
        canonical_punctuation.append(replacement)
        for value in group:
            python_translation[ord(value)] = replacement
            if value not in seen_chars:
                sql_from_chars.append(value)
                sql_to_chars.append(replacement)
                seen_chars.add(value)

    sql_punctuation_class = _build_sql_character_class(canonical_punctuation)
    sql_punctuated_ascii_token = rf"[A-Za-z0-9]+{sql_punctuation_class}[A-Za-z0-9]+"
    sql_whitespace_patterns = (
        rf"\s+({sql_punctuation_class})",
        rf"({sql_punctuation_class})\s+",
        rf"({sql_punctuated_ascii_token})\s+([^ -~])",
        rf"([^ -~])\s+({sql_punctuated_ascii_token})",
    )
    return (
        python_translation,
        "".join(sql_from_chars),
        "".join(sql_to_chars),
        tuple(canonical_punctuation),
        sql_whitespace_patterns,
    )


(
    SONG_LOOKUP_PUNCTUATION_TRANSLATION,
    SONG_LOOKUP_SQL_FROM_CHARS,
    SONG_LOOKUP_SQL_TO_CHARS,
    SONG_LOOKUP_CANONICAL_PUNCTUATION,
    SONG_LOOKUP_SQL_PUNCTUATION_WHITESPACE_PATTERNS,
) = _build_punctuation_translation()

SONG_LOOKUP_PUNCTUATION_WHITESPACE_PATTERN = re.compile(
    rf"\s*([{re.escape(''.join(SONG_LOOKUP_CANONICAL_PUNCTUATION))}])\s*"
)
SONG_LOOKUP_PUNCTUATED_ASCII_TOKEN = (
    rf"[A-Za-z0-9]+[{re.escape(''.join(SONG_LOOKUP_CANONICAL_PUNCTUATION))}][A-Za-z0-9]+"
)
SONG_LOOKUP_PUNCTUATED_TOKEN_BEFORE_NON_ASCII_PATTERN = re.compile(
    rf"({SONG_LOOKUP_PUNCTUATED_ASCII_TOKEN})\s+([^\x00-\x7f])"
)
SONG_LOOKUP_PUNCTUATED_TOKEN_AFTER_NON_ASCII_PATTERN = re.compile(
    rf"([^\x00-\x7f])\s+({SONG_LOOKUP_PUNCTUATED_ASCII_TOKEN})"
)


def normalize_song_lookup_text(value: str) -> str:
    """Normalize song names for lookup-only punctuation equivalence."""
    normalized = unicodedata.normalize("NFKC", value).translate(SONG_LOOKUP_PUNCTUATION_TRANSLATION)
    normalized = SONG_LOOKUP_PUNCTUATION_WHITESPACE_PATTERN.sub(r"\1", normalized)
    normalized = SONG_LOOKUP_PUNCTUATED_TOKEN_BEFORE_NON_ASCII_PATTERN.sub(r"\1\2", normalized)
    normalized = SONG_LOOKUP_PUNCTUATED_TOKEN_AFTER_NON_ASCII_PATTERN.sub(r"\1\2", normalized)
    return normalized.strip().lower()
