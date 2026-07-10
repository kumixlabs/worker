/**
 * Extended help text for the Forge Worker CLI.
 */

/**
 * Additional command examples and operational notes shown after `forge-worker --help`.
 */
export const cliHelpText = `
Examples:
  $ forge-worker init --token <token>                 Create config with dashboard/API token
  $ forge-worker init --dev                           Create local dev config and print auth URL
  $ forge-worker init --port 9000 --disk-limit 85     Update port and disk usage limit
  $ forge-worker init --timezone Asia/Jakarta         Update recurring schedule timezone
  $ forge-worker serve                                Start API + dashboard on 127.0.0.1
  $ forge-worker serve --host 0.0.0.0                 Expose API + dashboard on network
  $ forge-worker serve --port 9000 --dev              Start on custom port and print full token
  $ forge-worker status                               Show config, binaries, disk, and cache
  $ forge-worker doctor                               Run preflight checks
  $ forge-worker token                                Print masked token
  $ forge-worker token --show                         Print full token
  $ forge-worker token --regenerate                   Rotate token and print masked preview
  $ forge-worker update --check                       Check npm for newer worker version
  $ forge-worker update --restart                     Update and restart when safe
  $ forge-worker update --force                       Update and restart even with active streams
  $ forge-worker update --force --auto-start          Restart, then start previous active streams again
  $ forge-worker reset --yes                          Stop streams and clear database/cache
  $ forge-worker reset --force --yes                  Clear data despite active stream warnings
  $ forge-worker reset --all --yes                    Factory reset config and data

Commands:
  init       Create or update local config.
  serve      Run the local API, dashboard, scheduler, and stream recovery.
  status     Print local config, FFmpeg/FFprobe health, disk usage, and cache size.
  doctor     Run preflight checks for binaries, config, token, and disk limit.
  token      Print or rotate the local worker token.
  update     Update @tubeforge/worker from npm.
  reset      Stop active streams and delete worker data.

Security:
  Tokens are masked by default. Use --show only in a trusted terminal.
  Default host is 127.0.0.1. Use --host 0.0.0.0 only behind trusted network controls.

Data directory:
   Config, database, tombstones, and source cache live in ~/.forge-worker.
   Override with FORGE_WORKER_DATA_DIR.
   Restrict web API CORS with FORGE_WORKER_CORS_ORIGINS=https://app.example.com.

Dashboard:
  Run "forge-worker serve" then open the dashboard URL printed in the console.
`;
