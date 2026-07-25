from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status
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
    FactuurStatus,
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
    EflAuditSyncIn,
    FactuurCreateIn,
    FeedbackEventIn,
    FeedbackEventOut,
    ManifestRequestIn,
    ManufacturerUpdateIn,
    PolicyEnvelope,
    WerkbonCreateIn,
    WerkbonRegelIn,
)
from .security import AuthContext, get_auth_context, issue_dev_token
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

        rate_limiter.hit(auth.party_id, "/garage/diagnosis-events")
        get_or_create_party(db, party_id=auth.party_id, party_type=auth.party_type)

        event = add_diagnosis_event(
            db,
            garage_party_id=auth.party_id,
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

        rate_limiter.hit(auth.party_id, "/consents")

        vehicle = get_vehicle_by_external_ref(db, payload.voertuig_id)
        if not vehicle:
            raise HTTPException(status_code=404, detail="Voertuig niet gevonden")
        if vehicle.garage_party_id != auth.party_id:
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
        rate_limiter.hit(auth.party_id, "/werkbonnen")
        get_or_create_party(db, party_id=auth.party_id, party_type=auth.party_type)

        manifest_payload = {
            "action": "werkbon_aanmaken",
            **payload.model_dump(mode="json"),
        }
        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=auth.party_id,
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
        if vehicle.garage_party_id != auth.party_id:
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

        werkbon = create_werkbon(
            db,
            voertuig_id=vehicle.id,
            garage_party_id=auth.party_id,
            root_cause=payload.root_cause,
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
        rate_limiter.hit(auth.party_id, "/werkbonnen/{id}/regels")

        manifest_payload = {
            "action": "werkbon_regel_toevoegen",
            "werkbon_id": werkbon_id,
            **payload.model_dump(mode="json"),
        }
        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=auth.party_id,
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
        if werkbon.garage_party_id != auth.party_id:
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
        rate_limiter.hit(auth.party_id, "/werkbonnen/{id}/afronden")

        manifest_payload = {
            "action": "werkbon_afronden",
            "werkbon_id": werkbon_id,
        }
        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=auth.party_id,
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
        if werkbon.garage_party_id != auth.party_id:
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
        rate_limiter.hit(auth.party_id, "/facturen")

        manifest_payload = {
            "action": "factuur_aanmaken",
            **payload.model_dump(mode="json"),
        }
        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=auth.party_id,
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
        if werkbon.garage_party_id != auth.party_id:
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

        factuur = create_concept_factuur(db, werkbon=werkbon, garage_party_id=auth.party_id)
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
        rate_limiter.hit(auth.party_id, "/facturen/{id}/finaliseren")

        manifest_payload = {
            "action": "factuur_finaliseren",
            "factuur_id": factuur_id,
        }
        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=auth.party_id,
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
        if factuur.garage_party_id != auth.party_id:
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
        rate_limiter.hit(auth.party_id, "/facturen/{id}")

        manifest_payload = {
            "action": "factuur_ophalen",
            "factuur_id": factuur_id,
        }
        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=auth.party_id,
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
        if factuur.garage_party_id != auth.party_id:
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
        rate_limiter.hit(auth.party_id, "/data/opvragen")

        get_or_create_party(db, party_id=auth.party_id, party_type=auth.party_type)
        manifest_payload = manifest_in.model_dump(mode="json")

        manifest = create_manifest(
            db,
            payload=manifest_payload,
            party_id=auth.party_id,
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
                if vehicle.garage_party_id != auth.party_id:
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
        rate_limiter.hit(auth.party_id, "/manifest/audit/{manifest_id}")

        manifest = db.get(ManifestRequest, manifest_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Manifest niet gevonden")

        if manifest.party_id != auth.party_id:
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

