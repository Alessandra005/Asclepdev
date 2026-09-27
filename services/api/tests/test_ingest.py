from app.ingest.pipeline import _normalize_lab_value


def test_normalize_lab_value_preserves_known_unit() -> None:
    assert _normalize_lab_value("2345-7", 110, "mg/dL") == (110.0, "mg/dL")


def test_normalize_lab_value_preserves_missing_unit() -> None:
    assert _normalize_lab_value("2345-7", 110, None) == (110.0, None)


def test_normalize_lab_value_preserves_none_value() -> None:
    assert _normalize_lab_value("2345-7", None, "mg/dL") == (None, "mg/dL")
