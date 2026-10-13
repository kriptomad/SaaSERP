// apps/web/src/modules/registrations/api.ts
// Contratos reais de apps/api/src/modules/{clients,suppliers,products}/*.routes.ts.
// Decimais (Prisma) chegam como string.
import { api } from "../../api/client";

export interface Client {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  creditLimit: string;
  // Capítulo 4.6 — Varejo Geral (Crediário/Fiado): saldo já utilizado do limite de
  // crediário do cliente; debitado automaticamente por vendas STORE_CREDIT.
  creditBalanceUsed: string;
  isReseller: boolean;
  // Capítulo 11.8 — Material de Construção/Ferragens: cliente profissional com
  // faturamento mensal consolidado (ver construction/api.ts).
  isBusinessAccount: boolean;
  // Capítulo 11.2 — Ótica: vínculo opcional a convênio/plano de saúde (habilita
  // venda com paymentMethod HEALTH_INSURANCE no PDV).
  healthInsurancePlanId: string | null;
  healthInsurancePlanMemberId: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
}

export type PartyInput = {
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
};

export type TrackingType = "NONE" | "BATCH" | "SERIAL" | "VARIANT";
export type ProductSaleUnit = "UNIT" | "KG" | "METER" | "SQUARE_METER" | "CUBIC_METER" | "LITER";

export interface ProductListItem {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category: string | null;
  unitPrice: string;
  wholesalePrice: string | null;
  wholesaleMinQty: number | null;
  stockQuantity: string;
  trackingType: TrackingType;
  isWeighted: boolean;
  ncm: string;
  // Capítulo 11.4 — Loja de Roupas/Moda: tag de coleção/estação (ex.: "Verão 2026").
  collectionTag: string | null;
  // Capítulo 11.8 — Material de Construção/Ferragens: unidade de compra vs. venda.
  saleUnit: ProductSaleUnit;
  purchaseUnit: string | null;
  unitConversionFactor: string | null;
  // Capítulo 11.5 — Papelaria/Presentes: kit escolar = Recipe/RecipeItem como BOM do kit.
  isKitComposition: boolean;
}

export interface ProductDetail extends ProductListItem {
  originUf: string | null;
  nicheCode: string | null;
  costPrice: string | null;
  minStockThreshold: string | null;
  supplierId: string | null;
}

export interface ProductInput {
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category: string | null;
  trackingType: TrackingType;
  ncm: string;
  originUf: string | null;
  unitPrice: number;
  wholesalePrice: number | null;
  wholesaleMinQty: number | null;
  costPrice: number | null;
  minStockThreshold: number | null;
  isWeighted: boolean;
  supplierId: string | null;
  // Capítulo 11.4 — Loja de Roupas/Moda: tag de coleção/estação (ex.: "Verão 2026").
  collectionTag: string | null;
  // stockQuantity inicial só é aceito na criação (a edição de saldo passa por ajuste de estoque)
  stockQuantity?: number;
  // Capítulo 11.8 — Material de Construção/Ferragens.
  saleUnit?: ProductSaleUnit;
  purchaseUnit?: string | null;
  unitConversionFactor?: number | null;
  // Capítulo 11.5 — Papelaria/Presentes (kits escolares).
  isKitComposition?: boolean;
}

export const clientsApi = {
  list: (search?: string) => api.get<Client[]>("/clients", { search }),
  create: (input: PartyInput & { creditLimit: number; isReseller?: boolean; isBusinessAccount?: boolean; healthInsurancePlanId?: string | null; healthInsurancePlanMemberId?: string | null }) =>
    api.post<Client>("/clients", input),
  update: (
    id: string,
    input: Partial<PartyInput> & { creditLimit?: number; isReseller?: boolean; isBusinessAccount?: boolean; healthInsurancePlanId?: string | null; healthInsurancePlanMemberId?: string | null },
  ) => api.patch<Client>(`/clients/${id}`, input),
};

// Capítulo 4.6 — Varejo Geral (Crediário/Fiado). Contratos reais de
// apps/api/src/modules/clients/credit-payments.routes.ts.
export interface ClientCreditStoreCreditSale {
  id: string;
  totalAmount: string;
  status: string;
  createdAt: string;
}

export interface ClientCreditPayment {
  id: string;
  amount: string;
  note: string | null;
  registeredByUserId: string;
  createdAt: string;
}

export interface ClientCreditStatement {
  client: { id: string; name: string };
  creditLimit: string;
  creditBalanceUsed: string;
  availableLimit: string;
  storeCreditSales: ClientCreditStoreCreditSale[];
  payments: ClientCreditPayment[];
}

export const clientCreditApi = {
  getStatement: (clientId: string) => api.get<ClientCreditStatement>(`/clients/${clientId}/credit-statement`),
  registerPayment: (clientId: string, input: { amount: number; note?: string | null }) =>
    api.post<{ payment: ClientCreditPayment; client: { creditLimit: string; creditBalanceUsed: string } }>(
      `/clients/${clientId}/credit-payments`,
      input,
    ),
};

export const suppliersApi = {
  list: (search?: string) => api.get<Supplier[]>("/suppliers", { search }),
  create: (input: PartyInput) => api.post<Supplier>("/suppliers", input),
  update: (id: string, input: Partial<PartyInput>) => api.patch<Supplier>(`/suppliers/${id}`, input),
};

export const productsApi = {
  list: () => api.get<ProductListItem[]>("/products"),
  get: (id: string) => api.get<ProductDetail>(`/products/${id}`),
  create: (input: ProductInput) => api.post<ProductDetail>("/products", input),
  update: (id: string, input: Partial<ProductInput>) => api.patch<ProductDetail>(`/products/${id}`, input),
  remove: (id: string) => api.delete(`/products/${id}`),
};

export const TRACKING_LABEL: Record<TrackingType, string> = {
  NONE: "Sem rastreio",
  BATCH: "Lote / validade",
  SERIAL: "Número de série",
  VARIANT: "Grade (variantes)",
};
