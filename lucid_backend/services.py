from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import (
    BatchJob,
    BatchStatus,
    Claim,
    ClaimAccessGrant,
    ClaimStatus,
    DiagnosisEvent,
    Factuur,
    FactuurStatus,
    FeedbackEvent,
    GarageSeenCode,
    GrootboekPost,
    ManufacturerBatchRecord,
    OwnerConsent,
    Party,
    PartyType,
    Vehicle,
    Werkbon,
    WerkbonRegel,
    WerkbonStatus,
)
from .policy import anonymize_vehicle_ref, has_active_consent


settings = get_settings()
MONEY_QUANT = Decimal("0.01")
BTW_RATE = Decimal("0.21")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _money(value: Decimal | float | int | str) -> Decimal:
    return Decimal(str(value)).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)


def _werkbon_regel_totaal(regel: WerkbonRegel) -> Decimal:
    uren = _money(regel.uren or 0)
    uurtarief = _money(regel.uurtarief or 0)
    onderdeel_prijs = _money(regel.onderdeel_prijs or 0)
    return _money((uren * uurtarief) + onderdeel_prijs)


def get_or_create_party(db: Session, party_id: str, party_type: str, name: str | None = None) -> Party:
    party = db.get(Party, party_id)
    if party:
        if party.party_type != party_type:
            party.party_type = party_type
        if name and party.name != name:
            party.name = name
        db.add(party)
        db.flush()
        return party

    party = Party(id=party_id, party_type=party_type, name=name or f"{party_type}-{party_id}")
    db.add(party)
    db.flush()
    return party


def get_vehicle_by_external_ref(db: Session, vehicle_ref: str) -> Vehicle | None:
    stmt = select(Vehicle).where(Vehicle.external_vehicle_ref == vehicle_ref).limit(1)
    return db.execute(stmt).scalar_one_or_none()


def ensure_vehicle(db: Session, garage_party_id: str, vehicle_ref: str, hash_salt_version: int = 1) -> Vehicle:
    stmt = (
        select(Vehicle)
        .where(Vehicle.garage_party_id == garage_party_id, Vehicle.external_vehicle_ref == vehicle_ref)
        .limit(1)
    )
    vehicle = db.execute(stmt).scalar_one_or_none()
    if vehicle:
        return vehicle

    vehicle = Vehicle(
        garage_party_id=garage_party_id,
        external_vehicle_ref=vehicle_ref,
        hash_salt_version=hash_salt_version,
    )
    db.add(vehicle)
    db.flush()
    return vehicle


def upsert_seen_code(db: Session, garage_party_id: str, dtc_code: str, occurred_at: datetime) -> None:
    stmt = (
        select(GarageSeenCode)
        .where(GarageSeenCode.garage_party_id == garage_party_id, GarageSeenCode.dtc_code == dtc_code)
        .limit(1)
    )
    seen = db.execute(stmt).scalar_one_or_none()
    if not seen:
        seen = GarageSeenCode(
            garage_party_id=garage_party_id,
            dtc_code=dtc_code,
            first_seen_at=occurred_at,
            last_seen_at=occurred_at,
            seen_count=1,
        )
    else:
        seen.last_seen_at = max(seen.last_seen_at, occurred_at)
        seen.seen_count += 1

    db.add(seen)


def add_diagnosis_event(
    db: Session,
    *,
    garage_party_id: str,
    vehicle_ref: str,
    dtc_code: str,
    occurred_at: datetime | None,
    source: str,
    repair_action: str | None,
) -> DiagnosisEvent:
    vehicle = ensure_vehicle(db, garage_party_id=garage_party_id, vehicle_ref=vehicle_ref)
    event_time = occurred_at or utcnow()
    event = DiagnosisEvent(
        vehicle_id=vehicle.id,
        dtc_code=dtc_code,
        occurred_at=event_time,
        source=source,
        repair_action=repair_action,
    )
    db.add(event)
    upsert_seen_code(db, garage_party_id=garage_party_id, dtc_code=dtc_code, occurred_at=event_time)
    db.flush()
    return event


def open_claim(db: Session, insurer_party_id: str, vehicle_id: str, access_ttl_minutes: int) -> tuple[Claim, ClaimAccessGrant]:
    claim = Claim(
        insurer_party_id=insurer_party_id,
        vehicle_id=vehicle_id,
        status=ClaimStatus.OPEN.value,
        opened_at=utcnow(),
    )
    db.add(claim)
    db.flush()

    grant = ClaimAccessGrant(
        claim_id=claim.id,
        granted_at=utcnow(),
        expires_at=utcnow() + timedelta(minutes=access_ttl_minutes),
    )
    db.add(grant)
    db.flush()
    return claim, grant


def close_claim(db: Session, claim: Claim) -> Claim:
    claim.status = ClaimStatus.CLOSED.value
    claim.closed_at = utcnow()
    db.add(claim)
    db.flush()
    return claim


def create_werkbon(db: Session, *, voertuig_id: str, garage_party_id: str, root_cause: str) -> Werkbon:
    werkbon = Werkbon(
        voertuig_id=voertuig_id,
        garage_party_id=garage_party_id,
        root_cause=root_cause,
        status=WerkbonStatus.OPEN.value,
        aangemaakt_at=utcnow(),
    )
    db.add(werkbon)
    db.flush()
    return werkbon


def get_werkbon(db: Session, werkbon_id: str) -> Werkbon | None:
    return db.get(Werkbon, werkbon_id)


def add_werkbon_regel(
    db: Session,
    *,
    werkbon: Werkbon,
    omschrijving: str,
    uren: float,
    uurtarief: float,
    onderdeel_code: str | None,
    onderdeel_prijs: float,
) -> WerkbonRegel:
    regel = WerkbonRegel(
        werkbon_id=werkbon.id,
        omschrijving=omschrijving,
        uren=float(_money(uren)),
        uurtarief=float(_money(uurtarief)),
        onderdeel_code=onderdeel_code,
        onderdeel_prijs=float(_money(onderdeel_prijs)),
    )
    db.add(regel)
    db.flush()
    return regel


def list_werkbon_regels(db: Session, werkbon_id: str) -> list[WerkbonRegel]:
    stmt = select(WerkbonRegel).where(WerkbonRegel.werkbon_id == werkbon_id).order_by(WerkbonRegel.id.asc())
    return db.execute(stmt).scalars().all()


def bereken_werkbon_subtotaal(db: Session, werkbon_id: str) -> Decimal:
    regels = list_werkbon_regels(db, werkbon_id)
    totaal = Decimal("0.00")
    for regel in regels:
        totaal += _werkbon_regel_totaal(regel)
    return _money(totaal)


def afronden_werkbon(db: Session, werkbon: Werkbon) -> Werkbon:
    werkbon.status = WerkbonStatus.AFGEROND.value
    werkbon.afgerond_at = utcnow()
    db.add(werkbon)
    db.flush()
    return werkbon


def _next_factuurnummer(db: Session, year: int) -> str:
    prefix = f"{year}-"
    stmt = (
        select(Factuur.factuurnummer)
        .where(Factuur.factuurnummer.like(f"{prefix}%"))
        .order_by(Factuur.factuurnummer.desc())
        .limit(1)
    )
    latest = db.execute(stmt).scalar_one_or_none()
    if not latest:
        return f"{year}-0001"
    try:
        current = int(latest.split("-")[1])
    except (IndexError, ValueError):
        current = 0
    return f"{year}-{(current + 1):04d}"


def get_factuur_by_werkbon(db: Session, werkbon_id: str) -> Factuur | None:
    stmt = select(Factuur).where(Factuur.werkbon_id == werkbon_id).limit(1)
    return db.execute(stmt).scalar_one_or_none()


def create_concept_factuur(db: Session, *, werkbon: Werkbon, garage_party_id: str) -> Factuur:
    subtotaal = bereken_werkbon_subtotaal(db, werkbon.id)
    btw = _money(subtotaal * BTW_RATE)
    totaal = _money(subtotaal + btw)
    factuurnummer = _next_factuurnummer(db, utcnow().year)

    factuur = Factuur(
        werkbon_id=werkbon.id,
        garage_party_id=garage_party_id,
        status=FactuurStatus.CONCEPT.value,
        factuurnummer=factuurnummer,
        subtotaal=float(subtotaal),
        btw=float(btw),
        totaal=float(totaal),
        aangemaakt_at=utcnow(),
    )
    db.add(factuur)
    db.flush()
    return factuur


def get_factuur(db: Session, factuur_id: str) -> Factuur | None:
    return db.get(Factuur, factuur_id)


def _post_totals_balanced(posten: list[GrootboekPost]) -> bool:
    debet = Decimal("0.00")
    credit = Decimal("0.00")
    for post in posten:
        amount = _money(post.bedrag)
        if post.type == "debet":
            debet += amount
        elif post.type == "credit":
            credit += amount
    return _money(debet) == _money(credit)


def finalize_factuur(db: Session, factuur: Factuur) -> tuple[Factuur, list[GrootboekPost]]:
    werkbon = get_werkbon(db, factuur.werkbon_id)
    if werkbon is None:
        raise ValueError("Werkbon niet gevonden voor factuur")

    subtotaal = bereken_werkbon_subtotaal(db, werkbon.id)
    btw = _money(subtotaal * BTW_RATE)
    totaal = _money(subtotaal + btw)

    factuur.subtotaal = float(subtotaal)
    factuur.btw = float(btw)
    factuur.totaal = float(totaal)
    factuur.status = FactuurStatus.GEFINALISEERD.value
    factuur.gefinaliseerd_at = utcnow()
    db.add(factuur)
    db.flush()

    existing_stmt = select(GrootboekPost).where(GrootboekPost.factuur_id == factuur.id)
    existing = db.execute(existing_stmt).scalars().all()
    for post in existing:
        db.delete(post)
    db.flush()

    posten = [
        GrootboekPost(
            factuur_id=factuur.id,
            type="debet",
            rekening="debiteuren",
            bedrag=float(totaal),
            geboekt_at=utcnow(),
        ),
        GrootboekPost(
            factuur_id=factuur.id,
            type="credit",
            rekening="omzet",
            bedrag=float(subtotaal),
            geboekt_at=utcnow(),
        ),
        GrootboekPost(
            factuur_id=factuur.id,
            type="credit",
            rekening="btw_te_betalen",
            bedrag=float(btw),
            geboekt_at=utcnow(),
        ),
    ]
    for post in posten:
        db.add(post)
    db.flush()

    if not _post_totals_balanced(posten):
        raise ValueError("Grootboek is niet in balans na finaliseren")

    return factuur, posten


def get_grootboek_posten(db: Session, factuur_id: str) -> list[GrootboekPost]:
    stmt = select(GrootboekPost).where(GrootboekPost.factuur_id == factuur_id).order_by(GrootboekPost.id.asc())
    return db.execute(stmt).scalars().all()


def set_owner_consent(db: Session, vehicle_id: str, consent_type: str, granted: bool) -> OwnerConsent:
    now = utcnow()
    if not granted:
        # Revoke all active grants of same type
        stmt = select(OwnerConsent).where(
            OwnerConsent.vehicle_id == vehicle_id,
            OwnerConsent.consent_type == consent_type,
            OwnerConsent.granted.is_(True),
            OwnerConsent.revoked_at.is_(None),
        )
        active_records = db.execute(stmt).scalars().all()
        for record in active_records:
            record.revoked_at = now
            db.add(record)

    consent = OwnerConsent(
        vehicle_id=vehicle_id,
        consent_type=consent_type,
        granted=granted,
        granted_at=now,
        revoked_at=None if granted else now,
    )
    db.add(consent)
    db.flush()
    return consent


def get_vehicle_repair_history(db: Session, vehicle_id: str) -> list[str]:
    stmt = (
        select(DiagnosisEvent.repair_action)
        .where(DiagnosisEvent.vehicle_id == vehicle_id, DiagnosisEvent.repair_action.is_not(None))
        .order_by(DiagnosisEvent.occurred_at.desc())
        .limit(50)
    )
    rows = db.execute(stmt).scalars().all()
    return [r for r in rows if r]


def get_vehicle_dtc_summary(db: Session, vehicle_id: str) -> list[dict]:
    stmt = (
        select(DiagnosisEvent.dtc_code, func.count(DiagnosisEvent.id).label("count"), func.max(DiagnosisEvent.occurred_at).label("latest"))
        .where(DiagnosisEvent.vehicle_id == vehicle_id)
        .group_by(DiagnosisEvent.dtc_code)
        .order_by(func.count(DiagnosisEvent.id).desc())
    )
    rows = db.execute(stmt).all()
    return [
        {"dtc_code": row.dtc_code, "count": int(row.count), "latest_occurrence": row.latest.isoformat() if row.latest else None}
        for row in rows
    ]


def run_trigger1_batch(db: Session) -> dict:
    started = utcnow()
    job = BatchJob(trigger_id="T1_GARAGE_TO_FABRIKANT", status=BatchStatus.RUNNING.value, started_at=started)
    db.add(job)
    db.flush()

    window_start = started - timedelta(hours=settings.trigger1_window_hours)

    aggregation_stmt = (
        select(
            DiagnosisEvent.vehicle_id,
            DiagnosisEvent.dtc_code,
            func.count(DiagnosisEvent.id).label("code_count"),
        )
        .where(DiagnosisEvent.occurred_at >= window_start)
        .group_by(DiagnosisEvent.vehicle_id, DiagnosisEvent.dtc_code)
        .having(func.count(DiagnosisEvent.id) >= 3)
    )
    aggregates = db.execute(aggregation_stmt).all()

    sent_records: list[dict] = []

    for row in aggregates:
        vehicle = db.get(Vehicle, row.vehicle_id)
        if not vehicle:
            continue

        # Block if owner opted out from manufacturer sharing.
        if has_active_consent(db, vehicle_id=vehicle.id, consent_type="manufacturer_sharing_opt_out"):
            continue

        anonymized_ref = anonymize_vehicle_ref(vehicle.external_vehicle_ref, vehicle.hash_salt_version)
        record = ManufacturerBatchRecord(
            batch_job_id=job.id,
            vehicle_id=vehicle.id,
            anonymized_vehicle_ref=anonymized_ref,
            dtc_code=row.dtc_code,
            count_in_window=int(row.code_count),
        )
        db.add(record)
        sent_records.append(
            {
                "anonymized_vehicle_ref": anonymized_ref,
                "dtc_code": row.dtc_code,
                "count_in_window": int(row.code_count),
            }
        )

    job.records_sent = len(sent_records)
    job.status = BatchStatus.FINISHED.value
    job.finished_at = utcnow()
    db.add(job)
    db.flush()

    return {
        "batch_job_id": job.id,
        "trigger_id": job.trigger_id,
        "records_sent": job.records_sent,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "sample": sent_records[:5],
    }


def create_feedback_event(
    db: Session,
    *,
    case_id: str | None,
    failure_mode_id: str,
    success: bool,
    garage_party_id: str | None = None,
) -> FeedbackEvent:
    event = FeedbackEvent(
        case_id=case_id,
        failure_mode_id=failure_mode_id,
        success=success,
        garage_party_id=garage_party_id,
        created_at=utcnow(),
        processed=False,
    )
    db.add(event)
    db.flush()
    return event


def run_feedback_aggregation_batch(db: Session) -> dict:
    started = utcnow()
    unprocessed_stmt = select(FeedbackEvent).where(FeedbackEvent.processed == False)
    events = db.scalars(unprocessed_stmt).all()

    summary: dict[str, dict[str, int]] = {}
    for ev in events:
        fm_id = ev.failure_mode_id
        if fm_id not in summary:
            summary[fm_id] = {"confirmed": 0, "rejected": 0}
        if ev.success:
            summary[fm_id]["confirmed"] += 1
        else:
            summary[fm_id]["rejected"] += 1
        ev.processed = True
        db.add(ev)

    db.flush()
    return {
        "processed_count": len(events),
        "aggregated_summary": summary,
        "processed_at": started.isoformat(),
    }


def seed_demo_data(db: Session) -> None:
    existing = db.execute(select(func.count(Party.id))).scalar_one()
    if existing and existing > 0:
        return

    garage = Party(id="garage-001", party_type=PartyType.GARAGE.value, name="Garage Demo")
    insurer = Party(id="verzekeraar-001", party_type=PartyType.VERZEKERAAR.value, name="Verzekeraar Demo")
    manufacturer = Party(id="fabrikant-001", party_type=PartyType.FABRIKANT.value, name="Fabrikant Demo")
    db.add_all([garage, insurer, manufacturer])
    db.flush()

    vehicle_a = Vehicle(garage_party_id=garage.id, external_vehicle_ref="VTG-001", hash_salt_version=1)
    vehicle_b = Vehicle(garage_party_id=garage.id, external_vehicle_ref="VTG-002", hash_salt_version=1)
    db.add_all([vehicle_a, vehicle_b])
    db.flush()

    now = utcnow()

    # Vehicle A has 3x repeated code -> eligible for Trigger 1 if no opt-out.
    events = [
        DiagnosisEvent(vehicle_id=vehicle_a.id, dtc_code="P0300", occurred_at=now - timedelta(hours=3), source="garage"),
        DiagnosisEvent(vehicle_id=vehicle_a.id, dtc_code="P0300", occurred_at=now - timedelta(hours=2), source="garage"),
        DiagnosisEvent(vehicle_id=vehicle_a.id, dtc_code="P0300", occurred_at=now - timedelta(hours=1), source="garage", repair_action="Bougie vervangen"),
        DiagnosisEvent(vehicle_id=vehicle_a.id, dtc_code="P0420", occurred_at=now - timedelta(hours=1), source="garage", repair_action="Katalysator check"),
        DiagnosisEvent(vehicle_id=vehicle_b.id, dtc_code="P0171", occurred_at=now - timedelta(hours=1), source="garage", repair_action="Luchtfilter vervangen"),
    ]
    db.add_all(events)

    # Seen codes
    for code, count in {"P0300": 3, "P0420": 1}.items():
        db.add(
            GarageSeenCode(
                garage_party_id=garage.id,
                dtc_code=code,
                first_seen_at=now - timedelta(hours=3),
                last_seen_at=now - timedelta(hours=1),
                seen_count=count,
            )
        )

    # Vehicle B opted out for manufacturer sharing
    db.add(
        OwnerConsent(
            vehicle_id=vehicle_b.id,
            consent_type="manufacturer_sharing_opt_out",
            granted=True,
            granted_at=now - timedelta(days=1),
            revoked_at=None,
        )
    )

    # Claim history consent for vehicle A
    db.add(
        OwnerConsent(
            vehicle_id=vehicle_a.id,
            consent_type="claim_history_share",
            granted=True,
            granted_at=now - timedelta(hours=2),
            revoked_at=None,
        )
    )

    claim, grant = open_claim(db, insurer_party_id=insurer.id, vehicle_id=vehicle_a.id, access_ttl_minutes=60)
    claim.status = ClaimStatus.OPEN.value
    grant.consumed_at = None
    db.add_all([claim, grant])
    db.flush()
