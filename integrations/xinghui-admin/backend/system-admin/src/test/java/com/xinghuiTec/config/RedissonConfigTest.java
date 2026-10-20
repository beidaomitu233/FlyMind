package com.xinghuiTec.config;

import org.junit.jupiter.api.Test;
import org.redisson.config.Config;
import static org.junit.jupiter.api.Assertions.*;

class RedissonConfigTest {
    @Test void emptyPasswordDisablesAuthWithoutChangingConfiguredPasswords() {
        for (String password : new String[] {null, "", "fixture-redis-password", " "}) {
            Config config = new Config();
            config.useSingleServer().setAddress("redis://127.0.0.1:6379").setPassword(password);
            new RedissonConfig().redissonCustomizer().customize(config);
            assertEquals("".equals(password) ? null : password, config.useSingleServer().getPassword());
            assertTrue(config.isUseScriptCache());
        }
    }
}
