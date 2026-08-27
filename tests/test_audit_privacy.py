from __future__ import annotations

import pytest

from lucid_backend.audit import redact_audit_payload


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        (
            {"photo_data_uri": "data:image/png;base64,secret-bytes"},
            {"photo_data_uri": "[REDACTED]"},
        ),
        (
            {"attachment": {"content": "secret-content"}},
            {"attachment": "[REDACTED]"},
        ),
        (
            {"image_data": "raw-bytes", "file_uri": "s3://secret"},
            {"image_data": "[REDACTED]", "file_uri": "[REDACTED]"},
        ),
        (
            {"photo_attached": True, "image_attached": False},
            {"photo_attached": True, "image_attached": False},
        ),
        (
            {"PHOTO_DATA_URI": "x"},
            {"PHOTO_DATA_URI": "[REDACTED]"},
        ),
        (
            {"payload": {"attachment": "secret", "diagnosis_id": "diag-1"}},
            {"payload": {"attachment": "[REDACTED]", "diagnosis_id": "diag-1"}},
        ),
        (
            {"items": [{"photo": "x"}, {"photo_attached": True, "label": "ok"}]},
            {"items": [{"photo": "[REDACTED]"}, {"photo_attached": True, "label": "ok"}]},
        ),
        (
            {"list": ["plain", {"photo": "x"}]},
            {"list": ["plain", {"photo": "[REDACTED]"}]},
        ),
        (
            {"diagnosis_id": "diag-1", "symptom_text": "ok", "count": 3},
            {"diagnosis_id": "diag-1", "symptom_text": "ok", "count": 3},
        ),
    ],
)
def test_redact_audit_payload(payload: dict, expected: dict) -> None:
    assert redact_audit_payload(payload) == expected


def test_redact_audit_payload_does_not_mutate_input() -> None:
    payload = {"photo_data_uri": "secret", "attachment": {"content": "secret"}}
    redact_audit_payload(payload)
    assert payload == {"photo_data_uri": "secret", "attachment": {"content": "secret"}}


def test_redact_audit_payload_redacts_whole_nested_attachment() -> None:
    payload = {"attachment": {"photo_data_uri": "nested-secret"}}
    assert redact_audit_payload(payload) == {"attachment": "[REDACTED]"}
