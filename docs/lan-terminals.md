# LAN terminals: Branch Server and Branch Terminals

One PC in the branch is the **Branch Server**. It holds the database. Every other counter is a **Branch Terminal**: it shows the server's screens and keeps no data of its own. Nothing here needs the internet.

## Set up the Branch Server

1. Install Mediescare on the server PC. In the first-run wizard choose **Branch Server**.
2. On the same wizard screen click **Allow through Windows Firewall** (Windows shows an administrator prompt; nothing changes unless you click). It opens TCP 3210 (the app) and UDP 3211 (discovery) for the **local network only**. Or run the two commands yourself in an administrator Command Prompt (they are shown in the wizard and in the Network menu):

   ```
   netsh advfirewall firewall add rule name=Mediescare-Server-TCP dir=in action=allow protocol=TCP localport=3210 remoteip=localsubnet profile=private,domain
   netsh advfirewall firewall add rule name=Mediescare-Discovery-UDP dir=in action=allow protocol=UDP localport=3211 remoteip=localsubnet profile=private,domain
   ```

   If 3210 was busy and the server picked the next free port, the menu shows the real port; use it in the first command.

3. Finish the normal first-run setup of the branch (owner, branch, recovery key).
4. Give the server PC a fixed address in the router (DHCP reservation) so terminals always find it.

Menu **Network** on the server:

- **Server address and pairing code**: shows the LAN addresses (`http://192.168.x.x:3210`) and creates a terminal pairing code. Sign in as an administrator in the window first (the code is created with your own session through `POST /api/sync/pairing-code`; the shell holds no credentials). The same code is available in Settings, Cloud sync and terminals, New terminal pairing code.
- **Allow through Windows Firewall**: the same opt-in button as in the wizard.

## Set up a Branch Terminal

1. Install Mediescare on the counter PC. In the wizard choose **Branch Terminal**.
2. The wizard searches the network (UDP) and lists the branch servers it hears: name, branch code, address. Pick yours. If none is listed, type the address (for example `192.168.1.10:3210`) and click **Use this address**; the wizard checks that a Branch Server answers there.
3. On the server create a pairing code (see above). Type the 8 digits on the terminal, optionally rename the counter, click **Pair**.
4. The terminal stores its device token sealed with the Windows credential store, saves `{ mode: terminal, serverUrl }` and opens the server's login page. Users sign in as usual.

The wizard is bilingual (English and Urdu, right to left for Urdu lines) and uses only the local network.

### Pairing code rules (unchanged by the wizard)

Eight digits, valid 10 minutes, works once, held hashed in server memory only, a new code replaces the old one, at most 5 codes per 10 minutes, 5 wrong guesses burn the code, 10 attempts a minute for the whole server. A used or wrong code gives the same answer.

## When the server is not reachable

A terminal that cannot reach its server within 5 seconds shows a **Branch server not reachable** page (not a blank window) with a checklist and:

- **Retry**: checks again and opens the app as soon as the server answers.
- **Re-pair with this server**: the wizard with the saved address filled in; needs a new pairing code (use it after the server was reinstalled or this counter was removed).
- **Change server**: the wizard from the search step.

While a terminal is open, menu **Network** has **Connected server** and **Re-pair or change server**. A successful re-pair restarts the app into the new setup; cancelling changes nothing.

## Troubleshooting

| Symptom                                       | Check                                                                                                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wizard lists no server                        | Firewall rules on the server (UDP 3211). Some routers block broadcast between Wi-Fi and cable ("client isolation"). Type the address instead.                                                      |
| "Cannot reach" for a typed address            | Same network? Server running and past first-run setup? TCP 3210 rule? Windows may call the shop network **Public**; the rules apply to Private and Domain networks, so set the network to Private. |
| "Not running as a Branch Server"              | That PC was installed as Single PC. Single PC listens on this PC only. Reinstall or reset its setup as Branch Server.                                                                              |
| "Wrong code or expired"                       | Create a new code on the server; type all 8 digits; codes work once.                                                                                                                               |
| "Too many attempts"                           | Wait a minute.                                                                                                                                                                                     |
| Server address changed after a router restart | Reserve a fixed address for the server in the router, then use **Change server** on each terminal.                                                                                                 |

## What is tested and what is not

Tested (automated, `pnpm --filter @mediescare/desktop test`, `apps/desktop/src/wizard-core.test.ts`): discovery list and failure handling, address validation (credentials, paths, non-branch-servers, unreachable), pairing against a loopback server (success, wrong code, reuse, rate limit, not a branch server), token stored sealed, config written atomically and only after a successful pairing, firewall commands and elevation wrapper, address and pairing-code dialog texts.

Tested by hand on one PC (`apps/desktop/scripts/manual-lan-check.mjs`, not part of the gate): a real Branch Server and a fresh Terminal as two Electron processes with separate data folders: wizard discovery over the PC's own LAN address, invalid and unreachable addresses, wrong code, real code, terminal loads the server login page, token sealed, used code refused, offline page with Retry and Change server.

**Not verified**: a real second PC and a real router; the Windows Firewall elevation prompt and the rules it adds (only the command text is unit tested); the menu dialogs (Server address and pairing code, Connected server, Re-pair from the menu, the app restart after it); the packaged installer; Urdu text appearance on a PC without an Urdu font; failover and standby.

Still not built: terminals do not yet authenticate their requests with the device token (users sign in with sessions as before); a screen to list and revoke terminal devices.
