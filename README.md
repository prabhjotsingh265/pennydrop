# Pennydrop

Price monitoring that notices when a shop redesigns its page, and keeps going.

Work in progress. Built so far:

| Part                                   | What it does                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/extract`](packages/extract) | Reads a product's price five ways (JSON-LD, microdata, meta tags, a saved selector, and heuristics that read the page like a person) and decides between them. When a shop redesigns and the saved selector breaks, it writes a new one. Parses prices as shops write them worldwide: `1.299,99 €`, `₹1,29,999`, `CHF 1'299.90` |
| [`packages/fetch`](packages/fetch)     | Fetches pages politely and safely: robots.txt per RFC 9309, cleaned addresses, timeouts, size limits (including after decompression), and a guard that refuses private network addresses on every hop                                                                                                                           |
| [`apps/fetcher`](apps/fetcher)         | Checks a product end to end: plain HTTP first, a real Chromium only when the price is written by JavaScript. The browser's traffic goes through a local proxy that applies the same address guard                                                                                                                               |
| [`apps/shop`](apps/shop)               | A practice shop built to change and to break: three layouts, three personalities (healthy, slow, failing), and controls to switch them                                                                                                                                                                                          |
| [`apps/web`](apps/web)                 | The React app; for now, the design prototype at `/prototype`                                                                                                                                                                                                                                                                    |
| [`apps/api`](apps/api)                 | The Fastify API; for now, a health check                                                                                                                                                                                                                                                                                        |

## Run it locally

Everything runs in Docker, so Docker is the only thing to install.

```sh
make setup   # first time: build, install packages, start everything
make up      # start
make down    # stop
make check   # formatting, lint, type checks and tests, as CI runs them
make help    # every command
```

| Address                          | What's there                                        |
| -------------------------------- | --------------------------------------------------- |
| <http://localhost:3000>          | The app                                             |
| <http://localhost:3001>          | The API (the app reaches it through `/api`)         |
| <http://localhost:8026>          | Mailpit: every email the app sends lands here       |
| <http://fickle.localhost:4000>   | The practice shop, healthy                          |
| <http://slowpoke.localhost:4000> | The same shop, slow on purpose                      |
| <http://brittle.localhost:4000>  | The same shop, failing on purpose                   |
| `/_chaos` on any shop            | Controls that change its layout, speed and failures |
| `localhost:55433`                | PostgreSQL, for a database GUI                      |
