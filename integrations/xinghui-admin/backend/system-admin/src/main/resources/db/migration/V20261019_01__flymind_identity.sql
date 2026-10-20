CREATE TABLE app_flymind_team (
 id varchar(36) PRIMARY KEY,
 name varchar(80) NOT NULL,
 type varchar(16) NOT NULL,
 personal_user_id bigint NULL UNIQUE,
 status tinyint NOT NULL DEFAULT 1,
 created_at bigint NOT NULL,
 CONSTRAINT fk_fm_personal_user FOREIGN KEY (personal_user_id) REFERENCES sys_user(user_id)
);
CREATE TABLE app_flymind_member (
 team_id varchar(36) NOT NULL,
 user_id bigint NOT NULL,
 role varchar(10) NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
 created_at bigint NOT NULL,
 PRIMARY KEY(team_id,user_id),
 CONSTRAINT fk_fm_member_team FOREIGN KEY(team_id) REFERENCES app_flymind_team(id),
 CONSTRAINT fk_fm_member_user FOREIGN KEY(user_id) REFERENCES sys_user(user_id)
);
CREATE TABLE app_flymind_session (
 id varchar(36) PRIMARY KEY,
 user_id bigint NOT NULL,
 token_hash char(64) NOT NULL UNIQUE,
 created_at bigint NOT NULL,
 expires_at bigint NOT NULL,
 revoked_at bigint NULL,
 CONSTRAINT fk_fm_session_user FOREIGN KEY(user_id) REFERENCES sys_user(user_id)
);
CREATE TABLE app_flymind_invite (
 id varchar(36) PRIMARY KEY,
 team_id varchar(36) NOT NULL,
 user_id bigint NOT NULL,
 role varchar(10) NOT NULL,
 token_hash char(64) NOT NULL UNIQUE,
 created_by bigint NOT NULL,
 created_at bigint NOT NULL,
 expires_at bigint NOT NULL,
 accepted_at bigint NULL,
 CONSTRAINT fk_fm_invite_team FOREIGN KEY(team_id) REFERENCES app_flymind_team(id),
 CONSTRAINT fk_fm_invite_user FOREIGN KEY(user_id) REFERENCES sys_user(user_id)
);
