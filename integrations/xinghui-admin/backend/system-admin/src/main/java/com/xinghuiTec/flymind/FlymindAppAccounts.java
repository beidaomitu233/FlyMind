package com.xinghuiTec.flymind;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;

/** One-way compatibility import. Never replaces an independent credential. */
@Component
@Order(100)
@ConditionalOnProperty(name="flymind.app-credential-migration.enabled",matchIfMissing=true)
public class FlymindAppAccounts implements ApplicationRunner {
 private final JdbcTemplate db;
 private final String tenant;
 public FlymindAppAccounts(JdbcTemplate db,@Value("${FLYMIND_APP_TENANT_ID}") String tenant){this.db=db;this.tenant=tenant;}
 public static void validatePassword(String password){
  if(password==null||password.isBlank()||password.codePointCount(0,password.length())<6||password.getBytes(StandardCharsets.UTF_8).length>72)
   throw new FlymindException(400,"INVALID_INPUT","前台密码至少6字符且不超过72 UTF-8字节");
 }
 public static void revoke(JdbcTemplate db,String userId,long now){
  db.update("UPDATE app_flymind_oauth_grant SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",now,userId);
  db.update("UPDATE app_flymind_local_grant SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",now,userId);
  db.update("UPDATE app_flymind_session SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",now,userId);
 }
 @Override @Transactional public void run(ApplicationArguments args){migrateExisting();}
 @Transactional public int migrateExisting(){
  long now=System.currentTimeMillis();
  return db.update("INSERT INTO app_flymind_account(user_id,password,status,created_at,updated_at) SELECT u.user_id,u.password,COALESCE(u.status,1),?,? FROM sys_user u WHERE u.tenant_id=? AND u.is_deleted=0 AND NOT EXISTS(SELECT 1 FROM app_flymind_account a WHERE a.user_id=u.user_id) AND (NOT EXISTS(SELECT 1 FROM sys_user_role ur JOIN sys_role r ON r.role_id=ur.role_id WHERE ur.user_id=u.user_id AND r.is_deleted=0) OR EXISTS(SELECT 1 FROM app_flymind_member m WHERE m.user_id=u.user_id) OR EXISTS(SELECT 1 FROM app_flymind_session s WHERE s.user_id=u.user_id))",now,now,tenant);
 }
}
