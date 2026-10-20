package com.xinghuiTec.flymind.oauth;

import com.xinghuiTec.flymind.FlymindException;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.dao.DataAccessException;
import java.util.Map;

@RestControllerAdvice(assignableTypes=OAuthController.class)
public class OAuthErrors {
    @ExceptionHandler(OAuthFailure.class) ResponseEntity<Object> oauth(OAuthFailure error) { return response(error.status,error.error); }
    @ExceptionHandler(FlymindException.class) ResponseEntity<Object> identity(FlymindException error) { return response(error.status,error.status==401?"invalid_token":"access_denied"); }
    @ExceptionHandler(DataAccessException.class) ResponseEntity<Object> unavailable(DataAccessException error) { return response(503,"temporarily_unavailable"); }
    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class) ResponseEntity<Object> invalid(Exception error) { return response(400,"invalid_request"); }
    private ResponseEntity<Object> response(int status,String error) { return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(Map.of("code",status,"message",error,"data",Map.of("error",error))); }
}
