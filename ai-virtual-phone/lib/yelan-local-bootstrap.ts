import { loadApiConfigs, saveApiConfigs, loadBindingConfig, saveBindingConfig, loadPresets, loadWorldBooks, loadRegexes, savePresets, saveWorldBooks, saveRegexes } from "./settings-storage";
import type { ApiConfig } from "./settings-types";
import { isYelanManaged, yelanRequest } from './yelan-managed-client';
import { saveCharacters } from './character-storage';
import { buildManagedRoleSettings, type ManagedRole } from './yelan-role-rules';
import { hydrateSettingsDb } from './settings-db';
import { kvSet } from './kv-db';

export async function bootstrapYelanLocal() {
  if (isYelanManaged) {
    const boot = await yelanRequest<{ userId: string; characters: ManagedRole[]; imageGeneration?: boolean }>('/phone/bootstrap');
    await hydrateSettingsDb();
    kvSet('yelan-image-enabled', String(Boolean(boot.imageGeneration)));
    const roleSettings = boot.characters.map(buildManagedRoleSettings);
    // Platform bindings are refreshed, but unrelated user-authored material is retained.
    savePresets([...loadPresets().filter(item => !item.id.startsWith('yelan:')), ...roleSettings.map(settings => settings.preset)]);
    saveWorldBooks([...loadWorldBooks().filter(item => !item.id.startsWith('yelan:')), ...roleSettings.map(settings => settings.worldBook)]);
    saveRegexes([...loadRegexes().filter(item => !item.id.startsWith('yelan:')), ...roleSettings.map(settings => settings.regex)]);
    const now = new Date().toISOString();
    saveCharacters(boot.characters.map(character => ({ ...character, createdAt: now, updatedAt: character.updatedAt || now })));
    const configs: ApiConfig[] = boot.characters.map(character => ({
      id: `yelan:${character.id}`, name: '夜阑托管', provider: 'Custom', apiKey: 'server-managed',
      baseUrl: `/api/host/phone/characters/${encodeURIComponent(character.id)}`,
      defaultModel: 'yelan-managed', enableNativeTools: false, enableImageRecognition: true, enableImageGeneration: Boolean(boot.imageGeneration),
    }));
    saveApiConfigs(configs);
    const bindings = loadBindingConfig();
    for (const slot of Object.values(bindings.appDefaults || {})) if (slot) slot.apiConfigId = configs[0]?.id;
    bindings.globalDefaults.apiConfigId = configs[0]?.id;
    for (const character of boot.characters) {
      let binding = bindings.characterBindings.find(item => item.characterId === character.id);
      if (!binding) { binding = { characterId: character.id, defaults: {}, appOverrides: {} }; bindings.characterBindings.push(binding); }
      binding.defaults.apiConfigId = `yelan:${character.id}`;
      binding.defaults.presetId = `yelan:${character.id}:preset`;
      binding.defaults.worldBookIds = [...new Set([`yelan:${character.id}:worldbook`, ...(binding.defaults.worldBookIds || []).filter(id => !id.startsWith('yelan:'))])];
      binding.defaults.regexIds = [...new Set([`yelan:${character.id}:regex`, ...(binding.defaults.regexIds || []).filter(id => !id.startsWith('yelan:'))])];
      for (const slot of Object.values(binding.appOverrides)) if (slot) slot.apiConfigId = `yelan:${character.id}`;
    }
    saveBindingConfig(bindings);
    try {
      const { startPhoneInspection } = await import('./phone-inspection-client');
      startPhoneInspection(boot.userId);
    } catch { /* Inspection availability must not prevent the phone from opening. */ }
    return;
  }
  if (process.env.NEXT_PUBLIC_YELAN_PHONE_LOCAL !== "true") return;
  const response = await fetch("/api/yelan/config", { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("夜阑共用配置加载失败");
  const shared: ApiConfig = await response.json();
  const configs = loadApiConfigs();
  const previous = configs.findIndex(c => c.id === shared.id);
  if (previous >= 0) configs[previous] = shared;
  else configs.unshift(shared);
  saveApiConfigs(configs);
  const bindings = loadBindingConfig();
  if (!bindings.globalDefaults.apiConfigId) {
    bindings.globalDefaults.apiConfigId = shared.id;
    saveBindingConfig(bindings);
  }
}
