const API_URL = "/api";


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
  const res = await fetch(`${API_URL}/students`);
  if (!res.ok) throw new Error("Failed to fetch students");
  return res.json();
}

export async function createStudent(data: Omit<Student, "id" | "attendance" | "status">): Promise<Student> {
  const res = await fetch(`${API_URL}/students`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.detail || "Failed to create student");
  }
  return res.json();
}

export async function trainStudentFace(studentId: number, file: File): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_URL}/students/${studentId}/train`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const errorDetails = await res.json().catch(() => ({}));
    throw new Error(errorDetails.detail || "Failed to register student face");
  }
}

export async function deleteStudent(studentId: number): Promise<void> {
  const res = await fetch(`${API_URL}/students/${studentId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete student");
}

export async function getDailyAnalytics() {
  const res = await fetch(`${API_URL}/analytics/daily`);
  if (!res.ok) throw new Error("Failed to fetch daily analytics");
  return res.json();
}

export async function getWeeklyAnalytics() {
  const res = await fetch(`${API_URL}/analytics/weekly`);
  if (!res.ok) throw new Error("Failed to fetch weekly analytics");
  return res.json();
}

export async function getAlerts() {
  const res = await fetch(`${API_URL}/alerts`);
  if (!res.ok) throw new Error("Failed to fetch alerts");
  return res.json();
}

export async function getClassInsights() {
  const res = await fetch(`${API_URL}/analytics/insights`);
  if (!res.ok) throw new Error("Failed to fetch class insights");
  return res.json();
}

export async function getSummaryStats() {
  const res = await fetch(`${API_URL}/analytics/summary`);
  if (!res.ok) throw new Error("Failed to fetch summary stats");
  return res.json();
}

export async function resetAttendance(): Promise<void> {
  const res = await fetch(`${API_URL}/attendance/reset`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to reset attendance");
}

export async function getAttendanceDistribution(): Promise<{ name: string; value: number; fill: string }[]> {
  const res = await fetch(`${API_URL}/analytics/distribution`);
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
  const res = await fetch(endpoint);
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

export interface Camera {
  index: number;
  label: string;
}

/** Returns the list of connected cameras from the backend. */
export async function getCameras(): Promise<Camera[]> {
  const res = await fetch(`${API_URL}/camera/list`);
  if (!res.ok) throw new Error("Failed to fetch camera list");
  return res.json();
}

/**
 * Tells the backend to switch to camera `index`.
 * Resolves when the switch is confirmed, rejects on error.
 */
export async function switchCamera(index: number): Promise<void> {
  const res = await fetch(`${API_URL}/camera/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to switch to camera ${index}`);
  }
}
