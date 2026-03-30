package com.gateway.analytics.config;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import javax.sql.DataSource;

@Configuration
@Profile("clickhouse")
public class ClickHouseConfig {

    @Value("${clickhouse.datasource.url}")
    private String url;

    @Value("${clickhouse.datasource.username:default}")
    private String username;

    @Value("${clickhouse.datasource.password:}")
    private String password;

    @Bean
    @Qualifier("clickHouseJdbcTemplate")
    public JdbcTemplate clickHouseJdbcTemplate() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource();
        dataSource.setDriverClassName("com.clickhouse.jdbc.ClickHouseDriver");
        dataSource.setUrl(url);
        dataSource.setUsername(username);
        dataSource.setPassword(password);
        return new JdbcTemplate(dataSource);
    }
}
