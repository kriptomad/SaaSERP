-- Capítulo 23.5 — nova categoria de notificação para alerta crítico quando o ERP não
-- consegue confirmar uma transação TEF junto à adquirente após múltiplas tentativas,
-- mesmo com a sessão já aprovada pelo cliente no pinpad.
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'TEF_CONFIRMATION_FAILED';
