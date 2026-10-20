# Pennydrop

Price monitoring that notices when a shop redesigns its page, and keeps going.

Work in progress.

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
