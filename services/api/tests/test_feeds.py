from app.ingest import feeds


def test_missing_inbox_is_a_quiet_no_op(fake_session, tmp_path) -> None:
    assert feeds.sync_inventory(fake_session, tmp_path / "inventory.csv") == 0
    assert feeds.ingest_note_drops(fake_session, tmp_path / "notes") == 0


def test_malformed_note_drop_is_skipped_not_fatal(fake_session, tmp_path) -> None:
    (tmp_path / "bad.json").write_text("{not json")
    (tmp_path / "partial.json").write_text('{"id": "x"}')  # no kind or body
    assert feeds.ingest_note_drops(fake_session, tmp_path) == 0
    assert fake_session.statements == []  # nothing landed
