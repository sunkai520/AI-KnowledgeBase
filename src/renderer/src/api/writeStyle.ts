import exctronAxios from "../config/axios";

export function add(params: any) {
  return exctronAxios.post("/writeStyle/add", params);
}

export function getCurrentProfile() {
  return exctronAxios.get("/writeStyle/current");
}

export function updateCurrentProfile(params: any) {
  return exctronAxios.put("/writeStyle/current", params);
}

export function listProfileFeedbackSessions(params: any) {
  return exctronAxios.get("/writeStyle/feedback/sessions", { params });
}

export function getProfileFeedbackSessionDetail(params: any) {
  return exctronAxios.get("/writeStyle/feedback/session/detail", { params });
}

export function deleteProfileFeedbackSession(params: any) {
  return exctronAxios.get("/writeStyle/feedback/session/delete", { params });
}

export function suggestProfileFeedbackSession(params: any) {
  return exctronAxios.post("/writeStyle/feedback/session/suggest", params);
}

export function applyProfileFeedbackSession(params: any) {
  return exctronAxios.post("/writeStyle/feedback/session/apply", params);
}

export function restoreProfileHistory(params: any) {
  return exctronAxios.post("/writeStyle/history/restore", params);
}

export function appendProfileSample(params: any) {
  return exctronAxios.post("/writeStyle/appendSample", params);
}

export function deleteProfileSample(params: any) {
  return exctronAxios.get("/writeStyle/sample/delete", { params });
}

export function list(params: any) {
  return exctronAxios.get("/writeStyle/list", { params });
}

export function detail(id: any) {
  return exctronAxios.get(`/writeStyle/detail/${id}`);
}

export function del(params: any) {
  return exctronAxios.get("/writeStyle/delete", { params });
}
