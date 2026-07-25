/**
 * Extended help text for the Kumix Worker CLI.
 */

/**
 * Additional command examples and operational notes shown after `kumix-worker --help`.
 */
export const cliHelpText = `
Examples:
  $ kumix-worker init --token <token>                 Create config with API token
  $ kumix-worker init --dev                           Create local dev config
  $ kumix-worker init --port 9000 --disk-limit 85     Update port and disk usage limit
  $ kumix-worker init --timezone Asia/Jakarta         Update recurring schedule timezone
  $ kumix-worker serve                                Start API + dashboard on 127.0.0.1
  $ kumix-worker serve --host 0.0.0.0                 Expose API + dashboard on network
  $ kumix-worker serve --port 9000                    Start on custom port
  $ kumix-worker status                               Show config, binaries, disk, and cache
  $ kumix-worker doctor                               Run preflight checks
  $ kumix-worker token                                Print masked API token
  $ kumix-worker token --show                         Print full API token
  $ kumix-worker token --regenerate                   Rotate API token and re-encrypt stream keys
  $ kumix-worker password --password <pw>             Reset the dashboard login password
  $ kumix-worker update --check                       Check npm for newer worker version
  $ kumix-worker update --restart                     Update and restart when safe
  $ kumix-worker update --force                       Update and restart even with active streams
  $ kumix-worker update --force --auto-start          Restart, then start previous active streams again
  $ kumix-worker reset --yes                          Stop streams and clear database/cache
  $ kumix-worker reset --force --yes                  Clear data despite active stream warnings
  $ kumix-worker reset --all --yes                    Factory reset config and data

Commands:
  init       Create or update local config.
  serve      Run the local API, dashboard, scheduler, and stream recovery.
  status     Print local config, FFmpeg/FFprobe health, disk usage, and cache size.
  doctor     Run preflight checks for binaries, config, token, and disk limit.
  token      Print or rotate the local API token (not the dashboard password).
  password   Reset the dashboard login password.
  update     Update @kumix/worker from npm.
  reset      Stop active streams and delete worker data.

Security:
  Dashboard login uses a password (default 123456). Change it via Settings or 'kumix-worker password'.
  API token is separate: Bearer auth, stream-key encryption, signed URLs.
  Tokens are masked by default. Use token --show only in a trusted terminal.
  Default host is 127.0.0.1. Use --host 0.0.0.0 only behind trusted network controls.

Data directory:
   Config, database, tombstones, and source cache live in ~/.kumix-worker.
   Override with KUMIX_WORKER_DATA_DIR.
   Restrict public API CORS with KUMIX_WORKER_CORS_ORIGINS=https://app.example.com.

Dashboard:
  Run "kumix-worker serve" then open the Dashboard URL printed in the console.
  Sign in with the dashboard password (not the API token).
`;
