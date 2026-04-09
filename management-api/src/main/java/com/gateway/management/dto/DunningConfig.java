package com.gateway.management.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DunningConfig {

    @Builder.Default
    private List<Integer> retryIntervals = List.of(1, 3, 7);

    @Builder.Default
    private int gracePeriodDays = 14;

    @Builder.Default
    private String finalAction = "SUSPEND";

    @Builder.Default
    private int maxRetries = 3;
}
