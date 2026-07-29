import exctronAxios from '../config/axios';

// ── Sessions ──────────────────────────────────────────────────────────────
export function getAgentSessions() {
  return exctronAxios.get('/deepAgent/sessions');
}
export function createAgentSession(name?: string) {
  return exctronAxios.post('/deepAgent/sessions', { name });
}
export function deleteAgentSession(sessionId: string) {
  return exctronAxios.delete(`/deepAgent/sessions/${sessionId}`);
}
export function getSessionMessages(sessionId: string) {
  return exctronAxios.get(`/deepAgent/sessions/${sessionId}/messages`);
}
export function updateSessionWorkDir(sessionId: string, workDir: string) {
  return exctronAxios.put(`/deepAgent/sessions/${sessionId}/workdir`, { workDir });
}
export function updateSessionPermission(sessionId: string, permissionLevel: 'auto' | 'confirm') {
  return exctronAxios.put(`/deepAgent/sessions/${sessionId}/permission`, { permissionLevel });
}

// ── Skills ────────────────────────────────────────────────────────────────
export function getAgentSkills() {
  return exctronAxios.get('/deepAgent/skills');
}
export function updateSkillEnabled(name: string, enabled: boolean) {
  return exctronAxios.put(`/deepAgent/skills/${name}`, { enabled });
}
export function createSkill(data: { name: string; displayName?: string; description?: string }) {
  return exctronAxios.post('/deepAgent/skills', data);
}
export function getSkillContent(name: string) {
  return exctronAxios.get(`/deepAgent/skills/${name}/content`);
}
export function saveSkillContent(name: string, content: string) {
  return exctronAxios.put(`/deepAgent/skills/${name}/content`, { content });
}
export function deleteSkill(name: string) {
  return exctronAxios.delete(`/deepAgent/skills/${name}`);
}
export function previewSkillImport(data: { mode: 'url' | 'zip' | 'folder'; url?: string; zipBase64?: string; fileName?: string; dirPath?: string }) {
  return exctronAxios.post('/deepAgent/skills/import/preview', data);
}
export function confirmSkillImport(data: { dirName: string; filesBase64: Record<string, string>; meta?: any }) {
  return exctronAxios.post('/deepAgent/skills/import/confirm', data);
}

// ── Agent 主模型配置 ───────────────────────────────────────────────────────
export function getAgentModelConfig() {
  return exctronAxios.get('/deepAgent/agent-config');
}
export function saveAgentModelConfig(config: { provider: string; modelName: string; temperature: number }) {
  return exctronAxios.put('/deepAgent/agent-config', config);
}
