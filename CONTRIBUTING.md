# Contributing

Thanks for helping improve these samples.

## What belongs here

Small, dependency-free examples of calling AI Server's HTTP API that a developer can read in one sitting.
A change earns its place if it makes the API easier to adopt.

Please **don't** add: framework scaffolding, package managers where the standard library will do, or
abstractions shared between languages — each file is meant to be readable and copy-pasteable on its own.

## Ground rules

- **No secrets.** No API keys, hostnames or personal data in code, comments, tests or screenshots.
  Configuration comes from `AISERVER_BASE_URL` / `AISERVER_API_KEY` / `AISERVER_MODEL`.
- **Run it before you send it.** Every sample must work against a real AI Server. Say in your PR which
  endpoints you exercised and which model you used.
- **Keep the client contract.** Any new sample must still handle 401, `429` + `X-AISuite-Upgrade`,
  `429`/`503` + `Retry-After`, and stream responses rather than buffering them.
- **Match the house style** of the file you're editing, and keep each sample roughly under 150 lines.

## Adding a new language

Mirror `python/chat.py`: discover models, stream a completion, handle the errors above, read the same
three environment variables. Add a row to the table in `README.md`.

## Licence

Contributions are accepted under the [MIT Licence](LICENSE).
