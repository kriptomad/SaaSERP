// apps/web/src/modules/client-records/api.ts
// Contratos reais de apps/api/src/modules/client-records/client-records.routes.ts.
import { api } from "../../api/client";

export interface Pet {
  id: string;
  tenantId: string;
  ownerId: string;
  name: string;
  species: string;
  breed: string | null;
  birthDate: string | null;
  weightKg: string | null;
}

export interface VaccineRecord {
  id: string;
  tenantId: string;
  petId: string;
  vaccineName: string;
  appliedAt: string;
  nextDoseDueAt: string | null;
  appliedByUserId: string;
  reminderSentAt: string | null;
}

// Capítulo 11.3 — Petshop/Veterinária: CRM consolidado do pet (vacinas + agenda +
// compras do tutor — Sale não tem FK direta para Pet, ver comentário no backend).
export interface PetCrmSummary {
  pet: Pet & { owner: { id: string; name: string; phone: string | null; email: string | null } };
  vaccineRecords: VaccineRecord[];
  appointments: Array<{
    id: string;
    scheduledAt: string;
    status: string;
    service: { id: string; name: string } | null;
    professional: { id: string; name: string } | null;
  }>;
  purchases: Array<{
    id: string;
    createdAt: string;
    totalAmount: string;
    status: string;
    items: Array<{ id: string; productId: string | null; serviceId: string | null; quantity: string; totalPrice: string }>;
  }>;
}

export interface PetInput {
  ownerId: string;
  name: string;
  species: string;
  breed?: string;
  birthDate?: string;
  weightKg?: number;
}

export interface Vehicle {
  id: string;
  tenantId: string;
  ownerId: string;
  licensePlate: string;
  chassisNumber: string | null;
  model: string;
  manufactureYear: number | null;
  mileageKm: number | null;
}

export interface VehicleInput {
  ownerId: string;
  licensePlate: string;
  chassisNumber?: string;
  model: string;
  manufactureYear?: number;
  mileageKm?: number;
}

export type VehicleListingStatus = "AVAILABLE" | "RESERVED" | "SOLD" | "CONSIGNED";

export interface VehicleListing {
  id: string;
  tenantId: string;
  chassisNumber: string;
  licensePlate: string | null;
  model: string;
  manufactureYear: number;
  mileageKm: number;
  askingPrice: string;
  status: VehicleListingStatus;
  consignorClientId: string | null;
  consignmentCommissionPercentage: string | null;
  // Capítulo 11.12 — consignação/documentação (preenchidos no cadastro ou só na venda).
  consignorPayoutAmount: string | null;
  actualSalePrice: string | null;
  atpveIssuedAt: string | null;
  detranCommunicationProtocol: string | null;
  soldAt: string | null;
}

export interface VehicleListingInput {
  chassisNumber: string;
  licensePlate?: string;
  model: string;
  manufactureYear: number;
  mileageKm: number;
  askingPrice: number;
  consignorClientId?: string;
  consignmentCommissionPercentage?: number;
  consignorPayoutAmount?: number;
  actualSalePrice?: number;
  atpveIssuedAt?: string;
  detranCommunicationProtocol?: string;
}

export type VehicleConsignmentPayoutStatus = "PENDING" | "PAID";

// Capítulo 11.12 — repasse ao consignante, criado SOMENTE no momento da venda
// efetiva (mark-sold), nunca antes.
export interface VehicleConsignmentPayout {
  id: string;
  tenantId: string;
  vehicleListingId: string;
  consignorClientId: string;
  payoutAmount: string;
  status: VehicleConsignmentPayoutStatus;
  paidAt: string | null;
  createdAt: string;
}

export interface MarkSoldInput {
  actualSalePrice?: number;
  consignorPayoutAmount?: number;
  atpveIssuedAt?: string;
  detranCommunicationProtocol?: string;
}

export interface OpticalPrescription {
  id: string;
  tenantId: string;
  clientId: string;
  prescriptionNumber: number;
  prescribingDoctor: string;
  doctorRegistrationNumber: string;
  clientAddressSnapshot: string;
  rightEyeSphere: string;
  rightEyeCylinder: string;
  rightEyeAxis: number;
  leftEyeSphere: string;
  leftEyeCylinder: string;
  leftEyeAxis: number;
  addition: string | null;
  pupillaryDistance: string | null;
  registeredAt: string;
}

export interface OpticalPrescriptionInput {
  clientId: string;
  prescribingDoctor: string;
  doctorRegistrationNumber: string;
  clientAddressSnapshot: string;
  rightEyeSphere: number;
  rightEyeCylinder: number;
  rightEyeAxis: number;
  leftEyeSphere: number;
  leftEyeCylinder: number;
  leftEyeAxis: number;
  addition?: number;
  pupillaryDistance?: number;
}

export const petsApi = {
  list: (ownerId?: string) => api.get<Pet[]>("/pets", { ownerId }),
  get: (id: string) => api.get<Pet & { vaccineRecords: VaccineRecord[]; owner: { id: string; name: string } }>(`/pets/${id}`),
  create: (input: PetInput) => api.post<Pet>("/pets", input),
  update: (id: string, input: Partial<PetInput>) => api.patch<Pet>(`/pets/${id}`, input),
  vaccineRecords: (petId: string) => api.get<VaccineRecord[]>(`/pets/${petId}/vaccine-records`),
  addVaccineRecord: (petId: string, input: { vaccineName: string; appliedAt: string; nextDoseDueAt?: string }) =>
    api.post<VaccineRecord>(`/pets/${petId}/vaccine-records`, input),
  // Capítulo 11.3 — CRM consolidado: vacinas + agenda + compras do tutor numa só tela.
  crmSummary: (petId: string) => api.get<PetCrmSummary>(`/pets/${petId}/crm-summary`),
};

export const vehiclesApi = {
  list: (params?: { ownerId?: string; licensePlate?: string }) => api.get<Vehicle[]>("/vehicles", params),
  get: (id: string) => api.get<Vehicle & { owner: { id: string; name: string }; workOrders: Array<{ id: string; status: string; createdAt: string }> }>(`/vehicles/${id}`),
  create: (input: VehicleInput) => api.post<Vehicle>("/vehicles", input),
  update: (id: string, input: Partial<VehicleInput>) => api.patch<Vehicle>(`/vehicles/${id}`, input),
};

export const vehicleListingsApi = {
  list: (status?: VehicleListingStatus) => api.get<VehicleListing[]>("/vehicle-listings", { status }),
  get: (id: string) => api.get<VehicleListing & { consignorClient: { id: string; name: string } | null }>(`/vehicle-listings/${id}`),
  create: (input: VehicleListingInput) => api.post<VehicleListing>("/vehicle-listings", input),
  update: (id: string, input: Partial<VehicleListingInput>) => api.patch<VehicleListing>(`/vehicle-listings/${id}`, input),
  markSold: (id: string, input?: MarkSoldInput) => api.patch<{ listing: VehicleListing; payout: VehicleConsignmentPayout | null }>(`/vehicle-listings/${id}/mark-sold`, input ?? {}),
  markPayoutPaid: (id: string) => api.patch<VehicleConsignmentPayout>(`/vehicle-listings/${id}/mark-payout-paid`),
  getConsignmentPayout: (id: string) => api.get<VehicleConsignmentPayout | null>(`/vehicle-listings/${id}/consignment-payout`),
};

export const opticalPrescriptionsApi = {
  list: (clientId?: string) => api.get<OpticalPrescription[]>("/optical-prescriptions", { clientId }),
  create: (input: OpticalPrescriptionInput) => api.post<OpticalPrescription>("/optical-prescriptions", input),
};

export const VEHICLE_LISTING_STATUS_LABEL: Record<VehicleListingStatus, string> = {
  AVAILABLE: "Disponível",
  RESERVED: "Reservado",
  SOLD: "Vendido",
  CONSIGNED: "Consignado",
};
