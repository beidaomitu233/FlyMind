-- Independent application credentials retain the existing user/team identity.
-- Existing hashes are imported by the configured, idempotent application runner.
CREATE TABLE app_flymind_account (
 user_id bigint PRIMARY KEY,
 password varchar(100) NOT NULL,
 status tinyint NOT NULL DEFAULT 1,
 created_at bigint NOT NULL,
 updated_at bigint NOT NULL,
 CONSTRAINT fk_fm_account_user FOREIGN KEY(user_id) REFERENCES sys_user(user_id)
);
