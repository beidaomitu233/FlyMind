package com.xinghuiTec.flymind;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import org.springframework.dao.DataAccessException;
import java.util.Map;
@RestControllerAdvice(assignableTypes={FlymindOverviewController.class,FlymindLocalGrantController.class,FlymindController.class,FlymindAdminController.class,FlymindAdminUserController.class})
public class FlymindErrors {
 @ExceptionHandler(FlymindException.class) public ResponseEntity<Object> expected(FlymindException e){return response(e.status,e.code,e.getMessage());}
 @ExceptionHandler(DataAccessException.class) public ResponseEntity<Object> unavailable(DataAccessException e){return response(503,"IDENTITY_UNAVAILABLE","身份服务暂时不可用");}
 @ExceptionHandler({org.springframework.http.converter.HttpMessageNotReadableException.class,org.springframework.web.bind.MissingRequestHeaderException.class}) public ResponseEntity<Object> bad(Exception e){return response(400,"INVALID_INPUT","请求参数不合法");}
 private ResponseEntity<Object> response(int status,String code,String message){return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(Map.of("code",status,"errorCode",code,"message",message));}
}
