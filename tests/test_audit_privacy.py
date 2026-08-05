def test_audit_redaction_removes_raw_attachment_values() -> None:
    from lucid_backend.audit import redact_audit_payload

    payload = {
        "photo_data_uri": "data:image/png;base64,secret-bytes",
        "attachment": {"content": "secret-content"},
        "photo_attached": True,
        "diagnosis_id": "diag-1",
    }

    redacted = redact_audit_payload(payload)

    assert redacted == {
        "photo_data_uri": "[REDACTED]",
        "attachment": "[REDACTED]",
        "photo_attached": True,
        "diagnosis_id": "diag-1",
    }
