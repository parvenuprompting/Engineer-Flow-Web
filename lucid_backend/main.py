from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response, status
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .audit import create_audit_event, create_decision, create_manifest
from .config import get_settings
from .database import Base, engine, get_db
from .models import (
    GarageSeenCode,
    ManufacturerDefinition,
    ManifestRequest,
    PartyType,
    PolicyOutcome,
    PolicyDecision,
    AuditEvent,
    Claim,
    EflCase,
    EflDiagnosis,
    Factuur,
    FactuurStatus,
    Werkbon,
    WerkbonStatus,
)
from .policy import (
    PolicyDenied,
    TRIGGER_2,
    TRIGGER_3,
    claim_scoped_vehicle_ref,
    enforce_trigger2_and_consume_grant,
    enforce_trigger3_payload,
    evaluate_data_request,
)
from .rate_limit import rate_limiter
from .schemas import (
    AuditOut,
    ClaimCreateIn,
    ConsentUpsertIn,
    DevTokenIn,
    DevTokenOut,
    DiagnosisEventIn,
    EflCaseConfirmIn,
    EflCaseCreateIn,
    EflDiagnosisMetadataIn,
    EflDiagnosisPersistIn,
    EflAuditSyncIn,
    FactuurCreateIn,
    FeedbackEventIn,
    FeedbackEventOut,
    MembershipInviteIn,
    MembershipStatusIn,
    ManifestRequestIn,
    ManufacturerUpdateIn,
    PolicyEnvelope,
    WerkbonCreateIn,
    WerkbonRegelIn,
)
from .security import AuthContext, get_auth_context, issue_dev_token
from .membership import (
    invite_membership,
    require_active_membership,
    require_garage_mutation_access,
    require_membership_manager,
    update_membership_status,
)
from .models import GarageMembership, Party, User
from .services import (
    add_diagnosis_event,
    add_werkbon_regel,
    afronden_werkbon,
    create_concept_factuur,
    create_feedback_event,
    create_werkbon,
    close_claim,
    finalize_factuur,
    get_factuur,
    get_factuur_by_werkbon,
    get_grootboek_posten,
    get_or_create_party,
    get_werkbon,
    get_vehicle_by_external_ref,
    get_vehicle_dtc_summary,
    get_vehicle_repair_history,
    list_werkbon_regels,
    open_claim,
    bereken_werkbon_subtotaal,
    run_feedback_aggregation_batch,
    run_trigger1_batch,
    seed_demo_data,
    set_owner_consent,
)

settings = get_settings()


def _pdf_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _diagnosis_pdf(title: str, diagnosis_id: str, symptom_text: str, case_status: str | None, dds_case: object) -> bytes:
    lines = [
        title,
        f"Diagnosis ID: {diagnosis_id}",
        f"Symptom: {symptom_text}",
        f"Case status: {case_status or 'unknown'}",
        "",
        "DDS payload:",
        str(dds_case),
    ]
    commands = ["BT", "/F1 10 Tf", "50 760 Td"]
    for index, line in enumerate(lines):
        if index:
            commands.append("0 -16 Td")
        commands.append(f"({_pdf_escape(line[:180])}) Tj")
    commands.append("ET")
    stream = "\n".join(commands).encode("ascii", errors="replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{number} 0 obj\n".encode("ascii"))
        output.extend(obj)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return bytes(output)


def _assert_party_scope(auth: AuthContext) -> None:
    if auth.party_type == PartyType.GARAGE.value and "diagnosis:read_local" not in auth.scopes:
        raise HTTPException(status_code=403, detail="Missing required scope: diagnosis:read_local")
    if auth.party_type == PartyType.FABRIKANT.value and "patterns:read_anon" not in auth.scopes:
        raise HTTPException(status_code=403, detail="Missing required scope: patterns:read_anon")
    if auth.party_type == PartyType.VERZEKERAAR.value and "claim:read_history" not in auth.scopes:
        raise HTTPException(status_code=403, detail="Missing required scope: claim:read_history")


def _assert_garage_write_access(auth: AuthContext) -> None:
    if auth.party_type != PartyType.GARAGE.value:
        raise HTTPException(status_code=403, detail="Alleen garage mag deze actie uitvoeren")
    if "diagnosis:read_local" not in auth.scopes:
        raise HTTPException(status_code=403, detail="Missing required scope: diagnosis:read_local")


def _record_deny_and_raise(
    db: Session,
    *,
    manifest_id: str,
    endpoint: str,
    request_payload: object,
    reason_code: str,
    detail: str,
    status_code: int,
    trigger_id: str | None,
) -> None:
    decision = create_decision(
        db,
        manifest_id=manifest_id,
        outcome=PolicyOutcome.DENY,
        reason_code=reason_code,
        trigger_id=trigger_id,
    )
    error_payload = {"error": detail, "reason_code": reason_code}
    create_audit_event(
        db,
        manifest_id=manifest_id,
        decision_id=decision.id,
        endpoint=endpoint,
        request_payload=request_payload,
        response_payload=error_payload,
    )
    db.commit()
    raise HTTPException(
        status_code=status_code,
        detail={"reason_code": reason_code, "message": detail},
    )


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Conditionele voertuigdata-uitwisseling via LUCID met PostgreSQL + JWT hardening",
    )

    @app.on_event("startup")
    def startup() -> None:
        if not settings.auto_create_schema:
            return
        Base.metadata.create_all(bind=engine)
        with Session(engine) as db:
            seed_demo_data(db)
            db.commit()

    @app.get("/")
    def root() -> dict:
        return {
            "protocol": settings.policy_version,
            "node": "Engineer Flow",
            "mode": "postgres+jwt",
            "sovereignty_rule": "Niet-geanonimiseerde data verlaat de garage nooit.",
        }

    @app.get("/health")
    def health(db: Session = Depends(get_db)) -> dict:
        db.execute(text("SELECT 1"))
        return {
            "status": "ok",
            "db": "reachable",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "efl_audit_ingest_enabled": settings.efl_audit_ingest_enabled,
        }

    @app.get("/policy/version")
    def policy_version() -> dict:
        return {
            "policy_version": settings.policy_version,
            "app_version": settings.app_version,
            "trigger1_batch_interval_minutes": settings.trigger1_batch_interval_minutes,
        }

    @app.post("/cases")
    def efl_case_create(
        payload: EflCaseCreateIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> dict:
        _assert_garage_write_access(auth)
        garage_id = require_garage_mutation_access(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/cases")

        if payload.idempotency_key:
            existing_case = db.execute(
                select(EflCase).where(
                    EflCase.garage_party_id == garage_id,
                    EflCase.idempotency_key == payload.idempotency_key,
                )
            ).scalar_one_or_none()
            if existing_case:
                return {
                    "case_id": existing_case.id,
                    "status": existing_case.status,
                    "vehicle_id": existing_case.vehicle_ref,
                    "garage_id": existing_case.garage_party_id,
                    "created_at": existing_case.created_at,
                    "idempotent_replay": True,
                }

        case = EflCase(
            garage_party_id=garage_id,
            owner_subject=auth.sub,
            vehicle_ref=payload.vehicle_id,
            status="open",
            idempotency_key=payload.idempotency_key,
        )
        db.add(case)
        db.commit()
        db.refresh(case)
        return {
            "case_id": case.id,
            "status": case.status,
            "vehicle_id": case.vehicle_ref,
            "garage_id": case.garage_party_id,
            "created_at": case.created_at,
        }

    @app.get("/cases/{case_id}")
    def efl_case_detail(
        case_id: str,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> dict:
        _assert_garage_write_access(auth)
        garage_id = require_active_membership(db, auth).garage_party_id
        case = db.execute(
            select(EflCase).where(EflCase.id == case_id, EflCase.garage_party_id == garage_id)
        ).scalar_one_or_none()
        if case is None:
            raise HTTPException(status_code=404, detail="Case niet gevonden")
        return {
            "case_id": case.id,
            "status": case.status,
            "vehicle_id": case.vehicle_ref,
            "garage_id": case.garage_party_id,
            "confirmed_failure_mode_id": case.confirmed_failure_mode_id,
            "created_at": case.created_at,
            "updated_at": case.updated_at,
        }

    @app.post("/cases/{case_id}/confirm")
    def efl_case_confirm(
        case_id: str,
        payload: EflCaseConfirmIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> dict:
        _assert_garage_write_access(auth)
        garage_id = require_garage_mutation_access(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/cases/{case_id}/confirm")
        case = db.get(EflCase, case_id)
        if not case:
            raise HTTPException(status_code=404, detail="Case niet gevonden")
        if case.garage_party_id != garage_id:
            raise HTTPException(status_code=403, detail="Case behoort niet tot deze garage")

        case.confirmed_failure_mode_id = payload.failure_mode_id
        case.confirmed_at = datetime.now(timezone.utc)
        case.status = "confirmed"
        case.updated_at = case.confirmed_at
        db.add(case)
        db.commit()
        return {
            "success": True,
            "case_id": case.id,
            "failure_mode_id": case.confirmed_failure_mode_id,
            "status": case.status,
            "confirmed_at": case.confirmed_at,
        }

    @app.post("/diagnoses")
    def efl_diagnosis_persist(
        payload: EflDiagnosisPersistIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> dict:
        _assert_garage_write_access(auth)
        garage_id = require_garage_mutation_access(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/diagnoses")

        case = db.get(EflCase, payload.case_id)
        if not case:
            raise HTTPException(status_code=404, detail="Case niet gevonden")
        if case.garage_party_id != garage_id:
            raise HTTPException(status_code=403, detail="Case behoort niet tot deze garage")

        existing = db.execute(
            select(EflDiagnosis).where(
                EflDiagnosis.diagnosis_id == payload.diagnosis_id,
                EflDiagnosis.garage_party_id == garage_id,
            )
        ).scalar_one_or_none()
        if not existing and payload.idempotency_key:
            existing = db.execute(
                select(EflDiagnosis).where(EflDiagnosis.idempotency_key == payload.idempotency_key)
            ).scalar_one_or_none()
        if existing:
            return {
                "diagnosis_id": existing.diagnosis_id,
                "case_id": existing.case_id,
                "status": "duplicate",
                "created_at": existing.created_at,
            }

        response_payload = payload.response
        diagnosis = EflDiagnosis(
            diagnosis_id=payload.diagnosis_id,
            case_id=case.id,
            garage_party_id=garage_id,
            owner_subject=auth.sub,
            symptom_text=payload.symptom_text,
            engine_version=str(response_payload.get("audit_trail", {}).get("engine_version", "unknown")),
            response_payload=response_payload,
            idempotency_key=payload.idempotency_key,
        )
        case.updated_at = datetime.now(timezone.utc)
        response = {
            "diagnosis_id": diagnosis.diagnosis_id,
            "case_id": diagnosis.case_id,
            "status": "persisted",
        }
        manifest = create_manifest(
            db,
            payload={
                "action": "diagnosis_persist",
                "diagnosis_id": payload.diagnosis_id,
                "case_id": payload.case_id,
                "idempotency_key": payload.idempotency_key,
            },
            party_id=garage_id,
            party_type=auth.party_type,
        )
        decision = create_decision(
            db,
            manifest_id=manifest.id,
            outcome=PolicyOutcome.ALLOW,
            reason_code="ALLOW_DIAGNOSIS_PERSISTED",
            trigger_id=None,
        )
        db.add(diagnosis)
        db.add(case)
        create_audit_event(
            db,
            manifest_id=manifest.id,
            decision_id=decision.id,
            endpoint="/diagnoses",
            request_payload=payload.model_dump(mode="json"),
            response_payload=response,
        )
        db.commit()
        db.refresh(diagnosis)
        return {**response, "created_at": diagnosis.created_at, "manifest_id": manifest.id, "decision_id": decision.id}

    def _serialize_efl_diagnosis(diagnosis: EflDiagnosis) -> dict:
        return {
            "diagnosis_id": diagnosis.diagnosis_id,
            "case_id": diagnosis.case_id,
            "symptom_text": diagnosis.symptom_text,
            "created_at": diagnosis.created_at,
            "engine_version": diagnosis.engine_version,
            "response": diagnosis.response_payload,
            "metadata": diagnosis.case_metadata,
            "case_status": diagnosis.case.status if diagnosis.case else None,
        }

    @app.get("/diagnoses")
    def efl_diagnosis_list(
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
        offset: int = Query(default=0, ge=0, le=100000),
        limit: int = Query(default=50, ge=1, le=100),
        status_filter: str | None = Query(default=None, alias="status"),
        vehicle_id: str | None = Query(default=None),
        q: str | None = Query(default=None, min_length=1),
        cluster_filter: str | None = Query(default=None, alias="cluster", min_length=1),
        from_date: datetime | None = Query(default=None),
        to_date: datetime | None = Query(default=None),
    ) -> dict:
        _assert_garage_write_access(auth)
        garage_id = require_active_membership(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/diagnoses")
        stmt = (
            select(EflDiagnosis)
            .where(EflDiagnosis.garage_party_id == garage_id)
            .order_by(EflDiagnosis.created_at.desc())
        )
        candidates = db.execute(stmt).scalars().all()
        filtered = []
        query_text = q.lower() if q else None
        for diagnosis in candidates:
            metadata = diagnosis.case_metadata or {}
            response = diagnosis.response_payload or {}
            cluster = str(response.get("symptom_cluster") or response.get("symptom_cluster_name") or "")
            if cluster and cluster_filter and cluster_filter.lower() not in cluster.lower():
                continue
            if from_date and diagnosis.created_at < from_date:
                continue
            if to_date and diagnosis.created_at >= to_date:
                continue
            effective_status = str(metadata.get("status") or ("resolved" if metadata.get("confirmed_fix_id") else "under_investigation"))
            if status_filter and effective_status != status_filter:
                continue
            if vehicle_id and metadata.get("vehicle_id") != vehicle_id:
                continue
            if query_text and query_text not in f"{diagnosis.diagnosis_id} {diagnosis.symptom_text} {cluster}".lower():
                continue
            filtered.append(diagnosis)
        page = filtered[offset : offset + limit]
        return {
            "diagnoses": [_serialize_efl_diagnosis(diagnosis) for diagnosis in page],
            "pagination": {
                "offset": offset,
                "limit": limit,
                "total": len(filtered),
                "has_more": offset + limit < len(filtered),
            },
        }

    @app.get("/diagnoses/{diagnosis_id}/export")
    def efl_diagnosis_export(
        diagnosis_id: str,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
        export_format: str = Query(default="dds", alias="format"),
    ) -> Response:
        _assert_garage_write_access(auth)
        garage_id = require_active_membership(db, auth).garage_party_id
        diagnosis = db.execute(
            select(EflDiagnosis).where(
                EflDiagnosis.diagnosis_id == diagnosis_id,
                EflDiagnosis.garage_party_id == garage_id,
            )
        ).scalar_one_or_none()
        if not diagnosis:
            raise HTTPException(status_code=404, detail="Diagnose niet gevonden")
        dds_case = diagnosis.response_payload.get("dds_case") or diagnosis.response_payload
        import json

        if export_format.lower() == "pdf":
            return Response(
                content=_diagnosis_pdf(
                    diagnosis.case_metadata.get("title") or "Engineer Flow diagnose",
                    diagnosis_id,
                    diagnosis.symptom_text,
                    diagnosis.case.status if diagnosis.case else None,
                    dds_case,
                ),
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="{diagnosis_id}.pdf"'},
            )
        if export_format.lower() != "dds":
            raise HTTPException(status_code=400, detail="format moet dds of pdf zijn")

        return Response(
            content=json.dumps(dds_case, ensure_ascii=True, indent=2, default=str),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{diagnosis_id}.dds.json"'},
        )

    @app.get("/diagnoses/{diagnosis_id}")
    def efl_diagnosis_detail(
        diagnosis_id: str,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> dict:
        _assert_garage_write_access(auth)
        garage_id = require_active_membership(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/diagnoses/{diagnosis_id}")
        diagnosis = db.execute(
            select(EflDiagnosis).where(
                EflDiagnosis.diagnosis_id == diagnosis_id,
                EflDiagnosis.garage_party_id == garage_id,
            )
        ).scalar_one_or_none()
        if not diagnosis:
            raise HTTPException(status_code=404, detail="Diagnose niet gevonden")
        return _serialize_efl_diagnosis(diagnosis)

    @app.patch("/diagnoses/{diagnosis_id}")
    def efl_diagnosis_update(
        diagnosis_id: str,
        payload: EflDiagnosisMetadataIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> dict:
        _assert_garage_write_access(auth)
        garage_id = require_garage_mutation_access(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/diagnoses/{diagnosis_id}")
        diagnosis = db.execute(
            select(EflDiagnosis).where(
                EflDiagnosis.diagnosis_id == diagnosis_id,
                EflDiagnosis.garage_party_id == garage_id,
            )
        ).scalar_one_or_none()
        if not diagnosis:
            raise HTTPException(status_code=404, detail="Diagnose niet gevonden")

        updates = payload.model_dump(exclude_none=True)
        diagnosis.case_metadata = {**diagnosis.case_metadata, **updates}
        db.add(diagnosis)
        db.commit()
        db.refresh(diagnosis)
        return _serialize_efl_diagnosis(diagnosis)

    @app.delete("/diagnoses/{diagnosis_id}")
    def efl_diagnosis_delete(
        diagnosis_id: str,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> dict:
        _assert_garage_write_access(auth)
        garage_id = require_garage_mutation_access(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/diagnoses/{diagnosis_id}")
        diagnosis = db.execute(
            select(EflDiagnosis).where(
                EflDiagnosis.diagnosis_id == diagnosis_id,
                EflDiagnosis.garage_party_id == garage_id,
            )
        ).scalar_one_or_none()
        if not diagnosis:
            raise HTTPException(status_code=404, detail="Diagnose niet gevonden")
        manifest = create_manifest(
            db,
            payload={"action": "diagnosis_delete", "diagnosis_id": diagnosis_id},
            party_id=garage_id,
            party_type=auth.party_type,
        )
        decision = create_decision(
            db,
            manifest_id=manifest.id,
            outcome=PolicyOutcome.ALLOW,
            reason_code="ALLOW_DIAGNOSIS_DELETED",
            trigger_id=None,
        )
        db.delete(diagnosis)
        create_audit_event(
            db,
            manifest_id=manifest.id,
            decision_id=decision.id,
            endpoint="/diagnoses/{diagnosis_id}",
            request_payload={"diagnosis_id": diagnosis_id},
            response_payload={"deleted": True, "diagnosis_id": diagnosis_id},
        )
        db.commit()
        return {"deleted": True, "diagnosis_id": diagnosis_id, "audit_manifest_id": manifest.id}

    @app.post("/auth/dev-token", response_model=DevTokenOut)
    def auth_dev_token(payload: DevTokenIn) -> DevTokenOut:
        token = issue_dev_token(
            subject=payload.subject,
            party_type=payload.party_type,
            party_id=payload.party_id,
            scopes=payload.scopes,
            expires_in_minutes=payload.expires_in_minutes,
        )
        return DevTokenOut(token=token, expires_in_minutes=payload.expires_in_minutes)

    @app.get("/garages/{garage_id}/memberships")
    def list_garage_memberships(
        garage_id: str,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> list[dict]:
        require_active_membership(db, auth, garage_id)
        memberships = db.execute(
            select(GarageMembership, User)
            .join(User, GarageMembership.user_id == User.id)
            .where(GarageMembership.garage_party_id == garage_id)
            .order_by(GarageMembership.invited_at)
        ).all()
        return [
            {
                "membership_id": membership.id,
                "firebase_uid": user.firebase_uid,
                "email": user.email,
                "display_name": user.display_name,
                "role": membership.role,
                "status": membership.status,
                "invited_at": membership.invited_at,
                "activated_at": membership.activated_at,
                "revoked_at": membership.revoked_at,
            }
            for membership, user in memberships
        ]

    @app.post("/garages/{garage_id}/memberships")
    def create_garage_membership(
        garage_id: str,
        payload: MembershipInviteIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> dict:
        require_membership_manager(db, auth, garage_id)
        garage = db.get(Party, garage_id)
        if garage is None:
            raise HTTPException(status_code=404, detail="Garage niet gevonden")
        membership = invite_membership(
            db,
            garage=garage,
            firebase_uid=payload.firebase_uid,
            role=payload.role,
            email=payload.email,
            display_name=payload.display_name,
        )
        db.commit()
        return {"membership_id": membership.id, "garage_id": garage_id, "status": membership.status, "role": membership.role}

    @app.patch("/garages/{garage_id}/memberships/{membership_id}")
    def change_garage_membership_status(
        garage_id: str,
        membership_id: str,
        payload: MembershipStatusIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> dict:
        require_membership_manager(db, auth, garage_id)
        membership = db.get(GarageMembership, membership_id)
        if membership is None or membership.garage_party_id != garage_id:
            raise HTTPException(status_code=404, detail="Membership niet gevonden")
        update_membership_status(db, membership, payload.status)
        db.commit()
        return {"membership_id": membership.id, "garage_id": garage_id, "status": membership.status}

    @app.post("/internal/efl-audit-events")
    def ingest_efl_audit_events(
        payload: EflAuditSyncIn,
        db: Session = Depends(get_db),
        x_efl_audit_secret: str | None = Header(default=None),
    ) -> dict:
        if not settings.efl_audit_ingest_enabled:
            raise HTTPException(status_code=503, detail="EFL audit ingest disabled")

        if x_efl_audit_secret != settings.efl_audit_ingest_secret:
            raise HTTPException(status_code=403, detail="Invalid EFL audit ingest secret")

        accepted = 0
        duplicate = 0

        for event in payload.events:
            existing = db.execute(
                select(PolicyDecision).where(
                    PolicyDecision.reason_code == "EFL_AUDIT_INGEST",
                    PolicyDecision.trigger_id == event.event_id,
                )
            ).scalar_one_or_none()
            if existing:
                duplicate += 1
                continue

            manifest = create_manifest(
                db,
                payload={
                    "source": "efl_core_next_adapter",
                    "event_id": event.event_id,
                    "event_type": event.event_type,
                    "created_at": event.created_at,
                    "execution_signature": event.execution_signature,
                    "payload_hash": event.payload_hash,
                    "previous_event_hash": event.previous_event_hash,
                    "case_id": event.case_id,
                    "diagnosis_id": event.diagnosis_id,
                    "payload": event.payload,
                },
                party_id="efl-core",
                party_type="system",
            )
            decision = create_decision(
                db,
                manifest_id=manifest.id,
                outcome=PolicyOutcome.ALLOW,
                reason_code="EFL_AUDIT_INGEST",
                trigger_id=event.event_id,
            )
            create_audit_event(
                db,
                manifest_id=manifest.id,
                decision_id=decision.id,
                endpoint="/internal/efl-audit-events",
                request_payload=event.payload,
                response_payload={
                    "event_id": event.event_id,
                    "execution_signature": event.execution_signature,
                    "accepted": True,
                },
            )
            accepted += 1

        db.commit()
        return {
            "status": "accepted",
            "accepted": accepted,
            "duplicate": duplicate,
        }

    @app.post("/garage/diagnosis-events")
    def garage_add_event(
        payload: DiagnosisEventIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> dict:
        if auth.party_type != PartyType.GARAGE.value:
            raise HTTPException(status_code=403, detail="Alleen garage mag diagnosis events registreren")
        if "diagnosis:read_local" not in auth.scopes:
            raise HTTPException(status_code=403, detail="Missing required scope: diagnosis:read_local")

        garage_id = require_garage_mutation_access(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/garage/diagnosis-events")

        event = add_diagnosis_event(
            db,
            garage_party_id=garage_id,
            vehicle_ref=payload.voertuig_id,
            dtc_code=payload.dtc_code,
            occurred_at=payload.occurred_at,
            source=payload.source,
            repair_action=payload.repair_action,
        )
        db.commit()

        return {
            "status": "registered",
            "event_id": event.id,
            "voertuig_id": payload.voertuig_id,
            "dtc_code": payload.dtc_code,
        }

    @app.post("/claims")
    def claims_open(
        payload: ClaimCreateIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> dict:
        if auth.party_type != PartyType.VERZEKERAAR.value:
            raise HTTPException(status_code=403, detail="Alleen verzekeraar mag claims openen")
        if "claim:read_history" not in auth.scopes:
            raise HTTPException(status_code=403, detail="Missing required scope: claim:read_history")

        rate_limiter.hit(auth.party_id, "/claims")

        get_or_create_party(db, party_id=auth.party_id, party_type=auth.party_type)
        vehicle = get_vehicle_by_external_ref(db, payload.voertuig_id)
        if not vehicle:
            raise HTTPException(status_code=404, detail="Voertuig niet gevonden")

        claim, grant = open_claim(
            db,
            insurer_party_id=auth.party_id,
            vehicle_id=vehicle.id,
            access_ttl_minutes=payload.access_ttl_minutes,
        )
        db.commit()

        return {
            "claim_id": claim.id,
            "status": claim.status,
            "access_grant_id": grant.id,
            "access_expires_at": grant.expires_at,
        }

    @app.post("/claims/{claim_id}/close")
    def claims_close(
        claim_id: str,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> dict:
        if auth.party_type != PartyType.VERZEKERAAR.value:
            raise HTTPException(status_code=403, detail="Alleen verzekeraar mag claims sluiten")
        if "claim:read_history" not in auth.scopes:
            raise HTTPException(status_code=403, detail="Missing required scope: claim:read_history")

        rate_limiter.hit(auth.party_id, "/claims/{claim_id}/close")

        claim = db.get(Claim, claim_id)
        if not claim:
            raise HTTPException(status_code=404, detail="Claim niet gevonden")
        if claim.insurer_party_id != auth.party_id:
            raise HTTPException(status_code=403, detail="Claim behoort niet tot deze verzekeraar")

        claim = close_claim(db, claim)
        db.commit()

        return {
            "claim_id": claim.id,
            "status": claim.status,
            "closed_at": claim.closed_at,
        }

    @app.post("/consents")
    def consents_upsert(
        payload: ConsentUpsertIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> dict:
        if auth.party_type != PartyType.GARAGE.value:
            raise HTTPException(status_code=403, detail="Alleen garage mag consent beheren")
        if "consent:write" not in auth.scopes:
            raise HTTPException(status_code=403, detail="Missing required scope: consent:write")

        garage_id = require_garage_mutation_access(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/consents")

        vehicle = get_vehicle_by_external_ref(db, payload.voertuig_id)
        if not vehicle:
            raise HTTPException(status_code=404, detail="Voertuig niet gevonden")
        if vehicle.garage_party_id != garage_id:
            raise HTTPException(status_code=403, detail="Voertuig behoort niet tot deze garage")

        consent = set_owner_consent(
            db,
            vehicle_id=vehicle.id,
            consent_type=payload.consent_type,
            granted=payload.granted,
        )
        db.commit()

        return {
            "consent_id": consent.id,
            "voertuig_id": payload.voertuig_id,
            "consent_type": consent.consent_type,
            "granted": consent.granted,
            "granted_at": consent.granted_at,
            "revoked_at": consent.revoked_at,
        }

    @app.post("/werkbonnen", response_model=PolicyEnvelope)
    def werkbon_aanmaken(
        payload: WerkbonCreateIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> PolicyEnvelope:
        _assert_garage_write_access(auth)
        garage_id = require_garage_mutation_access(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/werkbonnen")

        if payload.idempotency_key:
            existing_werkbon = db.execute(
                select(Werkbon).where(
                    Werkbon.garage_party_id == garage_id,
                    Werkbon.idempotency_key == payload.idempotency_key,
                )
            ).scalar_one_or_none()
            if existing_werkbon:
                return PolicyEnvelope(
                    manifest_id="idempotent-replay",
                    decision_id="idempotent-replay",
                    policy_version=settings.policy_version,
                    data={
                        "werkbon_id": existing_werkbon.id,
                        "voertuig_id": existing_werkbon.voertuig_id,
                        "root_cause": existing_werkbon.root_cause,
                        "status": existing_werkbon.status,
                        "idempotent_replay": True,
                    },
                )

        manifest_payload = {
            "action": "werkbon_aanmaken",
            **payload.model_dump(mode="json"),
        }
        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=garage_id,
            party_type=auth.party_type,
        )

        vehicle = get_vehicle_by_external_ref(db, payload.voertuig_id)
        if not vehicle:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/werkbonnen",
                request_payload=manifest_payload,
                reason_code="VEHICLE_NOT_FOUND",
                detail="Voertuig niet gevonden.",
                status_code=404,
                trigger_id=None,
            )
        if vehicle.garage_party_id != garage_id:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/werkbonnen",
                request_payload=manifest_payload,
                reason_code="GARAGE_NOT_OWNER",
                detail="Garage mag alleen werkbonnen maken voor eigen voertuigen.",
                status_code=403,
                trigger_id=None,
            )
        case = db.get(EflCase, payload.case_id)
        if not case or case.garage_party_id != garage_id:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/werkbonnen",
                request_payload=manifest_payload,
                reason_code="CASE_NOT_FOUND_OR_NOT_OWNED",
                detail="Werkbon moet aan een case van deze garage gekoppeld zijn.",
                status_code=404,
                trigger_id=None,
            )

        werkbon = create_werkbon(
            db,
            case_id=case.id,
            voertuig_id=vehicle.id,
            garage_party_id=garage_id,
            root_cause=payload.root_cause,
            idempotency_key=payload.idempotency_key,
        )
        decision = create_decision(
            db,
            manifest_id=manifest.id,
            outcome=PolicyOutcome.ALLOW,
            reason_code="ALLOW_WERKBON_CREATED",
            trigger_id=None,
        )
        response_payload = {
            "manifest_id": manifest.id,
            "decision_id": decision.id,
            "policy_version": settings.policy_version,
            "data": {
                "werkbon_id": werkbon.id,
                "case_id": werkbon.case_id,
                "voertuig_id": payload.voertuig_id,
                "root_cause": werkbon.root_cause,
                "status": werkbon.status,
                "aangemaakt_at": werkbon.aangemaakt_at,
                "afgerond_at": werkbon.afgerond_at,
            },
        }
        create_audit_event(
            db,
            manifest_id=manifest.id,
            decision_id=decision.id,
            endpoint="/werkbonnen",
            request_payload=manifest_payload,
            response_payload=response_payload,
        )
        db.commit()
        return PolicyEnvelope(**response_payload)

    @app.post("/werkbonnen/{werkbon_id}/regels", response_model=PolicyEnvelope)
    def werkbon_regel_toevoegen(
        werkbon_id: str,
        payload: WerkbonRegelIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> PolicyEnvelope:
        _assert_garage_write_access(auth)
        garage_id = require_garage_mutation_access(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/werkbonnen/{id}/regels")

        manifest_payload = {
            "action": "werkbon_regel_toevoegen",
            "werkbon_id": werkbon_id,
            **payload.model_dump(mode="json"),
        }
        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=garage_id,
            party_type=auth.party_type,
        )

        werkbon = get_werkbon(db, werkbon_id)
        if not werkbon:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/werkbonnen/{id}/regels",
                request_payload=manifest_payload,
                reason_code="WERKBON_NOT_FOUND",
                detail="Werkbon niet gevonden.",
                status_code=404,
                trigger_id=None,
            )
        if werkbon.garage_party_id != garage_id:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/werkbonnen/{id}/regels",
                request_payload=manifest_payload,
                reason_code="GARAGE_NOT_OWNER",
                detail="Werkbon behoort niet tot deze garage.",
                status_code=403,
                trigger_id=None,
            )
        if werkbon.status != WerkbonStatus.OPEN.value:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/werkbonnen/{id}/regels",
                request_payload=manifest_payload,
                reason_code="WERKBON_NOT_OPEN",
                detail="Regels toevoegen kan alleen op open werkbonnen.",
                status_code=409,
                trigger_id=None,
            )

        regel = add_werkbon_regel(
            db,
            werkbon=werkbon,
            omschrijving=payload.omschrijving,
            uren=payload.uren,
            uurtarief=payload.uurtarief,
            onderdeel_code=payload.onderdeel_code,
            onderdeel_prijs=payload.onderdeel_prijs,
        )
        regel_totaal = (payload.uren * payload.uurtarief) + payload.onderdeel_prijs
        subtotaal = float(bereken_werkbon_subtotaal(db, werkbon.id))

        decision = create_decision(
            db,
            manifest_id=manifest.id,
            outcome=PolicyOutcome.ALLOW,
            reason_code="ALLOW_WERKBON_REGEL_CREATED",
            trigger_id=None,
        )
        response_payload = {
            "manifest_id": manifest.id,
            "decision_id": decision.id,
            "policy_version": settings.policy_version,
            "data": {
                "werkbon_id": werkbon.id,
                "werkbon_regel_id": regel.id,
                "status": werkbon.status,
                "regel": {
                    "omschrijving": regel.omschrijving,
                    "uren": float(regel.uren),
                    "uurtarief": float(regel.uurtarief),
                    "onderdeel_code": regel.onderdeel_code,
                    "onderdeel_prijs": float(regel.onderdeel_prijs),
                    "regel_totaal": round(regel_totaal, 2),
                },
                "werkbon_subtotaal": subtotaal,
            },
        }
        create_audit_event(
            db,
            manifest_id=manifest.id,
            decision_id=decision.id,
            endpoint="/werkbonnen/{id}/regels",
            request_payload=manifest_payload,
            response_payload=response_payload,
        )
        db.commit()
        return PolicyEnvelope(**response_payload)

    @app.post("/werkbonnen/{werkbon_id}/afronden", response_model=PolicyEnvelope)
    def werkbon_afronden(
        werkbon_id: str,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> PolicyEnvelope:
        _assert_garage_write_access(auth)
        garage_id = require_garage_mutation_access(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/werkbonnen/{id}/afronden")

        manifest_payload = {
            "action": "werkbon_afronden",
            "werkbon_id": werkbon_id,
        }
        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=garage_id,
            party_type=auth.party_type,
        )

        werkbon = get_werkbon(db, werkbon_id)
        if not werkbon:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/werkbonnen/{id}/afronden",
                request_payload=manifest_payload,
                reason_code="WERKBON_NOT_FOUND",
                detail="Werkbon niet gevonden.",
                status_code=404,
                trigger_id=None,
            )
        if werkbon.garage_party_id != garage_id:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/werkbonnen/{id}/afronden",
                request_payload=manifest_payload,
                reason_code="GARAGE_NOT_OWNER",
                detail="Werkbon behoort niet tot deze garage.",
                status_code=403,
                trigger_id=None,
            )

        if werkbon.status == WerkbonStatus.OPEN.value:
            werkbon = afronden_werkbon(db, werkbon)

        decision = create_decision(
            db,
            manifest_id=manifest.id,
            outcome=PolicyOutcome.ALLOW,
            reason_code="ALLOW_WERKBON_AFGEROND",
            trigger_id=None,
        )
        response_payload = {
            "manifest_id": manifest.id,
            "decision_id": decision.id,
            "policy_version": settings.policy_version,
            "data": {
                "werkbon_id": werkbon.id,
                "status": werkbon.status,
                "afgerond_at": werkbon.afgerond_at,
            },
        }
        create_audit_event(
            db,
            manifest_id=manifest.id,
            decision_id=decision.id,
            endpoint="/werkbonnen/{id}/afronden",
            request_payload=manifest_payload,
            response_payload=response_payload,
        )
        db.commit()
        return PolicyEnvelope(**response_payload)

    @app.post("/facturen", response_model=PolicyEnvelope)
    def factuur_aanmaken(
        payload: FactuurCreateIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> PolicyEnvelope:
        _assert_garage_write_access(auth)
        garage_id = require_garage_mutation_access(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/facturen")

        if payload.idempotency_key:
            existing_factuur = db.execute(
                select(Factuur).where(
                    Factuur.garage_party_id == garage_id,
                    Factuur.idempotency_key == payload.idempotency_key,
                )
            ).scalar_one_or_none()
            if existing_factuur:
                return PolicyEnvelope(
                    manifest_id="idempotent-replay",
                    decision_id="idempotent-replay",
                    policy_version=settings.policy_version,
                    data={
                        "factuur_id": existing_factuur.id,
                        "werkbon_id": existing_factuur.werkbon_id,
                        "status": existing_factuur.status,
                        "factuurnummer": existing_factuur.factuurnummer,
                        "idempotent_replay": True,
                    },
                )

        manifest_payload = {
            "action": "factuur_aanmaken",
            **payload.model_dump(mode="json"),
        }
        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=garage_id,
            party_type=auth.party_type,
        )

        werkbon = get_werkbon(db, payload.werkbon_id)
        if not werkbon:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/facturen",
                request_payload=manifest_payload,
                reason_code="WERKBON_NOT_FOUND",
                detail="Werkbon niet gevonden.",
                status_code=404,
                trigger_id=None,
            )
        if werkbon.garage_party_id != garage_id:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/facturen",
                request_payload=manifest_payload,
                reason_code="GARAGE_NOT_OWNER",
                detail="Werkbon behoort niet tot deze garage.",
                status_code=403,
                trigger_id=None,
            )
        if werkbon.status != WerkbonStatus.AFGEROND.value:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/facturen",
                request_payload=manifest_payload,
                reason_code="WERKBON_NOT_AFGEROND",
                detail="Factuur kan alleen op een afgeronde werkbon worden gemaakt.",
                status_code=409,
                trigger_id=None,
            )

        existing_factuur = get_factuur_by_werkbon(db, werkbon.id)
        if existing_factuur:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/facturen",
                request_payload=manifest_payload,
                reason_code="FACTUUR_ALREADY_EXISTS",
                detail="Er bestaat al een factuur voor deze werkbon.",
                status_code=409,
                trigger_id=None,
            )

        factuur = create_concept_factuur(
            db,
            werkbon=werkbon,
            garage_party_id=garage_id,
            idempotency_key=payload.idempotency_key,
        )
        decision = create_decision(
            db,
            manifest_id=manifest.id,
            outcome=PolicyOutcome.ALLOW,
            reason_code="ALLOW_FACTUUR_CONCEPT_CREATED",
            trigger_id=None,
        )
        response_payload = {
            "manifest_id": manifest.id,
            "decision_id": decision.id,
            "policy_version": settings.policy_version,
            "data": {
                "factuur_id": factuur.id,
                "werkbon_id": factuur.werkbon_id,
                "status": factuur.status,
                "factuurnummer": factuur.factuurnummer,
                "subtotaal": float(factuur.subtotaal),
                "btw": float(factuur.btw),
                "totaal": float(factuur.totaal),
                "aangemaakt_at": factuur.aangemaakt_at,
                "gefinaliseerd_at": factuur.gefinaliseerd_at,
            },
        }
        create_audit_event(
            db,
            manifest_id=manifest.id,
            decision_id=decision.id,
            endpoint="/facturen",
            request_payload=manifest_payload,
            response_payload=response_payload,
        )
        db.commit()
        return PolicyEnvelope(**response_payload)

    @app.post("/facturen/{factuur_id}/finaliseren", response_model=PolicyEnvelope)
    def factuur_finaliseren(
        factuur_id: str,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> PolicyEnvelope:
        _assert_garage_write_access(auth)
        garage_id = require_garage_mutation_access(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/facturen/{id}/finaliseren")

        manifest_payload = {
            "action": "factuur_finaliseren",
            "factuur_id": factuur_id,
        }
        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=garage_id,
            party_type=auth.party_type,
        )

        factuur = get_factuur(db, factuur_id)
        if not factuur:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/facturen/{id}/finaliseren",
                request_payload=manifest_payload,
                reason_code="FACTUUR_NOT_FOUND",
                detail="Factuur niet gevonden.",
                status_code=404,
                trigger_id=None,
            )
        if factuur.garage_party_id != garage_id:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/facturen/{id}/finaliseren",
                request_payload=manifest_payload,
                reason_code="GARAGE_NOT_OWNER",
                detail="Factuur behoort niet tot deze garage.",
                status_code=403,
                trigger_id=None,
            )
        if factuur.status == FactuurStatus.GEFINALISEERD.value:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/facturen/{id}/finaliseren",
                request_payload=manifest_payload,
                reason_code="FACTUUR_ALREADY_FINALIZED",
                detail="Factuur is al gefinaliseerd.",
                status_code=409,
                trigger_id=None,
            )

        try:
            factuur, posten = finalize_factuur(db, factuur)
        except ValueError as exc:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/facturen/{id}/finaliseren",
                request_payload=manifest_payload,
                reason_code="FACTUUR_FINALIZE_FAILED",
                detail=str(exc),
                status_code=409,
                trigger_id=None,
            )

        decision = create_decision(
            db,
            manifest_id=manifest.id,
            outcome=PolicyOutcome.ALLOW,
            reason_code="ALLOW_FACTUUR_FINALIZED",
            trigger_id=None,
        )
        response_payload = {
            "manifest_id": manifest.id,
            "decision_id": decision.id,
            "policy_version": settings.policy_version,
            "data": {
                "factuur_id": factuur.id,
                "status": factuur.status,
                "factuurnummer": factuur.factuurnummer,
                "subtotaal": float(factuur.subtotaal),
                "btw": float(factuur.btw),
                "totaal": float(factuur.totaal),
                "gefinaliseerd_at": factuur.gefinaliseerd_at,
                "grootboek_posten": [
                    {
                        "id": post.id,
                        "type": post.type,
                        "rekening": post.rekening,
                        "bedrag": float(post.bedrag),
                        "geboekt_at": post.geboekt_at,
                    }
                    for post in posten
                ],
            },
        }
        create_audit_event(
            db,
            manifest_id=manifest.id,
            decision_id=decision.id,
            endpoint="/facturen/{id}/finaliseren",
            request_payload=manifest_payload,
            response_payload=response_payload,
        )
        db.commit()
        return PolicyEnvelope(**response_payload)

    @app.get("/facturen/{factuur_id}", response_model=PolicyEnvelope)
    def factuur_ophalen(
        factuur_id: str,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> PolicyEnvelope:
        _assert_garage_write_access(auth)
        garage_id = require_active_membership(db, auth).garage_party_id
        rate_limiter.hit(garage_id, "/facturen/{id}")

        manifest_payload = {
            "action": "factuur_ophalen",
            "factuur_id": factuur_id,
        }
        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=garage_id,
            party_type=auth.party_type,
        )

        factuur = get_factuur(db, factuur_id)
        if not factuur:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/facturen/{id}",
                request_payload=manifest_payload,
                reason_code="FACTUUR_NOT_FOUND",
                detail="Factuur niet gevonden.",
                status_code=404,
                trigger_id=None,
            )
        if factuur.garage_party_id != garage_id:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/facturen/{id}",
                request_payload=manifest_payload,
                reason_code="GARAGE_NOT_OWNER",
                detail="Factuur behoort niet tot deze garage.",
                status_code=403,
                trigger_id=None,
            )

        werkbon = get_werkbon(db, factuur.werkbon_id)
        regels = list_werkbon_regels(db, factuur.werkbon_id)
        posten = get_grootboek_posten(db, factuur.id)

        decision = create_decision(
            db,
            manifest_id=manifest.id,
            outcome=PolicyOutcome.ALLOW,
            reason_code="ALLOW_FACTUUR_READ",
            trigger_id=None,
        )
        response_payload = {
            "manifest_id": manifest.id,
            "decision_id": decision.id,
            "policy_version": settings.policy_version,
            "data": {
                "factuur_id": factuur.id,
                "werkbon_id": factuur.werkbon_id,
                "status": factuur.status,
                "factuurnummer": factuur.factuurnummer,
                "subtotaal": float(factuur.subtotaal),
                "btw": float(factuur.btw),
                "totaal": float(factuur.totaal),
                "aangemaakt_at": factuur.aangemaakt_at,
                "gefinaliseerd_at": factuur.gefinaliseerd_at,
                "werkbon": {
                    "werkbon_id": werkbon.id if werkbon else None,
                    "status": werkbon.status if werkbon else None,
                    "root_cause": werkbon.root_cause if werkbon else None,
                    "afgerond_at": werkbon.afgerond_at if werkbon else None,
                },
                "regels": [
                    {
                        "id": regel.id,
                        "omschrijving": regel.omschrijving,
                        "uren": float(regel.uren),
                        "uurtarief": float(regel.uurtarief),
                        "onderdeel_code": regel.onderdeel_code,
                        "onderdeel_prijs": float(regel.onderdeel_prijs),
                    }
                    for regel in regels
                ],
                "grootboek_posten": [
                    {
                        "id": post.id,
                        "type": post.type,
                        "rekening": post.rekening,
                        "bedrag": float(post.bedrag),
                        "geboekt_at": post.geboekt_at,
                    }
                    for post in posten
                ],
            },
        }
        create_audit_event(
            db,
            manifest_id=manifest.id,
            decision_id=decision.id,
            endpoint="/facturen/{id}",
            request_payload=manifest_payload,
            response_payload=response_payload,
        )
        db.commit()
        return PolicyEnvelope(**response_payload)

    @app.post("/data/opvragen", response_model=PolicyEnvelope)
    def data_opvragen(
        manifest_in: ManifestRequestIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> PolicyEnvelope:
        _assert_party_scope(auth)
        garage_id = None
        if auth.party_type == PartyType.GARAGE.value:
            garage_id = require_active_membership(db, auth).garage_party_id
        request_party_id = garage_id or auth.party_id
        rate_limiter.hit(request_party_id, "/data/opvragen")
        manifest_payload = manifest_in.model_dump(mode="json")

        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=request_party_id,
            party_type=auth.party_type,
        )

        vehicle = get_vehicle_by_external_ref(db, manifest_in.voertuig_id)
        if not vehicle:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/data/opvragen",
                request_payload=manifest_payload,
                reason_code="VEHICLE_NOT_FOUND",
                detail="Voertuig niet gevonden in garage node.",
                status_code=404,
                trigger_id=None,
            )

        base_decision = evaluate_data_request(auth)
        if not base_decision.allowed:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/data/opvragen",
                request_payload=manifest_payload,
                reason_code=base_decision.reason_code,
                detail="Realtime fabrikant-opvraag is geblokkeerd: gebruik Trigger 1 batch.",
                status_code=403,
                trigger_id=base_decision.trigger_id,
            )

        try:
            if auth.party_type == PartyType.GARAGE.value:
                if vehicle.garage_party_id != garage_id:
                    raise PolicyDenied(
                        reason_code="GARAGE_NOT_OWNER",
                        detail="Garage mag alleen lokale voertuigen opvragen.",
                    )

                data = {
                    "toegang": "volledig",
                    "voertuig_id": vehicle.external_vehicle_ref,
                    "foutcodes": get_vehicle_dtc_summary(db, vehicle.id),
                    "reparatiehistorie": get_vehicle_repair_history(db, vehicle.id),
                }
                reason_code = "ALLOW_GARAGE_LOCAL"
                trigger_id = None

            elif auth.party_type == PartyType.VERZEKERAAR.value:
                claim, _grant = enforce_trigger2_and_consume_grant(
                    db,
                    auth=auth,
                    manifest_claim_id=manifest_in.claim_id,
                    vehicle=vehicle,
                )
                data = {
                    "toegang": "claim-gebonden",
                    "claim_id": claim.id,
                    "claim_scoped_vehicle_ref": claim_scoped_vehicle_ref(claim.id, vehicle.id, vehicle.hash_salt_version),
                    "reparatiehistorie": get_vehicle_repair_history(db, vehicle.id),
                }
                reason_code = "ALLOW_TRIGGER2_CLAIM_HISTORY"
                trigger_id = TRIGGER_2

            else:
                raise PolicyDenied(
                    reason_code="UNSUPPORTED_PARTY_PATH",
                    detail="Deze party type route wordt niet ondersteund.",
                )

            if manifest_in.aanvrager and manifest_in.aanvrager != auth.party_type:
                data["legacy_notice"] = "aanvrager in payload is genegeerd; JWT party_type is leidend"

            decision = create_decision(
                db,
                manifest_id=manifest.id,
                outcome=PolicyOutcome.ALLOW,
                reason_code=reason_code,
                trigger_id=trigger_id,
            )

            response_payload = {
                "manifest_id": manifest.id,
                "decision_id": decision.id,
                "policy_version": settings.policy_version,
                "data": data,
            }

            create_audit_event(
                db,
                manifest_id=manifest.id,
                decision_id=decision.id,
                endpoint="/data/opvragen",
                request_payload=manifest_payload,
                response_payload=response_payload,
            )
            db.commit()

            return PolicyEnvelope(**response_payload)

        except PolicyDenied as denied:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/data/opvragen",
                request_payload=manifest_payload,
                reason_code=denied.reason_code,
                detail=denied.detail,
                status_code=denied.status_code,
                trigger_id=denied.trigger_id,
            )

    @app.post("/fabrikant/update", response_model=PolicyEnvelope)
    def fabrikant_update(
        payload: ManufacturerUpdateIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> PolicyEnvelope:
        if auth.party_type != PartyType.FABRIKANT.value:
            raise HTTPException(status_code=403, detail="Alleen fabrikant mag technische updates pushen")
        if "definitions:write" not in auth.scopes:
            raise HTTPException(status_code=403, detail="Missing required scope: definitions:write")

        rate_limiter.hit(auth.party_id, "/fabrikant/update")

        pseudo_manifest_payload = {
            "trigger": TRIGGER_3,
            "foutcode": payload.foutcode,
            "source_version": payload.source_version,
            "contains_commercial_data": payload.contains_commercial_data,
        }

        manifest = create_manifest(
            db,
            payload=pseudo_manifest_payload,
            party_id=auth.party_id,
            party_type=auth.party_type,
        )

        try:
            enforce_trigger3_payload(payload.contains_commercial_data)

            definition = ManufacturerDefinition(
                dtc_code=payload.foutcode,
                technische_definitie=payload.technische_definitie,
                source_version=payload.source_version,
            )
            db.add(definition)

            stmt = select(GarageSeenCode.garage_party_id).where(GarageSeenCode.dtc_code == payload.foutcode)
            garage_ids = sorted(set(db.execute(stmt).scalars().all()))

            response_data = {
                "trigger": TRIGGER_3,
                "foutcode": payload.foutcode,
                "distributed_to_garages": garage_ids,
                "distributed_count": len(garage_ids),
                "commercieel": False,
            }

            decision = create_decision(
                db,
                manifest_id=manifest.id,
                outcome=PolicyOutcome.ALLOW,
                reason_code="ALLOW_TRIGGER3_TECHNICAL_UPDATE",
                trigger_id=TRIGGER_3,
            )
            response_payload = {
                "manifest_id": manifest.id,
                "decision_id": decision.id,
                "policy_version": settings.policy_version,
                "data": response_data,
            }

            create_audit_event(
                db,
                manifest_id=manifest.id,
                decision_id=decision.id,
                endpoint="/fabrikant/update",
                request_payload=pseudo_manifest_payload,
                response_payload=response_payload,
            )
            db.commit()
            return PolicyEnvelope(**response_payload)

        except PolicyDenied as denied:
            _record_deny_and_raise(
                db,
                manifest_id=manifest.id,
                endpoint="/fabrikant/update",
                request_payload=pseudo_manifest_payload,
                reason_code=denied.reason_code,
                detail=denied.detail,
                status_code=denied.status_code,
                trigger_id=denied.trigger_id,
            )

    @app.post("/jobs/trigger1/run", response_model=PolicyEnvelope)
    def run_trigger1(
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> PolicyEnvelope:
        if auth.party_type != PartyType.GARAGE.value:
            raise HTTPException(status_code=403, detail="Alleen garage mag Trigger 1 batch draaien")
        if "diagnosis:read_local" not in auth.scopes:
            raise HTTPException(status_code=403, detail="Missing required scope: diagnosis:read_local")

        rate_limiter.hit(auth.party_id, "/jobs/trigger1/run")

        manifest_payload = {"trigger": "T1_GARAGE_TO_FABRIKANT", "mode": "batch"}
        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=auth.party_id,
            party_type=auth.party_type,
        )

        batch_result = run_trigger1_batch(db)
        # Keep the API response compatible with clients that consume the batch records directly.
        batch_result["records"] = batch_result.get("sample", [])

        decision = create_decision(
            db,
            manifest_id=manifest.id,
            outcome=PolicyOutcome.ALLOW,
            reason_code="ALLOW_TRIGGER1_BATCH",
            trigger_id="T1_GARAGE_TO_FABRIKANT",
        )

        response_payload = {
            "manifest_id": manifest.id,
            "decision_id": decision.id,
            "policy_version": settings.policy_version,
            "data": batch_result,
        }

        create_audit_event(
            db,
            manifest_id=manifest.id,
            decision_id=decision.id,
            endpoint="/jobs/trigger1/run",
            request_payload=manifest_payload,
            response_payload=response_payload,
        )

        db.commit()
        return PolicyEnvelope(**response_payload)

    @app.get("/manifest/audit/{manifest_id}", response_model=AuditOut)
    def manifest_audit(
        manifest_id: str,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> AuditOut:
        audit_party_id = auth.party_id
        if auth.party_type == PartyType.GARAGE.value:
            audit_party_id = require_active_membership(db, auth).garage_party_id
        rate_limiter.hit(audit_party_id, "/manifest/audit/{manifest_id}")

        manifest = db.get(ManifestRequest, manifest_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Manifest niet gevonden")

        if manifest.party_id != audit_party_id:
            raise HTTPException(status_code=403, detail="Geen toegang tot auditdata van andere partij")

        decisions_stmt = (
            select(PolicyDecision)
            .where(PolicyDecision.manifest_id == manifest_id)
            .order_by(PolicyDecision.created_at.asc())
        )
        events_stmt = (
            select(AuditEvent)
            .where(AuditEvent.manifest_id == manifest_id)
            .order_by(AuditEvent.created_at.asc())
        )

        decisions = db.execute(decisions_stmt).scalars().all()
        events = db.execute(events_stmt).scalars().all()

        return AuditOut(
            manifest_id=manifest.id,
            manifest_payload=manifest.manifest_payload,
            party_id=manifest.party_id,
            party_type=manifest.party_type,
            created_at=manifest.created_at,
            decisions=[
                {
                    "decision_id": d.id,
                    "outcome": d.outcome,
                    "reason_code": d.reason_code,
                    "trigger_id": d.trigger_id,
                    "created_at": d.created_at,
                }
                for d in decisions
            ],
            events=[
                {
                    "event_id": e.id,
                    "endpoint": e.endpoint,
                    "request_hash": e.request_hash,
                    "response_hash": e.response_hash,
                    "created_at": e.created_at,
                }
                for e in events
            ],
        )

    @app.post("/feedback/confirm", response_model=FeedbackEventOut)
    def post_feedback_confirm(
        payload: FeedbackEventIn,
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> FeedbackEventOut:
        _assert_garage_write_access(auth)
        event = create_feedback_event(
            db,
            case_id=payload.case_id,
            failure_mode_id=payload.failure_mode_id,
            success=payload.success,
            garage_party_id=auth.party_id,
        )
        db.commit()
        db.refresh(event)
        return FeedbackEventOut(
            id=event.id,
            case_id=event.case_id,
            failure_mode_id=event.failure_mode_id,
            success=event.success,
            created_at=event.created_at,
            processed=event.processed,
        )

    @app.post("/jobs/feedback/aggregate")
    def trigger_feedback_batch(
        auth: Annotated[AuthContext, Depends(get_auth_context)],
        db: Session = Depends(get_db),
    ) -> dict:
        rate_limiter.hit(auth.party_id, "/jobs/feedback/aggregate")
        result = run_feedback_aggregation_batch(db)
        db.commit()
        return result

    return app
