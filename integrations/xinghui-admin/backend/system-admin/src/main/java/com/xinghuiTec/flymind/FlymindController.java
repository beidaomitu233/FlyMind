package com.xinghuiTec.flymind;

import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import java.util.*;
import jakarta.servlet.http.HttpServletRequest;

@RestController
@RequestMapping("/app/flymind")
public class FlymindController {
 private final FlymindIdentityService service;
 public FlymindController(FlymindIdentityService service){this.service=service;}
 private ResponseEntity<Object> ok(Object data){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("code",200,"message","成功","data",data));}
 private String field(Map<String,Object> body,String key){Object v=body.get(key);if(!(v instanceof String s))throw new FlymindException(400,"INVALID_INPUT","缺少必要字段");return s;}
 private void fields(Map<String,Object> body,String... keys){if(!Set.of(keys).containsAll(body.keySet()))throw new FlymindException(400,"INVALID_INPUT","包含不支持的字段");}
 @PostMapping("/auth/login") public ResponseEntity<Object> login(@RequestBody Map<String,Object> b,HttpServletRequest request){fields(b,"phone","password");return ok(service.login(field(b,"phone"),field(b,"password"),request.getRemoteAddr()));}
 @GetMapping("/auth/me") public ResponseEntity<Object> me(@RequestHeader("Authorization")String auth){return ok(service.me(auth));}
 @PostMapping("/auth/logout") public ResponseEntity<Object> logout(@RequestHeader("Authorization")String auth){service.logout(auth);return ok(Map.of("success",true));}
 @PostMapping("/auth/password") public ResponseEntity<Object> password(@RequestHeader("Authorization")String auth,@RequestBody Map<String,Object>b){fields(b,"currentPassword","newPassword");service.changePassword(auth,field(b,"currentPassword"),field(b,"newPassword"));return ok(Map.of("success",true,"reauthenticate",true));}
 @PostMapping("/session/introspect") public ResponseEntity<Object> introspect(@RequestHeader("Authorization")String auth,@RequestBody Map<String,Object>b){fields(b,"teamId");return ok(service.introspect(auth,field(b,"teamId")));}
 @GetMapping("/teams") public ResponseEntity<Object> teams(@RequestHeader("Authorization")String auth){return ok(service.teams(auth));}
 @PostMapping("/teams") public ResponseEntity<Object> create(@RequestHeader("Authorization")String auth,@RequestBody Map<String,Object>b){fields(b,"name");return ok(service.createTeam(auth,field(b,"name")));}
 @PatchMapping("/teams/{tid}") public ResponseEntity<Object> rename(@RequestHeader("Authorization")String auth,@PathVariable String tid,@RequestBody Map<String,Object>b){fields(b,"name");return ok(service.renameTeam(auth,tid,field(b,"name")));}
 @GetMapping("/teams/{tid}/members") public ResponseEntity<Object> members(@RequestHeader("Authorization")String auth,@PathVariable String tid){return ok(service.members(auth,tid));}
 @PostMapping("/teams/{tid}/invites") public ResponseEntity<Object> invite(@RequestHeader("Authorization")String auth,@PathVariable String tid,@RequestBody Map<String,Object>b){fields(b,"phone","role");return ok(service.invite(auth,tid,field(b,"phone"),field(b,"role")));}
 @PostMapping("/invites/accept") public ResponseEntity<Object> accept(@RequestHeader("Authorization")String auth,@RequestBody Map<String,Object>b){fields(b,"inviteToken");return ok(service.accept(auth,field(b,"inviteToken")));}
 @PatchMapping("/teams/{tid}/members/{uid}") public ResponseEntity<Object> role(@RequestHeader("Authorization")String auth,@PathVariable String tid,@PathVariable String uid,@RequestBody Map<String,Object>b){fields(b,"role");service.changeRole(auth,tid,uid,field(b,"role"));return ok(Map.of("success",true));}
 @DeleteMapping("/teams/{tid}/members/{uid}") public ResponseEntity<Object> remove(@RequestHeader("Authorization")String auth,@PathVariable String tid,@PathVariable String uid){service.remove(auth,tid,uid);return ok(Map.of("success",true));}
 @PostMapping("/teams/{tid}/transfer") public ResponseEntity<Object> transfer(@RequestHeader("Authorization")String auth,@PathVariable String tid,@RequestBody Map<String,Object>b){fields(b,"userId");service.transfer(auth,tid,field(b,"userId"));return ok(Map.of("success",true));}
 @PostMapping("/teams/{tid}/leave") public ResponseEntity<Object> leave(@RequestHeader("Authorization")String auth,@PathVariable String tid){service.leave(auth,tid);return ok(Map.of("success",true));}
}
