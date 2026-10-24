package com.xinghuiTec.flymind;

import org.junit.jupiter.api.*;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.context.annotation.*;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.beans.factory.annotation.Autowired;
import org.h2.jdbcx.JdbcDataSource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import javax.sql.DataSource;
import java.util.concurrent.atomic.AtomicLong;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringJUnitConfig(FlymindIdentityTest.Config.class)
class FlymindIdentityTest {
 @Configuration @EnableTransactionManagement static class Config {
  @Bean DataSource source(){JdbcDataSource ds=new JdbcDataSource();ds.setURL("jdbc:h2:mem:flymindidentity;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");return ds;}
  @Bean JdbcTemplate db(DataSource ds){return new JdbcTemplate(ds);}
  @Bean DataSourceTransactionManager tx(DataSource ds){return new DataSourceTransactionManager(ds);}
  @Bean AtomicLong time(){return new AtomicLong(1800000000000L);}
  @Bean FlymindLoginLimiter limiter(){return new FlymindLoginLimiter(null){@Override public void check(String ip,String phone){}};}
  @Bean FlymindIdentityService service(JdbcTemplate db,FlymindLoginLimiter limiter,AtomicLong time){return new FlymindIdentityService(db,new BCryptPasswordEncoder(4),limiter,"app-test",time::get);}
 }
 @Autowired JdbcTemplate db;@Autowired DataSource source;@Autowired FlymindIdentityService service;@Autowired AtomicLong time;
 MockMvc http;
 @BeforeEach void reset()throws Exception {
  db.execute("DROP ALL OBJECTS");
  db.execute("CREATE TABLE sys_user(user_id BIGINT PRIMARY KEY,tenant_id VARCHAR(20),username VARCHAR(50),nickname VARCHAR(50),password VARCHAR(100),mobile VARCHAR(20),status INT,is_deleted INT)");
  try(var c=source.getConnection()){ScriptUtils.executeSqlScript(c,new ClassPathResource("db/migration/V20261019_01__flymind_identity.sql"));ScriptUtils.executeSqlScript(c,new ClassPathResource("db/migration/V20261019_03__flymind_oauth.sql"));ScriptUtils.executeSqlScript(c,new ClassPathResource("db/migration/V20261020_01__flymind_local_device.sql"));}
  BCryptPasswordEncoder passwords=new BCryptPasswordEncoder(4);for(int i=1;i<=4;i++)db.update("INSERT INTO sys_user VALUES(?,?,?,?,?,?,1,0)",i,i==4?"another-tenant":"app-test","account"+i,"用户"+i,passwords.encode("correct-password"),"1380000000"+i);
  FlymindCredentialFixtures.install(db);time.set(1800000000000L);http=MockMvcBuilders.standaloneSetup(new FlymindController(service)).setControllerAdvice(new FlymindErrors()).build();
 }
 String login(int i){return "Bearer "+service.login("1380000000"+i,"correct-password","127.0.0.1").sessionToken();}
 String team(String auth){return service.createTeam(auth," 测试团队 ").id();}
 void reject(int status,Runnable task){FlymindException e=assertThrows(FlymindException.class,task::run);assertEquals(status,e.status);}
 @Test void directoryBackfillIsStableUniqueAndNeverChangesInternalIds(){
  db.update("DELETE FROM app_flymind_user_code WHERE user_id IN (1,2,3)");var migration=new FlymindDirectoryMigration(db,"app-test");migration.run(null);
  var before=db.queryForList("SELECT user_id,user_code FROM app_flymind_user_code ORDER BY user_id");migration.run(null);assertEquals(before,db.queryForList("SELECT user_id,user_code FROM app_flymind_user_code ORDER BY user_id"));assertEquals(4,before.size());assertEquals(4,new java.util.HashSet<>(db.query("SELECT user_code FROM app_flymind_user_code",(r,n)->r.getString(1))).size());
  for(String code:db.query("SELECT user_code FROM app_flymind_user_code",(r,n)->r.getString(1)))assertTrue(code.matches("(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{6}"));assertEquals(4,db.queryForObject("SELECT COUNT(*) FROM sys_user",Integer.class));
 }
 @Test void multipleDevicesAndPersonalSpaceAreIndependent(){String a=login(1),b=login(1);assertNotEquals(a,b);assertEquals(1,service.teams(a).size());service.logout(a);reject(401,()->service.me(a));assertEquals(1,service.teams(b).size());assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM app_flymind_team WHERE personal_user_id=1",Integer.class));assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM app_flymind_session WHERE token_hash=?",Integer.class,b.substring(7)));}
 @Test void credentialsTenantDisableAndExpiryFailClosed(){reject(401,()->service.login("13800000001","bad","ip"));reject(401,()->login(4));String a=login(1);db.update("UPDATE app_flymind_account SET status=0 WHERE user_id=1");reject(401,()->service.me(a));db.update("UPDATE app_flymind_account SET status=1 WHERE user_id=1");time.addAndGet(8L*24*60*60*1000);reject(401,()->service.me(a));}
 @Test void inviteBindsAccountAndCannotReplay(){String a=login(1),b=login(2),c=login(3),tid=team(a);var invite=service.invite(a,tid,"13800000002","editor");reject(409,()->service.accept(c,invite.inviteToken()));assertEquals("editor",service.accept(b,invite.inviteToken()).role());reject(409,()->service.accept(b,invite.inviteToken()));assertEquals(2,service.members(a,tid).size());}
 @Test void viewerAndNonMemberCannotMutateTeams(){String a=login(1),b=login(2),tid=team(a);reject(403,()->service.introspect(b,tid));var invite=service.invite(a,tid,"13800000002","viewer");service.accept(b,invite.inviteToken());reject(403,()->service.renameTeam(b,tid,"不能修改"));reject(403,()->service.invite(b,tid,"13800000003","editor"));service.remove(a,tid,"2");reject(403,()->service.introspect(b,tid));}
 @Test void ownerTransferAndAdminRoleCeiling(){String a=login(1),b=login(2),c=login(3),tid=team(a);service.accept(b,service.invite(a,tid,"13800000002","admin").inviteToken());reject(403,()->service.invite(b,tid,"13800000003","admin"));reject(403,()->service.remove(b,tid,"1"));reject(403,()->service.changeRole(a,tid,"1","editor"));reject(403,()->service.leave(a,tid));service.transfer(a,tid,"2");assertEquals("owner",service.teams(b).stream().filter(t->t.id().equals(tid)).findFirst().orElseThrow().role());assertEquals("admin",service.teams(a).stream().filter(t->t.id().equals(tid)).findFirst().orElseThrow().role());}
 @Test void suspendedTeamAndExpiredInviteReject(){String a=login(1),b=login(2),tid=team(a);var invite=service.invite(a,tid,"13800000002","editor");time.addAndGet(49L*60*60*1000);reject(409,()->service.accept(b,invite.inviteToken()));db.update("UPDATE app_flymind_team SET status=0 WHERE id=?",tid);reject(403,()->service.introspect(a,tid));}
 @Test void personalCannotInviteAndFailedAcceptDoesNotConsume(){String a=login(1),b=login(2),tid=service.teams(a).get(0).id();reject(403,()->service.invite(a,tid,"13800000002","editor"));assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM app_flymind_invite",Integer.class));}
 @Test void httpContractUsesStringIdsAndNoStoreAndRejectsTenantInjection()throws Exception {
  http.perform(post("/app/flymind/auth/login").contentType("application/json").content("{\"phone\":\"13800000001\",\"password\":\"correct-password\",\"tenantId\":\"another-tenant\"}")).andExpect(status().isBadRequest());
  String a=login(1),tid=team(a);http.perform(post("/app/flymind/session/introspect").header("Authorization",a).contentType("application/json").content("{\"teamId\":\""+tid+"\"}")).andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store")).andExpect(jsonPath("$.data.user.id").value("1")).andExpect(jsonPath("$.data.team.role").value("owner")).andExpect(jsonPath("$.data.session.id").isString()).andExpect(jsonPath("$.data.sessionToken").doesNotExist());
  http.perform(post("/app/flymind/session/introspect").header("Authorization",login(2)).contentType("application/json").content("{\"teamId\":\""+tid+"\"}")).andExpect(status().isForbidden());
 }
 @Test void infrastructureFailureIs503NotStaleAuthorization()throws Exception {String a=login(1);db.execute("DROP TABLE app_flymind_session CASCADE");http.perform(get("/app/flymind/auth/me").header("Authorization",a)).andExpect(status().isServiceUnavailable());}
 @Test void parallelAcceptIsAtomicAndRemovedInviterCannotGrant(){
  String a=login(1),b=login(2),tid=team(a);var invite=service.invite(a,tid,"13800000002","editor");
  var pool=java.util.concurrent.Executors.newFixedThreadPool(2);
  try {var tasks=java.util.List.<java.util.concurrent.Callable<Integer>>of(()->{try{service.accept(b,invite.inviteToken());return 200;}catch(FlymindException e){return e.status;}},()->{try{service.accept(b,invite.inviteToken());return 200;}catch(FlymindException e){return e.status;}});var results=pool.invokeAll(tasks);assertEquals(java.util.Set.of(200,409),java.util.Set.of(results.get(0).get(),results.get(1).get()));assertEquals(2,service.members(a,tid).size());}catch(Exception e){throw new RuntimeException(e);}finally{pool.shutdownNow();}
  String c=login(3);service.changeRole(a,tid,"2","admin");var pending=service.invite(b,tid,"13800000003","editor");service.remove(a,tid,"2");reject(404,()->service.accept(c,pending.inviteToken()));assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM app_flymind_member WHERE team_id=? AND user_id=3",Integer.class,tid));
 }

}
