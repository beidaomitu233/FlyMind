package com.xinghuiTec.flymind;

import com.xinghuiTec.flymind.oauth.*;
import com.xinghuiTec.config.SecurityConfig;
import com.xinghuiTec.filter.AuthenticationEntryPointImpl;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.web.WebAppConfiguration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import javax.sql.DataSource;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.net.*;
import static com.xinghuiTec.flymind.oauth.OAuthInputs.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;

@SpringJUnitConfig({FlymindIdentityTest.Config.class,FlymindSecurityTest.Web.class,SecurityConfig.class,FlymindSecurityConfig.class,AuthenticationEntryPointImpl.class,OAuthSecurity.class,OAuthController.class,OAuthClients.class,FlymindOAuthTest.ClockConfig.class,OAuthErrors.class,FlymindController.class,FlymindAdminUserController.class,FlymindErrors.class})
@TestPropertySource(properties={"FLYMIND_APP_TENANT_ID=app-test","FLYMIND_GATEWAY_KEY=test-only-gateway-key-32-bytes-long","FLYMIND_CLOUD_PUBLIC_ORIGIN=https://flymind.example"})
@WebAppConfiguration
class FlymindOAuthTest {
    static final String KEY="test-only-gateway-key-32-bytes-long", RESOURCE="https://flymind.example/mcp", REDIRECT="http://127.0.0.1:12345/callback", VERIFIER="v".repeat(64);
    @org.springframework.context.annotation.Configuration static class ClockConfig {
        @org.springframework.context.annotation.Bean OAuthGrants grants(JdbcTemplate db,FlymindIdentityService identity,OAuthClients clients,AtomicLong clock){return new OAuthGrants(db,identity,clients,"https://flymind.example","app-test",clock::get);}
    }
    @org.springframework.boot.test.mock.mockito.MockBean com.xinghuiTec.utils.RedisCacheUtils redis;
    @Autowired WebApplicationContext context;
    @Autowired JdbcTemplate db; @Autowired DataSource source; @Autowired FlymindIdentityService identity;
    @Autowired OAuthGrants grants; @Autowired OAuthClients clients; @Autowired ObjectMapper json; @Autowired AtomicLong clock;
    MockMvc http; String bearer,team;
    @BeforeEach void setup() throws Exception {
        db.execute("DROP ALL OBJECTS");
        db.execute("CREATE TABLE sys_user(user_id BIGINT PRIMARY KEY,tenant_id VARCHAR(20),username VARCHAR(50),nickname VARCHAR(50),password VARCHAR(100),mobile VARCHAR(20),status INT,is_deleted INT)");
        try(var connection=source.getConnection()) { for(String sql:List.of("V20261019_01__flymind_identity.sql","V20261019_03__flymind_oauth.sql","V20261020_01__flymind_local_device.sql")) ScriptUtils.executeSqlScript(connection,new ClassPathResource("db/migration/"+sql)); }
        clock.set(1800000000000L);
        for(int i=1;i<=2;i++) db.update("INSERT INTO sys_user VALUES(?,'app-test',?,?,?, ?,1,0)",i,"account"+i,"User"+i,new BCryptPasswordEncoder(4).encode("correct-password"),"1380000000"+i);
        FlymindCredentialFixtures.install(db);bearer="Bearer "+identity.login("13800000001","correct-password","ip").sessionToken();team=identity.createTeam(bearer,"OAuth team").id();
        clients.register(json.readTree("{\"client_id\":\"client1\",\"client_name\":\"Test MCP\",\"token_endpoint_auth_method\":\"none\",\"redirect_uris\":[\""+REDIRECT+"\"],\"grant_types\":[\"authorization_code\",\"refresh_token\"],\"response_types\":[\"code\"]}"));
        http=MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }
    String challenge() throws Exception { return Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(VERIFIER.getBytes(StandardCharsets.US_ASCII))); }
    String request(List<String> scopes) throws Exception { return grants.request(new Authorization("client1",REDIRECT,challenge(),scopes,"state & safe",RESOURCE)).requestId(); }
    String code(List<String> scopes) throws Exception {
        String redirect=grants.approve(bearer,new Approval(request(scopes),team,true)).redirectUri();
        assertTrue(redirect.startsWith(REDIRECT+"?code="));assertTrue(redirect.contains("state=state+%26+safe"));
        return URLDecoder.decode(URI.create(redirect).getRawQuery().split("&")[0].substring(5),StandardCharsets.UTF_8);
    }
    Tokens tokens() throws Exception {return grants.code(new Code("client1",code(null),VERIFIER,REDIRECT,RESOURCE));}
    Map<String,Object> introspect(Tokens tokens){return grants.introspect("Bearer "+tokens.access_token(),new Introspection(RESOURCE,team));}
    void rejected(Runnable operation){assertThrows(OAuthFailure.class,operation::run);}

    @Test void fullChainRequiresGatewayAndApplicationBearerForConsent() throws Exception {
        http.perform(get("/app/flymind/oauth/clients/client1")).andExpect(status().isUnauthorized());
        http.perform(get("/app/flymind/oauth/clients/client1").header("X-FlyMind-Gateway-Key","wrong")).andExpect(status().isUnauthorized());
        http.perform(get("/app/flymind/oauth/clients/client1").header("X-FlyMind-Gateway-Key",KEY)).andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store"));
        String request=request(null),body="{\"requestId\":\""+request+"\"}";
        http.perform(post("/app/flymind/oauth/requests/inspect").header("X-FlyMind-Gateway-Key",KEY).contentType("application/json").content(body)).andExpect(status().isUnauthorized());
        http.perform(post("/app/flymind/oauth/requests/inspect").header("X-FlyMind-Gateway-Key",KEY).header("Authorization",bearer).contentType("application/json").content(body)).andExpect(status().isOk()).andExpect(jsonPath("$.data.client.name").value("Test MCP"));
        http.perform(get("/app/flymind/oauth/not-a-route").header("Authorization",bearer)).andExpect(status().isUnauthorized());
        http.perform(post("/app/flymind/oauth/requests/inspect").header("X-FlyMind-Gateway-Key",KEY).header("Authorization","Bearer "+tokens().access_token()).contentType("application/json").content(body)).andExpect(status().isUnauthorized());
    }
    @Test void pkceResourceRedirectExpiryAndOneUseCode() throws Exception {
        String code=code(null);
        rejected(()->grants.code(new Code("client1",code,"x".repeat(64),REDIRECT,RESOURCE)));
        rejected(()->grants.code(new Code("client1",code,VERIFIER,REDIRECT+"/other",RESOURCE)));
        rejected(()->grants.code(new Code("client1",code,VERIFIER,REDIRECT,"https://other.example/mcp")));
        Tokens issued=grants.code(new Code("client1",code,VERIFIER,REDIRECT,RESOURCE));assertTrue(issued.access_token().startsWith("fm_mcp_"));assertEquals(600,issued.expires_in());assertNotNull(introspect(issued));
        rejected(()->grants.code(new Code("client1",code,VERIFIER,REDIRECT,RESOURCE)));
        String expired=code(null);clock.addAndGet(300001);rejected(()->grants.code(new Code("client1",expired,VERIFIER,REDIRECT,RESOURCE)));
    }
    @Test void refreshRotatesAndReplayRevokesGrantAcrossServiceInstances() throws Exception {
        Tokens first=tokens(),second=grants.refresh(new Refresh("client1",first.refresh_token(),null,RESOURCE));assertNotEquals(first.refresh_token(),second.refresh_token());assertNotNull(introspect(second));
        rejected(()->grants.refresh(new Refresh("client1",first.refresh_token(),null,RESOURCE)));
        rejected(()->introspect(second));rejected(()->grants.refresh(new Refresh("client1",second.refresh_token(),null,RESOURCE)));
        assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM app_flymind_oauth_grant WHERE revoked_at IS NOT NULL",Integer.class));
    }
    @Test void scopeCannotExpandAndViewerCannotApproveWrite() throws Exception {
        Tokens read=grants.code(new Code("client1",code(List.of("flymind:read")),VERIFIER,REDIRECT,RESOURCE));
        rejected(()->grants.refresh(new Refresh("client1",read.refresh_token(),List.of("flymind:read","flymind:write"),RESOURCE)));
        String second="Bearer "+identity.login("13800000002","correct-password","ip").sessionToken();identity.accept(second,identity.invite(bearer,team,"13800000002","viewer").inviteToken());
        String pending=request(null);rejected(()->grants.approve(second,new Approval(pending,team,true)));
        String readonly=request(List.of("flymind:read"));assertTrue(grants.approve(second,new Approval(readonly,team,true)).redirectUri().contains("code="));
        rejected(()->grants.request(new Authorization("client1",REDIRECT,"x".repeat(43),List.of("flymind:write"),null,RESOURCE)));
    }
    @Test void currentRoleMembershipAccountAndTeamAreAlwaysRechecked() throws Exception {
        Tokens issued=tokens();db.update("UPDATE app_flymind_member SET role='viewer' WHERE team_id=? AND user_id=1",team);
        assertEquals(List.of("flymind:read"),((Map<?,?>)introspect(issued).get("authorization")).get("scopes"));
        db.update("DELETE FROM app_flymind_member WHERE team_id=? AND user_id=1",team);rejected(()->introspect(issued));
        db.update("INSERT INTO app_flymind_member VALUES(?,1,'owner',?)",team,clock.get());db.update("UPDATE app_flymind_team SET status=0 WHERE id=?",team);rejected(()->introspect(issued));
        db.update("UPDATE app_flymind_team SET status=1 WHERE id=?",team);db.update("UPDATE app_flymind_account SET status=0 WHERE user_id=1");rejected(()->introspect(issued));
    }
    @Test void logoutDoesNotRevokeGrantButAdminDisableAndResetDo() throws Exception {
        Tokens first=tokens();identity.logout(bearer);assertNotNull(introspect(first));
        http.perform(post("/admin/flymind/users/1/password").with(user("operator").authorities(()->"system:user:edit")).contentType("application/json").content("{\"password\":\"replacement-test-password\"}")).andExpect(status().isOk());rejected(()->introspect(first));
        bearer="Bearer "+identity.login("13800000001","replacement-test-password","ip").sessionToken();Tokens next=tokens();
        http.perform(patch("/admin/flymind/users/1").with(user("operator").authorities(()->"system:user:edit")).contentType("application/json").content("{\"status\":0}")).andExpect(status().isOk());
        db.update("UPDATE app_flymind_account SET status=1 WHERE user_id=1");rejected(()->introspect(next));
    }
    @Test void secretsOnlyExistAsDigestsAndRevocationIsIdempotent() throws Exception {
        Tokens issued=tokens();assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM app_flymind_oauth_token WHERE token_hash IN (?,?)",Integer.class,issued.access_token(),issued.refresh_token()));
        grants.revoke(new Revoke("client1",issued.access_token(),"access_token"));grants.revoke(new Revoke("client1",issued.access_token(),null));grants.revoke(new Revoke("client1","unknown",null));rejected(()->introspect(issued));
        Tokens persisted=tokens();OAuthGrants restarted=new OAuthGrants(db,identity,clients,"https://flymind.example","app-test",clock::get);assertNotNull(restarted.introspect("Bearer "+persisted.access_token(),new Introspection(RESOURCE,team)));
    }
    @Test void registrationAndStrictBodiesRejectUnsupportedInputs() throws Exception {
        for(String uri:List.of("http://evil.example/cb","https://example.com/cb#fragment","https://u:p@example.com/cb","https://example.com/*"))assertThrows(OAuthFailure.class,()->OAuthClients.redirect(uri));
        var metadata=clients.get("client1").deepCopy();((com.fasterxml.jackson.databind.node.ObjectNode)metadata).put("client_id","client2").put("client_secret","forbidden");rejected(()->clients.register(metadata));
        http.perform(post("/app/flymind/oauth/requests/inspect").header("X-FlyMind-Gateway-Key",KEY).header("Authorization",bearer).contentType("application/json").content("{\"requestId\":\"x\",\"userId\":\"another\"}")).andExpect(status().isBadRequest());
    }
    @Test void consentIsSingleUseAndDenialNeverCreatesAGrant() throws Exception {
        String pending=request(null);
        assertTrue(grants.approve(bearer,new Approval(pending,null,false)).redirectUri().contains("error=access_denied"));
        rejected(()->grants.approve(bearer,new Approval(pending,team,true)));
        assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM app_flymind_oauth_grant",Integer.class));
        String expired=request(null);clock.addAndGet(300001);rejected(()->grants.inspect(bearer,new Request(expired)));
    }
    @Test void adminMayApproveWriteAndTokensCannotCrossTeamsOrApplicationApis() throws Exception {
        String second="Bearer "+identity.login("13800000002","correct-password","ip").sessionToken();
        identity.accept(second,identity.invite(bearer,team,"13800000002","admin").inviteToken());
        String pending=request(null),redirect=grants.approve(second,new Approval(pending,team,true)).redirectUri();
        String code=URLDecoder.decode(URI.create(redirect).getRawQuery().split("&")[0].substring(5),StandardCharsets.UTF_8);
        Tokens issued=grants.code(new Code("client1",code,VERIFIER,REDIRECT,RESOURCE));assertTrue(issued.scope().contains("flymind:write"));
        rejected(()->grants.introspect("Bearer "+issued.access_token(),new Introspection(RESOURCE,"other-team")));
        http.perform(get("/app/flymind/auth/me").header("Authorization","Bearer "+issued.access_token())).andExpect(status().isUnauthorized());
        clock.addAndGet(600001);rejected(()->introspect(issued));
    }
    @Test void clientScopeCeilingAndTypedBodiesCannotBeBypassed() throws Exception {
        var client=clients.get("client1").deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode)client).put("client_id","read-client").put("scope","flymind:read");clients.register(client);
        rejected(()->grants.request(new Authorization("read-client",REDIRECT,challengeUnchecked(),null,null,RESOURCE)));
        http.perform(post("/app/flymind/oauth/requests/inspect").header("X-FlyMind-Gateway-Key",KEY).header("Authorization",bearer).contentType("application/json").content("{\"requestId\":42}")).andExpect(status().isBadRequest());
        http.perform(post("/app/flymind/oauth/requests/approve").header("X-FlyMind-Gateway-Key",KEY).header("Authorization",bearer).contentType("application/json").content("{\"requestId\":\"x\",\"approved\":\"true\"}")).andExpect(status().isBadRequest());
    }
    String challengeUnchecked() {try{return challenge();}catch(Exception error){throw new RuntimeException(error);}}
    @Test void parallelCodeExchangeReturnsOnlyOneCredentialPair() throws Exception {
        String code=code(null);var executor=java.util.concurrent.Executors.newFixedThreadPool(2);
        try{var actions=List.<java.util.concurrent.Callable<Boolean>>of(()->{try{grants.code(new Code("client1",code,VERIFIER,REDIRECT,RESOURCE));return true;}catch(OAuthFailure e){return false;}},()->{try{grants.code(new Code("client1",code,VERIFIER,REDIRECT,RESOURCE));return true;}catch(OAuthFailure e){return false;}});var result=executor.invokeAll(actions);assertNotEquals(result.get(0).get(),result.get(1).get());assertEquals(2,db.queryForObject("SELECT COUNT(*) FROM app_flymind_oauth_token",Integer.class));}finally{executor.shutdownNow();}
    }
}
