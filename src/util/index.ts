export function assertNever(x: never): never {
  throw x;
}

export async function sleep(ms: number) {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), ms));
}
