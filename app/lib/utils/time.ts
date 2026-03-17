function nowIso(): string {
  return new Date().toISOString()
}

function addSeconds(isoOrDate: string | Date, seconds: number): string {
  const d =
    isoOrDate instanceof Date ? new Date(isoOrDate) : new Date(isoOrDate)
  d.setSeconds(d.getSeconds() + seconds)
  return d.toISOString()
}

function isExpired(expiresAt: string | Date, now = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime()
}

export { addSeconds, isExpired, nowIso }
