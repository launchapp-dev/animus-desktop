import { invoke } from "@tauri-apps/api/core";

import type { TemplateRender } from "../types/project";

export function templateRender(
  language: string,
  template: string,
): Promise<TemplateRender> {
  return invoke<TemplateRender>("template_render", { language, template });
}
