# Finance Pattern Engine — API Worker

Backend MVP per API key, quote giornaliere, statistiche aggregate e livelli Free/Premium. Il sito GitHub Pages rimane statico; questo Worker deve essere distribuito separatamente su Cloudflare Workers con D1.

## Funzioni incluse

- `GET /health`: health check.
- `GET /v1/coins`: feed protetto da header `x-api-key`.
- `GET /v1/usage`: statistiche degli ultimi 30 giorni per la chiave autenticata.
- `GET /v1/watchlist`: scarica una watchlist privata tramite header `x-watchlist-key`.
- `PUT /v1/watchlist`: salva fino a 100 ticker nella watchlist privata; il codice è generato dal browser e sul server viene conservato solo il suo hash SHA-256.
- `POST /admin/keys`: crea una chiave (la chiave completa viene mostrata una sola volta).
- `GET /admin/keys`: elenco chiavi senza segreti.
- `POST /admin/keys/{id}/revoke`: revoca una chiave.
- `GET /admin/stats`: richieste giornaliere aggregate e ripartizione Free/Premium.
- Limite giornaliero: Free 1.000 richieste; Premium 100.000 richieste.
- Le chiavi sono conservate come hash SHA-256, non in chiaro.

## Deploy

1. Crea un account Cloudflare e un database D1 chiamato `fpe-api`.
2. Dalla cartella `api-worker` esegui:
   ```sh
   npx wrangler d1 create fpe-api
   ```
3. Inserisci il valore `database_id` restituito in `wrangler.toml`.
4. Applica lo schema:
   ```sh
   npx wrangler d1 execute fpe-api --file=schema.sql
   ```
5. Imposta il segreto amministrativo e pubblica:
   ```sh
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler deploy
   ```
6. Aggiorna la documentazione con il dominio Worker assegnato (ad esempio `https://api.tuodominio.workers.dev`).

## Creare una chiave

```sh
curl -X POST "https://YOUR-WORKER.workers.dev/admin/keys" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"Nome sviluppatore","plan":"free"}'
```

Per assegnare Premium, usa `"plan":"premium"`. La chiave completa appare solo nella risposta di creazione: consegnala in modo sicuro allo sviluppatore.

## Statistiche e revoca

```sh
curl "https://YOUR-WORKER.workers.dev/admin/stats" -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
curl "https://YOUR-WORKER.workers.dev/admin/keys" -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
curl -X POST "https://YOUR-WORKER.workers.dev/admin/keys/KEY_ID/revoke" -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
curl "https://YOUR-WORKER.workers.dev/v1/usage" -H "x-api-key: fpe_live_YOUR_KEY"
```

## Stato e limiti attuali

Questo è un MVP backend con emissione amministrativa delle chiavi. Non è ancora un portale self-service: registrazione utenti, verifica email, checkout/abbonamento Stripe, rinnovi e downgrade automatici richiedono integrazione e configurazione di account/secret esterni. Nessuna chiave o pagamento è attivo finché il Worker non viene distribuito e configurato. Il contatore D1 applica il tetto giornaliero, ma per protezione avanzata da picchi/abusi si raccomanda Cloudflare Rate Limiting. Il piano Premium è assegnato manualmente dall'amministratore finché non viene collegato Stripe.


### Sincronizzazione watchlist privata

Il sito genera un codice casuale `fpe_watch_...` nel browser. Il codice funziona come una password: chi lo possiede può leggere e sovrascrivere la watchlist associata. Il Worker conserva solo l'hash SHA-256 del codice e i ticker, non il codice in chiaro. Non condividerlo pubblicamente.

Dopo il deploy del Worker e l'applicazione dello schema D1 aggiornato, apri la pagina Mercati, espandi "Configura sincronizzazione tra dispositivi", inserisci l'URL HTTPS del Worker, genera un codice e premi "Carica watchlist". Sugli altri dispositivi inserisci lo stesso URL e codice, poi premi "Scarica watchlist". Il codice rimane salvato nel browser locale; usa "Copia codice" per trasferirlo in modo sicuro.

La sincronizzazione cloud non è disponibile finché il Worker non è distribuito e il database D1 aggiornato. Senza questo passaggio, la watchlist locale continua a funzionare sul singolo browser.

Non inserire mai `ADMIN_TOKEN` nel sito statico, in Git o nel browser.
