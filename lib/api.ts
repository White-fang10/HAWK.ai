const API_URL = "/api";

export function getAuthHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("hawk_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface Student {
  id: number;
  name: string;
  roll: string;
  email: string;
  phone: string;
  avatar: string;
  attendance: number;
  status: "present" | "absent" | "late";
}

export async function getStudents(): Promise<Student[]> {
  const res = await fetch(`${API_URL}/students`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch students");
  return res.json();
}

export async function createStudent(data: Omit<Student, "id" | "attendance" | "status">): Promise<Student> {
  const res = await fetch(`${API_URL}/students`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.detail || "Failed to create student");
  }
  return res.json();
}

export async function trainStudentFace(studentId: number, files: File | File[]): Promise<void> {
  const formData = new FormData();
  const fileList = Array.isArray(files) ? files : [files];
  fileList.forEach(file => formData.append("files", file));
  const res = await fetch(`${API_URL}/students/${studentId}/train`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: formData,
  });
  if (!res.ok) {
    const errorDetails = await res.json().catch(() => ({}));
    throw new Error(errorDetails.detail || "Failed to register student face");
  }
}

export async function deleteStudent(studentId: number): Promise<void> {
  const res = await fetch(`${API_URL}/students/${studentId}`, { 
    method: "DELETE",
    headers: getAuthHeaders() 
  });
  if (!res.ok) throw new Error("Failed to delete student");
}

export async function updateStudent(
  studentId: number,
  data: Partial<Omit<Student, "id" | "attendance" | "status">>
): Promise<Student> {
  const res = await fetch(`${API_URL}/students/${studentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.detail || "Failed to update student");
  }
  return res.json();
}

export async function getDailyAnalytics() {
  const res = await fetch(`${API_URL}/analytics/daily`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch daily analytics");
  return res.json();
}

export async function getWeeklyAnalytics() {
  const res = await fetch(`${API_URL}/analytics/weekly`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch weekly analytics");
  return res.json();
}

export async function getAlerts() {
  const res = await fetch(`${API_URL}/alerts`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch alerts");
  return res.json();
}

export async function getClassInsights() {
  const res = await fetch(`${API_URL}/analytics/insights`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch class insights");
  return res.json();
}

export async function getSummaryStats() {
  const res = await fetch(`${API_URL}/analytics/summary`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch summary stats");
  return res.json();
}

export async function resetAttendance(): Promise<void> {
  const res = await fetch(`${API_URL}/attendance/reset`, { 
    method: "POST",
    headers: getAuthHeaders() 
  });
  if (!res.ok) throw new Error("Failed to reset attendance");
}

export async function getAttendanceDistribution(): Promise<{ name: string; value: number; fill: string }[]> {
  const res = await fetch(`${API_URL}/analytics/distribution`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch distribution");
  return res.json();
}

/**
 * Fetches a report from the backend and triggers a browser file download.
 * @param period  "daily" | "weekly" | "monthly"
 * @param format  "excel" | "pdf"
 */
export async function downloadReport(period: string, format: "excel" | "pdf"): Promise<void> {
  const endpoint = `${API_URL}/reports/${period}/${format}`;
  const res = await fetch(endpoint, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to download ${format} report`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ext = format === "excel" ? "xlsx" : "pdf";
  a.href = url;
  a.download = `hawk_ai_${period}_report.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// BURST ATTENDANCE (new architecture)
// ─────────────────────────────────────────────

export interface ConfirmedStudent {
  student_id: number;
  name: string;
  votes: number;
  out_of: number;
}

export interface BurstResult {
  confirmed: ConfirmedStudent[];
  total_marked: number;
  frame_details?: unknown[];
}

/**
 * Sends 5 captured JPEG frames to the backend burst endpoint.
 * The backend runs SCRFD detection + GhostFaceNet recognition on each frame,
 * then uses 3-of-5 voting to confirm student presence.
 */
export async function processBurst(frames: Blob[]): Promise<BurstResult> {
  const formData = new FormData();
  // Field name MUST be "files" (plural) to match FastAPI List[UploadFile]
  frames.forEach((b) => formData.append("files", b, "frame.jpg"));
  const res = await fetch(`${API_URL}/attendance/burst`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Burst processing failed (${res.status})`);
  }
  return res.json();
}

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────

export interface BackendHealth {
  status: string;
  students_total: number;
  students_enrolled: number;
  index_size: number;
  detector: string;
  recognizer: string;
  mode: string;
}

/**
 * Checks backend health and returns model/status information.
 * Does NOT require authentication — safe to call before login.
 */
export async function checkBackendHealth(): Promise<BackendHealth> {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) throw new Error("Backend health check failed");
  return res.json();
}
