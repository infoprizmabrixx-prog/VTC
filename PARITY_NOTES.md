# VTC In-House Portal v2 — Parity Notes

## 1. Build System & Stack Alignment
- **Build Tool (`02_ARCHITECTURE_AND_CONVENTIONS.md` §3):** Spec allows Gradle or Maven; owner explicitly instructed **Maven only (`pom.xml`), do not use Gradle**. Implemented with Maven (`backend/pom.xml` and `docker/Dockerfile` using `maven:3.9.9-eclipse-temurin-17`).
- **Password Hashing (`04_SECURITY_AND_PERMISSIONS.md` §3):** v1.6 uses `PBKDF2-HMAC-SHA256` (240,000 iterations, `<salt_hex>$<digest_hex>`). To preserve 100% compatibility with migrated v1.6 hashes while also supporting Spring Security `BCryptPasswordEncoder` from the project stack, `PasswordHasher` supports both existing `<salt_hex>$<digest_hex>` PBKDF2-HMAC-SHA256 secrets and `$2a$`/`$2b$` BCrypt hashes transparently, generating PBKDF2-HMAC-SHA256 by default for v1.6 migration parity.
- **Authentication (`04_SECURITY_AND_PERMISSIONS.md` §3):** Supports the exact `vtc_session` HttpOnly `SameSite=Strict` cookie + SHA-256 `sessions.token_hash` required by all 76 API tests and Playwright E2E flows, plus `Authorization: Bearer <jwt>` support via `JwtTokenService`.
- **OpenAPI / Swagger (`00_START_HERE_MASTER_PROMPT.md` §6):** Configured via `springdoc-openapi-starter-webmvc-ui`, disabled by default (`springdoc.swagger-ui.enabled=false`) so `/docs` and `/redoc` return 404 in parity tests, and activatable via `SPRINGDOC_ENABLED=true`.

## 2. Structural Database Differences (per `03_DATA_MODEL.md` §3)
1. `roast_inputs` and `blend_inputs`: surrogate `id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY` added in `V1__baseline.sql`.
2. `masters`: generated column `bean_code_key` + unique index `ux_bean_code` replacing SQLite partial index.
3. `sessions`: `sid BIGINT NOT NULL AUTO_INCREMENT UNIQUE` added in `V2__session_sid.sql` and returned as `id` in `GET /api/v1/me/profile`.
4. `movements_mark_stock` trigger translated to MySQL `FOR EACH ROW` syntax.

## 3. Known v1.6 Gaps Kept As-Is (per `12_GLOSSARY_DECISIONS_AND_GAPS.md` §4)
1. **QC release (`qc_decide`):** Kept without maker ≠ checker check.
2. **Packing QA release (`pack_release`):** Kept without maker ≠ checker check.
3. **Quarantine verification (`verify_quarantined`):** Kept without maker ≠ checker check.
4. **Alerts bell (`GET /api/v1/alerts`):** Lists only `high` and `critical` alerts; `normal` alerts stored in DB only.
5. **Tally voucher dates (`finance._vouchers`):** Kept using UTC date part of `created_at`.
6. **Counter refunds (`decide_refund`):** Refunded goods are not returned to stock.
7. **Receipt payment status (`decide_supplier_payment`):** Becomes `PAID` only when `invoice_amount_paise` is known, else `PARTIAL`.
8. **Outside-roasting payment (`outside_payment`):** Manual `PENDING`/`PAID` flag.
9. **Outgoing orders (`orders`):** Single item line per order.
10. **Profit/margin (`reports`):** Hidden (`finance.margin` has `live=false`).
11. **Translations (`i18n.js`):** 50 UI keys + 88 help texts in EN/TE/HI; 193 error codes and inline screen labels in English.
12. **Telugu/Hindi help texts:** Used verbatim from `generated/helptext.json`.
13. **Staff documents:** Stored in `VTC_FILES_DIR` as `staffdoc_<sha256[:24]>.bin`.
14. **Admin MFA:** Not enabled in v1.6; kept off.
15. **Audit log protection:** Enforced in application code (no update/delete methods exposed).
16. **Cash-today forecast (`insights`):** Uses fixed `0.6` cash share when today has no sales yet.
17. **Monthly sequence reset (`_next_number`):** Bill and invoice numbers reset per `YYMM`.
18. **Initial owner secret (`seed`):** `VTC-Owner-Demo26` with `must_change_secret=1` when `VTC_DEMO=0`.
