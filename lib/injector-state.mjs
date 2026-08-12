export async function needsPreviewAttachment({ client, attachedTargetId, nextTargetId }) {
  if (!nextTargetId) return false;
  if (!client || nextTargetId !== attachedTargetId) return true;
  const runtimeAlive = await client.evaluate(
    "Boolean(window.__codexConversationPreviewInjection__)",
  );
  return !runtimeAlive;
}
