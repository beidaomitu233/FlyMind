package com.xinghuiTec.flymind.oauth;

import com.xinghuiTec.flymind.FlymindIdentityService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.util.function.LongSupplier;
import static com.xinghuiTec.flymind.oauth.OAuthInputs.*;

@Service
@Transactional(noRollbackFor = OAuthFailure.class)
public class OAuthGrants {
    private static final long CODE_TTL = 300_000, ACCESS_TTL = 600_000, GRANT_TTL = 30L*86400_000;
    private final JdbcTemplate db;
    private final FlymindIdentityService identity;
    private final OAuthClients clients;
    private final String resource, tenant;
    private final LongSupplier clock;
    @Autowired
    public OAuthGrants(JdbcTemplate db, FlymindIdentityService identity, OAuthClients clients,
                       @Value("${FLYMIND_CLOUD_PUBLIC_ORIGIN:}") String origin, @Value("${FLYMIND_APP_TENANT_ID}") String tenant) {
        this(db, identity, clients, origin, tenant, System::currentTimeMillis);
    }
    public OAuthGrants(JdbcTemplate db, FlymindIdentityService identity, OAuthClients clients, String origin, String tenant, LongSupplier clock) {
        this.db=db; this.identity=identity; this.clients=clients; this.tenant=tenant; this.clock=clock;
        String valid = "";
        try { URI uri = URI.create(origin); OAuthClients.redirect(origin); if (uri.getRawQuery() == null && (uri.getRawPath().isEmpty()) && origin.equals(uri.getScheme()+"://"+uri.getRawAuthority())) valid=origin+"/mcp"; } catch (RuntimeException ignored) {}
        this.resource=valid;
    }
    private OAuthFailure invalid() { return new OAuthFailure(400,"invalid_grant"); }
    private void resource(String value) { if (resource.isEmpty()) throw new OAuthFailure(503,"temporarily_unavailable"); if (!resource.equals(value)) throw new OAuthFailure(400,"invalid_target"); }
    private static String random(String prefix) { byte[] bytes=new byte[32]; new SecureRandom().nextBytes(bytes); return prefix+Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private static String hash(String value) { return FlymindIdentityService.hash(value); }
    private static boolean equal(String a,String b) { return a!=null&&b!=null&&MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8),b.getBytes(StandardCharsets.UTF_8)); }
    private static List<String> scopes(List<String> input) {
        List<String> value=input==null?List.of("flymind:read","flymind:write"):input;
        if (value.isEmpty() || value.size()>2 || new HashSet<>(value).size()!=value.size() || value.stream().anyMatch(s->s==null||!Set.of("flymind:read","flymind:write").contains(s)) || value.contains("flymind:write")&&!value.contains("flymind:read")) throw new OAuthFailure(400,"invalid_scope");
        return List.copyOf(value);
    }
    private Map<String,Object> row(String sql,Object... args) { List<Map<String,Object>> rows=db.queryForList(sql,args); if(rows.size()!=1)throw invalid();return rows.get(0); }
    private String text(Map<String,Object> row,String key) { return String.valueOf(row.get(key)); }
    private long number(Map<String,Object> row,String key) { return ((Number)row.get(key)).longValue(); }
    private String secret(String value,String prefix) { if(value==null||!value.matches(prefix+"[A-Za-z0-9_-]{43}"))throw invalid();return hash(value); }
    public RequestResult request(Authorization input) {
        if(input==null)throw new OAuthFailure(400,"invalid_request");resource(input.resource());clients.check(input.clientId(),input.redirectUri(),false);
        if(input.redirectUri()==null||input.codeChallenge()==null||!input.codeChallenge().matches("[A-Za-z0-9_-]{43}")||input.state()!=null&&input.state().length()>2048)throw new OAuthFailure(400,"invalid_request");
        List<String> scopes=scopes(input.scopes());clients.scopes(input.clientId(),scopes);String plain=random("");long expires=clock.getAsLong()+CODE_TTL;
        db.update("INSERT INTO app_flymind_oauth_request(request_hash,client_id,redirect_uri,challenge,scopes,state_value,resource_uri,expires_at) VALUES(?,?,?,?,?,?,?,?)",hash(plain),input.clientId(),input.redirectUri(),input.codeChallenge(),String.join(" ",scopes),input.state(),resource,expires);
        return new RequestResult(plain,expires);
    }
    private Map<String,Object> pending(String requestId,boolean lock) {
        Map<String,Object> request=row("SELECT * FROM app_flymind_oauth_request WHERE request_hash=?"+(lock?" FOR UPDATE":""),secret(requestId,""));
        if(request.get("consumed_at")!=null||number(request,"expires_at")<=clock.getAsLong())throw invalid();resource(text(request,"resource_uri"));return request;
    }
    public Map<String,Object> inspect(String bearer, Request input) {
        if(input==null)throw invalid();identity.authenticate(bearer);Map<String,Object> request=pending(input.requestId(),false);var client=clients.get(text(request,"client_id"));
        return Map.of("client",Map.of("id",text(request,"client_id"),"name",client.path("client_name").asText("MCP 客户端")),"scopes",List.of(text(request,"scopes").split(" ")),"teams",identity.teams(bearer),"expiresAt",number(request,"expires_at"));
    }
    public Redirect approve(String bearer, Approval input) {
        if(input==null||input.approved()==null)throw invalid();var actor=identity.authenticate(bearer);Map<String,Object> request=pending(input.requestId(),true);
        if(input.approved()&&db.query("SELECT user_id FROM sys_user WHERE user_id=? AND tenant_id=? AND status=1 AND is_deleted=0 FOR UPDATE",(r,n)->r.getString(1),actor.user().id(),tenant).size()!=1)throw new OAuthFailure(403,"access_denied");
        String redirect=text(request,"redirect_uri"),client=text(request,"client_id");clients.check(client,redirect,false);
        String result;
        if(input.approved()) {
            var team=identity.teams(bearer).stream().filter(t->t.id().equals(input.teamId())).findFirst().orElseThrow(()->new OAuthFailure(403,"access_denied"));
            List<String> requested=List.of(text(request,"scopes").split(" "));
            if(requested.contains("flymind:write")&&"viewer".equals(team.role()))throw new OAuthFailure(403,"access_denied");
            String grant=UUID.randomUUID().toString(),code=random("");long now=clock.getAsLong();
            db.update("INSERT INTO app_flymind_oauth_grant(id,client_id,user_id,team_id,scopes,resource_uri,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",grant,client,actor.user().id(),team.id(),text(request,"scopes"),resource,now,now+GRANT_TTL);
            db.update("INSERT INTO app_flymind_oauth_code(code_hash,grant_id,redirect_uri,challenge,expires_at) VALUES(?,?,?,?,?)",hash(code),grant,redirect,text(request,"challenge"),now+CODE_TTL);
            result="code="+encode(code);
        } else result="error=access_denied";
        db.update("UPDATE app_flymind_oauth_request SET consumed_at=? WHERE request_hash=?",clock.getAsLong(),hash(input.requestId()));
        if(request.get("state_value")!=null)result+="&state="+encode(text(request,"state_value"));
        return new Redirect(redirect+(redirect.contains("?")?"&":"?")+result);
    }
    private static String encode(String value){return URLEncoder.encode(value,StandardCharsets.UTF_8);}
    private Map<String,Object> grant(String id,boolean lock) {
        Map<String,Object> grant=row("SELECT * FROM app_flymind_oauth_grant WHERE id=?"+(lock?" FOR UPDATE":""),id);
        if(!resource.equals(grant.get("resource_uri")))throw invalid();
        if(grant.get("revoked_at")!=null||number(grant,"expires_at")<=clock.getAsLong())throw invalid();
        int active=db.query("SELECT u.user_id FROM sys_user u JOIN app_flymind_member m ON m.user_id=u.user_id JOIN app_flymind_team t ON t.id=m.team_id WHERE u.user_id=? AND u.tenant_id=? AND u.status=1 AND u.is_deleted=0 AND m.team_id=? AND t.status=1"+(lock?" FOR UPDATE":""),(r,n)->r.getString(1),grant.get("user_id"),tenant,grant.get("team_id")).size();
        if(active!=1)throw invalid();return grant;
    }
    private List<String> effective(Map<String,Object> grant,List<String> requested) {
        String role=db.queryForObject("SELECT role FROM app_flymind_member WHERE user_id=? AND team_id=?",String.class,grant.get("user_id"),grant.get("team_id"));
        List<String> allowed=new ArrayList<>(requested);if("viewer".equals(role))allowed.remove("flymind:write");return allowed;
    }
    private Tokens issue(Map<String,Object> grant,List<String> requested) {
        List<String> allowed=effective(grant,requested);long now=clock.getAsLong();String access=random("fm_mcp_"),refresh=random("fm_refresh_");long accessExpiry=Math.min(now+ACCESS_TTL,number(grant,"expires_at"));
        String scope=String.join(" ",allowed);
        db.update("INSERT INTO app_flymind_oauth_token(token_hash,grant_id,token_kind,scopes,expires_at) VALUES(?,?,'access',?,?)",hash(access),grant.get("id"),scope,accessExpiry);
        db.update("INSERT INTO app_flymind_oauth_token(token_hash,grant_id,token_kind,scopes,expires_at) VALUES(?,?,'refresh',?,?)",hash(refresh),grant.get("id"),scope,number(grant,"expires_at"));
        return new Tokens(access,"Bearer",(accessExpiry-now)/1000,refresh,scope);
    }
    public Tokens code(Code input) {
        if(input==null)throw invalid();resource(input.resource());clients.check(input.clientId(),input.redirectUri(),false);
        Map<String,Object> code=row("SELECT * FROM app_flymind_oauth_code WHERE code_hash=? FOR UPDATE",secret(input.code(),""));Map<String,Object> grant=grant(text(code,"grant_id"),true);
        if(!input.clientId().equals(grant.get("client_id"))||!Objects.equals(input.redirectUri(),code.get("redirect_uri"))||number(code,"expires_at")<=clock.getAsLong()||code.get("consumed_at")!=null)throw invalid();
        String verifier=input.codeVerifier();if(verifier==null||!verifier.matches("[A-Za-z0-9._~-]{43,128}"))throw invalid();
        byte[] digest;try{digest=MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));}catch(Exception e){throw new IllegalStateException(e);}
        if(!equal(Base64.getUrlEncoder().withoutPadding().encodeToString(digest),text(code,"challenge")))throw invalid();
        db.update("UPDATE app_flymind_oauth_code SET consumed_at=? WHERE code_hash=?",clock.getAsLong(),hash(input.code()));return issue(grant,List.of(text(grant,"scopes").split(" ")));
    }
    public Tokens refresh(Refresh input) {
        if(input==null)throw invalid();resource(input.resource());clients.check(input.clientId(),null,true);
        String digest=secret(input.refreshToken(),"fm_refresh_");Map<String,Object> token=row("SELECT * FROM app_flymind_oauth_token WHERE token_hash=? FOR UPDATE",digest);Map<String,Object> grant=grant(text(token,"grant_id"),true);
        if(!input.clientId().equals(grant.get("client_id"))||!"refresh".equals(token.get("token_kind")))throw invalid();
        if(token.get("consumed_at")!=null){db.update("UPDATE app_flymind_oauth_grant SET revoked_at=? WHERE id=?",clock.getAsLong(),grant.get("id"));throw invalid();}
        if(number(token,"expires_at")<=clock.getAsLong())throw invalid();
        List<String> requested=input.scopes()==null?List.of(text(token,"scopes").split(" ")):scopes(input.scopes());
        if(!List.of(text(token,"scopes").split(" ")).containsAll(requested))throw new OAuthFailure(400,"invalid_scope");
        db.update("UPDATE app_flymind_oauth_token SET consumed_at=? WHERE token_hash=?",clock.getAsLong(),digest);return issue(grant,requested);
    }
    public Map<String,Object> introspect(String bearer,Introspection input) {
        if(input==null)throw invalid();resource(input.resource());if(bearer==null||!bearer.startsWith("Bearer "))throw new OAuthFailure(401,"invalid_token");
        try {
        Map<String,Object> token=row("SELECT * FROM app_flymind_oauth_token WHERE token_hash=?",secret(bearer.substring(7),"fm_mcp_"));Map<String,Object> grant=grant(text(token,"grant_id"),false);
        if(!"access".equals(token.get("token_kind"))||number(token,"expires_at")<=clock.getAsLong()||input.teamId()!=null&&!input.teamId().equals(grant.get("team_id")))throw new OAuthFailure(401,"invalid_token");
        List<String> scope=effective(grant,List.of(text(token,"scopes").split(" ")));
        Map<String,Object> user=row("SELECT user_id,COALESCE(NULLIF(nickname,''),username) AS display_name FROM sys_user WHERE user_id=?",grant.get("user_id"));
        Map<String,Object> team=row("SELECT t.name,m.role FROM app_flymind_team t JOIN app_flymind_member m ON m.team_id=t.id WHERE t.id=? AND m.user_id=?",grant.get("team_id"),grant.get("user_id"));
        return Map.of("user",Map.of("id",text(user,"user_id"),"name",text(user,"display_name")),"session",Map.of("id",text(grant,"id"),"expiresAt",number(token,"expires_at")),"team",Map.of("id",text(grant,"team_id"),"name",text(team,"name"),"role",text(team,"role")),"authorization",Map.of("purpose","mcp","resource",resource,"scopes",scope,"clientId",text(grant,"client_id")));
        } catch(OAuthFailure error) { if(error.status==400&&"invalid_grant".equals(error.error))throw new OAuthFailure(401,"invalid_token");throw error; }
    }
    public void revoke(Revoke input) {
        if(input==null||input.token()==null||input.token().length()>512)throw new OAuthFailure(400,"invalid_request");clients.check(input.clientId(),null,false);
        List<String> grants=db.query("SELECT g.id FROM app_flymind_oauth_grant g JOIN app_flymind_oauth_token t ON t.grant_id=g.id WHERE t.token_hash=? AND g.client_id=?",(r,n)->r.getString(1),hash(input.token()),input.clientId());
        for(String id:grants)db.update("UPDATE app_flymind_oauth_grant SET revoked_at=? WHERE id=? AND revoked_at IS NULL",clock.getAsLong(),id);
    }
}
