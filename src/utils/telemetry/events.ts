export function redactIfDisabled(content: string): string {
  void content
  return '<REDACTED>'
}

export async function logOTelEvent(
  eventName: string,
  metadata: { [key: string]: string | undefined } = {},
): Promise<void> {
  void eventName
  void metadata
}
