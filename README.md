# metro-traces

Metro Traces is now a SvelteKit app managed with Bun.

## Setup

```bash
bun install
bun run dev
```

## Build

```bash
bun run build
```

## Notes

- The live vehicle feed is decoded from `https://svc.metrotransit.org/mtgtfs/vehiclepositions.pb` using `protobufjs`.
- The old static `index.html`, `app.js`, and `style.css` entrypoints have been replaced by the SvelteKit app under `src/`.