// apps/web/src/modules/client-records/ClientRecordsPage.tsx
// Prontuários vinculados a Client: Pet/VaccineRecord (petshop/veterinária),
// Vehicle (oficina), VehicleListing (loja de seminovos) e OpticalPrescription (ótica).
import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SellIcon from "@mui/icons-material/Sell";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  petsApi,
  vehiclesApi,
  vehicleListingsApi,
  opticalPrescriptionsApi,
  VEHICLE_LISTING_STATUS_LABEL,
  type Pet,
  type Vehicle,
  type VehicleListing,
  type VehicleConsignmentPayout,
} from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";
import { ClientPicker } from "../../shared/lookups";
import type { Client } from "../registrations/api";
import { formatDate, money } from "../../shared/ui/format";

// ───────────────────────── Pets ─────────────────────────

function NewPetDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [owner, setOwner] = useState<Client | null>(null);
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("");
  const [breed, setBreed] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => petsApi.create({ ownerId: owner!.id, name: name.trim(), species: species.trim(), breed: breed.trim() || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pets"] });
      toast.success("Pet cadastrado.");
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Novo pet</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <ClientPicker value={owner} onChange={setOwner} label="Tutor (cliente)" required />
          <TextField label="Nome do pet" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <TextField label="Espécie" value={species} onChange={(e) => setSpecies(e.target.value)} required placeholder="Cão, gato…" />
          <TextField label="Raça (opcional)" value={breed} onChange={(e) => setBreed(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={create.isPending}
          onClick={() => {
            setError(null);
            if (!owner) return setError("Selecione o tutor.");
            if (!name.trim() || !species.trim()) return setError("Nome e espécie são obrigatórios.");
            create.mutate();
          }}
        >
          {create.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PetDetailDialog({ petId, onClose }: { petId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["pets", petId], queryFn: () => petsApi.get(petId) });
  const [vaccineName, setVaccineName] = useState("");
  const [appliedAt, setAppliedAt] = useState(new Date().toISOString().slice(0, 10));
  const [nextDoseDueAt, setNextDoseDueAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addVaccine = useMutation({
    mutationFn: () =>
      petsApi.addVaccineRecord(petId, {
        vaccineName: vaccineName.trim(),
        appliedAt: new Date(`${appliedAt}T12:00:00`).toISOString(),
        nextDoseDueAt: nextDoseDueAt ? new Date(`${nextDoseDueAt}T12:00:00`).toISOString() : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pets", petId] });
      toast.success("Vacina registrada.");
      setVaccineName("");
      setNextDoseDueAt("");
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Prontuário do pet</DialogTitle>
      <DialogContent>
        <QueryState query={query}>
          {(pet) => (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="h6">
                {pet.name} ({pet.species}
                {pet.breed ? `, ${pet.breed}` : ""})
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Tutor: {pet.owner.name}
              </Typography>

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Registrar vacina
                </Typography>
                {error && (
                  <Alert severity="error" sx={{ mb: 1 }}>
                    {error}
                  </Alert>
                )}
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <TextField label="Vacina" value={vaccineName} onChange={(e) => setVaccineName(e.target.value)} fullWidth />
                  <TextField
                    label="Aplicada em"
                    type="date"
                    value={appliedAt}
                    onChange={(e) => setAppliedAt(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label="Próxima dose"
                    type="date"
                    value={nextDoseDueAt}
                    onChange={(e) => setNextDoseDueAt(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                  <Button
                    variant="outlined"
                    disabled={addVaccine.isPending}
                    onClick={() => {
                      setError(null);
                      if (!vaccineName.trim()) return setError("Informe o nome da vacina.");
                      addVaccine.mutate();
                    }}
                  >
                    Registrar
                  </Button>
                </Stack>
              </Paper>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Vacina</TableCell>
                      <TableCell>Aplicada em</TableCell>
                      <TableCell>Próxima dose</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pet.vaccineRecords.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell>{v.vaccineName}</TableCell>
                        <TableCell>{formatDate(v.appliedAt)}</TableCell>
                        <TableCell>{formatDate(v.nextDoseDueAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          )}
        </QueryState>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

// Capítulo 11.3 — Petshop/Veterinária: CRM consolidado — tela única com histórico
// de vacinas, agendamentos (banho/tosa/consulta) e compras do tutor.
function PetCrmSummaryDialog({ petId, onClose }: { petId: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["pets", petId, "crm-summary"], queryFn: () => petsApi.crmSummary(petId) });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>CRM consolidado do pet</DialogTitle>
      <DialogContent>
        <QueryState query={query}>
          {(data) => (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="h6">{data.pet.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                Tutor: {data.pet.owner.name} · {data.pet.owner.phone ?? "sem telefone"} · {data.pet.owner.email ?? "sem e-mail"}
              </Typography>

              <Typography variant="subtitle2">Vacinas</Typography>
              {data.vaccineRecords.length === 0 ? (
                <Alert severity="info">Nenhuma vacina registrada.</Alert>
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Vacina</TableCell>
                        <TableCell>Aplicada em</TableCell>
                        <TableCell>Próxima dose</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.vaccineRecords.map((v) => (
                        <TableRow key={v.id}>
                          <TableCell>{v.vaccineName}</TableCell>
                          <TableCell>{formatDate(v.appliedAt)}</TableCell>
                          <TableCell>{formatDate(v.nextDoseDueAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              <Typography variant="subtitle2">Agendamentos (banho/tosa/consulta)</Typography>
              {data.appointments.length === 0 ? (
                <Alert severity="info">Nenhum agendamento registrado.</Alert>
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Data/hora</TableCell>
                        <TableCell>Serviço</TableCell>
                        <TableCell>Profissional</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.appointments.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>{formatDate(a.scheduledAt)}</TableCell>
                          <TableCell>{a.service?.name ?? "—"}</TableCell>
                          <TableCell>{a.professional?.name ?? "—"}</TableCell>
                          <TableCell>{a.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              <Typography variant="subtitle2">Compras do tutor</Typography>
              <Typography variant="caption" color="text.secondary">
                Sale não possui vínculo direto com Pet — o histórico abaixo é do tutor (dono do pet), não filtrado por item comprado para este pet especificamente.
              </Typography>
              {data.purchases.length === 0 ? (
                <Alert severity="info">Nenhuma compra registrada para o tutor.</Alert>
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Data</TableCell>
                        <TableCell align="right">Total</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.purchases.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>{formatDate(s.createdAt)}</TableCell>
                          <TableCell align="right">{money(s.totalAmount)}</TableCell>
                          <TableCell>{s.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Stack>
          )}
        </QueryState>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

function PetsTab() {
  const query = useQuery({ queryKey: ["pets"], queryFn: () => petsApi.list() });
  const [newOpen, setNewOpen] = useState(false);
  const [detail, setDetail] = useState<Pet | null>(null);
  const [crmSummaryPetId, setCrmSummaryPetId] = useState<string | null>(null);

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewOpen(true)}>
          Novo pet
        </Button>
      </Stack>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum pet cadastrado ainda.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Nome</TableCell>
                    <TableCell>Espécie</TableCell>
                    <TableCell>Raça</TableCell>
                    <TableCell>Nascimento</TableCell>
                    <TableCell align="right">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((p) => (
                    <TableRow key={p.id} hover sx={{ cursor: "pointer" }} onClick={() => setDetail(p)}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell>{p.species}</TableCell>
                      <TableCell>{p.breed ?? "—"}</TableCell>
                      <TableCell>{formatDate(p.birthDate)}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCrmSummaryPetId(p.id);
                          }}
                        >
                          CRM
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </QueryState>
      {newOpen && <NewPetDialog onClose={() => setNewOpen(false)} />}
      {detail && <PetDetailDialog petId={detail.id} onClose={() => setDetail(null)} />}
      {crmSummaryPetId && <PetCrmSummaryDialog petId={crmSummaryPetId} onClose={() => setCrmSummaryPetId(null)} />}
    </Stack>
  );
}

// ───────────────────────── Veículos ─────────────────────────

function NewVehicleDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [owner, setOwner] = useState<Client | null>(null);
  const [licensePlate, setLicensePlate] = useState("");
  const [model, setModel] = useState("");
  const [manufactureYear, setManufactureYear] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      vehiclesApi.create({
        ownerId: owner!.id,
        licensePlate: licensePlate.trim().toUpperCase(),
        model: model.trim(),
        manufactureYear: manufactureYear ? Number(manufactureYear) : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success("Veículo cadastrado.");
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Novo veículo</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <ClientPicker value={owner} onChange={setOwner} label="Proprietário (cliente)" required />
          <TextField label="Placa" value={licensePlate} onChange={(e) => setLicensePlate(e.target.value)} required autoFocus />
          <TextField label="Modelo" value={model} onChange={(e) => setModel(e.target.value)} required />
          <TextField label="Ano de fabricação" value={manufactureYear} onChange={(e) => setManufactureYear(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={create.isPending}
          onClick={() => {
            setError(null);
            if (!owner) return setError("Selecione o proprietário.");
            if (!licensePlate.trim() || !model.trim()) return setError("Placa e modelo são obrigatórios.");
            create.mutate();
          }}
        >
          {create.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function VehiclesTab() {
  const query = useQuery({ queryKey: ["vehicles"], queryFn: () => vehiclesApi.list() });
  const [newOpen, setNewOpen] = useState(false);

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewOpen(true)}>
          Novo veículo
        </Button>
      </Stack>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum veículo cadastrado ainda.">
        {(data: Vehicle[]) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Placa</TableCell>
                    <TableCell>Modelo</TableCell>
                    <TableCell>Ano</TableCell>
                    <TableCell align="right">KM</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((v) => (
                    <TableRow key={v.id} hover>
                      <TableCell>{v.licensePlate}</TableCell>
                      <TableCell>{v.model}</TableCell>
                      <TableCell>{v.manufactureYear ?? "—"}</TableCell>
                      <TableCell align="right">{v.mileageKm ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </QueryState>
      {newOpen && <NewVehicleDialog onClose={() => setNewOpen(false)} />}
    </Stack>
  );
}

// ───────────────────────── Veículos seminovos (VehicleListing) ─────────────────────────

function NewListingDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [chassisNumber, setChassisNumber] = useState("");
  const [model, setModel] = useState("");
  const [manufactureYear, setManufactureYear] = useState("");
  const [mileageKm, setMileageKm] = useState("");
  const [askingPrice, setAskingPrice] = useState("");
  // Capítulo 11.12 — consignação: veículo de terceiro anunciado na loja.
  const [consignor, setConsignor] = useState<Client | null>(null);
  const [commissionPct, setCommissionPct] = useState("");
  const [payoutAmount, setPayoutAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      vehicleListingsApi.create({
        chassisNumber: chassisNumber.trim(),
        model: model.trim(),
        manufactureYear: Number(manufactureYear),
        mileageKm: Number(mileageKm),
        askingPrice: Number(askingPrice),
        ...(consignor ? { consignorClientId: consignor.id, consignmentCommissionPercentage: Number(commissionPct) } : {}),
        ...(payoutAmount.trim() ? { consignorPayoutAmount: Number(payoutAmount) } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle-listings"] });
      toast.success("Anúncio criado.");
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Novo anúncio de veículo seminovo</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Chassi" value={chassisNumber} onChange={(e) => setChassisNumber(e.target.value)} required autoFocus />
          <TextField label="Modelo" value={model} onChange={(e) => setModel(e.target.value)} required />
          <Stack direction="row" spacing={2}>
            <TextField label="Ano" value={manufactureYear} onChange={(e) => setManufactureYear(e.target.value)} fullWidth />
            <TextField label="KM" value={mileageKm} onChange={(e) => setMileageKm(e.target.value)} fullWidth />
          </Stack>
          <TextField label="Preço pedido (R$)" value={askingPrice} onChange={(e) => setAskingPrice(e.target.value)} required />
          <Typography variant="subtitle2">Consignação (opcional — veículo de terceiro)</Typography>
          <ClientPicker value={consignor} onChange={setConsignor} label="Cliente consignante" />
          {consignor && (
            <Stack direction="row" spacing={2}>
              <TextField label="Comissão da loja (%)" value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} fullWidth />
              <TextField label="Repasse combinado ao consignante (R$)" value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} fullWidth />
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={create.isPending}
          onClick={() => {
            setError(null);
            if (!chassisNumber.trim() || !model.trim()) return setError("Chassi e modelo são obrigatórios.");
            if (!(Number(askingPrice) > 0)) return setError("Informe um preço válido.");
            if (consignor && !commissionPct.trim()) return setError("Veículo consignado exige percentual de comissão definido.");
            create.mutate();
          }}
        >
          {create.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Fecha a venda — se o veículo é consignado (consignorClientId preenchido),
// aceita o preço de venda/repasse final (pode divergir dos valores combinados no
// cadastro) e a documentação (ATPV-e/protocolo DETRAN), todos opcionais, pois o
// backend já aceita o valor que já estava no cadastro.
function MarkSoldDialog({ listing, onClose }: { listing: VehicleListing; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [actualSalePrice, setActualSalePrice] = useState(listing.actualSalePrice ?? listing.askingPrice ?? "");
  const [consignorPayoutAmount, setConsignorPayoutAmount] = useState(listing.consignorPayoutAmount ?? "");
  const [atpveIssuedAt, setAtpveIssuedAt] = useState("");
  const [detranCommunicationProtocol, setDetranCommunicationProtocol] = useState(listing.detranCommunicationProtocol ?? "");
  const [error, setError] = useState<string | null>(null);

  const markSold = useMutation({
    mutationFn: () =>
      vehicleListingsApi.markSold(listing.id, {
        ...(actualSalePrice.toString().trim() ? { actualSalePrice: Number(actualSalePrice) } : {}),
        ...(consignorPayoutAmount.toString().trim() ? { consignorPayoutAmount: Number(consignorPayoutAmount) } : {}),
        ...(atpveIssuedAt ? { atpveIssuedAt: new Date(atpveIssuedAt).toISOString() } : {}),
        ...(detranCommunicationProtocol.trim() ? { detranCommunicationProtocol: detranCommunicationProtocol.trim() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle-listings"] });
      toast.success("Veículo marcado como vendido.");
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Fechar venda — {listing.model} ({listing.chassisNumber})</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Preço efetivo de venda (R$)" value={actualSalePrice} onChange={(e) => setActualSalePrice(e.target.value)} />
          {listing.consignorClientId && (
            <TextField
              label="Valor de repasse ao consignante (R$)"
              value={consignorPayoutAmount}
              onChange={(e) => setConsignorPayoutAmount(e.target.value)}
              helperText="Preenchido ao fechar a venda gera o repasse a pagar (PENDING) — a loja nunca deve ao consignante antes disso."
            />
          )}
          <TextField label="ATPV-e emitida em" type="date" value={atpveIssuedAt} onChange={(e) => setAtpveIssuedAt(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField label="Protocolo de comunicação ao DETRAN" value={detranCommunicationProtocol} onChange={(e) => setDetranCommunicationProtocol(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={markSold.isPending}>
          Cancelar
        </Button>
        <Button variant="contained" disabled={markSold.isPending} onClick={() => markSold.mutate()}>
          {markSold.isPending ? "Fechando…" : "Confirmar venda"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ConsignmentPayoutCell({ listing }: { listing: VehicleListing }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const payoutQuery = useQuery({
    queryKey: ["vehicle-listing-payout", listing.id],
    queryFn: () => vehicleListingsApi.getConsignmentPayout(listing.id),
    enabled: Boolean(listing.consignorClientId) && listing.status === "SOLD",
  });
  const markPaid = useMutation({
    mutationFn: () => vehicleListingsApi.markPayoutPaid(listing.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle-listing-payout", listing.id] });
      toast.success("Repasse ao consignante marcado como pago.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!listing.consignorClientId) return <>—</>;
  if (listing.status !== "SOLD") return <>Consignado (ainda não vendido)</>;
  const payout: VehicleConsignmentPayout | null | undefined = payoutQuery.data;
  if (!payout) return <>{payoutQuery.isLoading ? "…" : "—"}</>;
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography variant="body2">{money(payout.payoutAmount)} — {payout.status === "PAID" ? "Pago" : "Pendente"}</Typography>
      {payout.status === "PENDING" && (
        <Button size="small" onClick={() => markPaid.mutate()} disabled={markPaid.isPending}>
          Marcar pago
        </Button>
      )}
    </Stack>
  );
}

export function VehicleListingsTab() {
  const query = useQuery({ queryKey: ["vehicle-listings"], queryFn: () => vehicleListingsApi.list() });
  const [newOpen, setNewOpen] = useState(false);
  const [markSoldFor, setMarkSoldFor] = useState<VehicleListing | null>(null);

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewOpen(true)}>
          Novo anúncio
        </Button>
      </Stack>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhum veículo anunciado ainda.">
        {(data: VehicleListing[]) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Chassi</TableCell>
                    <TableCell>Modelo</TableCell>
                    <TableCell>Ano</TableCell>
                    <TableCell align="right">Preço</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Repasse consignação</TableCell>
                    <TableCell align="right">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((l) => (
                    <TableRow key={l.id} hover>
                      <TableCell>{l.chassisNumber}</TableCell>
                      <TableCell>{l.model}</TableCell>
                      <TableCell>{l.manufactureYear}</TableCell>
                      <TableCell align="right">{money(l.askingPrice)}</TableCell>
                      <TableCell>{VEHICLE_LISTING_STATUS_LABEL[l.status]}</TableCell>
                      <TableCell>
                        <ConsignmentPayoutCell listing={l} />
                      </TableCell>
                      <TableCell align="right">
                        {l.status !== "SOLD" && (
                          <Button size="small" startIcon={<SellIcon />} onClick={() => setMarkSoldFor(l)}>
                            Marcar vendido
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </QueryState>
      {newOpen && <NewListingDialog onClose={() => setNewOpen(false)} />}
      {markSoldFor && <MarkSoldDialog listing={markSoldFor} onClose={() => setMarkSoldFor(null)} />}
    </Stack>
  );
}

// ───────────────────────── Ótica (OpticalPrescription) ─────────────────────────

function NewPrescriptionDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [client, setClient] = useState<Client | null>(null);
  const [prescribingDoctor, setPrescribingDoctor] = useState("");
  // Capítulo 11.2 — Ótica (Decreto 24.492/1934): livro de registro de receitas exige
  // identificação do CRM/CRO do prescritor e o endereço do cliente no momento do registro.
  const [doctorRegistrationNumber, setDoctorRegistrationNumber] = useState("");
  const [clientAddressSnapshot, setClientAddressSnapshot] = useState("");
  const [rightEyeSphere, setRightEyeSphere] = useState("");
  const [rightEyeCylinder, setRightEyeCylinder] = useState("");
  const [rightEyeAxis, setRightEyeAxis] = useState("");
  const [leftEyeSphere, setLeftEyeSphere] = useState("");
  const [leftEyeCylinder, setLeftEyeCylinder] = useState("");
  const [leftEyeAxis, setLeftEyeAxis] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      opticalPrescriptionsApi.create({
        clientId: client!.id,
        prescribingDoctor: prescribingDoctor.trim(),
        doctorRegistrationNumber: doctorRegistrationNumber.trim(),
        clientAddressSnapshot: clientAddressSnapshot.trim(),
        rightEyeSphere: Number(rightEyeSphere),
        rightEyeCylinder: Number(rightEyeCylinder),
        rightEyeAxis: Number(rightEyeAxis),
        leftEyeSphere: Number(leftEyeSphere),
        leftEyeCylinder: Number(leftEyeCylinder),
        leftEyeAxis: Number(leftEyeAxis),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["optical-prescriptions"] });
      toast.success("Receita registrada.");
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nova receita de grau</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <ClientPicker value={client} onChange={setClient} label="Cliente" required />
          <TextField label="Médico prescritor" value={prescribingDoctor} onChange={(e) => setPrescribingDoctor(e.target.value)} required />
          <TextField
            label="CRM/CRO do prescritor"
            value={doctorRegistrationNumber}
            onChange={(e) => setDoctorRegistrationNumber(e.target.value)}
            required
            helperText="Decreto 24.492/1934 — identificação do profissional no livro de registro de receitas."
          />
          <TextField
            label="Endereço do cliente"
            value={clientAddressSnapshot}
            onChange={(e) => setClientAddressSnapshot(e.target.value)}
            required
            helperText="Registrado no momento da receita (exigência do livro de registro)."
          />
          <Typography variant="subtitle2">Olho direito</Typography>
          <Stack direction="row" spacing={2}>
            <TextField label="Esférico" value={rightEyeSphere} onChange={(e) => setRightEyeSphere(e.target.value)} fullWidth />
            <TextField label="Cilíndrico" value={rightEyeCylinder} onChange={(e) => setRightEyeCylinder(e.target.value)} fullWidth />
            <TextField label="Eixo" value={rightEyeAxis} onChange={(e) => setRightEyeAxis(e.target.value)} fullWidth />
          </Stack>
          <Typography variant="subtitle2">Olho esquerdo</Typography>
          <Stack direction="row" spacing={2}>
            <TextField label="Esférico" value={leftEyeSphere} onChange={(e) => setLeftEyeSphere(e.target.value)} fullWidth />
            <TextField label="Cilíndrico" value={leftEyeCylinder} onChange={(e) => setLeftEyeCylinder(e.target.value)} fullWidth />
            <TextField label="Eixo" value={leftEyeAxis} onChange={(e) => setLeftEyeAxis(e.target.value)} fullWidth />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={create.isPending}
          onClick={() => {
            setError(null);
            if (!client) return setError("Selecione o cliente.");
            if (!prescribingDoctor.trim()) return setError("Informe o médico prescritor.");
            if (!doctorRegistrationNumber.trim()) return setError("Informe o CRM/CRO do prescritor.");
            if (!clientAddressSnapshot.trim()) return setError("Informe o endereço do cliente.");
            const values = [rightEyeSphere, rightEyeCylinder, rightEyeAxis, leftEyeSphere, leftEyeCylinder, leftEyeAxis];
            if (values.some((v) => v.trim() === "" || Number.isNaN(Number(v)))) {
              return setError("Preencha todos os valores de grau com números válidos.");
            }
            create.mutate();
          }}
        >
          {create.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function OpticalPrescriptionsTab() {
  const query = useQuery({ queryKey: ["optical-prescriptions"], queryFn: () => opticalPrescriptionsApi.list() });
  const [newOpen, setNewOpen] = useState(false);

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewOpen(true)}>
          Nova receita
        </Button>
      </Stack>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyMessage="Nenhuma receita registrada ainda.">
        {(data) => (
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Nº receita</TableCell>
                    <TableCell>Data</TableCell>
                    <TableCell>Médico (CRM/CRO)</TableCell>
                    <TableCell>OD (Esf/Cil/Eixo)</TableCell>
                    <TableCell>OE (Esf/Cil/Eixo)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.prescriptionNumber}</TableCell>
                      <TableCell>{formatDate(p.registeredAt)}</TableCell>
                      <TableCell>
                        {p.prescribingDoctor} ({p.doctorRegistrationNumber})
                      </TableCell>
                      <TableCell>
                        {p.rightEyeSphere}/{p.rightEyeCylinder}/{p.rightEyeAxis}
                      </TableCell>
                      <TableCell>
                        {p.leftEyeSphere}/{p.leftEyeCylinder}/{p.leftEyeAxis}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </QueryState>
      {newOpen && <NewPrescriptionDialog onClose={() => setNewOpen(false)} />}
    </Stack>
  );
}

export function ClientRecordsPage() {
  const [tab, setTab] = useState(0);
  return (
    <Page>
      <PageHeader title="Prontuários de clientes" subtitle="Pet e receita óptica, vinculados a um Client. Veículos (oficina) e veículos seminovos (consignação) têm telas dedicadas em seus próprios menus de nicho." />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Pets" />
        <Tab label="Receitas ópticas" />
      </Tabs>
      {tab === 0 && <PetsTab />}
      {tab === 1 && <OpticalPrescriptionsTab />}
    </Page>
  );
}

// ───────────────────────── Telas dedicadas por nicho ─────────────────────────
// GAP DE AUDITORIA FECHADO (nicho-ui-dedicada): Veículos (Oficina Mecânica) e
// Veículos seminovos (Loja de Veículos) antes viviam escondidos como abas dentro
// da tela genérica "Prontuários", compartilhada com Pets/Receitas ópticas — um
// tenant de Oficina via abas de Pet/Ótica irrelevantes, e vice-versa. Cada nicho
// agora tem sua própria rota e item de menu dedicados (ver navigation.tsx).

export function VehiclesRecordsPage() {
  return (
    <Page>
      <PageHeader title="Veículos de clientes" subtitle="Cadastro de veículos vinculados a um Client, usado nas Ordens de Serviço da Oficina Mecânica/Autoelétrica." />
      <VehiclesTab />
    </Page>
  );
}

export function VehicleListingsPage() {
  return (
    <Page>
      <PageHeader title="Estoque de veículos seminovos" subtitle="Anúncios de veículos próprios ou em consignação, com baixa automática e cálculo de repasse ao consignante na venda." />
      <VehicleListingsTab />
    </Page>
  );
}
