import type { PrototypeResource } from './catalog';

/** Project only published authoring fields, never account copies, notes, or voice bindings. */
export function characterPreview(resource: PrototypeResource, compact = false) {
  const payload = resource.type === 'character' ? resource.payload : undefined;
  if (!payload) return null;
  const excerpt = (value: string | undefined, max: number) => {
    const text = (value || '').trim();
    return compact && text.length > max ? `${text.slice(0, max)}…` : text;
  };
  return {
    name: payload.name,
    background: excerpt(payload.worldbook?.background, 160),
    location: excerpt(payload.card?.initialState?.location, 60),
    opening: excerpt(payload.card?.initialState?.action, 130),
    ...(!compact
      ? {
          principles: payload.worldbook?.corePrinciples || '',
          style: payload.worldbook?.rules || '',
          boundaries: payload.worldbook?.forbiddenRules || '',
          relationshipByUser: payload.card?.relationshipByUser || '',
          relationshipByChar: payload.card?.relationshipByChar || '',
        }
      : {}),
  };
}
