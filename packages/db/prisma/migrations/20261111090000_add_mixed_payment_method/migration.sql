-- GAP DE AUDITORIA FECHADO (Rodada 6 — Pagamento Dividido/Split, Capítulo 9):
-- "MIXED" é o rótulo agregado gravado em Sale.paymentMethod quando a venda tem
-- 2+ linhas Payment de métodos DIFERENTES (ex.: metade PIX, metade cartão de
-- crédito). Nunca usado como Payment.method individual — cada linha de Payment
-- continua gravando o método real e específico daquela parcela.
ALTER TYPE "SalePaymentMethod" ADD VALUE IF NOT EXISTS 'MIXED';
