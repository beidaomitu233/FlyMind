package com.xinghuiTec.flymind;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import java.util.*;
@RestController
@RequestMapping("/app/flymind/local")
public class FlymindLocalGrantController {
 private final FlymindLocalGrantService service;
 public FlymindLocalGrantController(FlymindLocalGrantService service){this.service=service;}
 private String field(Map<String,Object> body,String key){if(!(body.get(key)instanceof String value))throw new FlymindException(400,"INVALID_INPUT","缺少设备授权字段");return value;}
 private void exact(Map<String,Object> body,String...keys){if(!body.keySet().equals(Set.of(keys)))throw new FlymindException(400,"INVALID_INPUT","设备授权字段无效");}
 private ResponseEntity<Object> ok(Object value){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("code",200,"data",value));}
 @PostMapping("/grants") public ResponseEntity<Object> create(@RequestHeader(value="Authorization",required=false)String auth,@RequestBody Map<String,Object> body){exact(body,"deviceId","dataRootId","teamId");return ok(service.create(auth,field(body,"deviceId"),field(body,"dataRootId"),field(body,"teamId")));}
 @PostMapping("/introspect") public ResponseEntity<Object> inspect(@RequestHeader(value="Authorization",required=false)String auth,@RequestBody Map<String,Object> body){exact(body,"deviceId","dataRootId");return ok(service.introspect(auth,field(body,"deviceId"),field(body,"dataRootId")));}
 @PostMapping("/revoke") public ResponseEntity<Object> revoke(@RequestHeader(value="Authorization",required=false)String auth,@RequestBody Map<String,Object> body){exact(body,"deviceId","dataRootId");service.revoke(auth,field(body,"deviceId"),field(body,"dataRootId"));return ok(Map.of("revoked",true));}
}
