package com.xinghuiTec.flymind;

import com.xinghuiTec.config.SecurityConfig;
import com.xinghuiTec.filter.AuthenticationEntryPointImpl;
import com.xinghuiTec.flymind.oauth.OAuthSecurity;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.web.WebAppConfiguration;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringJUnitConfig({FlymindSecurityTest.Web.class,SecurityConfig.class,AuthenticationEntryPointImpl.class,OAuthSecurity.class})
@TestPropertySource(properties="FLYMIND_GATEWAY_KEY=too-short")
@WebAppConfiguration
class FlymindOAuthGateTest {
    @org.springframework.boot.test.mock.mockito.MockBean com.xinghuiTec.utils.RedisCacheUtils redis;
    @Autowired WebApplicationContext context;
    @Test void weakConfigurationFailsClosedEvenWithTheMatchingShortKey() throws Exception {
        var http=MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        http.perform(get("/app/flymind/oauth/clients/anything").header("X-FlyMind-Gateway-Key","too-short")).andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.data.error").value("temporarily_unavailable"));
    }
}
