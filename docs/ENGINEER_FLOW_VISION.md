# Engineer Flow

## Productvisie, huidige staat en productieroute

**Documentversie:** 1.0
**Status:** richtinggevend productdocument
**Datum:** 2026-08-05
**Repository:** `parvenuprompting/Engineer-Flow-2027`
**Primaire doelgroep:** monteurs, werkplaatschefs, fleet managers en technische supportteams voor zware voertuigen en mixer-opbouwen

---

## 1. Samenvatting

Engineer Flow wordt een reproduceerbaar diagnose- en serviceplatform voor zware voertuigen en mixer-opbouwen. Het platform helpt een monteur om een ongestructureerde klacht om te zetten in:

1. een gestructureerd symptoombeeld;
2. een transparante rangorde van mogelijke failure modes;
3. onderscheidende, veilige diagnostische tests;
4. een gecontroleerde reparatie- en werkbonflow;
5. een meetbare en auditbare uitkomst.

De kern van het product is niet een chatbot die een plausibel antwoord produceert. De kern is een **deterministisch diagnostisch systeem** dat laat zien:

- welke evidence is gebruikt;
- welke oorzaken zijn uitgesloten;
- welke onzekerheid resteert;
- welke test de onzekerheid het beste reduceert;
- welke reparatie uiteindelijk is bevestigd.

AI mag de gebruikerservaring ondersteunen, bijvoorbeeld met titels, uitleg en educatieve chat. AI mag niet zelfstandig de officiële diagnose, constraint enforcement of failure-mode-beslissing bepalen.

De huidige codebase bevat al een werkende basis voor de diagnose-engine, audit trail, authenticatie, PostgreSQL-persistentie en werkbon/factuurbeleid. De app is nog geen productieproduct omdat de opslagpaden, garage-identiteit, security-hardening, diagnosevalidatie, observability en operationele deployment nog niet volledig zijn afgerond.

---

## 2. Visie

### 2.1 Vision statement

> Engineer Flow maakt complexe storingen aan zware voertuigen reproduceerbaar oplosbaar door vakkennis, meetbare evidence en veilige diagnostische stappen samen te brengen in één controleerbare workflow.

### 2.2 Productbelofte

Voor een bevoegde garagemedewerker belooft Engineer Flow:

> “Ik kan een storing sneller structureren, ik begrijp waarom bepaalde oorzaken hoger staan, ik weet welke veilige test ik eerst moet uitvoeren en ik kan de uiteindelijke reparatie controleerbaar vastleggen.”

### 2.3 Wat Engineer Flow niet is

Engineer Flow is niet:

- een generieke automotive chatbot;
- een vervanging voor een gekwalificeerde monteur;
- een systeem dat met tekst alleen absolute zekerheid kan geven;
- een marketing- of aanbevelingsmachine voor onderdelen;
- een onbemande veiligheidsbeslisser;
- een ongereviewde machine-learninglaag die zichzelf productiewaarheid toekent;
- een realtime datakanaal waarin ruwe garagegegevens standaard naar derden gaan.

---

## 3. Probleem en doelgroep

### 3.1 Het probleem

Storingen aan mixer-opbouwen zijn vaak:

- intermitterend;
- contextafhankelijk;
- verdeeld over mechanica, hydrauliek, elektronica, CAN en PTO;
- beschreven in werkplaatsjargon in plaats van formele termen;
- gevoelig voor verkeerde aannames;
- slecht overdraagbaar tussen monteur, werkplaats en fabrikant.

De huidige werkwijze is vaak gebaseerd op persoonlijke ervaring, losse documenten, eerdere cases en trial-and-error. Daardoor ontstaan:

- langere zoektijd;
- onnodig vervangen van onderdelen;
- onvoldoende vastgelegde testresultaten;
- kennisverlies wanneer een ervaren monteur vertrekt;
- onduidelijke overdracht naar een volgende werkplaats;
- beperkte leerbaarheid uit bevestigde reparaties.

### 3.2 Primaire persona’s

#### Monteur

Heeft een concrete storing voor zich, wil snel een veilige eerste test en wil niet door algemene theorie heen lezen.

#### Werkplaatschef

Wil cases kunnen volgen, reparaties vergelijken, kwaliteit bewaken en herhaalproblemen herkennen.

#### Fleet manager

Wil onderhoudshistorie en terugkerende storingen begrijpen zonder toegang te krijgen tot onnodige technische of persoonsgebonden data.

#### Fabrikant

Wil geanonimiseerde patronen en technische feedback ontvangen, niet de ruwe lokale historie van individuele voertuigen.

#### Verzekeraar

Wil alleen claimgebonden, geautoriseerde onderhoudshistorie kunnen opvragen, met duidelijke purpose en exactly-once-beleid.

---

## 4. Productprincipes

### P1. EFL core beslist, AI ondersteunt

De deterministische engine bepaalt:

- DES-matches;
- TS-evidence;
- subsystemen;
- failure-mode ranking;
- constraints;
- guided flow;
- diagnose-status.

AI mag:

- een case-titel voorstellen;
- technische begrippen uitleggen;
- een monteur helpen een vraag te formuleren;
- een educatieve toelichting geven.

AI mag niet:

- een officiële root cause vaststellen buiten de engine;
- constraints omzeilen;
- niet-bestaande componenten introduceren;
- een onveilige reparatie als zekerheid presenteren.

### P2. Onzekerheid is een geldige uitkomst

De engine moet kunnen zeggen:

- `ranked`: er is voldoende basis voor een gerangschikte hypothese;
- `clarification_required`: de invoer is ambigu en vereist aanvullende context;
- `knowledge_gap`: de kennisbank heeft onvoldoende dekking.

Een geforceerde oorzaak is slechter dan een expliciete knowledge gap.

### P3. Evidence vóór conclusie

Iedere hoge prioriteit in de ranking moet te herleiden zijn tot:

- invoer;
- context;
- DES/TS-matches;
- componentrelaties;
- constraints;
- testresultaten;
- dataset- en engineversie.

### P4. Diagnostische actie is niet hetzelfde als reparatie

Het product maakt onderscheid tussen:

- symptoom;
- hypothese;
- diagnostische test;
- testresultaat;
- reparatieoptie;
- bevestigde reparatie;
- post-repair outcome.

### P5. Veiligheid vóór snelheid

Een korte route is niet waardevol als die een monteur aan een onveilige handeling blootstelt. Iedere fysieke test moet uiteindelijk veiligheidsmetadata en stopcondities bevatten.

### P6. Lokale data blijft lokaal

Ruwe foutcodes, reparatiehistorie, vrije tekst en attachments verlaten de garage alleen via een expliciet toegestaan policy-pad.

### P7. Elke kenniswijziging is een release

Een wijziging in een JSON-dataset kan gedrag veranderen en moet daarom worden behandeld als een versieerbare softwarewijziging met regressietests.

### P8. Geen stille fallbacks in productie

Een productiesysteem mag niet ongemerkt van PostgreSQL naar procesgeheugen, lokale JSONL of Firestore overschakelen. In productie moet een opslagfout zichtbaar en herstelbaar zijn.

---

## 5. Productscope

### 5.1 Productkern v1

De eerste volwaardige release bestaat uit:

- Firebase-login;
- garage- en gebruikerscontext;
- voertuigselectie;
- case openen;
- symptoom- en contextinvoer;
- deterministische diagnose;
- clarification flow;
- knowledge-gap flow;
- failure-mode ranking;
- veilige guided tests;
- bevestigde diagnose-uitkomst;
- persistent diagnosearchief;
- audit trail;
- werkbon aanmaken en afronden;
- basisfeedback op diagnose-uitkomst.

### 5.2 Niet in de eerste productie-release

Deze onderdelen mogen in de repository blijven, maar worden pas geactiveerd na aparte validatie:

- echte CAN-loganalyse;
- fabrikant-trigger 1 in productie;
- verzekeraar-trigger 2 in productie;
- geavanceerde AI-expertchat;
- automatische kennisbankupdates;
- volledige offline multi-device conflictresolutie;
- geavanceerde facturatie-integraties.

---

## 6. Huidige technische staat

### 6.1 Technisch overzicht

| Onderdeel | Huidige staat | Beoordeling |
|---|---|---|
| Frontend | Next.js 15, React, Tailwind | Werkende basis |
| Diagnose-engine | Deterministische TypeScript-kern | Sterke prototypebasis |
| Symptoombrug | DES/TS-mapping met token- en phrase-overlap | Functioneel, beperkte taalrobustheid |
| Constraints | Canonieke, elektrische, hydraulische, variant- en logic rules | Sterk concept, meer validatie nodig |
| Guided flows | JSON flows, diagnostic steps en effects | Aanwezig, veiligheidslaag incompleet |
| Audit | Hash chain, IndexedDB buffering, LUCID mirror | Aanwezig, durable production sink nog nodig |
| Auth | Firebase client + server-side Firebase Admin | Technisch aanwezig, garage membership incompleet |
| Cases | PostgreSQL backend + lokale Next fallback | Dual path; productie moet één path gebruiken |
| Diagnoses | PostgreSQL backend + API-archief + Firestore fallback | Migratie in uitvoering |
| Werkbonnen | FastAPI/Postgres en lokale Next fallback | Niet volledig fail-closed |
| Facturen | FastAPI/Postgres en lokale Next fallback | Niet productieklaar |
| CAN-analyse | Gesimuleerde demo, standaard uitgeschakeld | Niet actief |
| AI-chat | Genkit flow met offline fallback | Experimenteel |
| Deployment | Firebase App Hosting-config aanwezig | Staging/production hardening ontbreekt |
| CI/CD | Geen volledige GitHub Actions pipeline | Nog bouwen |

### 6.2 Wat momenteel al werkt

- Deterministische diagnose zonder AI-ranking.
- Canonieke dataset loading.
- Fail-closed healthcheck op datasetintegriteit.
- `clarification_required` bij ambiguïteit.
- `knowledge_gap` bij onvoldoende dekking.
- DES naar TS evidence mapping.
- Subsystem- en clusterselectie.
- Component- en failure-mode scoring.
- Constraint tracing.
- DDS-achtige case-output.
- Hash-geketende lokale auditopslag.
- Browser audit buffering.
- Firebase server-side auth op actieve EFL-routes.
- Case- en diagnosepersistentie via FastAPI/PostgreSQL.
- Idempotente diagnoseopslag.
- Diagnosearchief API-first met tijdelijke Firestore fallback.
- Werkbon- en factuurbeleid in de FastAPI-backend.

### 6.3 Wat nog niet bewezen is

- Diagnosekwaliteit op echte historische cases.
- Stabiliteit van scores bij kennisbankuitbreiding.
- Correcte afhandeling van Nederlandse werkplaatsjargon.
- Correcte negatie- en contextinterpretatie.
- Veiligheid van alle guided steps in de praktijk.
- Multi-user garageownership.
- PostgreSQL-gedrag in de daadwerkelijke deploymentomgeving.
- Backup en restore.
- Productiegedrag bij backenduitval.
- Volledige workflow van diagnose naar factuur.
- Echte CAN-analyse.
- Productiegeschiktheid van AI-chat.

---

## 7. Eindarchitectuur

### 7.1 Doelarchitectuur

```text
Browser
  |
  | Firebase Auth ID token
  v
Next.js frontend + authenticated BFF
  |
  | internal service authentication
  v
FastAPI domain backend
  |
  +-- PostgreSQL: cases, diagnoses, work orders, invoices, policy, audit
  +-- Object storage: photos and CAN files
  +-- Background jobs: audit forwarding, batches, CAN analysis
  +-- Policy engine: garage, manufacturer, insurer access
  |
  +-- Deterministic EFL core integration
```

### 7.2 System of record

PostgreSQL wordt de system of record voor:

- garages;
- gebruikersmemberships;
- voertuigen;
- cases;
- diagnoses;
- testresultaten;
- bevestigde reparaties;
- werkbonnen;
- facturen;
- feedback;
- auditmetadata;
- policy decisions.

Firebase blijft uitsluitend voor identity zolang daar geen expliciete architectuurbeslissing voor wordt genomen.

### 7.3 Storagebeleid

| Data | Opslag | Regels |
|---|---|---|
| Auth identity | Firebase Auth | ID-token server-side verifiëren |
| Case/diagnose | PostgreSQL | Ownership, transacties, audit |
| Foto | Object storage | Geen base64 in audit, encryptie, retention |
| CAN-bestand | Object storage | Malware scan, beperkte toegang, lifecycle |
| Audit event | PostgreSQL/immutable sink | Hash chain, retention, append-only |
| UI fallback | Alleen development | Nooit stille productie-fallback |

---

## 8. Diagnostische kennisarchitectuur

### 8.1 Huidige flow

De huidige engine gebruikt ongeveer deze keten:

```text
vrije tekst
  -> normalisatie
  -> DES match
  -> DES/TS mapping
  -> subsystem scores
  -> symptom cluster
  -> component support
  -> failure-mode scores
  -> constraints
  -> ranking
  -> guided flow
```

De symptoombrug in `src/efl_core/symptom_bridge.ts` gebruikt momenteel token overlap, exacte frases en vaste thresholds. Dat is voldoende voor een gecontroleerde start, maar niet voldoende als enige taalrepresentatie voor een grote, vrije kennisbank.

### 8.2 Doelmodel

De kennisbank moet evolueren naar een evidence-based diagnostic graph:

```text
Symptom
  -> Context
  -> Observation / Measurement
  -> Candidate subsystem
  -> Candidate component
  -> Failure mode
  -> Diagnostic test
  -> Expected observation
  -> Pass/Fail effect
  -> Repair option
  -> Post-repair outcome
```

### 8.3 Kennisobjecten

Iedere kennisbankentry moet minimaal bevatten:

- stabiele ID;
- type;
- domein/subsystem;
- componentrelatie;
- Nederlandse beschrijving;
- synoniemen;
- werkplaatsjargon;
- negatieve formuleringen;
- contextsignalen;
- positieve evidence;
- negatieve evidence;
- relevante metingen;
- relevante DTC/CAN-signalen;
- diagnostische tests;
- verwachte observatie;
- pass-effect;
- fail-effect;
- veiligheidsniveau;
- bron/provenance;
- reviewstatus;
- datasetversie.

### 8.4 Scheiding tussen kennissoorten

De volgende objecten mogen niet in één onduidelijke lijst worden vermengd:

1. **Symptom descriptions**: wat de gebruiker/monteur ziet of hoort.
2. **Observations**: objectief vastgesteld gedrag.
3. **Measurements**: waarden met eenheid, bereik en meetconditie.
4. **Failure modes**: technische manieren waarop iets faalt.
5. **Diagnostic tests**: handelingen om hypotheses te onderscheiden.
6. **Repair actions**: mogelijke reparaties na voldoende evidence.
7. **Safety instructions**: voorwaarden en stopcondities.
8. **Outcomes**: resultaat na reparatie.

### 8.5 Kennisbankproces

Nieuwe kennis doorloopt:

```text
voorstel
  -> technische review
  -> schema-validatie
  -> gouden cases
  -> regressietest
  -> datasetversie
  -> release
  -> monitoring
```

Een bevestigde reparatie mag niet automatisch de kennisbank muteren. Eerst komt de case in een review queue.

---

## 9. Productroadmap

## Fase 0: Product- en architectuurfundament

**Doel:** één richting kiezen voordat nieuwe features de complexiteit verhogen.

### Architectuur

- [x] Bepaal deterministische EFL core als officiële diagnostische beslisser.
- [x] Bepaal FastAPI/PostgreSQL als doelbackend.
- [x] Bepaal Firebase Auth als huidige identity provider.
- [x] Leg Next.js vast als frontend/BFF-laag.
- [ ] Documenteer definitief eigenaarschap per datatabel.
- [ ] Definieer welke endpoints publiek, user-authenticated, garage-authenticated of internal-only zijn.
- [ ] Definieer development-, staging- en productieconfiguratie.
- [ ] Voeg een architecture decision record toe voor de Firebase/FastAPI identity bridge.

### Scope

- [x] CAN-analyse standaard uitschakelen.
- [x] Onbeveiligde dev-token proxy verwijderen.
- [x] Production buildchecks aanzetten.
- [ ] Maak een formele feature matrix met `production`, `pilot`, `experimental` en `disabled`.
- [ ] Verwijder marketingclaims voor features die nog simulaties zijn.
- [ ] Definieer v1-releasegrens.

### Gate

- [ ] Er is één vastgestelde system-of-record architectuur.
- [ ] Er is geen ongedocumenteerde fallback die in productie kan activeren.
- [ ] Iedere feature heeft een eigenaar, status en releasecriterium.

---

## Fase 1: Identity, tenants en autorisatie

**Doel:** gebruikers kunnen uitsluitend eigen garagegegevens gebruiken.

### Auth

- [x] Firebase ID-token server-side verifiëren.
- [x] `401` geven zonder token.
- [x] `401` geven bij ongeldig/verlopen token.
- [x] Firebase Admin configuratie documenteren.
- [ ] Firebase Admin credentials configureren in staging.
- [ ] Firebase Admin credentials configureren in productie.
- [x] Dev-auth deploymentmatig uitschakelen buiten development.
- [x] Private demo JWT keys uit productiepad verwijderen.

### Garage en memberships

- [x] `users`-tabel/model toevoegen.
- [x] `garage_memberships`-tabel/model toevoegen.
- [x] Rollenmodellering toevoegen.
- [x] Firebase UID aan membership koppelen.
- [x] `garage_id` niet langer stil laten terugvallen naar `uid`.
- [x] Vehicle ownership aan garage membership koppelen.
- [x] Membership lifecycle bouwen: uitnodigen, activeren, intrekken.
- [x] Role checks per mutatie vastleggen.

### Authorization tests

- [x] Unauthenticated route tests.
- [x] Garage ownership in bestaande FastAPI-domainflows.
- [x] Cross-garage case read test.
- [x] Cross-garage diagnosis read test.
- [x] Cross-garage work order mutation test.
- [x] Cross-role invoice mutation test.
- [ ] Firebase Emulator rules test.

### Gate

- [ ] Geen endpoint vertrouwt op een `userId`, `party_id` of garage-ID uit de request body.
- [ ] Iedere resource heeft aantoonbare tenant ownership.
- [ ] Een tweede garage kan geen enkele resource van de eerste garage lezen of muteren.

---

## Fase 2: Duurzame data en transacties

**Doel:** productdata overleeft restarts, deployments en meerdere instances.

### Database

- [x] Cases persistent modelleren.
- [x] Diagnoses persistent modelleren.
- [x] Diagnosemetadata persistent modelleren.
- [x] Alembic-migraties toevoegen.
- [x] Idempotency voor diagnoseopslag toevoegen.
- [ ] Test migraties tegen PostgreSQL 16.
- [x] `Base.metadata.create_all()` uit production startup verwijderen.
- [x] Alleen Alembic gebruiken voor schema-evolutie.
- [x] Foreign keys en cascadebeleid expliciet vastleggen.
- [ ] Database indexes met realistische data evalueren.

### Transactionele writes

- [x] Case aanmaken transactioneel maken.
- [x] Diagnose en auditrecord atomair opslaan.
- [x] Failure-mode confirmation transactioneel maken.
- [x] Werkbonregel toevoegen transactioneel maken.
- [x] Factuurfinalisatie transactioneel maken.
- [ ] Idempotency keys toevoegen aan alle muterende endpoints.
- [ ] Concurrencytests toevoegen.

### Fallbacks

- [x] Local `Map`-store expliciet achter developmentflag zetten.
- [x] Productie laten falen als PostgreSQL niet beschikbaar is.
- [ ] Geen lokale JSONL als primaire diagnoseopslag.
- [ ] Firestore alleen voor expliciete legacy-migratie gebruiken.
- [ ] Data-import en reconciliatie voor bestaande Firestore-diagnoses ontwerpen.

### Gate

- [ ] Restart-test verliest geen case, diagnose, werkbon of factuur.
- [ ] Twee gelijktijdige requests creëren geen dubbele financiële of diagnose-records.
- [ ] Een database restore is aantoonbaar succesvol.

---

## Fase 3: Diagnoseflow en archief

**Doel:** één complete, gebruikersgerichte diagnoseworkflow.

### Diagnoseflow

- [x] Symptoomtekst invoeren.
- [x] Context invoeren.
- [x] Optionele foto-invoer.
- [x] Diagnose uitvoeren.
- [x] Clarification state tonen.
- [x] Knowledge gap state tonen.
- [x] Root-cause ranking tonen.
- [x] Guided flow tonen.
- [x] Failure mode bevestigen.
- [x] Diagnose archiveren via EFL API.
- [x] Diagnosemetadata bijwerken.
- [x] Diagnose verwijderen via EFL API.
- [x] Diagnose opnieuw openen vanuit persistent backend zonder Firestore fallback.
- [x] Case status tonen in alle diagnoseviews.
- [x] Network retry en duidelijke persistence error UX toevoegen.

### Archief

- [x] EFL diagnose-list endpoint.
- [x] EFL diagnose-detail endpoint.
- [x] EFL diagnose-update endpoint.
- [x] EFL diagnose-delete endpoint.
- [x] `Mijn Diagnoses` API-first maken.
- [x] Detailpagina API-first maken.
- [x] Firestore fallback volledig verwijderen voor productie.
- [x] API-pagination toevoegen.
- [x] Filteren op status, voertuig, cluster en periode.
- [x] Zoeken op symptoomtekst en diagnose-ID.
- [x] Export van een diagnose naar DDS/PDF-formaat.

### Gate

- [ ] Monteur kan volledige flow doorlopen zonder Firestore.
- [ ] Refresh en opnieuw inloggen behouden de case.
- [ ] Archiefresultaat is tenant-isolated.
- [x] Geen diagnose kan worden verwijderd zonder audit event.

---

## Fase 4: Kennisbank en diagnostische kwaliteit

**Doel:** niet alleen meer kennis, maar aantoonbaar betere diagnoses.

### Kennisbankstructuur

- [ ] Kennisobject-schema definiëren.
- [ ] Synoniemen en werkplaatsjargon modelleren.
- [ ] Negatie en temporaliteit modelleren.
- [ ] Measurements met unit en meetconditie modelleren.
- [ ] Failure modes koppelen aan positieve en negatieve evidence.
- [ ] Tests koppelen aan pass/fail-effects.
- [ ] Repair actions scheiden van diagnostic actions.
- [ ] Safety metadata verplicht maken.
- [ ] Provenance en reviewstatus toevoegen.

### Validatie

- [ ] JSON-schema-validator uitbreiden.
- [ ] Referentiele integriteit controleren.
- [ ] Duplicate symptom detector bouwen.
- [ ] Tegenstrijdige constraint detector bouwen.
- [ ] Flow terminal-state validator bouwen.
- [ ] Ontbrekende safety metadata blokkeren.
- [ ] Dataset release script bouwen.

### Engine

- [ ] Nederlandse synoniemen en vervoegingen verbeteren.
- [ ] Werkplaatsjargon expliciet ondersteunen.
- [ ] Negatie herkennen.
- [ ] Multi-symptom input structureren.
- [ ] Contextsignalen expliciet uit vrije tekst halen.
- [ ] Scores kalibreren op historische cases.
- [ ] Tegenbewijs meenemen in ranking.
- [ ] Testen kiezen op informatiewaarde.
- [ ] Confidence niet als ongekalibreerde waarschijnlijkheid presenteren.
- [ ] Scoreveranderingen per datasetversie rapporteren.

### Gouden dataset

- [ ] Minimaal 20 gevalideerde cases per belangrijk subsystem verzamelen.
- [ ] Positieve cases toevoegen.
- [ ] Ambigue cases toevoegen.
- [ ] Knowledge-gap cases toevoegen.
- [ ] Misleidende symptomen toevoegen.
- [ ] Negatieve testresultaten toevoegen.
- [ ] Cases met meerdere gelijktijdige storingen toevoegen.
- [ ] Verwachte ranking per case vastleggen.
- [ ] Verwachte veilige vervolgstap vastleggen.
- [ ] Regression suite in CI opnemen.

### Gate

- [ ] Accuracy en false-confidence zijn gemeten.
- [ ] Elke release heeft een datasetversie.
- [ ] Een kennisbankwijziging zonder regressietest kan niet worden gemerged.
- [ ] Domeinexperts hebben de belangrijkste clusters goedgekeurd.

---

## Fase 5: Veiligheid en operationele werkplaatsflow

**Doel:** aanbevolen acties zijn uitvoerbaar en veilig in een echte werkplaats.

### Guided step safety

- [ ] Safety level per stap.
- [ ] Vereiste PBM per stap.
- [ ] Vereiste bevoegdheid per stap.
- [ ] Lockout/tagout waar nodig.
- [ ] Drukgevaar markeren.
- [ ] Bewegende delen markeren.
- [ ] Elektrisch risico markeren.
- [ ] Stopcondities definiëren.
- [ ] Precondition checklist tonen.
- [ ] Post-test observation verplicht vastleggen.

### Repair outcome

- [ ] Uitgevoerde reparatie vastleggen.
- [ ] Vervangen component vastleggen.
- [ ] Post-repair test vastleggen.
- [ ] Symptoom opgelost ja/nee vastleggen.
- [ ] Terugkeer van storing vastleggen.
- [ ] Monteurfeedback vastleggen.
- [ ] Outcome review queue bouwen.

### Gate

- [ ] Geen fysieke test zonder safety metadata.
- [ ] Geen reparatieadvies zonder voldoende evidence of duidelijke onzekerheidsmelding.
- [ ] Critical safety scenarios zijn door een domeinexpert beoordeeld.

---

## Fase 6: Werkbon en facturatie

**Doel:** diagnose gecontroleerd doorzetten naar service en administratie.

### Werkbon

- [ ] Next fallback voor werkbonnen verwijderen.
- [ ] Werkbon altijd aan case koppelen.
- [ ] Werkbonownership afdwingen.
- [ ] Werkbonstatussen definiëren.
- [ ] Regels transactioneel opslaan.
- [ ] Arbeid en onderdelen valideren.
- [ ] Werkbon afronden idempotent maken.
- [ ] Wijzigingen auditten.
- [ ] Werkbon PDF/export toevoegen.

### Factuur

- [ ] Factuur alleen op afgeronde werkbon.
- [ ] Factuursequence database-safe maken.
- [ ] Factuurfinalisatie idempotent maken.
- [ ] BTW-regels configureerbaar maken.
- [ ] Grootboekbalans afdwingen.
- [ ] Factuurdata immutable maken na finalisatie.
- [ ] Factuur PDF/export toevoegen.
- [ ] Boekhoudintegratie als aparte release ontwerpen.

### Gate

- [ ] Diagnose → werkbon → factuur is end-to-end persistent.
- [ ] Dubbele clicks veroorzaken geen dubbele factuur.
- [ ] Een gefinaliseerde factuur kan niet stil worden gewijzigd.
- [ ] Financiële tests zijn door een verantwoordelijke reviewer goedgekeurd.

---

## Fase 7: Audit, privacy en databeleid

**Doel:** iedere relevante handeling is controleerbaar zonder onnodige data te verspreiden.

### Audit

- [x] Diagnose audit trail.
- [x] Client audit buffering.
- [x] Hash chaining.
- [x] LUCID mirrorconcept.
- [ ] Durable audit sink in productie.
- [ ] Audit events transactioneel aan domeinwrites koppelen.
- [ ] Replay protection.
- [ ] Correlation IDs.
- [ ] Audit retention.
- [ ] Audit export.
- [ ] Audit integrity verifier.

### Privacy

- [ ] Data classification per veld.
- [ ] PII-redactie van vrije tekst.
- [ ] Foto’s uit audit payloads houden.
- [ ] Foto-opslag met object IDs en hashes.
- [ ] EXIF verwijderen.
- [ ] Malware scanning.
- [ ] Retentionbeleid.
- [ ] Verwijderbeleid.
- [ ] Data subject request proces.
- [ ] Privacy-impactanalyse.
- [ ] Consent UI voor fabrikant- en verzekeraarflows.

### Gate

- [ ] Een audit event bevat geen onnodige ruwe attachments.
- [ ] Ruwe garagegegevens verlaten de garage alleen via policy-approved routes.
- [ ] Verwijder- en retentionbeleid is technisch uitvoerbaar.

---

## Fase 8: Security en deployment

**Doel:** veilig en herhaalbaar deployen.

### Secrets

- [ ] Demo private keys uit productie verwijderen.
- [ ] Firebase Admin secrets via secret manager.
- [ ] LUCID service token via secret manager.
- [ ] HMAC secret randomiseren.
- [ ] JWT key rotation.
- [ ] Secret rotation procedure.
- [ ] Startup fail-closed bij ontbrekende productiecredentials.

### API security

- [ ] Request body size limits.
- [ ] Upload size limits.
- [ ] MIME/typevalidatie server-side.
- [ ] CORS expliciet configureren.
- [ ] Trusted hosts.
- [ ] Timeouts.
- [ ] Distributed rate limiting.
- [ ] Brute-force bescherming.
- [ ] Security headers.
- [ ] Dependency vulnerability review.

### Deployment

- [ ] Stagingomgeving.
- [ ] Productieomgeving.
- [ ] Environment schema/validation.
- [ ] Healthcheck voor database.
- [ ] Healthcheck voor EFL datasets.
- [ ] Healthcheck voor object storage.
- [ ] Rollbackprocedure.
- [ ] Database migration gate.
- [ ] Backup vóór migration.
- [ ] Restore drill.

### Gate

- [ ] Een nieuwe deployment is reproduceerbaar.
- [ ] Een mislukte migration blokkeert release.
- [ ] Secrets staan niet in repository, logs of clientbundle.
- [ ] Rollback is getest.

---

## Fase 9: Observability en CI/CD

**Doel:** problemen detecteren voordat gebruikers ze als dataverlies ervaren.

### CI

- [ ] GitHub Actions workflow toevoegen.
- [ ] `npm ci`.
- [ ] `npm run typecheck`.
- [ ] `npm run build`.
- [ ] Python dependency-installatie.
- [ ] `pytest`.
- [ ] Alembic upgrade tegen lege database.
- [ ] Alembic upgrade tegen bestaande database.
- [ ] `git diff --check`.
- [ ] Dependency audit.
- [ ] E2E smoke test.

### Logs en metrics

- [ ] Structured JSON logging.
- [ ] Request correlation ID.
- [ ] Diagnose latency.
- [ ] Persistence latency.
- [ ] Auth failures.
- [ ] Rate-limit events.
- [ ] Knowledge-gap rate.
- [ ] Clarification rate.
- [ ] Confirmation rate.
- [ ] False-confidence feedback.
- [ ] Audit backlog.
- [ ] Queue failures.
- [ ] Database pool saturation.

### Alerts

- [ ] Backend unavailable.
- [ ] Persistence failures.
- [ ] Audit forwarding failure.
- [ ] Abnormale auth failures.
- [ ] Database storage threshold.
- [ ] Repeated diagnostic engine errors.
- [ ] CAN job failure rate.

### Gate

- [ ] Iedere productie-error heeft een correlation ID.
- [ ] Incident responder kan een diagnose- en auditflow reconstrueren.
- [ ] Alerts zijn getest met een gecontroleerde failure.

---

## Fase 10: AI, CAN en externe datadeling

Deze fase komt pas na de kernrelease.

### AI-expertchat

- [ ] Alleen educatieve rol behouden.
- [ ] Knowledge-base retrieval implementeren.
- [ ] Prompt injection tests.
- [ ] Token- en historylimieten.
- [ ] Rate limiting.
- [ ] Geen interne foutdetails naar gebruiker.
- [ ] Geen root-cause claim zonder EFL core-output.
- [ ] Privacyreview van chatdata.
- [ ] Human escalation flow.

### CAN-analyse

- [ ] Ondersteunde formaten vastleggen.
- [ ] Echte parser/decoder implementeren.
- [ ] File upload naar object storage.
- [ ] Malware scanning.
- [ ] Asynchrone job queue.
- [ ] Progress/status endpoint.
- [ ] Vehicle profile mapping.
- [ ] CAN signature knowledge objects.
- [ ] Resultaat aan case koppelen.
- [ ] Audit trail voor parserregels.
- [ ] Golden CAN datasets.
- [ ] Productiefeature pas activeren na validatie.

### Fabrikant

- [ ] Trigger 1 scheduler.
- [ ] Drempel- en windowbeleid valideren.
- [ ] Anonimisering reviewen.
- [ ] Opt-out UX.
- [ ] Batch retry/idempotency.
- [ ] Manufacturer API contract.
- [ ] Data retention.

### Verzekeraar

- [ ] Claim UI.
- [ ] Claim ownership.
- [ ] Consent UI.
- [ ] Exactly-once tests.
- [ ] Claim TTL en revoke.
- [ ] Claim audit export.
- [ ] External insurer contract.

---

## 10. Productiechecklist

Deze checklist is de minimale go/no-go-lijst voor een eerste productiepilot.

### Product

- [ ] V1-scope is schriftelijk goedgekeurd.
- [ ] CAN-demo is niet zichtbaar als productiefunctie.
- [ ] AI-chat is correct gelabeld als ondersteunend.
- [ ] Diagnose-onzekerheid is zichtbaar.
- [ ] Gebruikers weten wanneer ze moeten stoppen/escaleren.

### Identity en authorization

- [ ] Firebase Admin werkt in staging.
- [ ] Firebase Admin werkt in productie.
- [ ] Garage membership is server-side.
- [ ] Cross-tenant reads zijn geblokkeerd.
- [ ] Cross-tenant writes zijn geblokkeerd.
- [ ] Dev-auth is uitgeschakeld.

### Diagnose

- [ ] Diagnose-engine healthcheck is groen.
- [ ] Datasetversies zijn vastgelegd.
- [ ] Gouden testdataset is groen.
- [ ] Knowledge gaps worden correct getoond.
- [ ] Clarifications worden correct getoond.
- [ ] Top-rank confidence is gekalibreerd of voorzichtig gelabeld.
- [ ] Guided steps zijn safety-reviewed.

### Data

- [ ] PostgreSQL is de enige productiebron.
- [ ] Firestore fallback is uit.
- [ ] Lokale Map/JSONL fallback is uit.
- [ ] Migrations zijn succesvol uitgevoerd.
- [ ] Backups zijn actief.
- [ ] Restore is getest.
- [ ] Attachments staan niet in auditpayloads.

### Workflows

- [ ] Case openen.
- [ ] Diagnose uitvoeren.
- [ ] Diagnose terugvinden na login.
- [ ] Failure mode bevestigen.
- [ ] Werkbon aanmaken.
- [ ] Werkbon afronden.
- [ ] Factuur aanmaken.
- [ ] Factuur finaliseren.
- [ ] Dubbele acties zijn idempotent.

### Operations

- [ ] CI is groen.
- [ ] Monitoring is actief.
- [ ] Alerts zijn getest.
- [ ] Rollback is getest.
- [ ] Incidentrunbook bestaat.
- [ ] Supportproces bestaat.
- [ ] Retention en privacybeleid zijn goedgekeurd.

---

## 11. Release gates

### Gate A: interne engineering release

Vereist:

- typecheck groen;
- build groen;
- Python-tests groen;
- migration test groen;
- unauthenticated routes geven correcte status;
- geen secrets in repository.

### Gate B: technische pilot

Vereist:

- staging-auth werkt;
- PostgreSQL is system of record;
- één garage kan volledige diagnoseflow uitvoeren;
- werkbonflow werkt;
- audit kan worden gereconstrueerd;
- backup/restore is getest;
- minimaal één domeinexpert valideert output.

### Gate C: beperkte gebruikerspilot

Vereist:

- echte garages zijn gemodelleerd;
- tenant isolation is getest;
- gouden dataset en safety review zijn afgerond;
- monitoring en incidentproces zijn actief;
- privacy- en retentionbeleid is vastgesteld;
- productclaims zijn aangepast aan bewezen functionaliteit.

### Gate D: productie-release v1

Vereist:

- alle P0-checklistitems zijn afgevinkt;
- geen actieve lokale productiefallback;
- diagnosekwaliteit heeft een afgesproken minimumscore;
- kritieke safety cases hebben nul onverklaarde blockers;
- rollback en restore zijn bewezen;
- eigenaar voor operationeel beheer is aangewezen.

---

## 12. KPI’s en succesmetingen

### Diagnostische kwaliteit

- top-1 failure-mode accuracy;
- top-3 coverage;
- false-confidence rate;
- clarification rate;
- knowledge-gap rate;
- percentage cases met objectieve measurement;
- percentage cases met bevestigde outcome;
- repair effectiveness;
- recurrence rate.

### Werkplaatswaarde

- tijd tot eerste onderscheidende test;
- totale diagnoseduur;
- onnodige onderdelenwissels;
- aantal herhaalbezoeken;
- percentage compleet ingevulde cases;
- adoptie per monteur;
- tijd tussen diagnose en werkbon.

### Platformkwaliteit

- API error rate;
- p95 diagnose latency;
- persistence failure rate;
- audit sync failure rate;
- uptime;
- database restore tijd;
- percentage releases zonder rollback.

### Productvertrouwen

- monteur accepteert top-3 ranking;
- monteur vindt guided flow bruikbaar;
- monteur begrijpt onzekerheid;
- expert review score;
- gemelde onveilige aanbevelingen.

---

## 13. Belangrijkste risico’s

### R1. Meer data zonder betere representatie

**Risico:** de kennisbank groeit, maar matching en ranking worden instabieler.
**Maatregel:** schema-validatie, golden cases, duplicates en regressietests.

### R2. Ongekalibreerde confidence

**Risico:** monteurs interpreteren een score als bewezen waarschijnlijkheid.
**Maatregel:** calibration study, voorzichtige UX-taal en expliciet tegenbewijs.

### R3. Parallelle opslag

**Risico:** Firestore, local store en PostgreSQL bevatten verschillende waarheden.
**Maatregel:** PostgreSQL als system of record en fallbacks alleen development.

### R4. Onveilige guided steps

**Risico:** technisch correcte maar fysiek onveilige instructies.
**Maatregel:** safety metadata en domeinreview als release gate.

### R5. Te vroege AI-uitbreiding

**Risico:** AI maskeert hiaten en maakt antwoorden plausibel maar oncontroleerbaar.
**Maatregel:** AI uitsluitend als ondersteunende laag.

### R6. Externe datadeling vóór governance

**Risico:** privacy- of policyfouten bij fabrikant/verzekeraar.
**Maatregel:** pas activeren na consent, exactly-once, anonimisering en auditreview.

### R7. Eén ontwikkelaar als single point of failure

**Risico:** kennis zit in code en hoofd, niet in processen.
**Maatregel:** dit document, ADR’s, runbooks, tests, release checklist en domeinreview.

---

## 14. Eerstvolgende uitvoeringsvolgorde

De aanbevolen volgorde vanaf de huidige staat:

1. Firebase Admin en garage membership in staging afronden.
2. PostgreSQL-route testen met echte authenticated Firebase gebruiker.
3. Firestore fallback uitzetten in staging.
4. Werkbon- en factuurfall-backs fail-closed maken.
5. E2E-test diagnose → case → diagnosearchief → werkbon.
6. Kennisbank-entry-schema en validator bouwen.
7. Gouden dataset opbouwen voor hydrauliek en PTO/elektrisch.
8. Guided-step safety metadata toevoegen.
9. Database backup/restore en monitoring inrichten.
10. Eerste technische pilot met één garage.
11. Feedback en bevestigde reparaties verzamelen.
12. Pas daarna AI-chat, CAN en externe triggerflows uitbreiden.

---

## 15. Definitie van “productieklaar”

Engineer Flow is productieklaar voor een beperkte v1-pilot wanneer:

1. een ingelogde monteur uitsluitend eigen garagegegevens ziet;
2. een case persistent wordt opgeslagen;
3. een diagnose reproduceerbaar is op basis van engine- en datasetversie;
4. de engine onzekerheid correct communiceert;
5. iedere voorgestelde fysieke test safety metadata heeft;
6. de monteur een failure mode en reparatie-uitkomst kan bevestigen;
7. diagnose, werkbon en auditrecord dezelfde system of record gebruiken;
8. productie niet terugvalt op local storage of Firestore;
9. backups, restore en rollback zijn getest;
10. de belangrijkste diagnose-uitkomsten door domeinexperts zijn gevalideerd;
11. CI, monitoring en incidentrespons actief zijn;
12. privacy- en retentionbeleid technisch uitvoerbaar zijn.

---

## 16. Slot

De juiste strategie voor Engineer Flow is geen volledige herbouw en ook geen onbeperkte uitbreiding van JSON-bestanden. De juiste strategie is:

1. de deterministische kern behouden;
2. de kennisbank structureren als evidence- en testmodel;
3. echte reparatie-uitkomsten gecontroleerd terugvoeren;
4. één duurzame backend als waarheid gebruiken;
5. safety, privacy en tenant isolation vóór schaal toevoegen;
6. AI en CAN pas activeren wanneer de kern meetbaar betrouwbaar is.

De onderscheidende waarde van Engineer Flow ontstaat wanneer een monteur niet alleen een antwoord krijgt, maar een **controleerbare redeneerroute die veilig naar een bevestigde reparatie leidt**.
