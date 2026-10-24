package com.xinghuiTec.flymind;

import com.xinghuiTec.constants.RedisConstants;
import com.xinghuiTec.domain.entity.SysMenu;
import com.xinghuiTec.domain.entity.SysRole;
import com.xinghuiTec.domain.entity.SysUser;
import com.xinghuiTec.domain.entity.SysUserRole;
import com.xinghuiTec.domain.vo.SysMenuVO;
import com.xinghuiTec.domain.vo.UserInfoVO;
import com.xinghuiTec.mapper.SysMenuMapper;
import com.xinghuiTec.mapper.SysUserMapper;
import com.xinghuiTec.mapper.SysUserRoleMapper;
import com.xinghuiTec.service.SysRoleService;
import com.xinghuiTec.service.impl.LoginServiceImpl;
import com.xinghuiTec.utils.RedisCacheUtils;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.*;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Old Redis metadata survives a Java upgrade; it must not hide new grants. */
class FlymindAdminCatalogCacheTest {
    @Test void deployedCatalogBypassesOldInfoAndRouterWithoutFlushingOrChangingLoginState() {
        var cache=mock(RedisCacheUtils.class);
        var userRoles=mock(SysUserRoleMapper.class);
        var menus=mock(SysMenuMapper.class);
        var users=mock(SysUserMapper.class);
        var roles=mock(SysRoleService.class);
        var service=new LoginServiceImpl();
        ReflectionTestUtils.setField(service,"redisCacheUtils",cache);
        ReflectionTestUtils.setField(service,"userRoleMapper",userRoles);
        ReflectionTestUtils.setField(service,"menuMapper",menus);
        ReflectionTestUtils.setField(service,"userMapper",users);
        ReflectionTestUtils.setField(service,"roleService",roles);
        long id=99L;
        var user=new SysUser();user.setUserId(id);
        var oldInfo=new UserInfoVO(user,List.of(),List.of("system:user:list"));
        var oldMenu=new SysMenuVO();oldMenu.setMenuId(90001L);oldMenu.setPath("flymind");
        // Retained old caches are deliberately still present and readable.
        when(cache.getCacheObject("admin:userinfo:"+id)).thenReturn(oldInfo);
        when(cache.<SysMenuVO>getCacheList("admin:user:router:"+id)).thenReturn(List.of(oldMenu));
        when(cache.<SysMenuVO>getCacheList(RedisConstants.USER_ROUTER_PREFIX+id)).thenReturn(null);
        var membership=new SysUserRole();membership.setUserId(id);membership.setRoleId(10L);
        when(userRoles.selectList(any())).thenReturn(List.of(membership));
        var role=new SysRole();role.setRoleId(10L);role.setRoleKey("flymind-platform-admin");
        when(roles.listByIds(anyCollection())).thenReturn(List.of(role));
        when(users.selectById(id)).thenReturn(user);
        when(menus.selectPermsByRoleIds(List.of(10L))).thenReturn(List.of("system:user:list","flymind:dashboard:view"));
        var dashboard=menu(90004L,0L,"dashboard","M",-100);
        var overview=menu(90005L,90004L,"overview","C",0);overview.setComponent("dashboard/analytics/index");
        when(menus.selectMenuByUserId(id)).thenReturn(List.of(overview,dashboard));

        assertTrue(service.getUserInfo(id).getPermissions().contains("flymind:dashboard:view"));
        var router=service.getUserRouter(id);
        assertEquals("dashboard",router.get(0).getPath());
        assertEquals("overview",router.get(0).getChildren().get(0).getPath());
        verify(cache,never()).getCacheObject("admin:userinfo:"+id);
        verify(cache,never()).getCacheList("admin:user:router:"+id);
        verify(cache).setCacheObject(eq(RedisConstants.USER_INFO_PREFIX+id),any(UserInfoVO.class),eq(1800),eq(TimeUnit.SECONDS));
        verify(cache).setCacheList(eq(RedisConstants.USER_ROUTER_PREFIX+id),anyList(),eq(1800L),eq(TimeUnit.SECONDS));
        verify(cache,never()).deleteObject(anyString());
        assertEquals("admin:login:",RedisConstants.ADMIN_LOGIN_PREFIX);
    }
    private static SysMenu menu(long id,long parent,String path,String type,int order) {
        var menu=new SysMenu();menu.setMenuId(id);menu.setParentId(parent);menu.setPath(path);
        menu.setMenuType(type);menu.setStatus("0");menu.setOrderNum(order);return menu;
    }
}
