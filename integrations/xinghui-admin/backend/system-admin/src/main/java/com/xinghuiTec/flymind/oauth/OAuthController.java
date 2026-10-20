package com.xinghuiTec.flymind.oauth;

import com.fasterxml.jackson.databind.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
import static com.xinghuiTec.flymind.oauth.OAuthInputs.*;

@RestController
@RequestMapping("/app/flymind/oauth")
public class OAuthController {
    private final OAuthClients clients;
    private final OAuthGrants grants;
    private final ObjectMapper json;
    public OAuthController(OAuthClients clients, OAuthGrants grants, ObjectMapper json) { this.clients=clients;this.grants=grants;this.json=json; }
    private ResponseEntity<Object> ok(Object data) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("code",200,"message","成功","data",data)); }
    private <T> T input(JsonNode body, Class<T> type) {
        if(body==null||!body.isObject())throw new OAuthFailure(400,"invalid_request");
        for(var field:type.getRecordComponents()) {
            JsonNode value=body.get(field.getName());
            if(value==null||value.isNull())continue;
            if(field.getType()==String.class&&!value.isTextual() || field.getType()==Boolean.class&&!value.isBoolean())throw new OAuthFailure(400,"invalid_request");
            if(field.getType()==java.util.List.class) { if(!value.isArray())throw new OAuthFailure(400,"invalid_request");for(JsonNode item:value)if(!item.isTextual())throw new OAuthFailure(400,"invalid_request"); }
        }
        try { return json.readerFor(type).with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).readValue(body); }
        catch(Exception e) { throw new OAuthFailure(400,"invalid_request"); }
    }
    @GetMapping("/clients/{id}") public ResponseEntity<Object> client(@PathVariable String id) { return ok(clients.get(id)); }
    @PostMapping("/clients") public ResponseEntity<Object> register(@RequestBody JsonNode body) { return ok(clients.register(body)); }
    @PostMapping("/requests") public ResponseEntity<Object> request(@RequestBody JsonNode body) { return ok(grants.request(input(body,Authorization.class))); }
    @PostMapping("/requests/inspect") public ResponseEntity<Object> inspect(@RequestHeader(value="Authorization",required=false) String bearer,@RequestBody JsonNode body) { return ok(grants.inspect(bearer,input(body,Request.class))); }
    @PostMapping("/requests/approve") public ResponseEntity<Object> approve(@RequestHeader(value="Authorization",required=false) String bearer,@RequestBody JsonNode body) {
        if(!body.isObject()||!body.path("approved").isBoolean())throw new OAuthFailure(400,"invalid_request");
        return ok(grants.approve(bearer,input(body,Approval.class)));
    }
    @PostMapping("/code") public ResponseEntity<Object> code(@RequestBody JsonNode body) { return ok(grants.code(input(body,Code.class))); }
    @PostMapping("/refresh") public ResponseEntity<Object> refresh(@RequestBody JsonNode body) { return ok(grants.refresh(input(body,Refresh.class))); }
    @PostMapping("/introspect") public ResponseEntity<Object> introspect(@RequestHeader(value="Authorization",required=false) String bearer,@RequestBody JsonNode body) { return ok(grants.introspect(bearer,input(body,Introspection.class))); }
    @PostMapping("/revoke") public ResponseEntity<Object> revoke(@RequestBody JsonNode body) { grants.revoke(input(body,Revoke.class));return ok(Map.of("success",true)); }
}
