export function calMacNotificationInfo(notices: Array<{
  title: string;
  detail: string;
  disruptionReason?: string | null | undefined;
}>): string {
  return JSON.stringify(notices
    .map(({ title, detail, disruptionReason }) => ({
      title,
      detail,
      disruptionReason: disruptionReason ?? null
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
