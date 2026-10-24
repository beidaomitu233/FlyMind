package com.xinghuiTec.flymind;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.h2.jdbcx.JdbcDataSource;
import static org.junit.jupiter.api.Assertions.*;
class FlymindBootstrapTest {
 @Test void explicitBootstrapCreatesVisibleRoutesAndNeverOverwritesAccounts(){
  JdbcDataSource ds=new JdbcDataSource();ds.setURL("jdbc:h2:mem:bootstrap;MODE=MySQL;DB_CLOSE_DELAY=-1");JdbcTemplate db=new JdbcTemplate(ds);db.execute("DROP ALL OBJECTS");
  db.execute("CREATE TABLE sys_user(user_id BIGINT PRIMARY KEY,tenant_id VARCHAR(20),username VARCHAR(50),nickname VARCHAR(50),password VARCHAR(100),mobile VARCHAR(20),status INT,is_deleted INT)");
  db.execute("CREATE TABLE sys_tenant(id BIGINT PRIMARY KEY,tenant_id VARCHAR(20),company_name VARCHAR(100),status VARCHAR(1))");
  db.execute("CREATE TABLE sys_role(role_id BIGINT PRIMARY KEY,tenant_id VARCHAR(20),role_name VARCHAR(50),role_key VARCHAR(50),status INT,is_deleted INT)");
  db.execute("CREATE TABLE sys_user_role(user_id BIGINT,role_id BIGINT)");
  db.execute("CREATE TABLE sys_menu(menu_id BIGINT PRIMARY KEY,menu_name VARCHAR(80),parent_id BIGINT,order_num INT,menu_type VARCHAR(1),path VARCHAR(200),component VARCHAR(255),status VARCHAR(1),visible VARCHAR(1),perms VARCHAR(100),is_deleted INT)");
  db.execute("CREATE TABLE sys_role_menu(role_id BIGINT,menu_id BIGINT)");
  try(var c=ds.getConnection()){org.springframework.jdbc.datasource.init.ScriptUtils.executeSqlScript(c,new org.springframework.core.io.support.EncodedResource(new org.springframework.core.io.ClassPathResource("db/migration/V20261024_02__flymind_overview_menu.sql"),java.nio.charset.StandardCharsets.UTF_8));}catch(java.sql.SQLException e){throw new IllegalStateException(e);}
  var bootstrap=new FlymindBootstrap(db,new BCryptPasswordEncoder(4),"app-test");var tx=new TransactionTemplate(new DataSourceTransactionManager(ds));
  tx.executeWithoutResult(t->bootstrap.initialize("13800000001","isolated-test-password"));
  assertEquals(2,db.queryForObject("SELECT COUNT(*) FROM sys_menu WHERE menu_type='M'",Integer.class));assertEquals(3,db.queryForObject("SELECT COUNT(*) FROM sys_menu WHERE menu_type='C'",Integer.class));
  assertEquals(3,db.queryForObject("SELECT COUNT(*) FROM sys_role_menu WHERE menu_id IN (90001,90002,90003)",Integer.class));
  assertEquals("数据看板",db.queryForObject("SELECT menu_name FROM sys_menu WHERE menu_id=90004",String.class));assertEquals("应用概览",db.queryForObject("SELECT menu_name FROM sys_menu WHERE menu_id=90005",String.class));
  assertEquals(-100,db.queryForObject("SELECT order_num FROM sys_menu WHERE menu_id=90004",Integer.class));
  assertEquals("app-test",db.queryForObject("SELECT tenant_id FROM sys_user",String.class));assertTrue(new BCryptPasswordEncoder(4).matches("isolated-test-password",db.queryForObject("SELECT password FROM sys_user",String.class)));
  assertThrows(IllegalStateException.class,()->tx.executeWithoutResult(t->bootstrap.initialize("13800000002","isolated-test-password")));assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM sys_user",Integer.class));
 }
}
