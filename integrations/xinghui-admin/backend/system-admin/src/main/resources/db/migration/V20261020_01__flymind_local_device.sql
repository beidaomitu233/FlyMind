CREATE TABLE app_flymind_local_grant (
 id varchar(36) PRIMARY KEY,
 binding_key char(64) NOT NULL UNIQUE,
 token_hash char(64) NOT NULL UNIQUE,
 session_id varchar(36) NOT NULL,
 user_id bigint NOT NULL,
 team_id varchar(36) NOT NULL,
 device_hash char(64) NOT NULL,
 data_root_id varchar(100) NOT NULL,
 created_at bigint NOT NULL,
 expires_at bigint NOT NULL,
 revoked_at bigint NULL,
 CONSTRAINT fk_fm_local_session FOREIGN KEY(session_id) REFERENCES app_flymind_session(id),
 CONSTRAINT fk_fm_local_user FOREIGN KEY(user_id) REFERENCES sys_user(user_id),
 CONSTRAINT fk_fm_local_team FOREIGN KEY(team_id) REFERENCES app_flymind_team(id)
);
CREATE INDEX idx_fm_local_member ON app_flymind_local_grant(team_id,user_id);
