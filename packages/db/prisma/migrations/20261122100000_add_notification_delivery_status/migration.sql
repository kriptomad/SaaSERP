-- GAP DE AUDITORIA FECHADO (fa-w5-notif-delivery-failure-silent-to-users): falhas de
-- entrega do fan-out externo (WhatsApp/SMS) de uma Notification nunca eram
-- persistidas na própria Notification — só em `WorkerJobFailure` (registro
-- técnico/operacional, sem relação direta com a Notification in-app que o usuário
-- vê no sininho). Adiciona um resumo visível ao usuário final: PENDING (default,
-- ainda não se sabe o resultado ou não há canal externo habilitado) / SENT / FAILED,
-- com uma mensagem de erro curta e sanitizada.
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

ALTER TABLE "notifications"
  ADD COLUMN "deliveryStatus" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "deliveryError" TEXT;
