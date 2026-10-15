// apps/web/src/modules/notifications/NotificationSettingsPage.tsx
// Fonte: BIBLE_ENGINEERING_V2.md, Capítulo 8.4 (preferências) + 20.2/20.8 (canais
// reais de WhatsApp/e-mail) — GAP DE AUDITORIA FECHADO: o backend
// (notification-settings.routes.ts) já tinha CRUD completo de preferências e
// dispositivos push, mas nenhuma tela em apps/web/src jamais existiu para isso.
//
// Push (Expo push tokens) é exclusivo de apps mobile construídos com Expo — não há
// nenhuma infraestrutura de Web Push (service worker + VAPID/PushManager) neste
// repositório web (confirmado por busca antes de escrever esta página). Por isso o
// toggle "push" é mostrado aqui apenas como leitura/desabilitado com uma nota
// honesta, nunca como um botão de "registrar este navegador" que fingiria
// funcionar sem a infra real por trás.
import { useEffect, useState } from "react";
import { Alert, Button, Divider, Paper, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABEL,
  NotificationCategory,
  notificationSettingsApi,
  userContactApi,
} from "./api";
import { Page, PageHeader, QueryState, errorMessage } from "../../shared/ui/PageLayout";
import { useToast } from "../../shared/ui/Toast";

export function NotificationSettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const preferencesQuery = useQuery({ queryKey: ["notification-preferences"], queryFn: notificationSettingsApi.listPreferences });
  const contactQuery = useQuery({ queryKey: ["user-contact"], queryFn: userContactApi.getContact });

  useEffect(() => {
    if (contactQuery.data) {
      setWhatsappPhone(contactQuery.data.whatsappPhone ?? "");
    }
  }, [contactQuery.data]);

  const updatePreference = useMutation({
    mutationFn: ({ category, channel, value }: { category: NotificationCategory; channel: "inApp" | "email" | "whatsapp" | "sms"; value: boolean }) =>
      notificationSettingsApi.updatePreference(category, { [channel]: value }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveContact = useMutation({
    mutationFn: () => userContactApi.setWhatsappPhone(whatsappPhone.trim() === "" ? null : whatsappPhone.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["user-contact"] });
      toast.success("Telefone de WhatsApp salvo com sucesso.");
      setPhoneError(null);
    },
    onError: (error) => setPhoneError(errorMessage(error)),
  });

  return (
    <Page>
      <PageHeader
        title="Notificações"
        subtitle="Escolha por qual canal você quer receber cada tipo de aviso — gravado por usuário (Capítulo 8.4)."
      />

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Telefone para WhatsApp
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Formato internacional E.164, ex.: +5511999998888. Necessário para ativar os canais "WhatsApp" e "SMS" abaixo (o SMS reaproveita o mesmo número).
        </Typography>
        {phoneError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {phoneError}
          </Alert>
        )}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
          <TextField
            label="WhatsApp (E.164)"
            value={whatsappPhone}
            onChange={(e) => setWhatsappPhone(e.target.value)}
            placeholder="+5511999998888"
            size="small"
            sx={{ minWidth: 260 }}
          />
          <Button variant="contained" disabled={saveContact.isPending} onClick={() => saveContact.mutate()}>
            {saveContact.isPending ? "Salvando…" : "Salvar telefone"}
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Canais por categoria
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          "No app" é sempre gravado (não pode ser desligado aqui); os demais canais disparam o envio real quando ligados.
          Push por navegador ainda não está disponível nesta tela — é exclusivo do app mobile (Expo), que usa dispositivos
          próprios registrados por lá.
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <QueryState query={preferencesQuery}>
          {(preferences) => {
            const byCategory = new Map(preferences.map((p) => [p.category, p]));
            return (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Categoria</TableCell>
                    <TableCell align="center">No app</TableCell>
                    <TableCell align="center">E-mail</TableCell>
                    <TableCell align="center">WhatsApp</TableCell>
                    <TableCell align="center">SMS</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {NOTIFICATION_CATEGORIES.map((category) => {
                    const pref = byCategory.get(category);
                    return (
                      <TableRow key={category}>
                        <TableCell>{NOTIFICATION_CATEGORY_LABEL[category]}</TableCell>
                        <TableCell align="center">
                          <Switch checked={pref?.inApp ?? true} disabled />
                        </TableCell>
                        <TableCell align="center">
                          <Switch
                            checked={pref?.email ?? true}
                            disabled={updatePreference.isPending}
                            onChange={(e) => updatePreference.mutate({ category, channel: "email", value: e.target.checked })}
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Switch
                            checked={pref?.whatsapp ?? false}
                            disabled={updatePreference.isPending}
                            onChange={(e) => updatePreference.mutate({ category, channel: "whatsapp", value: e.target.checked })}
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Switch
                            checked={pref?.sms ?? false}
                            disabled={updatePreference.isPending}
                            onChange={(e) => updatePreference.mutate({ category, channel: "sms", value: e.target.checked })}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            );
          }}
        </QueryState>
      </Paper>
    </Page>
  );
}
