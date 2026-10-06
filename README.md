# Fiori Centro de Estética — site

Site de alta conversão do **Fiori Centro de Estética** (Ingleses, Florianópolis): landing page com foco em agendamento pelo WhatsApp, formulário de captação de leads e backend seguro, sem dependências externas.

## Como rodar

Requer Node.js 20+.

```bash
npm start          # http://localhost:3000
npm run dev        # recarrega ao salvar
npm test           # testes do backend (node:test)
```

Configuração por variáveis de ambiente (veja `.env.example`):

| Variável | Para quê |
|---|---|
| `PORT`, `HOST` | Porta/interface do servidor |
| `SITE_URL` | URL pública (sitemap, robots.txt e verificação de origem do formulário) |
| `TRUST_PROXY` | `1` somente atrás de proxy reverso confiável (usa `X-Forwarded-For`) |
| `DATA_DIR` | Pasta onde os leads são gravados (`leads.jsonl`, permissão 600) |
| `LEAD_WEBHOOK_URL` | Opcional: webhook **HTTPS** que recebe cada lead (Zapier, Make, n8n, CRM) |
| `WHATSAPP_NUMBER` | Número da clínica com DDI (padrão `5548988365189`) |

Com Docker:

```bash
docker build -t fiori .
docker run -p 3000:3000 -e SITE_URL=https://www.seudominio.com.br -v fiori-data:/app/data fiori
```

## Estrutura

```
server.js            # inicialização do servidor HTTP e timeouts
src/app.js           # rotas: estáticos, /api/leads, robots.txt, sitemap.xml, /healthz
src/security.js      # cabeçalhos de segurança, CSP, rate limit, verificação de origem
src/leads.js         # validação, sanitização, gravação e webhook dos leads
src/static.js        # arquivos públicos carregados em memória, gzip/brotli, ETag
public/              # HTML, CSS, JS, fontes e imagens (tudo hospedado localmente)
test/                # testes automatizados
```

## Conversão

- CTA de WhatsApp em todas as seções, com **mensagem pré-preenchida por tratamento**.
- Botão flutuante (desktop) e barra fixa de ações no celular (Ligar · Agendar · Rota).
- Prova social logo no topo (5,0 no Google, 276 avaliações) e depoimentos reais.
- Formulário curto que salva o lead **e** abre o WhatsApp com a mensagem pronta. Se a API cair, o visitante é levado ao WhatsApp mesmo assim.
- FAQ para quebrar objeções, seção "como funciona" em 3 passos e localização com rota.
- Eventos no `window.dataLayer` (`cta_click`, `generate_lead`, `map_loaded`...) prontos para GA4/GTM/Meta Pixel. Ao adicionar esses scripts, libere os domínios deles na CSP em `src/security.js`.

## Segurança

- **Zero dependências npm**: nada de risco de cadeia de suprimentos.
- CSP restritiva (`script-src 'self'`, sem inline), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP.
- Arquivos estáticos servidos a partir de um mapa em memória: path traversal e exposição de dotfiles são impossíveis por construção.
- API de leads: verificação de `Origin` (CSRF), apenas `application/json`, limite de 4 KB no corpo, rate limit por IP, honeypot e checagem de tempo de preenchimento contra bots, validação e sanitização rígidas no servidor.
- Erros internos nunca são expostos ao cliente. Telefones aparecem mascarados nos logs.
- Timeouts contra slowloris e limites de cabeçalhos.
- LGPD: consentimento explícito, política de privacidade, mapa do Google carregado só após clique, fontes hospedadas localmente.

## Antes de publicar

1. Defina `SITE_URL` com o domínio final e publique atrás de HTTPS.
2. Adicione **fotos reais** do espaço e da equipe. É o que mais aumenta a conversão em estética. Não use fotos de "antes e depois" sem respeitar as regras do conselho profissional e do CONAR.
3. Confira horários, formas de pagamento e a lista de serviços com a clínica.
4. Atualize periodicamente a nota e o número de avaliações do Google.
