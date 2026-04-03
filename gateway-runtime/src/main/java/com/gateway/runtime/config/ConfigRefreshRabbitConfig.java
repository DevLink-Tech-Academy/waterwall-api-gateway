package com.gateway.runtime.config;

import com.gateway.common.events.RabbitMQExchanges;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.FanoutExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.UUID;

/**
 * RabbitMQ infrastructure beans for gateway config refresh events.
 * Separated from RouteConfigService to avoid circular bean dependency.
 */
@Configuration
public class ConfigRefreshRabbitConfig {

    public static final String CONFIG_REFRESH_QUEUE = "gateway-runtime.config.refresh." + UUID.randomUUID();
    public static final String TRANSFORM_REFRESH_QUEUE = "gateway-runtime.transform.refresh." + UUID.randomUUID();

    @Bean
    public Queue configRefreshQueue() {
        return new Queue(CONFIG_REFRESH_QUEUE, false, true, true);
    }

    @Bean
    public Queue transformRefreshQueue() {
        return new Queue(TRANSFORM_REFRESH_QUEUE, false, true, true);
    }

    @Bean
    public Binding configRefreshBinding(Queue configRefreshQueue, FanoutExchange configRefreshExchange) {
        return BindingBuilder.bind(configRefreshQueue).to(configRefreshExchange);
    }

    @Bean
    public Binding transformRefreshBinding(Queue transformRefreshQueue, FanoutExchange configRefreshExchange) {
        return BindingBuilder.bind(transformRefreshQueue).to(configRefreshExchange);
    }
}
