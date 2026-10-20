package com.xinghuiTec.flymind;

import com.xinghuiTec.config.SecurityConfig;
import com.xinghuiTec.filter.AuthenticationEntryPointImpl;
import com.xinghuiTec.filter.LoginFilter;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.*;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.context.web.WebAppConfiguration;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import javax.sql.DataSource;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringJUnitConfig({FlymindIdentityTest.Config.class,FlymindSecurityTest.Web.class,SecurityConfig.class,FlymindSecurityConfig.class,FlymindController.class,FlymindAdminController.class,FlymindAdminUserController.class,FlymindErrors.class,AuthenticationEntryPointImpl.class})
@org.springframework.test.context.TestPropertySource(properties="FLYMIND_APP_TENANT_ID=app-test")
@WebAppConfiguration
class FlymindSecurityTest {
 @org.springframework.boot.test.mock.mockito.MockBean com.xinghuiTec.utils.RedisCacheUtils redis;
 @Configuration @org.springframework.web.servlet.config.annotation.EnableWebMvc static class Web {
  @Bean ObjectMapper json(){return new ObjectMapper();}
  // Isolate the legacy JWT verifier; the real chain and its method permissions remain enabled.
  @Bean LoginFilter loginFilter(){return new LoginFilter(){@Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)throws IOException,ServletException {chain.doFilter(request,response);}};}
 }
 @Autowired WebApplicationContext context;@Autowired JdbcTemplate db;@Autowired DataSource source;@Autowired FlymindIdentityService service;
 MockMvc http;
 @BeforeEach void init()throws Exception {db.execute("DROP ALL OBJECTS");db.execute("CREATE TABLE sys_user(user_id BIGINT PRIMARY KEY,tenant_id VARCHAR(20),username VARCHAR(50),nickname VARCHAR(50),password VARCHAR(100),mobile VARCHAR(20),status INT,is_deleted INT)");try(var c=source.getConnection()){ScriptUtils.executeSqlScript(c,new ClassPathResource("db/migration/V20261019_01__flymind_identity.sql"));ScriptUtils.executeSqlScript(c,new ClassPathResource("db/migration/V20261019_03__flymind_oauth.sql"));ScriptUtils.executeSqlScript(c,new ClassPathResource("db/migration/V20261020_01__flymind_local_device.sql"));}db.update("INSERT INTO sys_user VALUES(1,'app-test','account','name',?,'13800000001',1,0)",new BCryptPasswordEncoder(4).encode("correct-password"));http=MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();}
 @Test void appChainRequiresOpaqueTokenAndDoesNotTrustAdminAuthentication()throws Exception {
  http.perform(get("/app/flymind/auth/me")).andExpect(status().isUnauthorized()).andExpect(header().string("Cache-Control","no-store"));
  http.perform(get("/app/flymind/auth/me").with(user("admin").authorities(()->"flymind:team:list"))).andExpect(status().isUnauthorized());
  String auth="Bearer "+service.login("13800000001","correct-password","ip").sessionToken();
  http.perform(get("/app/flymind/auth/me").header("Authorization",auth)).andExpect(status().isOk());
  http.perform(get("/app/flymind/auth/me").header("Authorization",auth.substring(7))).andExpect(status().isUnauthorized());
 }
 @Test void appTokenDoesNotAuthorizeAdminAndAdminPermissionsStillApply()throws Exception {
  String auth="Bearer "+service.login("13800000001","correct-password","ip").sessionToken();
  http.perform(get("/admin/flymind/teams").header("Authorization",auth)).andExpect(status().isUnauthorized());
  http.perform(get("/admin/flymind/teams").with(user("unprivileged"))).andExpect(status().isForbidden());
  http.perform(get("/admin/flymind/teams").with(user("operator").authorities(()->"flymind:team:list"))).andExpect(status().isOk());
 }
 @Test void publicLoginIsReachableWithoutAnAdminJwt()throws Exception {http.perform(post("/app/flymind/auth/login").contentType("application/json").content("{\"phone\":\"13800000001\",\"password\":\"correct-password\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.data.sessionToken").isString());}
 @Test void platformAccountsAreControlledAndDisabledSessionsStop()throws Exception {
  http.perform(post("/admin/flymind/users").with(user("operator").authorities(()->"system:user:add")).contentType("application/json").content("{\"phone\":\"13800000002\",\"name\":\"测试用户\",\"password\":\"test-only-password\"}")).andExpect(status().isOk());
  String auth="Bearer "+service.login("13800000002","test-only-password","ip").sessionToken();String id=service.authenticate(auth).user().id();
  http.perform(patch("/admin/flymind/users/"+id).with(user("operator").authorities(()->"system:user:edit")).contentType("application/json").content("{\"status\":0}")).andExpect(status().isOk());
  http.perform(get("/app/flymind/auth/me").header("Authorization",auth)).andExpect(status().isUnauthorized());
  http.perform(post("/admin/flymind/users").with(user("operator").authorities(()->"system:user:add")).contentType("application/json").content("{\"phone\":\"13800000003\",\"name\":\"测试\",\"password\":\"test-only-password\",\"tenantId\":\"attacker\"}")).andExpect(status().isBadRequest());
 }

 @Test void unknownApplicationPathsAndWrongTokensRemainProtected()throws Exception {
  http.perform(get("/app/flymind/unknown")).andExpect(status().isUnauthorized());
  http.perform(get("/app/flymind/auth/me").header("Authorization","Bearer "+"x".repeat(43))).andExpect(status().isUnauthorized());
  String auth="Bearer "+service.login("13800000001","correct-password","ip").sessionToken();
  http.perform(get("/app/flymind/unknown").header("Authorization",auth)).andExpect(status().isNotFound());
 }

 @Test void platformTeamStatusAcceptsOnlyExactZeroOrOne()throws Exception {
  String auth="Bearer "+service.login("13800000001","correct-password","ip").sessionToken();String tid=service.createTeam(auth,"状态测试").id();
  for(String invalid:new String[]{"0.5","1.2","-1","2","\"1\"","true"})http.perform(patch("/admin/flymind/teams/"+tid).with(user("operator").authorities(()->"flymind:team:edit")).contentType("application/json").content("{\"status\":"+invalid+"}")).andExpect(status().isBadRequest());
  org.junit.jupiter.api.Assertions.assertEquals(1,db.queryForObject("SELECT status FROM app_flymind_team WHERE id=?",Integer.class,tid));
  for(int valid:new int[]{0,1})http.perform(patch("/admin/flymind/teams/"+tid).with(user("operator").authorities(()->"flymind:team:edit")).contentType("application/json").content("{\"status\":"+valid+"}")).andExpect(status().isOk());
 }

 @Test void disablingAndPasswordResetRevokeEveryAppDevice()throws Exception {
  String a="Bearer "+service.login("13800000001","correct-password","ip").sessionToken(),b="Bearer "+service.login("13800000001","correct-password","ip").sessionToken();
  http.perform(patch("/admin/flymind/users/1").with(user("operator").authorities(()->"system:user:edit")).contentType("application/json").content("{\"status\":0}")).andExpect(status().isOk());
  http.perform(patch("/admin/flymind/users/1").with(user("operator").authorities(()->"system:user:edit")).contentType("application/json").content("{\"status\":1}")).andExpect(status().isOk());
  http.perform(get("/app/flymind/auth/me").header("Authorization",a)).andExpect(status().isUnauthorized());http.perform(get("/app/flymind/auth/me").header("Authorization",b)).andExpect(status().isUnauthorized());
  String c="Bearer "+service.login("13800000001","correct-password","ip").sessionToken();
  http.perform(post("/admin/flymind/users/1/password").with(user("operator").authorities(()->"system:user:edit")).contentType("application/json").content("{\"password\":\"replacement-test-password\"}")).andExpect(status().isOk());
  http.perform(get("/app/flymind/auth/me").header("Authorization",c)).andExpect(status().isUnauthorized());
  org.junit.jupiter.api.Assertions.assertThrows(FlymindException.class,()->service.login("13800000001","correct-password","ip"));org.junit.jupiter.api.Assertions.assertNotNull(service.login("13800000001","replacement-test-password","ip").sessionToken());
  http.perform(post("/admin/flymind/users/1/password").with(user("operator").authorities(()->"system:user:edit")).contentType("application/json").content("{\"password\":\"short\"}")).andExpect(status().isBadRequest());
  db.update("UPDATE sys_user SET tenant_id='other' WHERE user_id=1");http.perform(post("/admin/flymind/users/1/password").with(user("operator").authorities(()->"system:user:edit")).contentType("application/json").content("{\"password\":\"another-test-password\"}")).andExpect(status().isNotFound());
 }

 @Test void adminRevocationTargetsOnlyAffectedUserAndRedisFailureRollsBack()throws Exception {
  String key=com.xinghuiTec.constants.RedisConstants.ADMIN_LOGIN_PREFIX+"1";
  String a="Bearer "+service.login("13800000001","correct-password","ip").sessionToken();
  org.mockito.Mockito.doThrow(new org.springframework.data.redis.RedisConnectionFailureException("controlled-unavailable")).when(redis).deleteObject(key);
  http.perform(patch("/admin/flymind/users/1").with(user("operator").authorities(()->"system:user:edit")).contentType("application/json").content("{\"status\":0}")).andExpect(status().isServiceUnavailable());
  org.junit.jupiter.api.Assertions.assertEquals(1,db.queryForObject("SELECT status FROM sys_user WHERE user_id=1",Integer.class));org.junit.jupiter.api.Assertions.assertNotNull(service.authenticate(a));
  http.perform(post("/admin/flymind/users/1/password").with(user("operator").authorities(()->"system:user:edit")).contentType("application/json").content("{\"password\":\"replacement-test-password\"}")).andExpect(status().isServiceUnavailable());
  org.junit.jupiter.api.Assertions.assertNotNull(service.login("13800000001","correct-password","ip").sessionToken());org.junit.jupiter.api.Assertions.assertNotNull(service.authenticate(a));
  org.mockito.Mockito.verify(redis,org.mockito.Mockito.times(2)).deleteObject(key);org.mockito.Mockito.verifyNoMoreInteractions(redis);
  org.mockito.Mockito.reset(redis);
  http.perform(post("/admin/flymind/users/1/password").with(user("operator").authorities(()->"system:user:edit")).contentType("application/json").content("{\"password\":\"replacement-test-password\"}")).andExpect(status().isOk());
  org.mockito.Mockito.verify(redis).deleteObject(key);org.mockito.Mockito.verifyNoMoreInteractions(redis);
  http.perform(get("/app/flymind/auth/me").header("Authorization",a)).andExpect(status().isUnauthorized());
 }

}
