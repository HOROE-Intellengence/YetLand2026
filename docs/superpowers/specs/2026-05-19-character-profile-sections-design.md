# Character Profile Sections Design

Date: 2026-05-19
Status: Draft for user review

## Goal

Expand character settings so operators can maintain richer private persona details such as story, verbal habits, hobbies, family status, and custom sections. These details must be injected into the main AI prompt in a structured way while preserving existing character behavior, public API boundaries, and the current thin sidecar architecture.

This is not a multi-agent platform change. It is a character-card data and prompt-assembly extension.

## Current Context

Characters are stored server-side in `state.characters` and later map to the `characters` database table. Runtime prompt assembly reads the current character row through `charactersService.getRow()` and formats it in `loadCharacterCard()`. Admin character CRUD already supports fields such as `description`, `styleTags`, `forbiddenPhrases`, and opening lines.

The public character API can expose character metadata to the web frontend. Private prompt-only persona material must not be returned through public character list/detail responses.

The current character card is injected every chat turn. This design keeps that behavior. No five-turn reminder cadence is added because it would weaken persona consistency and introduce avoidable prompt drift.

## Data Model

Add a new optional character field:

```ts
profileSections: Array<{
  key: string;
  value: string;
  order: number;
}>
```

Rules:

- Existing characters default to an empty array.
- `key` is the section label shown in admin and rendered into the prompt.
- `value` is the private persona content for that section.
- `order` controls display and prompt order.
- Empty keys or empty values are rejected or stripped before save.
- Suggested section labels are `故事`, `口癖`, `爱好`, and `家庭状况`, but operators can add any section.

For the current JSON-backed store, `CharacterRow` gains `profileSections`. For the future Postgres path, add a migration with `profile_sections jsonb NOT NULL DEFAULT '[]'`.

## API Boundaries

Admin character create, patch, and list responses include `profileSections`.

Public character responses do not include `profileSections`. The public frontend may continue receiving `description`, opening lines, style tags, and other existing fields, but private persona sections remain admin-only and prompt-only.

This avoids leaking backstage prompt material into the user-facing app.

## Admin UX

The React admin character editor gains a visual "设定项目" area:

- Add section button.
- Default quick-add suggestions: `故事`, `口癖`, `爱好`, `家庭状况`.
- Each section has a label input and a textarea.
- Sections can be removed.
- Sections are saved with the rest of the character card and require the existing change reason.

Sorting can initially be simple: preserve the displayed array order and write sequential `order` values on submit. Drag-and-drop is not required for the first implementation.

## Prompt Assembly

`loadCharacterCard()` formats `profileSections` after the base description and before forbidden phrases:

```text
# 角色 · 沈砚之

基础描述：
...

设定细节：
- 故事：...
- 口癖：...
- 爱好：...
- 家庭状况：...

禁用语：...
```

If there are no sections, the prompt remains compatible with the current output. The sections are injected every turn with the character card.

## Non-Goals

- Do not create an `agent_config` table.
- Do not restore or invent a generic `#agents` panel.
- Do not make sidecar AI responsible for maintaining these fields in this iteration.
- Do not expose private persona sections through public character endpoints.
- Do not change character prompt injection to a five-turn cadence.
- Do not redesign prelude cards or sidecar prompt configuration.

## Testing

Add focused coverage:

- Character service defaults old rows to `profileSections: []`.
- Admin create/patch accepts and persists valid `profileSections`.
- Public character schemas and routes do not return `profileSections`.
- `loadCharacterCard()` renders sections in order into the prompt.
- Existing character rows without `profileSections` still load and chat normally.

Run at minimum:

```powershell
pnpm --filter @yelan/shared typecheck
pnpm --filter @yelan/api test
pnpm --filter @yelan/admin typecheck
```

For broader confidence after implementation:

```powershell
pnpm typecheck
pnpm test:gray
```

## Rollout

Implement as a backward-compatible schema extension. No existing state reset is required. Existing characters show an empty "设定项目" list in admin until operators add sections.

If bad content is entered, rollback is an admin edit that clears the sections. No deploy rollback should be required.
