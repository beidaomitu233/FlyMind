package com.xinghuiTec.flymind;
import org.springframework.jdbc.core.JdbcTemplate;
/** Explicit fixture credentials; never used by production startup. */
final class FlymindCredentialFixtures {
 static void install(JdbcTemplate db){
  db.execute("CREATE TABLE app_flymind_account(user_id BIGINT PRIMARY KEY REFERENCES sys_user(user_id),password VARCHAR(100) NOT NULL,status INT NOT NULL,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)");
  db.update("INSERT INTO app_flymind_account SELECT user_id,password,status,0,0 FROM sys_user");
 }
}
