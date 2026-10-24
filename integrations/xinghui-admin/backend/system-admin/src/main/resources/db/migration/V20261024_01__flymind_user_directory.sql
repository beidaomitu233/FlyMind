CREATE TABLE app_flymind_user_code (
 user_id bigint PRIMARY KEY,
 user_code char(6) NOT NULL UNIQUE,
 created_at bigint NOT NULL,
 CONSTRAINT fk_fmuc_user FOREIGN KEY(user_id) REFERENCES sys_user(user_id)
);
ALTER TABLE app_flymind_invite ADD COLUMN declined_at bigint NULL;
CREATE TABLE app_flymind_access_day (
 user_id bigint NOT NULL,
 day_utc char(10) NOT NULL,
 login_count bigint NOT NULL DEFAULT 0,
 first_at bigint NOT NULL,
 last_at bigint NOT NULL,
 PRIMARY KEY(user_id,day_utc),
 CONSTRAINT fk_fmad_user FOREIGN KEY(user_id) REFERENCES sys_user(user_id)
);
