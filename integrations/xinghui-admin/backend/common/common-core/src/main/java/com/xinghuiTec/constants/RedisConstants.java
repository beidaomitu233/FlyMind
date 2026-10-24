package com.xinghuiTec.constants;

/**
 * Redis 常量
 *
 * @author xinghuiTec
 */
public interface RedisConstants {

    String ADMIN_LOGIN_PREFIX = "admin:login:";

    Integer ADMIN_LOGIN_CAPTCHA_TTL_SEC = 120;

    // Bump only when the deployed permission/menu catalog changes. Redis may
    // outlive Java upgrades; all readers and targeted invalidators use this key.
    String USER_INFO_PREFIX = "admin:userinfo:v20261024:";

    Integer USER_INFO_TTL_SEC = 1800;

    String USER_ROUTER_PREFIX = "admin:user:router:v20261024:";

    Integer USER_ROUTER_TTL_SEC = 1800;
}
