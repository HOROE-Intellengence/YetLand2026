import { loadApiConfigs, saveApiConfigs, loadBindingConfig, saveBindingConfig } from "./settings-storage";
import type { ApiConfig } from "./settings-types";

export async function bootstrapYelanLocal() {
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
