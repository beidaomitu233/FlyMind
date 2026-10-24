package com.xinghuiTec.flymind;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
@Component @Order(110)
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name="flymind.app-credential-migration.enabled",matchIfMissing=true)
public class FlymindDirectoryMigration implements ApplicationRunner {
 private final JdbcTemplate db;private final String tenant;
 public FlymindDirectoryMigration(JdbcTemplate db,@Value("${FLYMIND_APP_TENANT_ID}")String tenant){this.db=db;this.tenant=tenant;}
 @Override @Transactional public void run(ApplicationArguments args){
  for(String id:db.query("SELECT a.user_id FROM app_flymind_account a JOIN sys_user u ON u.user_id=a.user_id WHERE u.tenant_id=? AND u.is_deleted=0 ORDER BY a.user_id",(r,n)->r.getString(1),tenant))FlymindUserDirectory.ensure(db,id,System.currentTimeMillis());
 }
}
