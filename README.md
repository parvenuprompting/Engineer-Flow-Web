# Engineer Flow 2026

[![Status](https://img.shields.io/badge/status-active%20development-orange.svg)](https://github.com/parvenuprompting/Engineer-Flow-2027)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)](https://www.postgresql.org/)
[![Last commit](https://img.shields.io/github/last-commit/parvenuprompting/Engineer-Flow-2027)](https://github.com/parvenuprompting/Engineer-Flow-2027/commits/main)

Engineer Flow is een diagnoseplatform voor zware voertuigen en mixer-opbouwen. De actieve app-flow gebruikt nu een **deterministische TypeScript-kern** voor symptoommapping, constraint-handhaving, failure-mode scoring, guided flows en audit trail.

Belangrijk:
- **EFL core beslist, AI niet**
- **Canonieke JSON-datasets zijn de bron van waarheid**
- **De kritieke diagnosepad werkt lokaal/offline**
- **Elke run levert DDS-output + audit trail**

De repo bevat daarnaast nog de oudere LUCID/FastAPI-backend en enkele AI-hulppaden, maar de actieve diagnoseflow in de Next.js-app loopt via `src/efl_core`.

> **Ontwikkelstatus:** de kernflow en server-authenticatie zijn actief in ontwikkeling. Cases en diagnoses ondersteunen duurzame PostgreSQL-opslag via de FastAPI-backend; zonder backendconfiguratie blijft alleen de development-opslag beschikbaar.

## Inhoud
- [Engineer Flow Vision & Roadmap](#engineer-flow-vision--roadmap)
- [Wat Dit Project Doet](#wat-dit-project-doet)
- [Huidige Status](#huidige-status)
- [Architectuur](#architectuur)
- [Deterministische Diagnosekern](#deterministische-diagnosekern)
- [Projectstructuur](#projectstructuur)
- [Quickstart (Aanbevolen)](#quickstart-aanbevolen)
- [Handmatige Setup](#handmatige-setup)
- [Configuratie (.env)](#configuratie-env)
- [JWT Rollen En Scopes](#jwt-rollen-en-scopes)
- [API Overzicht](#api-overzicht)
- [Belangrijkste Flows](#belangrijkste-flows)
- [LUCID Trigger Enforcement](#lucid-trigger-enforcement)
- [Datamodel (PostgreSQL)](#datamodel-postgresql)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)
- [Production Notes](#production-notes)

## Engineer Flow Vision & Roadmap

De volledige productvisie, huidige status, doelarchitectuur, roadmap, productiechecklists en release gates staan in [`docs/ENGINEER_FLOW_VISION.md`](docs/ENGINEER_FLOW_VISION.md).

## Wat Dit Project Doet

Engineer Flow zet vrije symptoomtekst om naar:
- canonieke `DES` matches
- canonieke `TS` evidence
- constraint-gefilterde failure modes
- guided diagnoseflows
- DDS v1.0 case-output
- audit trail met `execution_signature`

De app bevat daarnaast workflow-functies voor:
- opgeslagen diagnoses
- werkbonnen
- facturatie
- grootboekposten

## Huidige Status

Actief in het diagnosepad:
- `src/efl_core/engine.ts`
- `src/efl_core/symptom_bridge.ts`
- `src/efl_core/data/*.json`
- `src/app/api/efl-core/diagnose/route.ts`
- `src/app/actions.ts`

Belangrijke eigenschappen:
- hard constraint filtering op failure modes en componenten
- expliciete `knowledge_gap` fallback
- expliciete `clarification_required` toestand bij ambigue invoer
- hash-geketende lokale auditopslag in `.efl_store/diagnosis_audit.jsonl`
- browser-side offline auditbuffering via IndexedDB met sync naar `/api/efl-core/audit/sync`
- server-side lucid mirror replay via `/api/efl-core/audit/flush`
- lokale fallback voor expert-chat en case-title als AI niet beschikbaar is

Drie partijen met expliciete rechten:
- **Garage**: volledige lokale toegang tot ruwe foutcodes en reparatiehistorie.
- **Fabrikant**: alleen geanonimiseerde patroondata via batch (Trigger 1).
- **Verzekeraar**: alleen claim-gebonden onderhoudshistorie, exactly-once per claim (Trigger 2).

Alle aanvragen lopen via een manifest (`POST /data/opvragen`) en worden vastgelegd in:
- `manifest_requests`
- `policy_decisions`
- `audit_events`

## Architectuur

### Backend
- Framework: **FastAPI**
- ORM/Migraties: **SQLAlchemy 2 + Alembic**
- Database: **PostgreSQL**
- Auth: **JWT RS256** (`kid`-based key selectie)
- Entry point: `lucid_engineer_flow:app`

### Frontend
- Framework: **Next.js 15 + React 18 + Tailwind**
- Dev server: `npm run dev` op poort `9002`

### Actieve diagnose-engine
- Primary engine: `src/efl_core/engine.ts`
- Symptom bridge: `src/efl_core/symptom_bridge.ts`
- Offline fallbacks: `src/efl_core/offline_assist.ts`
- API adapter: `src/app/api/efl-core/*`
- Health endpoint: `src/app/api/efl-core/health/route.ts`

### Belangrijk principe
- Partij in request body wordt **niet vertrouwd**.
- `party_type` wordt altijd afgeleid uit JWT claims.
- `src/ai/flows/diagnose-flow.ts` is alleen nog een **deprecated compatibility layer** en mag niet als actief diagnosepad worden gebruikt.

## Deterministische Diagnosekern

De actieve route is:

1. Vrije tekst -> `DES` matching  
   `src/efl_core/symptom_bridge.ts`

2. `DES -> TS` scoring  
   Formule: `((strength * 0.7) + (uniqueness * 0.3)) / 5`

3. Subsystem- en clusterselectie  
   `src/efl_core/engine.ts`

4. Constraint enforcement  
   `constraints.json`, `electrical_constraints.json`, `hydraulic_constraints.json`, `variant_constraints.json`, `logic_rules.json`

5. Failure-mode scoring  
   deterministisch op basis van `TS`, subsystemsupport, componentrelaties en constraint-hits

6. Guided flow + DDS + audit trail  
   opgenomen in de diagnose-response

7. Browser-side audit buffering + sync  
   IndexedDB queue -> `/api/efl-core/audit/sync` -> append-only JSONL + lucid-compatible mirror

8. Server-side durable sink replay  
   `.efl_store/lucid_audit_mirror.jsonl` + `.efl_store/lucid_audit_forward_status.jsonl` -> `/api/efl-core/audit/flush`

Canonieke datasets:
- `master_symptom_set.v1.0.json`
- `des_ts_map.v1.0.json`
- `ef_diagnostic_schema.json`
- `version_manifest.json`
- component-, failure-mode-, cluster- en constraintbestanden in `src/efl_core/data/`

## Projectstructuur

```text
.
├── src/
│   ├── app/                     # Next.js app + API routes
│   ├── components/              # UI componenten
│   ├── efl_core/                # Deterministische diagnosekern
│   │   ├── engine.ts
│   │   ├── symptom_bridge.ts
│   │   ├── offline_assist.ts
│   │   ├── data.ts
│   │   ├── types.ts
│   │   ├── version.ts
│   │   └── data/
│   ├── lib/api/                 # Frontend API client + types
│   └── ai/                      # Legacy/UX AI flows
├── lucid_backend/
│   ├── main.py              # FastAPI routes
│   ├── policy.py            # Trigger/policy enforcement + reason codes
│   ├── models.py            # SQLAlchemy modellen
│   ├── services.py          # Domeinservices + seed data
│   ├── security.py          # JWT decode/validate + dev token minting
│   ├── audit.py             # Manifest/decision/audit registratie
│   └── schemas.py           # Request/response modellen
├── alembic/
│   ├── env.py
│   └── versions/            # DB migraties
├── lucid_engineer_flow.py   # App bootstrap
├── run_postgres.sh          # One-command local backend bootstrap
├── test_lucid.py            # End-to-end integratiescript
├── tests/test_lucid_backend.py  # Pytest suite
```

## Quickstart (Aanbevolen)

### 1) Frontend + deterministische diagnosekern

```bash
npm install
npm run dev
```

Frontend draait op:
- `http://127.0.0.1:9002`

Belangrijke pagina's:
- `/diagnose`
- `/my-diagnoses`
- `/chat`

### 2) Verificatie

```bash
npm run build
npm run typecheck
```

Let op:
- `npm run typecheck` verwacht een geldige `.next/types` output. Draai hem dus bij voorkeur na `npm run build`.
- De diagnose-health is opvraagbaar via `/api/efl-core/health`.

### 3) Backend + DB in 1 command

```bash
./run_postgres.sh
```

Dit script doet automatisch:
1. Start of herstart Docker container `lucid-postgres`.
2. Wacht op PostgreSQL readiness.
3. Zet/actualiseert `.env.lucid` met juiste `DATABASE_URL`.
4. Installeert Python dependencies in `.venv`.
5. Draait `alembic upgrade head`.
6. Laadt seeddata.
7. Start API op `http://127.0.0.1:8010`.

Handige flags:

```bash
./run_postgres.sh --with-tests   # draait ook test_lucid.py
./run_postgres.sh --no-api       # alleen setup/migratie/seed
```

### 4) Swagger openen

- `http://127.0.0.1:8010/docs`

## Server-side authenticatie voor EFL API

De actieve Next.js EFL-routes vereisen een Firebase ID-token. De browser voegt dit token automatisch toe voor ingelogde gebruikers.
Voor server-side tokenvalidatie gebruikt de app Application Default Credentials of `FIREBASE_SERVICE_ACCOUNT_JSON`.

Voor lokale ontwikkeling met een service-accountbestand:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/firebase-service-account.json
```

Of configureer een JSON-string in de serveromgeving:

```bash
FIREBASE_SERVICE_ACCOUNT_JSON='{"projectId":"...","clientEmail":"...","privateKey":"..."}'
```

Een optionele Firebase custom claim `garage_id` wordt gebruikt voor garage-isolatie. Zonder deze claim wordt de Firebase `uid` als tijdelijke eigenaarsscope gebruikt. Voor een multi-user garageomgeving moet `garage_id` verplicht worden gemaakt en aan een server-side membershipmodel worden gekoppeld.

## Duurzame EFL-opslag

Wanneer `LUCID_BACKEND_URL` is ingesteld, worden nieuwe cases en diagnose-uitkomsten via de beveiligde FastAPI-backend in PostgreSQL opgeslagen. Configureer daarnaast een geldig backend-JWT in `LUCID_SERVICE_TOKEN` en voer de migraties uit:

```bash
python -m alembic upgrade head
```

Als `LUCID_BACKEND_URL` niet is ingesteld, blijft de lokale opslag uitsluitend beschikbaar voor development. Zodra de backend in een omgeving is geconfigureerd maar niet bereikbaar is, faalt de diagnoseflow expliciet en wordt niet teruggevallen op lokale opslag.

## Alles lokaal starten

Gebruik voor de volledige lokale stack:

```bash
cp env.local.example .env.local
# Vul FIREBASE_SERVICE_ACCOUNT_JSON in .env.local in.
./run_local.sh
```

`run_local.sh` start Docker/PostgreSQL, voert de migraties uit, seedt de database, genereert een development-service-token, start FastAPI op poort `8010` en start daarna Next.js op poort `9002`.

Een Firebase Admin service-account maak je aan in Firebase Console via **Project settings → Service accounts → Generate new private key**. Gebruik de JSON-waarden in `.env.local`; commit dit bestand nooit.

## Handmatige Setup

Gebruik dit als je ook de oudere/aanvullende FastAPI-backend lokaal wilt draaien.

### 1) Postgres via Docker

```bash
docker run -d \
  --name lucid-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=lucid_engineer_flow \
  -p 5432:5432 \
  postgres:16
```

### 2) Python venv + dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r requirements-lucid.txt
```

### 3) Env zetten

Maak `.env.lucid` met minimaal:

```bash
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/lucid_engineer_flow
LUCID_ENABLE_DEV_AUTH=true
LUCID_JWT_ISSUER=lucid-internal-issuer
LUCID_JWT_AUDIENCE=lucid-engineer-flow
LUCID_HMAC_SECRET=lucid-dev-hmac-secret
```

Laad env:

```bash
set -a
source .env.lucid
set +a
```

### 4) Migreren + starten

```bash
python -m alembic upgrade head
python -m uvicorn lucid_engineer_flow:app --reload --port 8010
```

## Configuratie (.env)

Belangrijkste variabelen:

| Variabele | Doel | Default |
|---|---|---|
| `DATABASE_URL` | SQLAlchemy connectiestring | `postgresql+psycopg://postgres:postgres@localhost:5432/lucid_engineer_flow` |
| `LUCID_ENABLE_DEV_AUTH` | Dev token endpoint aan/uit | `false` |
| `LUCID_JWT_ISSUER` | JWT issuer-validatie | `lucid-internal-issuer` |
| `LUCID_JWT_AUDIENCE` | JWT audience-validatie | `lucid-engineer-flow` |
| `LUCID_DEFAULT_JWT_KID` | default key id voor dev minting | `dev-key-1` |
| `LUCID_JWT_PUBLIC_KEYS_JSON` | publieke keys (kid -> PEM) | ingebouwde demo key |
| `LUCID_JWT_PRIVATE_KEYS_JSON` | private keys voor dev minting | ingebouwde demo key |
| `LUCID_HMAC_SECRET` | HMAC voor anon refs | `lucid-dev-hmac-secret` |
| `LUCID_RATE_LIMIT_WINDOW` | rate-limit window sec | `60` |
| `LUCID_RATE_LIMIT_PER_WINDOW` | max requests per window | `60` |
| `LUCID_TRIGGER1_WINDOW_HOURS` | batch venster trigger 1 | `24` |
| `LUCID_TRIGGER1_BATCH_INTERVAL_MINUTES` | batch interval info | `60` |

## JWT Rollen En Scopes

`party_type` waarden:
- `garage`
- `fabrikant`
- `verzekeraar`

Aanbevolen scopes:
- garage: `diagnosis:read_local`, `consent:write`
- fabrikant: `patterns:read_anon`, `definitions:write`
- verzekeraar: `claim:read_history`

JWT claims die verplicht zijn:
- `sub`
- `party_type`
- `party_id`
- `scopes`
- `exp`
- plus header `kid`

## API Overzicht

| Method | Endpoint | Doel |
|---|---|---|
| `GET` | `/` | protocol info |
| `GET` | `/health` | app + DB health |
| `GET` | `/policy/version` | policy/app versie |
| `POST` | `/auth/dev-token` | dev JWT minten (alleen als enabled) |
| `POST` | `/garage/diagnosis-events` | diagnose events registreren |
| `POST` | `/claims` | claim openen |
| `POST` | `/claims/{claim_id}/close` | claim sluiten |
| `POST` | `/consents` | consent geven/intrekken |
| `POST` | `/data/opvragen` | manifest-gedreven dataflow |
| `POST` | `/fabrikant/update` | trigger 3 update push |
| `POST` | `/jobs/trigger1/run` | trigger 1 batch run |
| `GET` | `/manifest/audit/{manifest_id}` | echte auditrecord opvragen |

## Belangrijkste Flows

### A) Dev token ophalen

```bash
curl -X POST http://127.0.0.1:8010/auth/dev-token \
  -H "Content-Type: application/json" \
  -d '{
    "party_type": "garage",
    "party_id": "garage-001",
    "scopes": ["diagnosis:read_local", "consent:write"],
    "subject": "local-dev",
    "expires_in_minutes": 60
  }'
```

### B) Manifest data request

```bash
curl -X POST http://127.0.0.1:8010/data/opvragen \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "purpose": "diagnose check",
    "voertuig_id": "VTG-001"
  }'
```

### C) Verzekeraar claim-flow

1. Open claim: `POST /claims`
2. Lees claimdata 1x: `POST /data/opvragen` met `claim_id`
3. Sluit claim: `POST /claims/{claim_id}/close`
4. Tweede read met zelfde claim => `403 CLAIM_ALREADY_CONSUMED`

### D) Trigger 1 batch

```bash
curl -X POST http://127.0.0.1:8010/jobs/trigger1/run \
  -H "Authorization: Bearer <GARAGE_JWT>"
```

## LUCID Trigger Enforcement

| Trigger | Enforcement |
|---|---|
| T1 Garage -> Fabrikant | Alleen via batch endpoint; `>=3` DTC binnen policy window; blok bij `manufacturer_sharing_opt_out`; output geanonimiseerd (`veh_*`) |
| T2 Garage -> Verzekeraar | Vereist actieve claim + consent `claim_history_share` + unconsumed access grant; exactly-once (`CLAIM_ALREADY_CONSUMED`) |
| T3 Fabrikant -> Garage | Alleen technische definitie; blokkeert `contains_commercial_data=true`; distributie alleen naar garages met `garage_seen_codes` |

Sovereignty Rule:
- Geen plain `vehicle_id` buiten garage-context.
- Verzekeraar krijgt `claim_scoped_vehicle_ref`.

## Datamodel (PostgreSQL)

Belangrijkste tabellen:
- `parties`
- `vehicles`
- `diagnosis_events`
- `owner_consents`
- `claims`
- `claim_access_grants`
- `manufacturer_definitions`
- `garage_seen_codes`
- `manifest_requests`
- `policy_decisions`
- `audit_events`
- `batch_jobs`
- `manufacturer_batch_records`

## Tests

### Frontend / deterministische diagnosekern

```bash
npm run build
npm run typecheck
```

Dit valideert:
- de actieve Next.js app
- de deterministische diagnose-engine in `src/efl_core`
- de DDS/audit response-shapes

Let op: draai `typecheck` bij voorkeur na `build`, omdat `tsconfig.json` `.next/types/**/*.ts` meeneemt.

### End-to-end script

```bash
python test_lucid.py
```

Ondersteunt custom base URL:

```bash
LUCID_TEST_BASE_URL=http://127.0.0.1:8010 python test_lucid.py
```

### Pytest

```bash
pytest
```

Gedekte scenario's omvatten o.a.:
- auth claim-validatie
- scope violations
- trigger 2 one-time claim access
- trigger 3 commercial data blokkade
- trigger 1 anonimisering
- audit trail consistency

## Troubleshooting

### `tsc` klaagt over `.next/types/*.ts not found`

Dat gebeurt als `typecheck` draait zonder actuele `.next` output of parallel met een build.

Gebruik:

```bash
npm run build
npm run typecheck
```

### Firebase `app/no-options` tijdens build

Dit is op dit moment een bekende waarschuwing uit de bestaande Firebase-initialisatie. De build slaagt nog wel.

### `error: externally-managed-environment`
Gebruik altijd een virtualenv:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-lucid.txt
```

### `zsh: command not found: alembic`
Je zit niet in de venv, of alembic is niet geïnstalleerd.

```bash
source .venv/bin/activate
python -m alembic upgrade head
```

### `connection refused localhost:5432`
Postgres draait niet:

```bash
docker ps -a
docker start lucid-postgres
```

### `Dev auth endpoint disabled`
Zet:

```bash
LUCID_ENABLE_DEV_AUTH=true
```

en herstart de API.

### `Address already in use`
Andere server draait al op die poort.
Gebruik een andere poort of stop het bestaande proces.

## Production Notes

- De actieve diagnoseflow gebruikt geen AI-ranking meer.
- Auditregels worden lokaal append-only opgeslagen in `.efl_store/diagnosis_audit.jsonl`.
- Elke auditregel bevat nu een `previous_record_hash` en `record_hash`.
- Bij ambigue invoer geeft de engine `clarification_required` terug in plaats van een geforceerde root cause.
- Bij onvoldoende dekking geeft de engine `knowledge_gap` terug.
- Vervang demo JWT keys door echte key management + rotatie.
- Zet `LUCID_ENABLE_DEV_AUTH=false` buiten development.
- Gebruik sterke `LUCID_HMAC_SECRET`.
- Zet DB backups, connection pooling en monitoring aan.
- Overweeg immutable audit storage voor compliance.

---

Voor lokaal snel starten: `./run_postgres.sh --with-tests --no-api` geeft je een complete setup + validatie in één run.
