package com.xinghuiTec.flymind;
import com.xinghuiTec.XinghuiStartApplication;
import com.xinghuiTec.domain.entity.*;
import com.xinghuiTec.utils.*;
import com.xinghuiTec.constants.RedisConstants;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.core.io.ClassPathResource;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.redisson.api.RedissonClient;
import javax.sql.DataSource;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
/** Full Spring/Tomcat real HTTP, explicitly H2 and mocked Redis adapters. */
@SpringBootTest(classes=XinghuiStartApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"ADMIN_BIND_ADDRESS=127.0.0.1","ADMIN_DB_JDBC_URL=jdbc:h2:mem:flymindfullhttp;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","ADMIN_DB_USER=sa","ADMIN_DB_PASSWORD=","ADMIN_REDIS_HOST=127.0.0.1","ADMIN_REDIS_PASSWORD=","spring.datasource.dynamic.datasource.master.driver-class-name=org.h2.Driver","spring.flyway.enabled=false","FLYMIND_APP_TENANT_ID=app-http-test","FLYMIND_GATEWAY_KEY=integration-test-only-gateway-at-least-32-bytes","FLYMIND_CLOUD_PUBLIC_ORIGIN=https://flymind.example","flymind.bootstrap.enabled=false"})
class FlymindHttpRuntimeTest {
 static final String KEY="integration-test-only-gateway-at-least-32-bytes",RESOURCE="https://flymind.example/mcp",REDIRECT="http://127.0.0.1:12345/callback",PASSWORD="integration-only-password";
 @LocalServerPort int port;
 @Autowired JdbcTemplate db; @Autowired DataSource source; @Autowired ObjectMapper json;
 @MockBean org.springframework.data.redis.connection.ReactiveRedisConnectionFactory reactiveRedisFactory; @MockBean RedisCacheUtils cache; @MockBean RedisConnectionFactory redisFactory; @MockBean RedissonClient redisson; @MockBean FlymindLoginLimiter limiter;
 final HttpClient http=HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();String admin;
 record Response(int status,JsonNode body){}
 Response send(String method,String path,String bearer,Object body,boolean gateway)throws Exception {
  var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).timeout(java.time.Duration.ofSeconds(10)).header("Content-Type","application/json");
  if(bearer!=null)builder.header("Authorization",bearer);if(gateway)builder.header("X-FlyMind-Gateway-Key",KEY);
  builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
  var reply=http.send(builder.build(),HttpResponse.BodyHandlers.ofString());return new Response(reply.statusCode(),json.readTree(reply.body()));
 }
 Response app(String method,String path,String bearer,Object body)throws Exception{return send(method,"/app/flymind"+path,bearer,body,false);}
 Response oauth(String path,String bearer,Object body)throws Exception{return send("POST","/app/flymind/oauth"+path,bearer,body,true);}
 String login(String phone)throws Exception {var reply=app("POST","/auth/login",null,Map.of("phone",phone,"password",PASSWORD));assertEquals(200,reply.status());return "Bearer "+reply.body().path("data").path("sessionToken").asText();}
 @BeforeEach void seed()throws Exception {
  db.execute("DROP ALL OBJECTS");db.execute("CREATE TABLE sys_user(user_id BIGINT PRIMARY KEY,tenant_id VARCHAR(20),username VARCHAR(50),nickname VARCHAR(50),password VARCHAR(100),mobile VARCHAR(20),status INT,is_deleted INT)");
  try(var c=source.getConnection()){for(String sql:List.of("V20261019_01__flymind_identity.sql","V20261019_02__flymind_account_uniqueness.sql","V20261019_03__flymind_oauth.sql","V20261020_01__flymind_local_device.sql"))ScriptUtils.executeSqlScript(c,new ClassPathResource("db/migration/"+sql));}
  for(int i=1;i<=2;i++)db.update("INSERT INTO sys_user VALUES(?,'app-http-test',?,?,?, ?,1,0)",i,"user"+i,"User"+i,new BCryptPasswordEncoder(4).encode(PASSWORD),"1380000000"+i);
  admin=JwtUtil.createJWT("99","app-http-test");SysUser user=new SysUser();user.setUserId(99L);user.setMobile("13800000099");user.setStatus(1);LoginUser cached=new LoginUser(user,List.of("system:user:list","system:user:add","system:user:edit","flymind:team:list","flymind:team:edit"));cached.setToken(admin);cached.setTenantId("app-http-test");when(cache.getCacheObject(RedisConstants.ADMIN_LOGIN_PREFIX+"99")).thenReturn(cached);
 }
 @Test void accountsTeamsInvitationsAndDisableOverHttp()throws Exception {
  assertEquals(401,app("GET","/auth/me",null,null).status());assertEquals(401,app("GET","/unknown",null,null).status());String a=login("13800000001"),b=login("13800000002");
  var created=app("POST","/teams",a,Map.of("name","HTTP团队"));assertEquals(200,created.status());String team=created.body().path("data").path("id").asText();
  var invited=app("POST","/teams/"+team+"/invites",a,Map.of("phone","13800000002","role","editor"));assertEquals(200,invited.status());String invitation=invited.body().path("data").path("inviteToken").asText();
  assertEquals(200,app("POST","/invites/accept",b,Map.of("inviteToken",invitation)).status());assertEquals(409,app("POST","/invites/accept",b,Map.of("inviteToken",invitation)).status());assertEquals(2,app("GET","/teams/"+team+"/members",a,null).body().path("data").size());
  assertEquals(200,send("GET","/admin/flymind/users",admin,null,false).status());assertEquals(401,send("GET","/admin/flymind/users",a,null,false).status());assertEquals(200,send("PATCH","/admin/flymind/users/2",admin,Map.of("status",0),false).status());assertEquals(401,app("GET","/auth/me",b,null).status());verify(cache).deleteObject(RedisConstants.ADMIN_LOGIN_PREFIX+"2");
 }
 @Test void oauthConsentPkceAndRefreshReplayOverHttp()throws Exception {
  String a=login("13800000001"),team=app("POST","/teams",a,Map.of("name","OAuth团队")).body().path("data").path("id").asText();
  assertEquals(401,send("POST","/app/flymind/oauth/clients",null,Map.of(),false).status());assertEquals(200,oauth("/clients",null,Map.of("client_id","http-client","client_name","HTTP MCP","token_endpoint_auth_method","none","redirect_uris",List.of(REDIRECT),"grant_types",List.of("authorization_code","refresh_token"),"response_types",List.of("code"))).status());
  String verifier="v".repeat(64),challenge=Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
  var requested=oauth("/requests",null,Map.of("clientId","http-client","redirectUri",REDIRECT,"codeChallenge",challenge,"scopes",List.of("flymind:read","flymind:write"),"state","test-state","resource",RESOURCE));assertEquals(200,requested.status());String request=requested.body().path("data").path("requestId").asText();
  assertEquals(401,oauth("/requests/inspect",null,Map.of("requestId",request)).status());assertEquals(200,oauth("/requests/inspect",a,Map.of("requestId",request)).status());
  var approved=oauth("/requests/approve",a,Map.of("requestId",request,"teamId",team,"approved",true));assertEquals(200,approved.status());String redirect=approved.body().path("data").path("redirectUri").asText(),code=URLDecoder.decode(URI.create(redirect).getRawQuery().split("&")[0].substring(5),StandardCharsets.UTF_8);
  var exchange=Map.of("clientId","http-client","code",code,"codeVerifier",verifier,"redirectUri",REDIRECT,"resource",RESOURCE);var issued=oauth("/code",null,exchange);assertEquals(200,issued.status());String access=issued.body().path("data").path("access_token").asText(),refresh=issued.body().path("data").path("refresh_token").asText();assertEquals(400,oauth("/code",null,exchange).status());assertEquals(200,oauth("/introspect","Bearer "+access,Map.of("resource",RESOURCE,"teamId",team)).status());
  var renew=Map.of("clientId","http-client","refreshToken",refresh,"resource",RESOURCE);assertEquals(200,oauth("/refresh",null,renew).status());assertEquals(400,oauth("/refresh",null,renew).status());assertEquals(401,oauth("/introspect","Bearer "+access,Map.of("resource",RESOURCE,"teamId",team)).status());
 }
 @Test void realNodeLocalGateUsesJavaAuthority()throws Exception {
  requireNode();
  String owner=login("13800000001"),team=app("POST","/teams",owner,Map.of("name","Node Java授权")).body().path("data").path("id").asText();
  runNodeProbe("local-java-probe.mjs",Map.of("provider","http://127.0.0.1:"+port,"phone","13800000001","password",PASSWORD,"teamId",team));
  assertEquals(2,db.queryForObject("SELECT COUNT(*) FROM app_flymind_session WHERE user_id=1 AND revoked_at IS NOT NULL",Integer.class));assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM app_flymind_local_grant WHERE user_id=1 AND revoked_at IS NOT NULL",Integer.class));
 }
 @Test void realNodeCloudIdentityAndOAuthUseJavaAuthority()throws Exception {
  requireNode();
  String owner=login("13800000001"),team=app("POST","/teams",owner,Map.of("name","Node Cloud授权")).body().path("data").path("id").asText();
  runNodeProbe("cloud-java-probe.mjs",Map.of("provider","http://127.0.0.1:"+port,"phone","13800000001","password",PASSWORD,"teamId",team,"gatewayKey",KEY,"publicOrigin","https://flymind.example"));
 }
 String requireNode(){String node=System.getProperty("flymind.nodeExecutable");org.junit.jupiter.api.Assumptions.assumeTrue(node!=null&&!node.isBlank(),"Set -Dflymind.nodeExecutable to run the real Node/Java contract");return node;}
 void runNodeProbe(String fixture,Map<String,Object> input)throws Exception {
  String node=requireNode();
  java.nio.file.Path product=java.nio.file.Path.of(System.getProperty("user.dir")).toAbsolutePath();
  while(product!=null&&!java.nio.file.Files.exists(product.resolve("tests/fixtures/"+fixture)))product=product.getParent();
  assertNotNull(product,"Product fixture not found");
  Process process=new ProcessBuilder(node,"--import","tsx","tests/fixtures/"+fixture).directory(product.toFile()).start();
  try{
   try(var pipe=process.getOutputStream()){pipe.write(json.writeValueAsBytes(input));}
   assertTrue(process.waitFor(45,java.util.concurrent.TimeUnit.SECONDS),"Node gate probe timed out");
   String output=new String(process.getInputStream().readAllBytes(),StandardCharsets.UTF_8),error=new String(process.getErrorStream().readAllBytes(),StandardCharsets.UTF_8);
   assertEquals(0,process.exitValue(),error);assertTrue(json.readTree(output).path("ok").asBoolean(),"Node gate did not report success");
  }finally{if(process.isAlive()){process.destroyForcibly();assertTrue(process.waitFor(5,java.util.concurrent.TimeUnit.SECONDS),"Own Node process did not stop");}}
 }
 String localGrant(String appToken,String device,String root,String team)throws Exception {
  var issued=app("POST","/local/grants",appToken,Map.of("deviceId",device,"dataRootId",root,"teamId",team));assertEquals(200,issued.status());return "Bearer "+issued.body().path("data").path("grantToken").asText();
 }
 @Test void localRotationExpiryPasswordResetAndMembershipRevocationArePersistent()throws Exception {
  String owner=login("13800000001"),member=login("13800000002"),device="r".repeat(43),root="local-security-root";
  String team=app("POST","/teams",owner,Map.of("name","本地安全团队")).body().path("data").path("id").asText();
  String invite=app("POST","/teams/"+team+"/invites",owner,Map.of("phone","13800000002","role","viewer")).body().path("data").path("inviteToken").asText();
  assertEquals(200,app("POST","/invites/accept",member,Map.of("inviteToken",invite)).status());
  var binding=Map.of("deviceId",device,"dataRootId",root);
  String old=localGrant(member,device,root,team),current=localGrant(member,device,root,team);
  assertEquals(401,app("POST","/local/introspect",old,binding).status());
  assertEquals("viewer",app("POST","/local/introspect",current,binding).body().path("data").path("team").path("role").asText());
  assertEquals(200,app("DELETE","/teams/"+team+"/members/2",owner,null).status());
  // Rejoining without an intervening introspection cannot resurrect the old device grant.
  invite=app("POST","/teams/"+team+"/invites",owner,Map.of("phone","13800000002","role","editor")).body().path("data").path("inviteToken").asText();
  assertEquals(200,app("POST","/invites/accept",member,Map.of("inviteToken",invite)).status());
  assertEquals(401,app("POST","/local/introspect",current,binding).status());
  current=localGrant(member,device,root,team);
  assertEquals(200,send("PATCH","/admin/flymind/teams/"+team,admin,Map.of("status",0),false).status());
  assertEquals(200,send("PATCH","/admin/flymind/teams/"+team,admin,Map.of("status",1),false).status());
  assertEquals(401,app("POST","/local/introspect",current,binding).status());
  current=localGrant(member,device,root,team);
  db.update("UPDATE app_flymind_local_grant SET expires_at=1 WHERE user_id=2");
  assertEquals(401,app("POST","/local/introspect",current,binding).status());
  current=localGrant(member,device,root,team);
  assertEquals(200,send("POST","/admin/flymind/users/2/password",admin,Map.of("password","replacement-password"),false).status());
  assertEquals(401,app("POST","/local/introspect",current,binding).status());
 }
 @Test void localDeviceGrantsBindRootAndDeviceAndStopAfterLogoutAndDisable()throws Exception {
  String a=login("13800000001"),team=app("POST","/teams",a,Map.of("name","Local团队")).body().path("data").path("id").asText(),device="d".repeat(43),root="workspace-local-test";
  var binding=Map.of("deviceId",device,"dataRootId",root);
  assertEquals(401,app("POST","/local/grants",null,Map.of("deviceId",device,"dataRootId",root,"teamId",team)).status());
  var grant=app("POST","/local/grants",a,Map.of("deviceId",device,"dataRootId",root,"teamId",team));assertEquals(200,grant.status());String local="Bearer "+grant.body().path("data").path("grantToken").asText();assertTrue(local.startsWith("Bearer fm_local_"));
  assertEquals(401,app("GET","/auth/me",local,null).status());assertEquals(200,app("POST","/local/introspect",local,binding).status());
  assertEquals(403,app("POST","/local/introspect",local,Map.of("deviceId",device,"dataRootId","other-root")).status());assertEquals(403,app("POST","/local/introspect",local,Map.of("deviceId","e".repeat(43),"dataRootId",root)).status());
  assertEquals(200,app("POST","/local/revoke",local,binding).status());assertEquals(401,app("POST","/local/introspect",local,binding).status());assertEquals(401,app("GET","/auth/me",a,null).status());
  a=login("13800000001");grant=app("POST","/local/grants",a,Map.of("deviceId",device,"dataRootId",root,"teamId",team));local="Bearer "+grant.body().path("data").path("grantToken").asText();
  assertEquals(200,send("PATCH","/admin/flymind/users/1",admin,Map.of("status",0),false).status());assertEquals(401,app("POST","/local/introspect",local,binding).status());
 }
}
