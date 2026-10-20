package com.xinghuiTec.flymind.oauth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.net.URI;
import java.util.*;

@Service
@Transactional(noRollbackFor = OAuthFailure.class)
public class OAuthClients {
    private final JdbcTemplate db;
    private final ObjectMapper json;
    public OAuthClients(JdbcTemplate db, ObjectMapper json) { this.db = db; this.json = json; }
    static OAuthFailure invalid() { return new OAuthFailure(400, "invalid_client_metadata"); }
    static String string(JsonNode node, String field, int max) {
        JsonNode value = node.get(field);
        if (value == null || !value.isTextual() || value.asText().isBlank() || value.asText().length() > max) throw invalid();
        return value.asText();
    }
    public static void redirect(String value) {
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            boolean loopback = Set.of("localhost", "127.0.0.1", "[::1]", "::1").contains(host == null ? "" : host);
            if (value.length() > 2048 || value.contains("*") || uri.getFragment() != null || uri.getUserInfo() != null || host == null
                || !("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()) && loopback)) throw invalid();
        } catch (java.net.URISyntaxException error) { throw invalid(); }
    }
    public JsonNode register(JsonNode value) {
        if (value == null || !value.isObject() || value.toString().length() > 16000) throw invalid();
        Set<String> allowed=Set.of("client_id","client_id_issued_at","client_secret_expires_at","redirect_uris","token_endpoint_auth_method","grant_types","response_types","client_name","client_uri","logo_uri","scope","contacts","tos_uri","policy_uri","jwks_uri","jwks","software_id","software_version","software_statement","issuer");
        Iterator<String> fields = value.fieldNames();
        while (fields.hasNext()) if (!allowed.contains(fields.next())) throw invalid();
        if (value.has("scope")) {
            String scope=string(value,"scope",80);
            for(String part:scope.split(" "))if(!Set.of("flymind:read","flymind:write").contains(part))throw invalid();
        }
        String id = string(value, "client_id", 200);
        if (!id.matches("[A-Za-z0-9_-]{1,200}") || !"none".equals(string(value, "token_endpoint_auth_method", 20))) throw invalid();
        JsonNode uris = value.get("redirect_uris"), grants = value.get("grant_types"), responses = value.get("response_types");
        if (uris == null || !uris.isArray() || uris.isEmpty() || uris.size() > 10) throw invalid();
        Set<String> seen = new HashSet<>();
        for (JsonNode uri : uris) { if (!uri.isTextual() || !seen.add(uri.asText())) throw invalid(); redirect(uri.asText()); }
        if (grants == null || !grants.isArray() || grants.isEmpty() || grants.size() > 2) throw invalid();
        Set<String> allowedGrants = new HashSet<>();
        for (JsonNode grant : grants) if (!grant.isTextual() || !Set.of("authorization_code", "refresh_token").contains(grant.asText()) || !allowedGrants.add(grant.asText())) throw invalid();
        if (!allowedGrants.contains("authorization_code") || responses == null || !responses.isArray() || responses.size() != 1 || !"code".equals(responses.get(0).asText())) throw invalid();
        if (value.has("client_name") && (!value.get("client_name").isTextual() || value.get("client_name").asText().length() > 120)) throw invalid();
        if (db.queryForObject("SELECT COUNT(*) FROM app_flymind_oauth_client WHERE id=?", Integer.class, id) != 0) throw new OAuthFailure(400, "invalid_client_metadata");
        db.update("INSERT INTO app_flymind_oauth_client(id,metadata,created_at) VALUES(?,?,?)", id, value.toString(), System.currentTimeMillis());
        return value.deepCopy();
    }
    public JsonNode get(String id) {
        if (id == null || id.length() > 200) throw new OAuthFailure(400, "invalid_client");
        List<String> rows = db.query("SELECT metadata FROM app_flymind_oauth_client WHERE id=?", (r,n)->r.getString(1), id);
        if (rows.size() != 1) throw new OAuthFailure(404, "invalid_client");
        try { return json.readTree(rows.get(0)); } catch (Exception e) { throw new OAuthFailure(503, "server_error"); }
    }
    public void scopes(String id, List<String> requested) {
        JsonNode client=get(id);
        if(client.has("scope")&&!List.of(client.get("scope").asText().split(" ")).containsAll(requested))throw new OAuthFailure(400,"invalid_scope");
    }
    public void check(String id, String redirectURI, boolean refresh) {
        JsonNode client = get(id);
        if (refresh) { boolean found = false; for (JsonNode grant : client.get("grant_types")) if ("refresh_token".equals(grant.asText())) found = true; if (!found) throw new OAuthFailure(400, "unauthorized_client"); }
        if (redirectURI != null) { boolean found = false; for (JsonNode uri : client.get("redirect_uris")) if (redirectURI.equals(uri.asText())) found = true; if (!found) throw new OAuthFailure(400, "invalid_request"); }
    }
}
