-- V2__session_sid.sql · VTC In-House Portal v2 (MySQL 8.0+)
-- v1.6 (SQLite) identified a signed-in device by the hidden ROWID of `sessions` and returned it as "id" in
-- GET /api/v1/me/profile → sessions[]; the browser posts it back to POST /api/v1/me/sessions/revoke {"id": n}.
-- MySQL has no rowid, so v2 adds a numeric surrogate. The JSON field name stays "id".
ALTER TABLE `sessions` ADD COLUMN `sid` BIGINT NOT NULL AUTO_INCREMENT UNIQUE;
