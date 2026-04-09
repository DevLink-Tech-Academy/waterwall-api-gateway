package com.gateway.notification.config;

import org.springframework.amqp.core.*;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitConfig {

    public static final String EXCHANGE_NAME = "notifications";
    public static final String QUEUE_NAME = "notification-service.notifications";
    public static final String ROUTING_KEY_PATTERN = "notification.#";

    public static final String PLATFORM_EVENTS_EXCHANGE = "platform.events";
    public static final String PLATFORM_EVENTS_QUEUE = "notification-service.platform-events";
    public static final String PLATFORM_EVENTS_ROUTING_KEY = "#";

    @Bean
    public TopicExchange notificationExchange() {
        return new TopicExchange(EXCHANGE_NAME);
    }

    @Bean
    public Queue notificationQueue() {
        return QueueBuilder.durable(QUEUE_NAME).build();
    }

    @Bean
    public Binding notificationBinding(Queue notificationQueue, TopicExchange notificationExchange) {
        return BindingBuilder
                .bind(notificationQueue)
                .to(notificationExchange)
                .with(ROUTING_KEY_PATTERN);
    }

    @Bean
    public TopicExchange platformEventsExchange() {
        return new TopicExchange(PLATFORM_EVENTS_EXCHANGE);
    }

    @Bean
    public Queue platformEventsQueue() {
        return QueueBuilder.durable(PLATFORM_EVENTS_QUEUE).build();
    }

    @Bean
    public Binding platformEventsBinding(Queue platformEventsQueue, TopicExchange platformEventsExchange) {
        return BindingBuilder
                .bind(platformEventsQueue)
                .to(platformEventsExchange)
                .with(PLATFORM_EVENTS_ROUTING_KEY);
    }

    @Bean
    public Queue billingEventsQueue() {
        return QueueBuilder.durable("notification-service.billing-events").build();
    }

    @Bean
    public Binding billingInvoiceBinding(Queue billingEventsQueue, TopicExchange platformEventsExchange) {
        return BindingBuilder.bind(billingEventsQueue).to(platformEventsExchange).with("invoice.*");
    }

    @Bean
    public Binding billingPaymentBinding(Queue billingEventsQueue, TopicExchange platformEventsExchange) {
        return BindingBuilder.bind(billingEventsQueue).to(platformEventsExchange).with("payment.*");
    }

    @Bean
    public Binding billingSubSuspendedBinding(Queue billingEventsQueue, TopicExchange platformEventsExchange) {
        return BindingBuilder.bind(billingEventsQueue).to(platformEventsExchange).with("subscription.suspended");
    }

    @Bean
    public Binding billingSubExpiredBinding(Queue billingEventsQueue, TopicExchange platformEventsExchange) {
        return BindingBuilder.bind(billingEventsQueue).to(platformEventsExchange).with("subscription.expired");
    }

    @Bean
    public Binding billingAlertBinding(Queue billingEventsQueue, TopicExchange platformEventsExchange) {
        return BindingBuilder.bind(billingEventsQueue).to(platformEventsExchange).with("consumer.alert_triggered");
    }
}
