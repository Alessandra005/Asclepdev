def test_health_is_public_and_reports_each_dependency(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert set(r.json()) == {"db", "lab_tech", "resident", "ehr_a", "ehr_b"}
    assert r.headers["X-Request-Id"].startswith("req_")
