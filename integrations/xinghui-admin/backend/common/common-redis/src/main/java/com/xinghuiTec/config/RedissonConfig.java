package com.xinghuiTec.config;

import org.redisson.spring.starter.RedissonAutoConfigurationCustomizer;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;

/**
 * Redisson 配置
 *
 * @author xinghuiTec
 */
@AutoConfiguration
public class RedissonConfig {

    /**
     * 自定义 Redisson 配置
     * 启用 Lua 脚本缓存以提升性能（Redisson 大部分功能基于 Lua 实现）
     */
    @Bean
    public RedissonAutoConfigurationCustomizer redissonCustomizer() {
        return config -> {
            config.setUseScriptCache(true);
            // The starter copies an empty Spring Redis password as "", which
            // makes Redisson issue AUTH even when Redis has no password.
            if (config.isSingleConfig()) {
                var single = config.useSingleServer();
                if (single.getPassword() != null && single.getPassword().isEmpty()) {
                    single.setPassword(null);
                }
            }
        };
    }
}
