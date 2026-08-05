from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import GarageMembership, MembershipRole, MembershipStatus, Party, User
from .security import AuthContext


MANAGE_MEMBERSHIP_ROLES = {MembershipRole.OWNER.value, MembershipRole.MANAGER.value}
MUTATION_ROLES = {
    MembershipRole.OWNER.value,
    MembershipRole.MANAGER.value,
    MembershipRole.TECHNICIAN.value,
}


def get_or_create_user(
    db: Session, *, firebase_uid: str, email: str | None = None, display_name: str | None = None
) -> User:
    user = db.execute(select(User).where(User.firebase_uid == firebase_uid)).scalar_one_or_none()
    if user is None:
        user = User(firebase_uid=firebase_uid, email=email, display_name=display_name)
        db.add(user)
        db.flush()
    else:
        if email is not None:
            user.email = email
        if display_name is not None:
            user.display_name = display_name
        user.updated_at = datetime.now(timezone.utc)
    return user


def require_active_membership(db: Session, auth: AuthContext, garage_id: str | None = None) -> GarageMembership:
    stmt = (
        select(GarageMembership)
        .join(User, GarageMembership.user_id == User.id)
        .where(User.firebase_uid == auth.sub, User.active.is_(True), GarageMembership.status == MembershipStatus.ACTIVE.value)
    )
    if garage_id:
        stmt = stmt.where(GarageMembership.garage_party_id == garage_id)
    membership = db.execute(stmt).scalar_one_or_none()
    if membership is None:
        raise HTTPException(status_code=403, detail="Geen actieve garage membership")
    return membership


def require_membership_manager(db: Session, auth: AuthContext, garage_id: str) -> GarageMembership:
    membership = require_active_membership(db, auth, garage_id)
    if membership.role not in MANAGE_MEMBERSHIP_ROLES:
        raise HTTPException(status_code=403, detail="Alleen garage owner of manager mag memberships beheren")
    return membership


def require_garage_mutation_access(db: Session, auth: AuthContext) -> GarageMembership:
    membership = require_active_membership(db, auth)
    if membership.role not in MUTATION_ROLES:
        raise HTTPException(status_code=403, detail="Deze rol mag geen garagegegevens wijzigen")
    return membership


def invite_membership(
    db: Session, *, garage: Party, firebase_uid: str, role: str, email: str | None, display_name: str | None
) -> GarageMembership:
    user = get_or_create_user(db, firebase_uid=firebase_uid, email=email, display_name=display_name)
    existing = db.execute(
        select(GarageMembership).where(
            GarageMembership.garage_party_id == garage.id, GarageMembership.user_id == user.id
        )
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if existing:
        existing.role = role
        existing.status = MembershipStatus.INVITED.value
        existing.invited_at = now
        existing.activated_at = None
        existing.revoked_at = None
        return existing
    membership = GarageMembership(
        garage_party_id=garage.id,
        user_id=user.id,
        role=role,
        status=MembershipStatus.INVITED.value,
        invited_at=now,
    )
    db.add(membership)
    db.flush()
    return membership


def update_membership_status(db: Session, membership: GarageMembership, status: str) -> GarageMembership:
    membership.status = status
    if status == MembershipStatus.ACTIVE.value:
        membership.activated_at = datetime.now(timezone.utc)
        membership.revoked_at = None
    else:
        membership.revoked_at = datetime.now(timezone.utc)
    db.add(membership)
    db.flush()
    return membership
