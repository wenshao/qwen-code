package com.alibaba.qwen.code.managedagent.rig;

import com.alibaba.qwen.code.managedagent.api.AuthenticatedTenantActor;
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import java.security.Principal;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;

/**
 * VERIFICATION RIG ONLY: stands in for a trusted authentication adapter
 * (the PR's IT uses the same shape). X-Rig-Actor names the authenticated
 * actor for the request's X-Qwen-Tenant-Id.
 */
@Configuration
public class RigActorConfig {
    @Bean
    public FilterRegistrationBean<Filter> rigActorFilter() {
        Filter filter = (request, response, chain) -> {
            HttpServletRequest http = (HttpServletRequest) request;
            String actor = http.getHeader("X-Rig-Actor");
            String tenant = http.getHeader("X-Qwen-Tenant-Id");
            if (actor == null || tenant == null) {
                chain.doFilter(request, response);
                return;
            }
            Principal principal = new Actor(tenant, actor);
            chain.doFilter(new HttpServletRequestWrapper(http) {
                @Override
                public Principal getUserPrincipal() {
                    return principal;
                }
            }, response);
        };
        FilterRegistrationBean<Filter> bean = new FilterRegistrationBean<>(filter);
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE);
        bean.setAsyncSupported(true);
        bean.addUrlPatterns("/v1/agents/*", "/api/agent/web-shell/v1/*");
        return bean;
    }

    record Actor(String tenantId, String actorId) implements AuthenticatedTenantActor {
        @Override
        public String getName() {
            return actorId;
        }
    }
}
