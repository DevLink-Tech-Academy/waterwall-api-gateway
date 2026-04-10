package com.gateway.management.repository;

import com.gateway.management.entity.PlatformSettingEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface PlatformSettingRepository extends JpaRepository<PlatformSettingEntity, UUID> {

    Optional<PlatformSettingEntity> findBySettingKey(String settingKey);
}
