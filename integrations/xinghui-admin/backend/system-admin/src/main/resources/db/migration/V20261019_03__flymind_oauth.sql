CREATE TABLE app_flymind_oauth_client (
 id varchar(200) PRIMARY KEY,
 metadata text NOT NULL,
 created_at bigint NOT NULL
);
CREATE TABLE app_flymind_oauth_request (
 request_hash char(64) PRIMARY KEY,
 client_id varchar(200) NOT NULL,
 redirect_uri varchar(2048) NOT NULL,
 challenge varchar(43) NOT NULL,
 scopes varchar(80) NOT NULL,
 state_value varchar(2048) NULL,
 resource_uri varchar(2048) NOT NULL,
 expires_at bigint NOT NULL,
 consumed_at bigint NULL,
 CONSTRAINT fk_fmo_request_client FOREIGN KEY(client_id) REFERENCES app_flymind_oauth_client(id)
);
CREATE TABLE app_flymind_oauth_grant (
 id varchar(36) PRIMARY KEY,
 client_id varchar(200) NOT NULL,
 user_id bigint NOT NULL,
 team_id varchar(36) NOT NULL,
 scopes varchar(80) NOT NULL,
 resource_uri varchar(2048) NOT NULL,
 created_at bigint NOT NULL,
 expires_at bigint NOT NULL,
 revoked_at bigint NULL,
 CONSTRAINT fk_fmo_grant_client FOREIGN KEY(client_id) REFERENCES app_flymind_oauth_client(id),
 CONSTRAINT fk_fmo_grant_user FOREIGN KEY(user_id) REFERENCES sys_user(user_id),
 CONSTRAINT fk_fmo_grant_team FOREIGN KEY(team_id) REFERENCES app_flymind_team(id)
);
CREATE INDEX ix_fmo_grant_user ON app_flymind_oauth_grant(user_id);
CREATE TABLE app_flymind_oauth_code (
 code_hash char(64) PRIMARY KEY,
 grant_id varchar(36) NOT NULL,
 redirect_uri varchar(2048) NOT NULL,
 challenge varchar(43) NOT NULL,
 expires_at bigint NOT NULL,
 consumed_at bigint NULL,
 CONSTRAINT fk_fmo_code_grant FOREIGN KEY(grant_id) REFERENCES app_flymind_oauth_grant(id)
);
CREATE TABLE app_flymind_oauth_token (
 token_hash char(64) PRIMARY KEY,
 grant_id varchar(36) NOT NULL,
 token_kind varchar(10) NOT NULL CHECK(token_kind IN ('access','refresh')),
 scopes varchar(80) NOT NULL,
 expires_at bigint NOT NULL,
 consumed_at bigint NULL,
 CONSTRAINT fk_fmo_token_grant FOREIGN KEY(grant_id) REFERENCES app_flymind_oauth_grant(id)
);
CREATE INDEX ix_fmo_token_grant ON app_flymind_oauth_token(grant_id);
