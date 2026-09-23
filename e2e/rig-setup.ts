/** Run the fixture reset before probing the server that will serve the journey. */
export async function prepareRig(
  seed: () => unknown | Promise<unknown>,
  healthCheck: () => Promise<void>,
): Promise<void> {
  await seed();
  await healthCheck();
}
