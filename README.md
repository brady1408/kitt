# KITT

LAN-only K.I.T.T. console for the Claude Code sessions on ubuntu-vm.

- `hub/` Bun server: KITT session + task sessions via the Claude Agent SDK, registry, SQLite, WebSocket protocol, serves `web/dist`.
- `channel/` MCP channel "spoke" that attaches an interactive `claude` session to the hub.
- `web/` Vite React console (design lives in `kitt-os-assistant`, ported by hand).

## Run

    bun install
    bun run web:build
    bun run hub            # http://<vm-ip>:7331

Dev loop for the UI: `bun run hub` in one terminal, `bun run web:dev` in another (port 5173 proxies `/ws`).

## Attach a terminal session

    claude mcp add --scope user kitt -- bun run ~/ws/kitt/channel/server.ts   # once
    ck                                                                       # = claude --dangerously-load-development-channels server:kitt

## Service

`deploy/kitt-hub.service` is a systemd user unit; see the file for install steps.

## Tests

    bun test
    bun run typecheck
