package com.xinghuiTec.flymind;

import java.util.*;
import java.util.concurrent.*;
import javax.sql.DataSource;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.*;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Real JDBC transactions/uniqueness on isolated H2. Redis adapter is explicitly mocked. */
@SpringJUnitConfig(FlymindRegistrationTest.Config.class)
class FlymindRegistrationTest {
 @Configuration @EnableTransactionManagement static class Config {
  @Bean DataSource source(){var ds=new JdbcDataSource();ds.setURL("jdbc:h2:mem:registration;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000");return ds;}
  @Bean JdbcTemplate db(DataSource ds){return new JdbcTemplate(ds);}
  @Bean DataSourceTransactionManager tx(DataSource ds){return new DataSourceTransactionManager(ds);}
  @Bean FlymindLoginLimiter limiter(){return mock(FlymindLoginLimiter.class);}
  @Bean FlymindIdentityService service(JdbcTemplate db,FlymindLoginLimiter limiter){return new FlymindIdentityService(db,new BCryptPasswordEncoder(4),limiter,"app-register-test",System::currentTimeMillis);}
 }
 @Autowired JdbcTemplate db;@Autowired DataSource source;@Autowired FlymindIdentityService service;@Autowired FlymindLoginLimiter limiter;
 MockMvc http;
 @BeforeEach void reset()throws Exception{
  org.mockito.Mockito.reset(limiter);db.execute("DROP ALL OBJECTS");
  db.execute("CREATE TABLE sys_user(user_id BIGINT PRIMARY KEY,tenant_id VARCHAR(20),username VARCHAR(50) UNIQUE,nickname VARCHAR(50),password VARCHAR(100),mobile VARCHAR(20),status INT,is_deleted INT,create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  db.execute("CREATE TABLE sys_user_role(user_id BIGINT,role_id BIGINT)");
  try(var c=source.getConnection()){for(String sql:List.of("V20261019_01__flymind_identity.sql","V20261019_02__flymind_account_uniqueness.sql","V20261019_03__flymind_oauth.sql","V20261020_01__flymind_local_device.sql"))ScriptUtils.executeSqlScript(c,new ClassPathResource("db/migration/"+sql));}
  FlymindCredentialFixtures.install(db);
  http=MockMvcBuilders.standaloneSetup(new FlymindController(service)).setControllerAdvice(new FlymindErrors()).build();
 }
 int count(String table){return db.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class);}
 void rejected(int status,Runnable action){var error=assertThrows(FlymindException.class,action::run);assertEquals(status,error.status);}
 @Test void registerMeLogoutLoginCreatesOnlyIndependentFrontIdentity()throws Exception{
  var login=service.register("13800000011","easy12","loopback");String auth="Bearer "+login.sessionToken();
  assertTrue(login.sessionToken().matches("[A-Za-z0-9_-]{43}"));assertTrue(login.user().userCode().matches("(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{6}"));assertFalse(login.user().name().contains("13800000011"));
  assertEquals(login.user(),service.authenticate(auth).user());assertEquals("owner",service.teams(auth).get(0).role());assertEquals("个人空间",service.teams(auth).get(0).name());
  assertEquals(1,count("sys_user"));assertEquals(1,count("app_flymind_account"));assertEquals(1,count("app_flymind_member"));assertEquals(0,count("sys_user_role"));
  assertFalse(new BCryptPasswordEncoder().matches("easy12",db.queryForObject("SELECT password FROM sys_user",String.class)));
  assertNotEquals(login.sessionToken(),db.queryForObject("SELECT token_hash FROM app_flymind_session",String.class));
  assertNotNull(db.queryForObject("SELECT create_time FROM sys_user",java.sql.Timestamp.class));
  http.perform(get("/app/flymind/auth/me").header("Authorization",auth)).andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store")).andExpect(jsonPath("$.data.user.userCode").value(login.user().userCode()));
  service.logout(auth);rejected(401,()->service.me(auth));assertEquals(login.user().id(),service.login("13800000011","easy12","loopback").user().id());
 }
 @Test void invalidBodiesAndPasswordBudgetsNeverCreateAnyRows()throws Exception{
  for(String body:List.of("{\"phone\":\"13800000011\",\"password\":\"easy12\",\"role\":\"admin\"}","{\"phone\":\"13800000011\"}","{\"phone\":13800000011,\"password\":\"easy12\"}"))http.perform(post("/app/flymind/auth/register").contentType("application/json").content(body)).andExpect(status().isBadRequest());
  for(String phone:List.of("23800000011","12800000011","+8613800000011"," 13800000011","1380000001"))rejected(400,()->service.register(phone,"easy12","ip"));
  for(String password:List.of("easy1","      ","密".repeat(25)))rejected(400,()->service.register("13800000011",password,"ip"));
  assertEquals(0,count("sys_user"));assertEquals(0,count("app_flymind_session"));
  assertNotNull(service.register("13800000011","密".repeat(24),"ip").sessionToken());
 }
 @Test void retainedDisabledDeletedAndAdminPhonesAreNotClaimed(){
  for(int i=1;i<=4;i++)db.update("INSERT INTO sys_user(user_id,tenant_id,username,nickname,password,mobile,status,is_deleted) VALUES(?,'app-register-test',?,?,?, ?,?,?)",i,"reserved"+i,"保留账号","unrelated-hash","1380000000"+i,i==2?0:1,i==3?1:0);
  db.update("INSERT INTO sys_user_role VALUES(4,99)");db.update("INSERT INTO app_flymind_account VALUES(2,'existing-app-hash',0,1,1)");
  for(int i=1;i<=4;i++){String phone="1380000000"+i;var error=assertThrows(FlymindException.class,()->service.register(phone,"easy12","ip"));assertEquals(409,error.status);assertEquals("ACCOUNT_EXISTS",error.code);}
  assertEquals(4,count("sys_user"));assertEquals(1,count("sys_user_role"));assertEquals(1,count("app_flymind_account"));assertEquals(0,count("app_flymind_team"));assertEquals(0,count("app_flymind_session"));
 }
 @Test void simultaneousDuplicateRegistrationIsAtomic()throws Exception{
  var pool=Executors.newFixedThreadPool(2);var start=new CountDownLatch(1);
  try{Callable<Integer> task=()->{start.await();try{service.register("13800000011","easy12","ip");return 200;}catch(FlymindException e){return e.status;}};var a=pool.submit(task);var b=pool.submit(task);start.countDown();assertEquals(Set.of(200,409),Set.of(a.get(15,TimeUnit.SECONDS),b.get(15,TimeUnit.SECONDS)));}
  finally{pool.shutdownNow();}
  for(String table:List.of("sys_user","app_flymind_account","app_flymind_team","app_flymind_member","app_flymind_session","app_flymind_user_code"))assertEquals(1,count(table),table);
 }
 @Test void lateDatabaseFailureRollsBackTheWholeRegistration(){
  db.execute("ALTER TABLE app_flymind_session ADD CONSTRAINT refuse_session CHECK(created_at<0)");
  assertThrows(org.springframework.dao.DataAccessException.class,()->service.register("13800000011","easy12","ip"));
  for(String table:List.of("sys_user","app_flymind_account","app_flymind_team","app_flymind_member","app_flymind_session","app_flymind_user_code","app_flymind_access_day"))assertEquals(0,count(table),table);
 }
 @Test void throttlingAndUnavailableAuthorityFailBeforeAccountCreation(){
  doThrow(new FlymindException(429,"RATE_LIMITED","fixture")).when(limiter).checkRegistration(anyString(),anyString());rejected(429,()->service.register("13800000011","easy12","ip"));assertEquals(0,count("sys_user"));
  org.mockito.Mockito.reset(limiter);doThrow(new FlymindException(503,"IDENTITY_UNAVAILABLE","fixture")).when(limiter).checkRegistration(anyString(),anyString());rejected(503,()->service.register("13800000011","easy12","ip"));assertEquals(0,count("sys_user"));
 }
 @Test @SuppressWarnings({"unchecked","rawtypes"}) void registrationRedisCountersAreSeparateAndFailClosed(){
  var redis=mock(org.springframework.data.redis.core.StringRedisTemplate.class);var actual=new FlymindLoginLimiter(redis);
  when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class),anyList())).thenReturn(1L);actual.checkRegistration("shared-gateway","13800000011");
  var keys=org.mockito.ArgumentCaptor.forClass(List.class);verify(redis,times(2)).execute(any(org.springframework.data.redis.core.script.RedisScript.class),keys.capture());
  for(Object list:keys.getAllValues()){String key=((List<?>)list).get(0).toString();assertTrue(key.startsWith("flymind:registration-limit:"));assertFalse(key.contains("13800000011"));assertFalse(key.contains("shared-gateway"));}
  when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class),anyList())).thenReturn(121L);rejected(429,()->actual.checkRegistration("shared-gateway","13800000011"));
  when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class),anyList())).thenReturn(1L,6L);rejected(429,()->actual.checkRegistration("shared-gateway","13800000011"));
  when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class),anyList())).thenReturn(null);rejected(503,()->actual.checkRegistration("shared-gateway","13800000011"));
  when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class),anyList())).thenThrow(new org.springframework.data.redis.RedisConnectionFailureException("private fixture detail"));rejected(503,()->actual.checkRegistration("shared-gateway","13800000011"));
 }
}
