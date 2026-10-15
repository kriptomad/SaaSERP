-- Capítulo 20.2/20.8 — canal SMS real (Zenvia) no fan-out multicanal de notificações.
-- GAP DE AUDITORIA FECHADO (Mega-Audit Rodada 4): `IntegrationProvider.SMS_ZENVIA`
-- já existia desde o schema inicial mas nenhuma preferência/campo permitia o usuário
-- optar pelo canal. Reaproveita `User.whatsappPhone` (já E.164) como destino — nunca
-- um segundo campo de telefone redundante.
ALTER TABLE "notification_preferences" ADD COLUMN "sms" BOOLEAN NOT NULL DEFAULT false;
