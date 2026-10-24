package com.xinghuiTec.flymind;
import org.springframework.jdbc.core.JdbcTemplate;
/** Explicit fixture credentials; never used by production startup. */
final class FlymindCredentialFixtures {
 static void install(JdbcTemplate db){
  db.execute("CREATE TABLE app_flymind_account(user_id BIGINT PRIMARY KEY REFERENCES sys_user(user_id),password VARCHAR(100) NOT NULL,status INT NOT NULL,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)");
  db.update("INSERT INTO app_flymind_account SELECT user_id,password,status,0,0 FROM sys_user");
  try(var c=db.getDataSource().getConnection()){org.springframework.jdbc.datasource.init.ScriptUtils.executeSqlScript(c,new org.springframework.core.io.support.EncodedResource(new org.springframework.core.io.ClassPathResource("db/migration/V20261024_01__flymind_user_directory.sql"),java.nio.charset.StandardCharsets.UTF_8));}catch(java.sql.SQLException e){throw new IllegalStateException(e);}
  for(String id:db.query("SELECT user_id FROM sys_user",(r,n)->r.getString(1)))FlymindUserDirectory.ensure(db,id,0);
 }
}
