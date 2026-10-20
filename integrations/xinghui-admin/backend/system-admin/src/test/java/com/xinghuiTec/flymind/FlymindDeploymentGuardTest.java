package com.xinghuiTec.flymind;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class FlymindDeploymentGuardTest {
 @Test void requiredGatewayAndExactPublicOriginFailClosed(){
  String key="test-only-key-at-least-32-bytes-long";
  assertThrows(IllegalStateException.class,()->new FlymindDeploymentGuard("", "https://flymind.example"));
  for(String origin:new String[]{"", "http://example.com", "https://user:pass@example.com", "https://example.com/", "https://example.com/path", "https://example.com?query=1", "https://example.com#fragment"})assertThrows(IllegalStateException.class,()->new FlymindDeploymentGuard(key,origin));
  assertDoesNotThrow(()->new FlymindDeploymentGuard(key,"https://flymind.example"));assertDoesNotThrow(()->new FlymindDeploymentGuard(key,"http://127.0.0.1:1234"));
 }
}
