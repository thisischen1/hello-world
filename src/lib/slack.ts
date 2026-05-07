// Coordinator alerts. No-ops if SLACK_WEBHOOK_URL isn't set, so dev runs stay quiet.

const url = process.env['SLACK_WEBHOOK_URL'];

const PREFIX = { info: ':eyes:', warn: ':warning:', error: ':rotating_light:' } as const;

export async function slackAlert(
  text: string,
  level: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `${PREFIX[level]} ${text}` }),
    });
  } catch (err) {
    // Don't let Slack failures break the workflow that's trying to alert.
    console.error('slack send failed:', err);
  }
}
