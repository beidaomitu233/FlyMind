package com.xinghuiTec.flymind;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import static org.junit.jupiter.api.Assertions.*;

class FlymindAppAccountsTest {
 @Test void importsExistingFrontendIdentitiesOnceWithoutCreatingFrontendAccessForNewAdmins() {
  var db=new JdbcTemplate(new DriverManagerDataSource("jdbc:h2:mem:accountmigration;MODE=MySQL;DB_CLOSE_DELAY=-1","sa",""));
  db.execute("DROP ALL OBJECTS");
  db.execute("CREATE TABLE sys_user(user_id BIGINT PRIMARY KEY,tenant_id VARCHAR(20),password VARCHAR(100),status INT,is_deleted INT)");
  db.execute("CREATE TABLE sys_role(role_id BIGINT,status INT,is_deleted INT)");
  db.execute("CREATE TABLE sys_user_role(user_id BIGINT,role_id BIGINT)");
  db.execute("CREATE TABLE app_flymind_member(user_id BIGINT,team_id BIGINT)");
  db.execute("CREATE TABLE app_flymind_session(user_id BIGINT)");
  db.execute("CREATE TABLE app_flymind_account(user_id BIGINT PRIMARY KEY,password VARCHAR(100),status INT,created_at BIGINT,updated_at BIGINT)");
  db.update("INSERT INTO sys_user VALUES(1,'app','ordinary',1,0),(2,'app','admin-only',1,0),(3,'app','dual-member',1,0),(4,'other','foreign',1,0),(5,'app','disabled',0,0),(6,'app','dual-session',1,0)");
  db.update("INSERT INTO sys_role VALUES(10,0,0)");db.update("INSERT INTO sys_user_role VALUES(2,10),(3,10),(6,10)");
  db.update("INSERT INTO app_flymind_member VALUES(3,42)");db.update("INSERT INTO app_flymind_session VALUES(6)");
  var migration=new FlymindAppAccounts(db,"app");assertEquals(4,migration.migrateExisting());
  assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM app_flymind_account WHERE user_id IN(2,4)",Integer.class));
  assertEquals("ordinary",db.queryForObject("SELECT password FROM app_flymind_account WHERE user_id=1",String.class));
  assertEquals(0,db.queryForObject("SELECT status FROM app_flymind_account WHERE user_id=5",Integer.class));
  db.update("UPDATE app_flymind_account SET password='independent',status=0 WHERE user_id=1");assertEquals(0,migration.migrateExisting());
  assertEquals("independent",db.queryForObject("SELECT password FROM app_flymind_account WHERE user_id=1",String.class));
  assertEquals(42,db.queryForObject("SELECT team_id FROM app_flymind_member WHERE user_id=3",Integer.class));
  assertEquals(6,db.queryForObject("SELECT COUNT(*) FROM sys_user",Integer.class));
 }
 @Test void frontendAndBackendPoliciesAreIndependent() {
  assertDoesNotThrow(()->FlymindAppAccounts.validatePassword("123456"));
  assertThrows(FlymindException.class,()->FlymindAppAccounts.validatePassword("      "));
  assertThrows(FlymindException.class,()->FlymindAppAccounts.validatePassword("中".repeat(25)));
  assertThrows(com.xinghuiTec.exception.ServiceException.class,()->com.xinghuiTec.service.AdminPasswordPolicy.validated("123456"));
  assertEquals("simple-but-long",com.xinghuiTec.service.AdminPasswordPolicy.validated("simple-but-long"));
 }
}
