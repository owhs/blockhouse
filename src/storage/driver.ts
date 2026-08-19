// Storage abstraction. All content, media and template reads go through a driver,
// so the same code serves a local folder, an R2 bucket, memory, or (experimentally)
// a browser directory handle via the File System Access API.

export interface StatInfo { size: number; mtime: number }

export interface StorageDriver {
  read(key: string): Promise<Uint8Array | null>
  readText(key: string): Promise<string | null>
  write(key: string, data: Uint8Array | string): Promise<void>
  delete(key: string): Promise<void>
  /** Recursive list of file keys under prefix (keys are relative, '/'-separated). */
  list(prefix: string): Promise<string[]>
  stat(key: string): Promise<StatInfo | null>
  move?(from: string, to: string): Promise<void>
}

export async function moveKey(d: StorageDriver, from: string, to: string) {
  if (d.move) return d.move(from, to)
  const data = await d.read(from)
  if (data == null) return
  await d.write(to, data)
  await d.delete(from)
}
