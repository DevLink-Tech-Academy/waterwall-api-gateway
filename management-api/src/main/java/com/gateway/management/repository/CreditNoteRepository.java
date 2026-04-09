package com.gateway.management.repository;

import com.gateway.management.entity.CreditNoteEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface CreditNoteRepository extends JpaRepository<CreditNoteEntity, UUID> {

    List<CreditNoteEntity> findByInvoiceId(UUID invoiceId);

    List<CreditNoteEntity> findByConsumerId(UUID consumerId);
}
