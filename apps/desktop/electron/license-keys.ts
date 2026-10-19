// apps/desktop/electron/license-keys.ts
// Chave PÚBLICA (RS256) usada para verificar a assinatura do token de licença offline
// emitido por apps/api (ver apps/api/src/modules/licensing/license-token.service.ts,
// mesmo par de chaves do Capítulo 3.5, issuer "filitech-license"). É a chave pública —
// seguro embutir no binário distribuído; a privada NUNCA sai do backend.
//
// O valor abaixo é o par de DESENVOLVIMENTO (apps/api/keys/jwt-public.pem) — suficiente
// para validar tokens emitidos por uma instância local/dev da API durante testes deste
// shell. Em um build de produção real, substitua via variável de ambiente
// `FILITECH_LICENSE_PUBLIC_KEY` (conteúdo PEM, com `\n` escapado se vier de uma única
// linha) apontando para a chave pública do ambiente de produção — nunca reaproveite a
// chave de dev para assinar licenças de clientes reais.
const DEV_LICENSE_PUBLIC_KEY = `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEAkmma6FXa/oXhNz034NQmzSZ30NE5YDnk0uuHppim4Vfcwk0iI7mS
T7JwKew5asOpQy2a97QPXrhtBgCmZkhQ3vwiiOKWpWwQh0ct4F2A9041sht8E7Fg
qsXNSarisTiVKz9mB7RnRaCgmcbg98yQ4dQzYWzNtxn8EeMN9ZV9vyUmuwiFpi+I
9WkoUwS6kf1EDRsIsPWqdav1e9WMsx+IOFRa+D08oBhUd0roNDrJ6diiNcMxle47
EV2DUreZozVMoli6sMb1bBMY4T7GvfbTXtcjq+Oucmw75cqcmdCntRy3BLy3mxk7
B2t51lAql0G+NQkGmOIzqUzv5z2by1juAQIDAQAB
-----END RSA PUBLIC KEY-----
`;

export const LICENSE_PUBLIC_KEY = process.env.FILITECH_LICENSE_PUBLIC_KEY
  ? process.env.FILITECH_LICENSE_PUBLIC_KEY.replace(/\\n/g, "\n")
  : DEV_LICENSE_PUBLIC_KEY;
