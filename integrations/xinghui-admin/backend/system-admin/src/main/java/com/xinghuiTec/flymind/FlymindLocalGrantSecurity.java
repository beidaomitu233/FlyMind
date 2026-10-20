package com.xinghuiTec.flymind;
import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
/** Separate token purpose; every controller delegates to the authoritative grant service. */
@Configuration
public class FlymindLocalGrantSecurity {
 @Bean @Order(0) SecurityFilterChain localGrantChain(HttpSecurity http)throws Exception{return http.securityMatcher("/app/flymind/local/**").csrf(c->c.disable()).sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS)).authorizeHttpRequests(a->a.anyRequest().permitAll()).build();}
}
