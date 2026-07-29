package com.gateway.notification.config;

import com.gateway.common.auth.DualIssuerJwtDecoder;
import com.gateway.common.auth.JwtAuthenticationFilter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoders;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri}")
    private String issuerUri;

    @Value("${gateway.keycloak.issuer-uri:${JWT_KEYCLOAK_ISSUER_URI:}}")
    private String keycloakIssuer;

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers("/actuator/health/**").permitAll()
                        .requestMatchers("/v1/notifications/**").authenticated()
                        .requestMatchers("/v1/webhooks/**").authenticated()
                        .anyRequest().permitAll()
                )
                .addFilterBefore(jwtAuthenticationFilter(), UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public JwtDecoder jwtDecoder() {
        JwtDecoder nativeDecoder = JwtDecoders.fromIssuerLocation(issuerUri);
        // When a Keycloak issuer is configured, accept BOTH native identity-service
        // tokens and BDP Keycloak SSO tokens via issuer routing.
        if (keycloakIssuer != null && !keycloakIssuer.isBlank()) {
            return new DualIssuerJwtDecoder(nativeDecoder, keycloakIssuer);
        }
        return nativeDecoder;
    }

    @Bean
    public JwtAuthenticationFilter jwtAuthenticationFilter() {
        return new JwtAuthenticationFilter(jwtDecoder(), keycloakIssuer);
    }
}
